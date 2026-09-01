import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import type {
  BudgetProposal,
  Cents,
  CompletenessGap,
  Expense as ExpenseDto,
  FxContext,
  SpendBank,
  SpendDaySlice,
  SpendDayView,
  SpendPayment as SpendPaymentDto,
} from '@life-portal/shared-types';
import {
  NEW_LINE_PREFIX,
  addDays,
  arrangeWidgets,
  detectMissedMessages,
  eachDay,
  fxContext,
  isNewLineProposal,
  parseBankMessage,
  ratePointFor,
  rateTable,
  spendWaterfall,
  startOfFinancialMonth,
  suggestBudgets,
  sumCents,
  toDay,
  wallClockDay,
} from '@life-portal/shared-domain';
import type {
  BudgetDismissal,
  CustomPurposeHistory,
  LadderTierBudget,
  LinePeriodSpend,
  WaterfallResult,
} from '@life-portal/shared-domain';
import { CASHFLOW_CADENCES } from '@life-portal/shared-types';
import { CashflowService } from '../cashflow/cashflow.service';
import { FxService } from '../fx/fx.module';
import { NutritionService } from '../nutrition/nutrition.service';
import { SettingsService } from '../settings/settings.module';
import { SpendPayment } from './spending.schemas';
import type {
  CreatePaymentDto,
  IngestDto,
  PromotePurposeDto,
  SetDecisionDto,
  UpdatePaymentDto,
} from './spending.dto';

/**
 * How close two identical messages must be to count as the same one.
 *
 * A content hash alone would be wrong here, and the owner's own data shows why: a BOG message
 * carries **no time**, so two ₾4.00 coffees at the same shop on the same day are byte-identical.
 * Discarding the second would under-report spending — precisely the failure this feature exists
 * to prevent. A retried automation fires seconds apart; a real second coffee does not.
 */
const DUPLICATE_WINDOW_MS = 120_000;

/**
 * How far back a budget proposal looks.
 *
 * Driven by the longest minimum the domain enforces: four *complete* financial months, which
 * needs a fifth partial one in front of it, plus a fortnight of margin so a `monthStartsOn` of
 * 28 does not lose a month to the boundary. Daily and weekly lines are satisfied many times
 * over by the same window, and one window keeps the periods of all three cadences drawn from
 * the same run.
 */
const SUGGESTION_WINDOW_DAYS = 200;

@Injectable()
export class SpendingService {
  constructor(
    @InjectModel(SpendPayment.name) private readonly payments: Model<SpendPayment>,
    private readonly cashflow: CashflowService,
    private readonly nutrition: NutritionService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
  ) {}

  /** Every read funnels through here, so the owner clause can never be omitted. */
  private scoped(userId: string, extra: Record<string, unknown> = {}) {
    return { userId, ...extra };
  }

  /**
   * Which day a payment belongs to.
   *
   * Unlike meals — where the browser decides and sends `?today=` — the server applies the rule
   * here, because a phone automation cannot read the owner's profile. It can only report the
   * moment; `dayStartHour` lives on the server, so this is the only place the two can meet.
   */
  private async dayFor(userId: string, ...candidates: (string | undefined)[]): Promise<string> {
    const profile = await this.nutrition.profile(userId);
    const dayStartHour = profile.dayStartHour ?? 4;
    // The day comes from a timestamp's own wall clock, never from `new Date().getHours()` —
    // that answers in the *server's* timezone, and on a UTC host it filed every early-morning
    // payment a day early. Candidates are tried in order of how much they know about the
    // owner's clock; the last one (server receipt time) always parses.
    for (const candidate of candidates) {
      const day = wallClockDay(candidate, dayStartHour);
      if (day) return day;
    }
    return wallClockDay(new Date().toISOString(), dayStartHour) as string;
  }

  // ---------------------------------------------------------------- ingest

