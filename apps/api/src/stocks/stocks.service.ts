import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import type {
  Currency,
  EsppPlan as EsppPlanDto,
  EsppProjection,
  StockFundamentals as StockFundamentalsDto,
  StockLot as StockLotDto,
  StockPosition,
  StockPriceHistory as StockPriceHistoryDto,
  StockQuote as StockQuoteDto,
  StockTarget as StockTargetDto,
  StocksSummary,
  SuggestedTarget,
} from '@life-portal/shared-types';
import {
  addMonths,
  earmarkedByLoan,
  foldPositions,
  liquidationValueCents,
  maxTargetHorizonMonths,
  nextEsppGrant,
  projectEspp,
  suggestTargetPrice,
  toDay,
} from '@life-portal/shared-domain';
import { FinnhubProvider } from './finnhub.provider';
import {
  EsppPlan,
  StockFundamentals,
  StockLot,
  StockPriceHistory,
  StockQuote,
  StockTarget,
} from './stocks.schemas';
import type {
  CreateLotDto,
  SellLotDto,
  SetManualQuoteDto,
  UpsertEsppPlanDto,
  UpsertTargetDto,
} from './stocks.dto';

/** A quote older than this is shown as stale so the user knows not to trust it. */
const QUOTE_STALE_AFTER_DAYS = 4;

@Injectable()
export class StocksService {
  private readonly logger = new Logger(StocksService.name);

  constructor(
    @InjectModel(StockLot.name) private readonly lots: Model<StockLot>,
    @InjectModel(StockQuote.name) private readonly quotes: Model<StockQuote>,
    @InjectModel(StockPriceHistory.name) private readonly history: Model<StockPriceHistory>,
    @InjectModel(StockFundamentals.name) private readonly fundamentals: Model<StockFundamentals>,
    @InjectModel(StockTarget.name) private readonly targets: Model<StockTarget>,
    @InjectModel(EsppPlan.name) private readonly esppPlans: Model<EsppPlan>,
    private readonly finnhub: FinnhubProvider,
  ) {}

  // ---------------------------------------------------------------- lots

  async listLots(userId: string): Promise<StockLotDto[]> {
    const rows = await this.lots.find({ userId }).sort({ symbol: 1, purchaseDate: 1 });
    return rows.map((r) => r.toJSON() as unknown as StockLotDto);
  }

  async createLot(userId: string, dto: CreateLotDto): Promise<StockLotDto> {
    const created = await this.lots.create({ ...dto, symbol: dto.symbol.toUpperCase(), userId });
    // A brand-new symbol has no price until someone asks for one, so fetch it immediately
    // rather than showing an empty position until the next scheduled refresh.
    await this.ensureQuote(created.symbol);
    return created.toJSON() as unknown as StockLotDto;
  }

  async updateLot(userId: string, id: string, dto: Partial<CreateLotDto>): Promise<StockLotDto> {
    const patch = dto.symbol ? { ...dto, symbol: dto.symbol.toUpperCase() } : dto;
    const updated = await this.lots.findOneAndUpdate({ _id: this.oid(id), userId }, { $set: patch }, { new: true, runValidators: true });
    if (!updated) throw new NotFoundException(`Lot ${id} not found`);
    return updated.toJSON() as unknown as StockLotDto;
  }

  async sellLot(userId: string, id: string, dto: SellLotDto, today: string): Promise<StockLotDto> {
    const lot = await this.lots.findOne({ _id: this.oid(id), userId });
    if (!lot) throw new NotFoundException(`Lot ${id} not found`);

    const alreadySold = lot.soldQuantity ?? 0;
    const quantity = dto.quantity ?? lot.quantity - alreadySold;
    if (quantity <= 0 || alreadySold + quantity > lot.quantity) {
      throw new NotFoundException(`Lot ${id} does not have ${quantity} shares left to sell`);
    }

    lot.soldQuantity = alreadySold + quantity;
    lot.soldPricePerShareCents = dto.pricePerShareCents;
    lot.soldAt = dto.soldAt ?? today;
    await lot.save();
    return lot.toJSON() as unknown as StockLotDto;
  }

