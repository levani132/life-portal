import type {
  Cents,
  Currency,
  Id,
  StockLot,
  StockPosition,
  StockQuote,
  StockTarget,
  SuggestedTarget,
} from '@life-portal/shared-types';
import { scaleCents } from './money';

/** Shares still held from a lot. */
export function openQuantity(lot: StockLot): number {
  return Math.max(0, lot.quantity - (lot.soldQuantity ?? 0));
}

/** Profit already banked on the sold portion of a lot. */
export function realisedPnlCents(lot: StockLot): Cents {
  const sold = lot.soldQuantity ?? 0;
  if (sold <= 0 || lot.soldPricePerShareCents == null) return 0;
  return Math.round(sold * (lot.soldPricePerShareCents - lot.pricePerShareCents));
}

export interface FoldPositionsInput {
  lots: StockLot[];
  quotes: Record<string, StockQuote>;
  targets: Record<string, StockTarget>;
  suggestions: Record<string, SuggestedTarget>;
  defaultCurrency: Currency;
}

/**
 * Folds lots into one position per symbol.
 *
 * Cost basis is the weighted average across *open* lots only, so selling a cheap lot does
 * not distort the remaining position's average.
 */
export function foldPositions(input: FoldPositionsInput): StockPosition[] {
  const bySymbol = new Map<string, StockLot[]>();
  for (const lot of input.lots) {
    const symbol = lot.symbol.toUpperCase();
    const bucket = bySymbol.get(symbol);
    if (bucket) bucket.push(lot);
    else bySymbol.set(symbol, [lot]);
  }

  const positions: StockPosition[] = [];

  for (const [symbol, lots] of bySymbol) {
    const quote = input.quotes[symbol];
    const target = input.targets[symbol];
    const suggestedTarget = input.suggestions[symbol];

    const quantity = lots.reduce((sum, lot) => sum + openQuantity(lot), 0);
    const totalCostCents = lots.reduce(
      (sum, lot) => sum + Math.round(openQuantity(lot) * lot.pricePerShareCents) + (lot.feesCents ?? 0),
      0,
    );
    const realised = lots.reduce((sum, lot) => sum + realisedPnlCents(lot), 0);

    const currentPricePerShareCents = quote?.pricePerShareCents;
    const marketValueCents =
      currentPricePerShareCents != null ? Math.round(quantity * currentPricePerShareCents) : undefined;

    // The user's own target wins over the suggestion; the suggestion is a fallback so that
    // "value at target" is never blank on a freshly added symbol.
    //
    // A target of zero counts as "not set", not as "sell at nothing". A `StockTarget` row can
    // legitimately exist carrying only a horizon — the seed creates exactly that — and treating
    // its absent price as a real zero would discard the suggestion and zero out every
    // downstream figure.
    const userTarget =
      target?.targetPriceCents != null && target.targetPriceCents > 0
        ? target.targetPriceCents
        : undefined;
    const effectiveTargetPerShareCents = userTarget ?? suggestedTarget?.value;
    const effectiveTargetIsSuggested = userTarget == null && suggestedTarget != null;

    positions.push({
      symbol,
      currency: (lots[0]?.currency ?? input.defaultCurrency) as Currency,
      lots,
      quantity,
      totalCostCents,
      averageCostPerShareCents: quantity > 0 ? Math.round(totalCostCents / quantity) : 0,
      currentPricePerShareCents,
      quoteFetchedAt: quote?.fetchedAt,
      quoteStale: quote?.stale,
      marketValueCents,
      unrealisedPnlCents: marketValueCents != null ? marketValueCents - totalCostCents : undefined,
      unrealisedPnlPct:
        marketValueCents != null && totalCostCents > 0
          ? marketValueCents / totalCostCents - 1
          : undefined,
      realisedPnlCents: realised,
      target,
      suggestedTarget,
      effectiveTargetPerShareCents,
      valueAtTargetCents:
        effectiveTargetPerShareCents != null
          ? Math.round(quantity * effectiveTargetPerShareCents)
          : undefined,
      effectiveTargetIsSuggested,
    });
  }

  return positions.sort((a, b) => (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0));
}

export interface LiquidationInput {
  positions: StockPosition[];
  /** Capital gains rate as a decimal. Zero disables tax modelling. */
  taxRate: number;
  /** Value at target prices rather than current market prices. */
  atTarget: boolean;
}

/**
 * Net cash a liquidation would actually produce: gross proceeds less modelled capital gains
 * tax on the gain only. Losses reduce no tax here — a personal dashboard does not need
 * loss-offset accounting, and pretending otherwise would overstate the cash.
 */
export function liquidationValueCents(input: LiquidationInput): Cents {
  let net = 0;
  for (const position of input.positions) {
    const price = input.atTarget
      ? position.effectiveTargetPerShareCents
      : position.currentPricePerShareCents;
    if (price == null || position.quantity <= 0) continue;
    const gross = Math.round(position.quantity * price);
    const gain = Math.max(0, gross - position.totalCostCents);
    net += gross - (input.taxRate > 0 ? scaleCents(gain, input.taxRate) : 0);
  }
  return net;
}

/**
 * Splits liquidation proceeds across loans using each lot's `allocateToLoanId` and
 * `allocationRatio`. Lots with no allocation contribute to no loan.
 */
export function earmarkedByLoan(
  positions: StockPosition[],
  options: { taxRate: number; atTarget: boolean },
): Record<Id, Cents> {
  const out: Record<Id, Cents> = {};
  for (const position of positions) {
    const price = options.atTarget
      ? position.effectiveTargetPerShareCents
      : position.currentPricePerShareCents;
    if (price == null) continue;

    for (const lot of position.lots) {
      if (!lot.allocateToLoanId) continue;
      const quantity = openQuantity(lot);
      if (quantity <= 0) continue;
      const gross = Math.round(quantity * price);
      const cost = Math.round(quantity * lot.pricePerShareCents);
      const gain = Math.max(0, gross - cost);
      const net = gross - (options.taxRate > 0 ? scaleCents(gain, options.taxRate) : 0);
      const share = scaleCents(net, lot.allocationRatio ?? 1);
      out[lot.allocateToLoanId] = (out[lot.allocateToLoanId] ?? 0) + share;
    }
  }
  return out;
}

/** Longest user-set target horizon, used to date the best-case stock sale in loan scenarios. */
export function maxTargetHorizonMonths(positions: StockPosition[], fallback = 12): number {
  const horizons = positions
    .map((p) => p.target?.horizonMonths)
    .filter((h): h is number => typeof h === 'number' && h > 0);
  return horizons.length ? Math.max(...horizons) : fallback;
}