  /**
   * Records a submitted bank message.
   *
   * Answers success even when the message cannot be read. A Shortcut has no way to handle an
   * error, so any non-2xx means the message is gone for good — an unreadable one is therefore
   * stored verbatim and queued rather than rejected.
   */
  async ingest(
    userId: string,
    dto: IngestDto,
    receivedAt: string,
  ): Promise<{
    recorded: boolean;
    duplicate: boolean;
    status: string;
    paymentId?: string;
    day?: string;
  }> {
    // Whatever an unconfigured iOS date variable sent — locale prose included — must never
    // reject the request: a Shortcut cannot handle an error, so a 400 here loses the message
    // for good. An unusable `at` simply falls back to the arrival time, which for a live
    // automation is seconds away from the truth anyway.
    const at = dto.at && !Number.isNaN(Date.parse(dto.at)) ? dto.at : receivedAt;

    const duplicate = await this.findRecentDuplicate(userId, dto.raw, receivedAt);
    if (duplicate) {
      return {
        recorded: false,
        duplicate: true,
        status: duplicate.status,
        paymentId: duplicate.id,
        day: duplicate.day,
      };
    }

    const parsed = parseBankMessage(dto.raw, dto.bank as SpendBank | undefined);
    // Candidates in order of how much they know about the owner's clock. A bank's printed
    // *date* cannot say that a 01:00 payment belongs to yesterday, so any timestamp carrying a
    // clock — TBC's own, or the phone's — outranks BOG's date-only stamp.
    const statedWithClock =
      parsed?.statedAt && parsed.statedAt.length > 10 ? parsed.statedAt : undefined;
    const day = await this.dayFor(userId, statedWithClock, dto.at, parsed?.statedAt, at, receivedAt);

    const created = await this.payments.create({
      userId,
      // An unparsed row keeps its text and nothing else; it counts towards no figure until the
      // owner completes it, which is safer than recording a guessed amount.
      amountCents: parsed?.amountCents ?? 0,
      currency: parsed?.currency ?? 'GEL',
      merchant: parsed?.merchant,
      cardLast4: parsed?.cardLast4,
      at: parsed?.statedAt ?? at,
      day,
      direction: parsed?.direction ?? 'out',
      source: dto.source ?? 'sms',
      bank: dto.bank,
      raw: dto.raw,
      rawReceivedAt: receivedAt,
      status: parsed && parsed.amountCents != null ? 'recorded' : 'unparsed',
      reportedBalanceCents: parsed?.reportedBalanceCents,
      reportedBalanceCurrency: parsed?.reportedBalanceCurrency,
      cashbackCents: parsed?.cashbackCents,
    });

    const row = created.toJSON() as unknown as SpendPaymentDto;
    return {
      recorded: true,
      duplicate: false,
      status: row.status,
      paymentId: row.id,
      day: row.day,
    };
  }

  /**
   * The same text arriving twice within the window is one payment.
   *
   * Compared on the raw text *and* the arrival time, never on content alone — see
   * `DUPLICATE_WINDOW_MS`.
   */
  private async findRecentDuplicate(
    userId: string,
    raw: string,
    receivedAt: string,
  ): Promise<SpendPaymentDto | null> {
    const since = new Date(new Date(receivedAt).getTime() - DUPLICATE_WINDOW_MS).toISOString();
    const found = await this.payments
      .findOne(this.scoped(userId, { raw, rawReceivedAt: { $gte: since } }))
      .sort({ rawReceivedAt: -1 });
    return found ? (found.toJSON() as unknown as SpendPaymentDto) : null;
  }

  // ---------------------------------------------------------------- payments

  async list(
    userId: string,
    from?: string,
    to?: string,
    status?: string,
  ): Promise<SpendPaymentDto[]> {
    const filter: Record<string, unknown> = {};
    if (from || to) {
      filter['day'] = {
        ...(from ? { $gte: toDay(from) } : {}),
        ...(to ? { $lte: toDay(to) } : {}),
      };
    }
    if (status) filter['status'] = status;
    const rows = await this.payments.find(this.scoped(userId, filter)).sort({ at: -1 });
    return rows.map((r) => r.toJSON() as unknown as SpendPaymentDto);
  }

  async create(userId: string, today: string, dto: CreatePaymentDto): Promise<SpendPaymentDto> {
    const at = dto.at ?? new Date().toISOString();
    const day = dto.day ? toDay(dto.day) : await this.dayFor(userId, at);
    this.assertNotOverRefunded(dto.amountCents, dto.notReallySpentCents);
    const created = await this.payments.create({
      ...dto,
      userId,
      at,
      day,
      currency: dto.currency ?? 'GEL',
      source: 'manual',
      status: 'recorded',
    });
    return created.toJSON() as unknown as SpendPaymentDto;
  }