  async removeLot(userId: string, id: string) {
    const deleted = await this.lots.findOneAndDelete({ _id: this.oid(id), userId });
    if (!deleted) throw new NotFoundException(`Lot ${id} not found`);
    return { id, deleted: true as const };
  }

  // ---------------------------------------------------------------- targets

  async listTargets(userId: string): Promise<StockTargetDto[]> {
    const rows = await this.targets.find({ userId });
    return rows.map((r) => r.toJSON() as unknown as StockTargetDto);
  }

  async upsertTarget(userId: string, dto: UpsertTargetDto): Promise<StockTargetDto> {
    const symbol = dto.symbol.toUpperCase();
    const saved = await this.targets.findOneAndUpdate(
      { userId, symbol },
      {
        $set: {
          targetPriceCents: dto.targetPriceCents,
          horizonMonths: dto.horizonMonths ?? 12,
          rationale: dto.rationale,
          stopPriceCents: dto.stopPriceCents,
        },
      },
      { new: true, upsert: true },
    );
    return saved.toJSON() as unknown as StockTargetDto;
  }

  async removeTarget(userId: string, symbol: string) {
    await this.targets.deleteOne({ userId, symbol: symbol.toUpperCase() });
    return { symbol: symbol.toUpperCase(), deleted: true as const };
  }

  // ---------------------------------------------------------------- quotes

  async setManualQuote(dto: SetManualQuoteDto, today: string): Promise<StockQuoteDto> {
    const symbol = dto.symbol.toUpperCase();
    const saved = await this.quotes.findOneAndUpdate(
      { symbol },
      {
        $set: {
          pricePerShareCents: dto.pricePerShareCents,
          currency: dto.currency ?? 'USD',
          fiftyTwoWeekHighCents: dto.fiftyTwoWeekHighCents,
          fetchedAt: today,
          provider: 'manual',
          stale: false,
        },
      },
      { new: true, upsert: true },
    );
    await this.appendHistoryPoint(symbol, today, dto.pricePerShareCents);
    return saved.toJSON() as unknown as StockQuoteDto;
  }

  /** Fetches a quote only if none exists yet. Used when a new symbol appears. */
  private async ensureQuote(symbol: string): Promise<void> {
    if (await this.quotes.exists({ symbol })) return;
    await this.refreshSymbol(symbol);
  }

  /**
   * Refreshes one symbol's quote and appends today's close to its history.
   *
   * Returns false when the provider could not help, leaving any previous quote in place and
   * flagged stale rather than deleting it — a stale price beats no price.
   */
  async refreshSymbol(symbol: string, today = new Date().toISOString().slice(0, 10)): Promise<boolean> {
    const upper = symbol.toUpperCase();
    const quote = await this.finnhub.fetchQuote(upper);
    if (!quote) {
      await this.quotes.updateOne({ symbol: upper }, { $set: { stale: true } });
      return false;
    }

    const metrics = await this.finnhub.fetchMetrics(upper);

    await this.quotes.findOneAndUpdate(
      { symbol: upper },
      {
        $set: {
          pricePerShareCents: quote.pricePerShareCents,
          previousClosePerShareCents: quote.previousClosePerShareCents,
          dayChangePct: quote.dayChangePct,
          fiftyTwoWeekHighCents: metrics?.fiftyTwoWeekHighCents,
          fiftyTwoWeekLowCents: metrics?.fiftyTwoWeekLowCents,
          currency: 'USD',
          fetchedAt: today,
          provider: 'finnhub',
          stale: false,
        },
      },
      { upsert: true },
    );

    if (metrics) {
      await this.fundamentals.findOneAndUpdate(
        { symbol: upper },
        {
          $set: {
            epsTtm: metrics.epsTtm,
            peTtm: metrics.peTtm,
            epsGrowthPct: metrics.epsGrowthPct,
            beta: metrics.beta,
            fetchedAt: today,
          },
        },
        { upsert: true },
      );
    }

    await this.appendHistoryPoint(upper, today, quote.pricePerShareCents);
    return true;
  }

