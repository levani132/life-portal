/**
 * The spending waterfall — one pure function that decides what every payment in a window was
 * probably for, and what each allowance therefore saved (constitution principles III and V).
 *
 * The rule the module turns on: **a payment records what happened, never what it was for.**
 * What it was for is derived on every read by walking a ladder of budgeted expenses, so
 * changing a budget, reordering the ladder or confirming a payment re-attributes history
 * rather than leaving a stale guess behind.
 *
 * ## Why confirmations are placed before projections
 *
 * Every confirmed allocation is placed on its rung *first*, regardless of clock order and
 * regardless of which payment carried it, and only then are the unconfirmed remainders
 * cascaded. This is not an optimisation — it is the reason the answer is stable.
 *
 * Walking strictly by time and letting a confirmation take its turn would make the result
 * depend on the order the owner happened to click things in: confirming a 09:00 payment at
 * midnight would silently re-propose everything after it, and confirming the evening payment
 * first would give a different ladder from confirming the morning one first. Placing facts
 * before guesses removes the order entirely (FR-013a). Confirm the morning payment as the
 * whole day's food and the evening one re-proposes itself against the weekly allowance;
 * confirm the evening one instead and the morning payment moves there — neither payment
 * touched, one read.
 *
 * ## Why closing a rung matters
 *
 * A confirmation also *closes* the rung it names, for the period it names, to the cascade
 * (FR-014g). Say breakfast cost ₾7 of its ₾10 budget. If an unrelated payment were allowed to
 * quietly absorb the other ₾3, the ₾3 the owner actually saved would vanish into an
 * attribution they never made. Closing keeps the saving visible (FR-014i).
 *
 * The rung stays open to further *confirmations* (FR-014h), because food in one place and
 * dessert in another is one meal in two payments — so confirming never costs spending room,
 * it only stops guesses landing where the owner has already said what happened. The accepted
 * cost: confirm one breakfast payment, forget a second, and the second lands on the next
 * allowance down. Confirming it puts it right, and no total is ever wrong meanwhile — only
 * the attribution — because `budget − consumption` summed over the tiers is invariant under
 * how the payments were decided (research §2, FR-031c).
 *
 * ## The two days
 *
 * `payment.day` is when the money left the account and drives real spending and cash flow.
 * An allocation's `forDay`…`throughDay` is which day's *allowance* it consumes and drives the
 * ladder and savings. They coincide for every unconfirmed payment and diverge only when the
 * owner says tonight's shopping is for tomorrow (research §12).
 *
 * See `specs/002-spending-waterfall/contracts/domain.md`.
 */
import type {
  Cadence,
  Cents,
  Currency,
  FxContext,
  Id,
  IsoDate,
  LadderRung,
  LadderTier,
  PeriodSaving,
  SavingsBreakdown,
  SpendAllocation,
  SpendLadder,
  SpendPayment,
  SpendSettlement,
} from '@life-portal/shared-types';
import {
  addDays,
  addMonths,
  dayInMonthOf,
  eachDay,
  makeDay,
  toDay,
  weekdayOf,
  yearOf,
} from './dates';
import { toDisplayCents } from './fx';
import { clampPositive, splitCentsEvenly, sumCents } from './money';

/** The label an orphaned confirmation is shown under until the owner decides again. */
export const ORPHANED_RUNG_LABEL = 'Line item no longer exists';

/** The label given to cascade overflow that exhausted every tier. */
export const EXTRA_LABEL = 'Extra';

/**
 * One budgeted line as the ladder sees it: an amount, an order, and the two flags that keep
 * the cascade away from it.
 *
 * This is the caller's projection of a cash-flow `Expense` — the waterfall never reads the
 * expense collection itself, so cash flow stays the single source of the amount (principle IV).
 */
export interface LadderRungBudget {
  expenseId: Id;
  label: string;
  /** The budget for **one period** of the tier's cadence, in `currency`. */
  budgetCents: Cents;
  currency: Currency;
  /** `manual` lines are settled by hand: counted in the tier's budget, skipped by the cascade. */
  settlement?: SpendSettlement;
  /** A planned one-off is a specific intention, so a passing coffee must never consume it. */
  kind?: 'recurring' | 'one_off';
}

/** One cadence's worth of rungs, already grouped and ordered by the caller (`spendOrder`). */
export interface LadderTierBudget {
  cadence: Cadence;
  rungs: LadderRungBudget[];
}