  /** Also how an `unparsed` row is completed: supplying an amount records it. */
  async update(userId: string, id: string, dto: UpdatePaymentDto): Promise<SpendPaymentDto> {
    const existing = await this.byId(userId, id);
    const amountCents = dto.amountCents ?? existing.amountCents;
    const notReallySpent = dto.notReallySpentCents ?? existing.notReallySpentCents;
    this.assertNotOverRefunded(amountCents, notReallySpent);

    // A confirmation is the owner's statement of where this money went, denominated in the
    // payment's own currency. Shrinking the payment underneath it would leave a statement
    // claiming money that no longer exists — so the confirmation has to be adjusted first,
    // rather than silently capped into something the owner never said.
    if (existing.decision?.kind === 'confirmed' && existing.decision.allocations?.length) {
      const claimed = existing.decision.allocations.reduce((sum, a) => sum + a.amountCents, 0);
      if (claimed > amountCents - (notReallySpent ?? 0)) {
        throw new BadRequestException(
          'This payment is confirmed for more than the new amount — lower the confirmation first',
        );
      }
    }

    const patch: Record<string, unknown> = { ...dto };
    if (dto.day) patch['day'] = toDay(dto.day);
    if (dto.amountCents != null && existing.status === 'unparsed') patch['status'] = 'recorded';

    const updated = await this.payments.findOneAndUpdate(
      this.scoped(userId, { _id: id }),
      { $set: patch },
      { new: true },
    );
    if (!updated) throw new NotFoundException(`Payment ${id} not found`);
    return updated.toJSON() as unknown as SpendPaymentDto;
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.payments.findOneAndDelete(this.scoped(userId, { _id: id }));
    if (!deleted) throw new NotFoundException(`Payment ${id} not found`);
  }

  /**
   * Records what a payment was really for.
   *
   * A confirmation may cover only part of the payment — the remainder rejoins the cascade — but
   * never more than it, which would let one payment consume more allowance than money left the
   * account.
   */
  async setDecision(
    userId: string,
    id: string,
    today: string,
    dto: SetDecisionDto,
  ): Promise<SpendPaymentDto> {
    const existing = await this.byId(userId, id);

    if (dto.kind === 'none') {
      const cleared = await this.payments.findOneAndUpdate(
        this.scoped(userId, { _id: id }),
        { $unset: { decision: '' } },
        { new: true },
      );
      return (cleared as NonNullable<typeof cleared>).toJSON() as unknown as SpendPaymentDto;
    }

    if (dto.kind === 'custom') {
      if (!dto.purpose?.trim())
        throw new BadRequestException('A custom purpose needs a description');
      return this.writeDecision(userId, id, {
        kind: 'custom',
        purpose: dto.purpose.trim(),
        decidedAt: today,
      });
    }

    const allocations = dto.allocations ?? [];
    if (!allocations.length)
      throw new BadRequestException('A confirmation needs at least one allocation');

    const spendable = existing.amountCents - (existing.notReallySpentCents ?? 0);
    const claimed = allocations.reduce((sum, a) => sum + a.amountCents, 0);
    if (claimed > spendable) {
      throw new BadRequestException(
        `Allocations come to more than the payment: ${claimed} against ${spendable}`,
      );
    }
    for (const allocation of allocations) {
      if (allocation.throughDay && allocation.forDay && allocation.throughDay < allocation.forDay) {
        throw new BadRequestException('A span cannot end before it starts');
      }
      await this.assertOwnsExpense(userId, allocation.expenseId);
    }

    return this.writeDecision(userId, id, { kind: 'confirmed', allocations, decidedAt: today });
  }

  /** Turns a custom purpose into a budgeted line — created through cashflow, which owns it. */
  async promote(userId: string, id: string, today: string, dto: PromotePurposeDto) {
    const existing = await this.byId(userId, id);
    if (existing.decision?.kind !== 'custom') {
      throw new BadRequestException('Only a payment with a custom purpose can be promoted');
    }

    const expense = await this.cashflow.createExpense(userId, {
      label: dto.label,
      amountCents: dto.amountCents,
      currency: dto.currency ?? existing.currency,
      category: 'other',
      kind: 'recurring',
      recurrence: { cadence: dto.cadence, interval: 1, startDate: today },
    } as never);

    await this.payments.updateOne(this.scoped(userId, { _id: id }), {
      $set: { 'decision.promotedToExpenseId': (expense as { id: string }).id },
    });
    return expense;
  }

  // ---------------------------------------------------------------- the ladder