  /** Refreshes every symbol the user actually holds. */
  async refreshAll(userId?: string, today = new Date().toISOString().slice(0, 10)) {
    const symbols = await this.trackedSymbols(userId);
    const results: { symbol: string; refreshed: boolean }[] = [];
    for (const symbol of symbols) {
      results.push({ symbol, refreshed: await this.refreshSymbol(symbol, today) });
    }
    return {
      today,
      provider: this.finnhub.isConfigured ? 'finnhub' : 'manual',
      unavailableReason: this.finnhub.unavailableReason,
      results,
    };
  }

  /**
   * Fetches the peer-median P/E, which the suggested-target heuristic needs and which costs
   * several API calls — hence on demand rather than on every refresh.
   */
  async refreshFundamentals(symbol: string, today = new Date().toISOString().slice(0, 10)) {
    const upper = symbol.toUpperCase();
    const [metrics, peerPe] = await Promise.all([
      this.finnhub.fetchMetrics(upper),
      this.finnhub.fetchPeerPe(upper),
    ]);
    if (!metrics && peerPe == null) {
      return { symbol: upper, updated: false, reason: this.finnhub.unavailableReason ?? 'No data returned' };
    }
    await this.fundamentals.findOneAndUpdate(
      { symbol: upper },
      {
        $set: {
          ...(metrics
            ? { epsTtm: metrics.epsTtm, peTtm: metrics.peTtm, epsGrowthPct: metrics.epsGrowthPct, beta: metrics.beta }
            : {}),
          ...(peerPe != null ? { peerPe } : {}),
          fetchedAt: today,
        },
      },
      { upsert: true },
    );
    return { symbol: upper, updated: true, peerPe };
  }

  /** One point per day; re-running on the same day corrects rather than duplicates. */
  private async appendHistoryPoint(symbol: string, date: string, closeCents: number): Promise<void> {
    const existing = await this.history.findOne({ symbol });
    if (!existing) {
      await this.history.create({ symbol, points: [{ date, closeCents }], fetchedAt: date });
      return;
    }
    const index = existing.points.findIndex((p) => p.date === date);
    if (index >= 0) existing.points[index].closeCents = closeCents;
    else existing.points.push({ date, closeCents });
    existing.points.sort((a, b) => (a.date < b.date ? -1 : 1));
    existing.fetchedAt = date;
    await existing.save();
  }