export interface WaterfallInput {
  /** Reference day. Explicit, always (principle V). */
  today: IsoDate;
  /** Window the periods are reported over. Should cover whole months to read monthly consumption. */
  from: IsoDate;
  to: IsoDate;
  /**
   * Exactly the payments to consider. Deliberately not filtered against the window here: a
   * payment made on the 31st can name the 1st as the day its allowance belongs to, and
   * dropping it by its own day would lose that.
   */
  payments: SpendPayment[];
  tiers: LadderTierBudget[];
  /** Fallback rates, used for any day `ratesByDay` has no entry for. */
  fx: FxContext;
  /** Rates per `YYYY-MM-DD`. Each day converts at its own rate — never at today's (see `fx.ts`). */
  ratesByDay?: Record<string, FxContext>;
  /** 0 = Sunday .. 6 = Saturday. Defaults to Monday. */
  weekStartsOn?: number;
  /** Day of month a financial month begins. 1 (the default) gives calendar months. */
  monthStartsOn?: number;
}

/** A confirmed allocation whose line item no longer resolves. Surfaced, never dropped. */
export interface OrphanedAllocation {
  paymentId: Id;
  expenseId: Id;
  amountCents: Cents;
  forDay: IsoDate;
}

export interface WaterfallResult {
  /** Keyed by payment id. Money in, unparsed rows and fully repaid payments have no entry. */
  allocationsByPayment: Record<Id, SpendAllocation[]>;
  /** The ladder as it stands on any date in the window. */
  ladderFor(date: IsoDate): SpendLadder;
  /** One row per period of each cadence overlapping `[from, to]`. */
  savings: PeriodSaving[];
  /** `daily + weekly + monthly` equals `totalCents` exactly (SC-007). */
  cumulative: SavingsBreakdown;
  /** Keyed by the **financial** month's first day, so it works with `monthStartsOn` ≠ 1. */
  extraByMonth: Record<IsoDate, Cents>;
  /** Currencies present that no rate covered, so every figure here is approximate. */
  unconvertedCurrencies: Currency[];
  orphanedAllocations: OrphanedAllocation[];
}

/* ------------------------------------------------------------------ period boundaries -- */

/** The first day of the week containing `day`, given the week's start weekday. */
export function startOfWeek(day: IsoDate, weekStartsOn: number): IsoDate {
  const offset = (((weekdayOf(day) - weekStartsOn) % 7) + 7) % 7;
  return addDays(day, -offset);
}

/**
 * The first day of the **financial** month containing `day`.
 *
 * With `monthStartsOn: 7`, 3 September belongs to the month that began on 7 August — a budget
 * month that resets before the salary arrives would otherwise report an allowance the account
 * cannot fund (FR-027a). `1` reproduces calendar months exactly.
 */
export function startOfFinancialMonth(
  day: IsoDate,
  monthStartsOn: number,
): IsoDate {
  const anchor = dayInMonthOf(day, monthStartsOn);
  return toDay(day) >= anchor
    ? anchor
    : dayInMonthOf(addMonths(day, -1), monthStartsOn);
}

/** The first day of the financial year containing `day`, anchored on the same day of month. */
export function startOfFinancialYear(
  day: IsoDate,
  monthStartsOn: number,
): IsoDate {
  const anchor = makeDay(yearOf(day), 1, monthStartsOn);
  return toDay(day) >= anchor
    ? anchor
    : makeDay(yearOf(day) - 1, 1, monthStartsOn);
}

interface Boundaries {
  weekStartsOn: number;
  monthStartsOn: number;
}

function periodStart(cadence: Cadence, day: IsoDate, b: Boundaries): IsoDate {
  switch (cadence) {
    case 'daily':
      return toDay(day);
    case 'weekly':
      return startOfWeek(day, b.weekStartsOn);
    case 'monthly':
      return startOfFinancialMonth(day, b.monthStartsOn);
    case 'yearly':
      return startOfFinancialYear(day, b.monthStartsOn);
  }
}

function nextPeriodStart(
  cadence: Cadence,
  start: IsoDate,
  b: Boundaries,
): IsoDate {
  switch (cadence) {
    case 'daily':
      return addDays(start, 1);
    case 'weekly':
      return addDays(start, 7);
    case 'monthly':
      return dayInMonthOf(addMonths(start, 1), b.monthStartsOn);
    case 'yearly':
      return makeDay(yearOf(start) + 1, 1, b.monthStartsOn);
  }
}

function periodEnd(cadence: Cadence, start: IsoDate, b: Boundaries): IsoDate {
  return addDays(nextPeriodStart(cadence, start, b), -1);
}

/* -------------------------------------------------------------------- internal state -- */

interface RungDef extends LadderRungBudget {
  cadence: Cadence;
  settlement: SpendSettlement;
  kind: 'recurring' | 'one_off';
}