  /**
   * The budgeted lines, grouped into tiers and ordered as the owner arranged them.
   *
   * Built from the cash-flow expenses rather than a copy of them (principle IV), so editing a
   * budget on the Free money screen changes the ladder with no second write.
   */
  private async tiers(userId: string, from: string, to: string): Promise<LadderTierBudget[]> {
    const [expenses, settings] = await Promise.all([
      this.cashflow.listExpenses(userId),
      this.settings.get(userId),
    ]);

    // An inactive line is not a budget, so it is no rung.
    const usable = expenses.filter((e) => e.active !== false);

    return CASHFLOW_CADENCES.map((cadence) => {
      const forCadence = usable.filter((e) => {
        if (e.kind === 'recurring') return e.recurrence?.cadence === cadence;
        // A planned one-off belongs to the single period its date falls in — not to every month
        // for ever. Without this filter a credit-card payment made in June inflates the monthly
        // budget of every month after it, and therefore overstates every month's saving.
        if (cadence !== 'monthly' || !e.date) return false;
        const day = toDay(e.date);
        return day >= toDay(from) && day <= toDay(to);
      });
      // `spendOrder` is a preference list, not a set of positions: it has to tolerate ids it has
      // never seen and ids that no longer exist, exactly as `widgetOrder` does.
      const arranged = arrangeWidgets(
        forCadence.map((e, index) => ({ id: e.id, order: index })),
        settings.spendOrder ?? [],
      );
      const byId = new Map(forCadence.map((e) => [e.id, e]));

      return {
        cadence,
        rungs: arranged
          .map((slot) => byId.get(slot.id))
          .filter((e): e is NonNullable<typeof e> => Boolean(e))
          .map((e) => ({
            expenseId: e.id,
            label: e.label,
            budgetCents: e.amountCents,
            currency: e.currency,
            settlement: e.settlement ?? 'auto',
            kind: e.kind as 'recurring' | 'one_off',
          })),
      };
    });
  }

  /**
   * Runs the waterfall over a window wide enough to know monthly consumption.
   *
   * Every day converts at its own rate, so a lari payment is measured against that day's worth of
   * a dollar allowance rather than today's.
   */
  private async run(
    userId: string,
    today: string,
    options?: { from?: string; to?: string },
  ): Promise<WaterfallResult> {
    const settings = await this.settings.get(userId);
    const monthStart = startOfFinancialMonth(today, settings.monthStartsOn ?? 1);
    const from = options?.from ?? monthStart;
    const to = options?.to ?? today;

    // One-offs are judged against the whole financial month, not the month so far, so one
    // planned for the 28th still shows as budgeted on the 24th.
    const monthEnd = addDays(
      startOfFinancialMonth(addDays(monthStart, 45), settings.monthStartsOn ?? 1),
      -1,
    );
    const [payments, tiers] = await Promise.all([
      this.list(userId),
      this.tiers(userId, options?.from ?? monthStart, options?.to ?? monthEnd),
    ]);
    const display = await this.fx.displayFor(userId, today);

    // One rate lookup per day in the window, so a payment is never valued at a day it did not
    // happen on. `fx` is the fallback for any day the archive does not reach.
    //
    // The archive is fetched **once** and the per-day contexts derived from it in memory. This
    // is exactly what `fx.context` does internally, so the numbers are unchanged; doing it here
    // is what makes the 200-day window a budget proposal needs one query rather than two
    // hundred.
    const archive = await this.fx.archive();
    const ratesByDay: Record<string, FxContext> = {};
    for (const day of eachDay(from, to)) {
      ratesByDay[day] = fxContext(archive, day, display.currency);
    }

    return spendWaterfall({
      today,
      from,
      to,
      payments,
      tiers,
      fx: display.fx,
      ratesByDay,
      weekStartsOn: settings.weekStartsOn ?? 1,
      monthStartsOn: settings.monthStartsOn ?? 1,
    });
  }

  /** Everything the detail page needs in one round trip. */
  async overview(userId: string, today: string) {
    const result = await this.run(userId, today);
    const ladder = result.ladderFor(today);
    const payments = await this.list(userId, addDays(today, -30), today);
    const gaps = await this.gapsFor(await this.list(userId));
    const unparsed = await this.list(userId, undefined, undefined, 'unparsed');

    const spent = ladder.tiers.reduce((sum, t) => sum + t.consumedCents, 0) + ladder.extraCents;
    const saved = ladder.tiers.reduce((sum, t) => sum + t.savingCents, 0);

    return {
      today,
      ladder,
      todayFigures: {
        spentCents: spent,
        savedCents: saved,
        extraCents: ladder.extraCents,
        netCents: saved - ladder.extraCents,
      },
      payments: payments.map((p) => ({
        ...p,
        allocations: result.allocationsByPayment[p.id] ?? [],
      })),
      unparsedCount: unparsed.length,
      gaps,
      orphans: result.orphanedAllocations,
      basis:
        'Reflects captured payments only, so it is a lower bound. Amounts are converted at the ' +
        'National Bank of Georgia rate for the day each payment was made.',
    };
  }