  async importHistory(symbol: string, points: { date: string; closeCents: number }[], today: string) {
    const upper = symbol.toUpperCase();
    const existing = await this.history.findOne({ symbol: upper });
    const merged = new Map<string, number>(
      (existing?.points ?? []).map((p) => [p.date, p.closeCents]),
    );
    for (const point of points) merged.set(toDay(point.date), point.closeCents);

    const sorted = [...merged.entries()]
      .map(([date, closeCents]) => ({ date, closeCents }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    await this.history.findOneAndUpdate(
      { symbol: upper },
      { $set: { points: sorted, fetchedAt: today } },
      { upsert: true },
    );
    return { symbol: upper, pointCount: sorted.length };
  }

  async getHistory(symbol: string): Promise<StockPriceHistoryDto | null> {
    const found = await this.history.findOne({ symbol: symbol.toUpperCase() });
    return found ? (found.toJSON() as unknown as StockPriceHistoryDto) : null;
  }

  // ---------------------------------------------------------------- positions

  /** Symbols the user holds, plus any covered by an ESPP plan. */
  async trackedSymbols(userId?: string): Promise<string[]> {
    const filter = userId ? { userId } : {};
    const [lotSymbols, esppSymbols] = await Promise.all([
      this.lots.distinct('symbol', filter),
      this.esppPlans.distinct('symbol', { ...filter, active: true }),
    ]);
    return [...new Set([...lotSymbols, ...esppSymbols])].filter(Boolean).map((s) => String(s).toUpperCase());
  }

  async positions(userId: string, today: string): Promise<StockPosition[]> {
    const [lots, targets] = await Promise.all([this.listLots(userId), this.listTargets(userId)]);
    const symbols = [...new Set(lots.map((l) => l.symbol.toUpperCase()))];

    const [quoteRows, historyRows, fundamentalRows] = await Promise.all([
      this.quotes.find({ symbol: { $in: symbols } }),
      this.history.find({ symbol: { $in: symbols } }),
      this.fundamentals.find({ symbol: { $in: symbols } }),
    ]);

    const quotes: Record<string, StockQuoteDto> = {};
    for (const row of quoteRows) {
      const quote = row.toJSON() as unknown as StockQuoteDto;
      // Recomputed on read so an unrefreshed quote starts showing as stale on its own.
      quote.stale = quote.stale || this.isStale(quote.fetchedAt, today);
      quotes[quote.symbol] = quote;
    }

    const targetMap = Object.fromEntries(targets.map((t) => [t.symbol.toUpperCase(), t]));
    const historyMap = Object.fromEntries(
      historyRows.map((h) => [h.symbol, h.points.map((p) => ({ date: p.date, closeCents: p.closeCents }))]),
    );
    const fundamentalsMap = Object.fromEntries(
      fundamentalRows.map((f) => [f.symbol, f.toJSON() as unknown as StockFundamentalsDto]),
    );

    // Positions are folded once without suggestions to get the average cost that the
    // cost-basis hurdle term needs, then folded again with the suggestions in place.
    const provisional = foldPositions({ lots, quotes, targets: targetMap, suggestions: {}, defaultCurrency: 'USD' });

    const suggestions: Record<string, SuggestedTarget> = {};
    for (const position of provisional) {
      const quote = quotes[position.symbol];
      if (!quote) continue;
      const suggestion = suggestTargetPrice({
        symbol: position.symbol,
        currentPricePerShareCents: quote.pricePerShareCents,
        horizonMonths: targetMap[position.symbol]?.horizonMonths ?? 12,
        fiftyTwoWeekHighCents: quote.fiftyTwoWeekHighCents,
        history: historyMap[position.symbol],
        fundamentals: fundamentalsMap[position.symbol],
        averageCostPerShareCents: position.averageCostPerShareCents,
      });
      if (suggestion) suggestions[position.symbol] = suggestion;
    }

    return foldPositions({ lots, quotes, targets: targetMap, suggestions, defaultCurrency: 'USD' });
  }

  private isStale(fetchedAt: string, today: string): boolean {
    const days = (Date.parse(today) - Date.parse(fetchedAt)) / 86_400_000;
    return !Number.isFinite(days) || days > QUOTE_STALE_AFTER_DAYS;
  }

  // ---------------------------------------------------------------- espp

  async listEsppPlans(userId: string): Promise<EsppPlanDto[]> {
    const rows = await this.esppPlans.find({ userId });
    return rows.map((r) => r.toJSON() as unknown as EsppPlanDto);
  }

  async upsertEsppPlan(userId: string, dto: UpsertEsppPlanDto): Promise<EsppPlanDto> {
    const symbol = dto.symbol.toUpperCase();
    const saved = await this.esppPlans.findOneAndUpdate(
      { userId, symbol },
      {
        $set: {
          contributionPerPeriodCents: dto.contributionPerPeriodCents,
          currency: dto.currency ?? 'USD',
          discountPct: dto.discountPct ?? 0.15,
          periodBoundaries: dto.periodBoundaries ?? [
            { month: 5, day: 1 },
            { month: 11, day: 1 },
          ],
          active: dto.active ?? true,
          notes: dto.notes,
        },
      },
      { new: true, upsert: true },
    );
    return saved.toJSON() as unknown as EsppPlanDto;
  }

  /** Projected ESPP purchases for each active plan, through `through`. */
  async esppProjections(
    userId: string,
    today: string,
    through?: string,
    positions?: StockPosition[],
  ): Promise<EsppProjection[]> {
    const plans = (await this.listEsppPlans(userId)).filter((p) => p.active);
    if (!plans.length) return [];

    const resolvedPositions = positions ?? (await this.positions(userId, today));
    const horizon = through ? toDay(through) : addMonths(today, 24);
    const out: EsppProjection[] = [];

    for (const plan of plans) {
      const position = resolvedPositions.find((p) => p.symbol === plan.symbol);
      const [quote, history] = await Promise.all([
        this.quotes.findOne({ symbol: plan.symbol }),
        this.history.findOne({ symbol: plan.symbol }),
      ]);
      const currentPrice = position?.currentPricePerShareCents ?? quote?.pricePerShareCents;
      // Without any price at all there is nothing honest to project from.
      if (!currentPrice) continue;

      out.push(
        projectEspp({
          plan,
          today,
          through: horizon,
          history: (history?.points ?? []).map((p) => ({ date: p.date, closeCents: p.closeCents })),
          currentPricePerShareCents: currentPrice,
          effectiveTargetPerShareCents: position?.effectiveTargetPerShareCents,
        }),
      );
    }
    return out;
  }

  // ---------------------------------------------------------------- summary

  async summary(
    userId: string,
    today: string,
    options: { taxRate: number; currency?: Currency },
  ): Promise<StocksSummary> {
    const positions = await this.positions(userId, today);
    const esppProjections = await this.esppProjections(userId, today, undefined, positions);
    const nextGrant = esppProjections.map(nextEsppGrant).filter(Boolean)[0];

    const hasQuotes = positions.some((p) => p.currentPricePerShareCents != null);

    return {
      currency: options.currency ?? 'USD',
      positionCount: positions.length,
      totalCostCents: positions.reduce((sum, p) => sum + p.totalCostCents, 0),
      totalMarketValueCents: hasQuotes
        ? positions.reduce((sum, p) => sum + (p.marketValueCents ?? 0), 0)
        : undefined,
      totalUnrealisedPnlCents: hasQuotes
        ? positions.reduce((sum, p) => sum + (p.unrealisedPnlCents ?? 0), 0)
        : undefined,
      totalUnrealisedPnlPct: this.totalPnlPct(positions, hasQuotes),
      totalValueAtTargetCents: positions.reduce((sum, p) => sum + (p.valueAtTargetCents ?? 0), 0),
      liquidationNowCents: hasQuotes
        ? liquidationValueCents({ positions, taxRate: options.taxRate, atTarget: false })
        : undefined,
      liquidationAtTargetCents: liquidationValueCents({ positions, taxRate: options.taxRate, atTarget: true }),
      earmarkedByLoan: earmarkedByLoan(positions, { taxRate: options.taxRate, atTarget: true }),
      nextEsppDate: nextGrant?.date,
      nextEsppEstimatedShares: nextGrant?.estimatedShares,
      quotesStale: positions.some((p) => p.quoteStale) || !hasQuotes,
      quotesFetchedAt: positions.map((p) => p.quoteFetchedAt).filter(Boolean).sort()[0],
    };
  }

  /** Proceeds available to one loan, now and at target, after tax and allocation ratios. */
  async proceedsForLoan(userId: string, loanId: string, today: string, taxRate: number) {
    const positions = await this.positions(userId, today);
    const now = earmarkedByLoan(positions, { taxRate, atTarget: false });
    const atTarget = earmarkedByLoan(positions, { taxRate, atTarget: true });
    return {
      nowCents: now[loanId] ?? 0,
      atTargetCents: atTarget[loanId] ?? 0,
      targetHorizonMonths: maxTargetHorizonMonths(positions),
    };
  }

  private totalPnlPct(positions: StockPosition[], hasQuotes: boolean): number | undefined {
    if (!hasQuotes) return undefined;
    const cost = positions.reduce((sum, p) => sum + p.totalCostCents, 0);
    if (cost <= 0) return undefined;
    const value = positions.reduce((sum, p) => sum + (p.marketValueCents ?? 0), 0);
    return value / cost - 1;
  }

  private oid(id: string): string {
    if (!isValidObjectId(id)) throw new NotFoundException(`Lot ${id} not found`);
    return id;
  }
}