interface RungState {
  def: RungDef;
  periodStart: IsoDate;
  budgetCents: Cents;
  consumedCents: Cents;
  /** True once *anything* has been confirmed against this rung in this period. */
  confirmed: boolean;
}

interface ResolvedPayment {
  payment: SpendPayment;
  /** Spendable, in the display currency, converted at this payment's **own** day's rate. */
  spendableCents: Cents;
  allocations: SpendAllocation[];
  /** What no confirmation accounted for, and therefore rejoins the cascade (FR-014a). */
  remainderCents: Cents;
}

const rungKey = (cadence: Cadence, start: IsoDate, expenseId: Id) =>
  `${cadence}|${start}|${expenseId}`;

/**
 * Orders the cascade by `(day, at)`, then by id.
 *
 * The id tiebreak is what makes the result independent of the order the payments arrived in
 * or were decided in (FR-013a): two payments sharing a timestamp must not swap places
 * depending on how the caller happened to sort its query.
 */
function byDayThenAt(a: ResolvedPayment, b: ResolvedPayment): number {
  const dayDiff = a.payment.day.localeCompare(b.payment.day);
  if (dayDiff !== 0) return dayDiff;
  const atDiff = a.payment.at.localeCompare(b.payment.at);
  if (atDiff !== 0) return atDiff;
  return a.payment.id.localeCompare(b.payment.id);
}

/* ------------------------------------------------------------------------- the thing -- */