  /**
   * The three figures the dashboard card shows: what is left of today's allowances, what was
   * really spent today, and whether anything needs the owner's attention.
   */
  async summary(userId: string, today: string) {
    const result = await this.run(userId, today);
    const ladder = result.ladderFor(today);
    const daily = ladder.tiers.find((t) => t.cadence === 'daily');
    const unparsed = await this.list(userId, undefined, undefined, 'unparsed');
    const display = await this.fx.displayFor(userId, today);

    const spentToday =
      ladder.tiers.reduce((sum, t) => sum + t.consumedCents, 0) + ladder.extraCents;

    return {
      currency: display.currency,
      // What is genuinely left of today's routine allowance — the question the card exists for.
      remainingTodayCents: daily?.rungs.reduce((sum, r) => sum + r.remainingCents, 0) ?? 0,
      dailyBudgetCents: daily?.budgetCents ?? 0,
      spentTodayCents: spentToday,
      extraThisMonthCents: ladder.extraCents,
      unparsedCount: unparsed.length,
      gapCount: (await this.gapsFor(await this.list(userId))).length,
    };
  }

  /**
   * One day read allowance-first: what was actually spent on `date`, whichever day paid for it.
   *
   * A different question from the projection's "out", which follows the money. A payment spread
   * across four breakfasts pays on one day and spends on four, so the slices here are collected
   * by each allocation's `forDay` — including slices whose payment left the account on another
   * day entirely.
   */
  async day(userId: string, today: string, date: string): Promise<SpendDayView> {
    const settings = await this.settings.get(userId);
    // The window must cover both the asked-for day's financial month and today's, because the
    // waterfall reports periods inside it — but the payments themselves are never windowed, so
    // a span reaching `date` from an older payment is found regardless.
    const earlier = date < today ? date : today;
    const later = date > today ? date : today;
    const [result, payments] = await Promise.all([
      this.run(userId, today, {
        from: startOfFinancialMonth(earlier, settings.monthStartsOn ?? 1),
        to: later,
      }),
      this.list(userId),
    ]);

    const slices: SpendDaySlice[] = [];
    for (const payment of payments) {
      for (const allocation of result.allocationsByPayment[payment.id] ?? []) {
        if (allocation.forDay !== date) continue;
        slices.push({
          ...allocation,
          paymentId: payment.id,
          merchant: payment.merchant,
          paidDay: payment.day,
          decided: payment.decision?.kind,
        });
      }
    }
    slices.sort((a, b) => b.amountCents - a.amountCents);

    return {
      date,
      spentCents: slices.reduce((sum, slice) => sum + slice.amountCents, 0),
      slices,
    };
  }

  /** Per-period and cumulative savings, plus the month read three ways. */
  async savings(userId: string, today: string, from?: string, to?: string) {
    const result = await this.run(userId, today, { from, to });
    const cashflow = await this.cashflow.summary(userId, today);
    const month = result.savings.find((p) => p.cadence === 'monthly');

    return {
      periods: result.savings,
      cumulative: result.cumulative,
      month: {
        // Already known from income less budgeted spending — the figure the projection assumed.
        projectedSavingCents: cashflow.monthlyNetCents,
        actualSavingCents: month?.savingCents ?? 0,
        extraCents: month?.extraCents ?? 0,
      },
    };
  }

  // ---------------------------------------------------------------- budget proposals

  /**
   * What the owner's real spending says their allowances ought to be.
   *
   * Derived on every read like everything else (principle III) and **applied by nobody**: this
   * only ever returns proposals, and a budget changes when the owner accepts one (FR-036).
   */
  async suggestions(userId: string, today: string): Promise<{ suggestions: BudgetProposal[] }> {
    const day = toDay(today);
    const from = addDays(day, -SUGGESTION_WINDOW_DAYS);

    const [result, tiers, expenses, payments, display] = await Promise.all([
      this.run(userId, day, { from, to: day }),
      this.tiers(userId, from, day),
      this.cashflow.listExpenses(userId),
      this.list(userId),
      this.fx.displayFor(userId, day),
    ]);

    // The waterfall reports each period's rungs; the proposal engine needs the same figures
    // per line rather than per tier, so the ladder is re-read at each period's own first day.
    // `ladderFor` memoises the rung states, so this is arithmetic already done.
    const history: LinePeriodSpend[] = [];
    for (const period of result.savings) {
      const ladder = result.ladderFor(period.from);
      const tier = ladder.tiers.find((t) => t.cadence === period.cadence);
      for (const rung of tier?.rungs ?? []) {
        history.push({
          expenseId: rung.expenseId,
          from: period.from,
          to: period.to,
          spentCents: rung.consumedCents,
        });
      }
    }

    return {
      suggestions: suggestBudgets({
        today: day,
        tiers,
        history,
        // Before the first captured message every period reads as a perfect saving, which would
        // propose cutting every line to nothing. Capture starting late is not thrift.
        observedFrom: this.firstCapturedDay(payments) ?? day,
        dismissals: this.dismissals(expenses),
        purposes: this.customPurposes(payments, result, from, day),
        currency: display.currency,
      }),
    };
  }

  /**
   * Applies a proposal the owner accepted.
   *
   * Written through `CashflowService` because cash flow owns the expense (principle IV) — the
   * loan's repayment plan and the projection both read that one row, so a second writer here
   * would give two answers to "what is the budget".
   */
  async acceptSuggestion(userId: string, expenseId: string, today: string): Promise<ExpenseDto> {
    const proposal = await this.proposalFor(userId, expenseId, today);

    if (isNewLineProposal(proposal)) {
      // A purpose with no line yet: accepting *creates* the line, at the median observed.
      return this.cashflow.createExpense(userId, {
        label: proposal.label,
        amountCents: proposal.suggestedCents,
        currency: (proposal.assumptions?.['currency'] as string) ?? 'GEL',
        category: 'other',
        kind: 'recurring',
        recurrence: { cadence: proposal.cadence, interval: 1, startDate: toDay(today) },
      } as never);
    }

    // Only the amount. A proposal is a claim about one number, so accepting must not quietly
    // carry a cadence or a label along with it.
    return this.cashflow.updateExpense(userId, expenseId, {
      amountCents: proposal.suggestedCents,
    } as never);
  }

  /**
   * Records that the owner refused a proposal, so the same figure is not put to them again.
   *
   * The refusal is stored on the expense as the *value* dismissed rather than as a flag: the
   * owner rejected a number, not the idea of ever revising the line, so the proposal returns
   * as soon as the evidence has moved materially somewhere else (research §10).
   */
  async dismissSuggestion(userId: string, expenseId: string, today: string): Promise<ExpenseDto> {
    if (expenseId.startsWith(NEW_LINE_PREFIX)) {
      // A dismissal lives on the row the proposal concerns, and a line that does not exist has
      // no row to hold it. Research §10 chose two fields over a new collection precisely to
      // avoid one, so this case is a 400 rather than a new place to store state.
      throw new BadRequestException(
        'A proposal for a line that does not exist cannot be dismissed',
      );
    }
    const proposal = await this.proposalFor(userId, expenseId, today);
    return this.cashflow.recordSuggestionDismissal(
      userId,
      expenseId,
      toDay(today),
      proposal.suggestedCents,
    );
  }

  /**
   * The live proposal for one line.
   *
   * Recomputed rather than taken from the request, so accepting can only ever apply a figure
   * the evidence still supports — a stale tab cannot post yesterday's number.
   */
  private async proposalFor(
    userId: string,
    expenseId: string,
    today: string,
  ): Promise<BudgetProposal> {
    const { suggestions } = await this.suggestions(userId, today);
    const found = suggestions.find((s) => s.expenseId === expenseId);
    if (!found) throw new NotFoundException(`No current budget proposal for ${expenseId}`);
    return found;
  }

  /** Dismissals as the domain wants them, from the two fields the expense row carries. */
  private dismissals(expenses: ExpenseDto[]): Record<string, BudgetDismissal> {
    const out: Record<string, BudgetDismissal> = {};
    for (const expense of expenses) {
      if (expense.suggestionDismissedAt == null || expense.suggestionDismissedCents == null) {
        continue;
      }
      out[expense.id] = {
        at: expense.suggestionDismissedAt,
        cents: expense.suggestionDismissedCents,
      };
    }
    return out;
  }