export function spendWaterfall(input: WaterfallInput): WaterfallResult {
  const boundaries: Boundaries = {
    weekStartsOn: input.weekStartsOn ?? 1,
    monthStartsOn: input.monthStartsOn ?? 1,
  };
  const from = toDay(input.from);
  const to = toDay(input.to);

  const unconverted = new Set<Currency>();
  const fxFor = (day: IsoDate): FxContext =>
    input.ratesByDay?.[toDay(day)] ?? input.fx;

  /** Converts at the given day's rate, recording anything no rate covered (principle VI). */
  const inDisplay = (cents: Cents, currency: Currency, day: IsoDate): Cents => {
    const result = toDisplayCents(cents, currency, fxFor(day));
    if (!result.converted && currency !== fxFor(day).displayCurrency)
      unconverted.add(currency);
    return result.cents;
  };

  // ---- the ladder definition, flattened for lookup by expense id -------------------------
  const defsByCadence = new Map<Cadence, RungDef[]>();
  const defById = new Map<Id, RungDef>();
  for (const tier of input.tiers) {
    const defs = tier.rungs.map<RungDef>((rung) => ({
      ...rung,
      cadence: tier.cadence,
      settlement: rung.settlement ?? 'auto',
      kind: rung.kind ?? 'recurring',
    }));
    defsByCadence.set(tier.cadence, [
      ...(defsByCadence.get(tier.cadence) ?? []),
      ...defs,
    ]);
    // First definition wins, so a duplicated id cannot double a budget.
    for (const def of defs)
      if (!defById.has(def.expenseId)) defById.set(def.expenseId, def);
  }

  /** Cadences in the order the caller listed them, each once even if it arrived as two tiers. */
  const cadences = [...new Set(input.tiers.map((tier) => tier.cadence))];

  // ---- rung state, created on first touch -----------------------------------------------
  const states = new Map<string, RungState>();
  /**
   * A rung's budget is converted at the rate in force on the **period's own first day**, not
   * on today's, so a month attributed last spring keeps the allowance it actually had.
   */
  const stateFor = (def: RungDef, start: IsoDate): RungState => {
    const key = rungKey(def.cadence, start, def.expenseId);
    let state = states.get(key);
    if (!state) {
      state = {
        def,
        periodStart: start,
        budgetCents: inDisplay(def.budgetCents, def.currency, start),
        consumedCents: 0,
        confirmed: false,
      };
      states.set(key, state);
    }
    return state;
  };

  /** Never negative: a rung past its budget has nothing left, not a debt to borrow back. */
  const remainingOf = (state: RungState): Cents =>
    clampPositive(state.budgetCents - state.consumedCents);

  // ---- extra unplanned spending, per the day whose allowance it would have consumed ------
  const extraByDay = new Map<IsoDate, Cents>();
  const addExtra = (day: IsoDate, cents: Cents) => {
    extraByDay.set(toDay(day), (extraByDay.get(toDay(day)) ?? 0) + cents);
  };

  const orphanedAllocations: OrphanedAllocation[] = [];

  // ---- step 1: resolve ------------------------------------------------------------------
  // Money in is recorded but is never spending; an unparsed row counts towards no figure
  // until the owner completes it. Neither is half-recorded — both are simply absent here.
  const resolved: ResolvedPayment[] = input.payments
    .filter((p) => p.direction !== 'in' && p.status !== 'unparsed')
    .map((payment) => {
      const spendableSource = clampPositive(
        payment.amountCents - (payment.notReallySpentCents ?? 0),
      );
      return {
        payment,
        spendableCents: inDisplay(
          spendableSource,
          payment.currency,
          payment.day,
        ),
        allocations: [],
        remainderCents: 0,
      };
    })
    .sort(byDayThenAt);

  // ---- steps 2–4: place every confirmation, then close the rungs it touched --------------
  // This whole pass runs before any projection, for the reason in the file header.
  for (const entry of resolved) {
    const { payment } = entry;
    const decision = payment.decision;
    if (decision?.kind !== 'confirmed') {
      entry.remainderCents =
        decision?.kind === 'custom' ? 0 : entry.spendableCents;
      continue;
    }

    let placed = 0;
    for (const allocation of decision.allocations ?? []) {
      // Converting the payment once and each part separately can round apart, and a
      // confirmation is validated against the *stored* amount rather than the converted one.
      // Capping at what is left keeps "a payment's allocations sum to its spendable amount"
      // true by construction rather than by hoping the two roundings agree.
      const converted = clampPositive(
        inDisplay(allocation.amountCents, payment.currency, payment.day),
      );
      const amount = Math.min(converted, entry.spendableCents - placed);
      if (amount < 0) break;
      placed += amount;

      // ---- step 3: expand the span, each part consuming its own day's period ------------
      const first = toDay(allocation.forDay ?? payment.day);
      const last = toDay(allocation.throughDay ?? first);
      const days = first <= last ? eachDay(first, last) : eachDay(last, first);
      const parts = splitCentsEvenly(amount, days.length);

      const def = defById.get(allocation.expenseId);
      days.forEach((day, index) => {
        const part = parts[index] ?? 0;
        if (!def) {
          // ---- step 8: surface the orphan as extra, flagged by carrying the dead id ------
          orphanedAllocations.push({
            paymentId: payment.id,
            expenseId: allocation.expenseId,
            amountCents: part,
            forDay: day,
          });
          addExtra(day, part);
          if (part > 0) {
            entry.allocations.push({
              target: 'extra',
              expenseId: allocation.expenseId,
              label: ORPHANED_RUNG_LABEL,
              amountCents: part,
              forDay: day,
              projected: false,
            });
          }
          return;
        }

        const state = stateFor(def, periodStart(def.cadence, day, boundaries));
        state.consumedCents += part;
        // ---- step 4: closed to guesses, open to further confirmations -------------------
        // Closed for every day the owner named, even where the split left that day nothing,
        // because naming the day *is* the statement that it has been accounted for.
        state.confirmed = true;
        if (part > 0) {
          entry.allocations.push({
            target: 'expense',
            expenseId: def.expenseId,
            label: def.label,
            amountCents: part,
            forDay: day,
            projected: false,
          });
        }
      });
    }

    entry.remainderCents = clampPositive(entry.spendableCents - placed);
  }

  // ---- step 5: a custom purpose sits outside the ladder entirely -------------------------
  for (const entry of resolved) {
    if (entry.payment.decision?.kind !== 'custom') continue;
    const day = toDay(entry.payment.day);
    addExtra(day, entry.spendableCents);
    if (entry.spendableCents > 0) {
      entry.allocations.push({
        target: 'extra',
        label: entry.payment.decision.purpose?.trim() || EXTRA_LABEL,
        amountCents: entry.spendableCents,
        forDay: day,
        projected: false,
      });
    }
  }

  // ---- steps 6–7: cascade what is left, splitting across rungs as it goes ----------------
  const cascadeOrder: Cadence[] = ['daily', 'weekly', 'monthly', 'yearly'];
  for (const entry of resolved) {
    let left = entry.remainderCents;
    if (left <= 0) continue;
    const day = toDay(entry.payment.day);

    for (const cadence of cascadeOrder) {
      if (left <= 0) break;
      const start = periodStart(cadence, day, boundaries);
      for (const def of defsByCadence.get(cadence) ?? []) {
        if (left <= 0) break;
        // Settled by hand, a specific intention, or already accounted for by the owner —
        // three different reasons a guess must not land here.
        if (def.settlement === 'manual' || def.kind === 'one_off') continue;
        const state = stateFor(def, start);
        if (state.confirmed) continue;

        const take = Math.min(left, remainingOf(state));
        if (take <= 0) continue;
        state.consumedCents += take;
        left -= take;
        entry.allocations.push({
          target: 'expense',
          expenseId: def.expenseId,
          label: def.label,
          amountCents: take,
          forDay: day,
          projected: true,
        });
      }
    }

    if (left > 0) {
      addExtra(day, left);
      entry.allocations.push({
        target: 'extra',
        label: EXTRA_LABEL,
        amountCents: left,
        forDay: day,
        projected: true,
      });
      left = 0;
    }
  }

  /* ------------------------------------------------------------------------- results -- */

  const allocationsByPayment: Record<Id, SpendAllocation[]> = {};
  for (const entry of resolved)
    allocationsByPayment[entry.payment.id] = entry.allocations;

  const extraBetween = (start: IsoDate, end: IsoDate): Cents => {
    let total = 0;
    for (const [day, cents] of extraByDay)
      if (day >= start && day <= end) total += cents;
    return total;
  };

  const extraByMonth: Record<IsoDate, Cents> = {};
  for (const [day, cents] of extraByDay) {
    const month = startOfFinancialMonth(day, boundaries.monthStartsOn);
    extraByMonth[month] = (extraByMonth[month] ?? 0) + cents;
  }

  // ---- per-period savings ----------------------------------------------------------------
  const savings: PeriodSaving[] = [];
  for (const cadence of cadences) {
    const defs = defsByCadence.get(cadence) ?? [];
    let start = periodStart(cadence, from, boundaries);
    while (start <= to) {
      const end = periodEnd(cadence, start, boundaries);
      // `stateFor` materialises the period's rungs so an untouched period still reports the
      // budget it had — a day nothing was spent on saved the whole allowance.
      const rungStates = defs.map((def) => stateFor(def, start));
      const budgetCents = sumCents(rungStates.map((s) => s.budgetCents));
      const spentCents = sumCents(rungStates.map((s) => s.consumedCents));
      const extraCents = extraBetween(start, end);
      // Signed on purpose: a confirmation may take a rung past its budget and the tier then
      // reports the overspend rather than a floor of zero (FR-030a, FR-031b).
      const savingCents = budgetCents - spentCents;
      savings.push({
        cadence,
        from: start,
        to: end,
        budgetCents,
        spentCents,
        savingCents,
        extraCents,
        netCents: savingCents - extraCents,
      });
      start = nextPeriodStart(cadence, start, boundaries);
    }
  }

  const savedFor = (cadence: Cadence) =>
    sumCents(
      savings.filter((s) => s.cadence === cadence).map((s) => s.savingCents),
    );

  const daily = savedFor('daily');
  const weekly = savedFor('weekly');
  // `SavingsBreakdown` names three buckets and the contract asserts they sum to the total,
  // so a yearly tier's saving is reported with the monthly one rather than dropped —
  // dropping it would break the invariant that the total is independent of the decisions.
  const monthly = savedFor('monthly') + savedFor('yearly');

  const cumulative: SavingsBreakdown = {
    totalCents: daily + weekly + monthly,
    daily,
    weekly,
    monthly,
    extraCents: extraBetween(from, to),
  };

  const ladderFor = (date: IsoDate): SpendLadder => {
    const day = toDay(date);
    const tiers: LadderTier[] = cadences.map((cadence) => {
      const start = periodStart(cadence, day, boundaries);
      const rungs: LadderRung[] = (defsByCadence.get(cadence) ?? []).map(
        (def) => {
          const state = stateFor(def, start);
          return {
            expenseId: def.expenseId,
            label: def.label,
            budgetCents: state.budgetCents,
            consumedCents: state.consumedCents,
            remainingCents: remainingOf(state),
            settlement: def.settlement,
            confirmed: state.confirmed,
          };
        },
      );
      const budgetCents = sumCents(rungs.map((r) => r.budgetCents));
      const consumedCents = sumCents(rungs.map((r) => r.consumedCents));
      return {
        cadence,
        rungs,
        budgetCents,
        consumedCents,
        savingCents: budgetCents - consumedCents,
      };
    });

    const month = startOfFinancialMonth(day, boundaries.monthStartsOn);
    return {
      date: day,
      tiers,
      extraCents: extraByMonth[month] ?? 0,
      // Re-read rather than captured: asking for a ladder outside the window materialises
      // that period's budgets, which can turn up a currency no rate covered.
      unconvertedCurrencies: [...unconverted].sort(),
    };
  };

  return {
    allocationsByPayment,
    ladderFor,
    savings,
    cumulative,
    extraByMonth,
    unconvertedCurrencies: [...unconverted].sort(),
    orphanedAllocations,
  };
}