  /** The earliest day anything was captured, or `undefined` when nothing has been. */
  private firstCapturedDay(payments: SpendPaymentDto[]): string | undefined {
    let earliest: string | undefined;
    for (const payment of payments) {
      if (!earliest || payment.day < earliest) earliest = payment.day;
    }
    return earliest;
  }

  /**
   * Custom purposes, grouped by what the owner typed, for new-line proposals (FR-049).
   *
   * The amounts come from the waterfall's own allocations rather than from `amountCents`, so
   * they are already net of anything paid back and already converted at the rate of the day
   * each payment was made — the same figures every other total on the screen is built from.
   */
  private customPurposes(
    payments: SpendPaymentDto[],
    result: WaterfallResult,
    from: string,
    to: string,
  ): CustomPurposeHistory[] {
    const byPurpose = new Map<string, CustomPurposeHistory>();

    for (const payment of payments) {
      const decision = payment.decision;
      const purpose = decision?.kind === 'custom' ? decision.purpose?.trim() : undefined;
      if (!purpose) continue;
      if (payment.day < from || payment.day > to) continue;

      const key = purpose.toLowerCase();
      const entry = byPurpose.get(key) ?? { purpose, occurrences: [] };
      const amountCents: Cents = sumCents(
        (result.allocationsByPayment[payment.id] ?? [])
          .filter((allocation) => allocation.target === 'extra')
          .map((allocation) => allocation.amountCents),
      );
      entry.occurrences.push({ day: payment.day, amountCents });
      // One promotion is enough: the line exists, so the purpose is never proposed again.
      if (decision?.promotedToExpenseId) entry.promotedToExpenseId = decision.promotedToExpenseId;
      byPurpose.set(key, entry);
    }

    return [...byPurpose.values()];
  }

  // ---------------------------------------------------------------- completeness

  /**
   * Messages the app can prove it never received.
   *
   * Derived rather than stored, so a payment added by hand later closes its own gap.
   */
  async gaps(userId: string): Promise<CompletenessGap[]> {
    return this.gapsFor(await this.list(userId));
  }

  /**
   * The completeness check, with the rates it needs to chain a foreign-currency payment.
   *
   * A dollar charge on a lari card prints a USD amount over a GEL `Nashti`, so the chain has to
   * value it in the account's currency — at the rate of the payment's own day, from the same
   * archive every other figure converts through. One archive read serves every day.
   */
  private async gapsFor(payments: SpendPaymentDto[]): Promise<CompletenessGap[]> {
    const archive = await this.fx.archive();
    const ratesByDay: Record<string, Record<string, number>> = {};
    for (const payment of payments) {
      if (ratesByDay[payment.day]) continue;
      const point = ratePointFor(archive, payment.day);
      ratesByDay[payment.day] = point && archive ? rateTable(archive.base, point.rates) : {};
    }
    return detectMissedMessages(payments, ratesByDay);
  }

  // ---------------------------------------------------------------- helpers

  private async byId(userId: string, id: string): Promise<SpendPaymentDto> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Payment ${id} not found`);
    const found = await this.payments.findOne(this.scoped(userId, { _id: id }));
    if (!found) throw new NotFoundException(`Payment ${id} not found`);
    return found.toJSON() as unknown as SpendPaymentDto;
  }

  private async writeDecision(
    userId: string,
    id: string,
    decision: unknown,
  ): Promise<SpendPaymentDto> {
    const updated = await this.payments.findOneAndUpdate(
      this.scoped(userId, { _id: id }),
      { $set: { decision } },
      { new: true },
    );
    if (!updated) throw new NotFoundException(`Payment ${id} not found`);
    return updated.toJSON() as unknown as SpendPaymentDto;
  }

  private assertNotOverRefunded(amountCents: number, notReallySpentCents?: number): void {
    if (notReallySpentCents != null && notReallySpentCents > amountCents) {
      throw new BadRequestException('More cannot be paid back than was spent');
    }
  }

  /** A confirmation may only name a line the same owner holds. */
  private async assertOwnsExpense(userId: string, expenseId: string): Promise<void> {
    const expenses = await this.cashflow.listExpenses(userId);
    if (!expenses.some((e) => e.id === expenseId)) {
      throw new NotFoundException(`Budget line ${expenseId} not found`);
    }
  }
}
