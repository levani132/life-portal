import type {
  CashEvent,
  FxContext,
  CashProjection,
  CashProjectionDay,
  CashSnapshot,
  Currency,
  Expense,
  IncomeArrivalOverride,
  IncomeSource,
  RealisedSale,
} from '@life-portal/shared-types';
import { addDays, diffDays, eachDay, isAfter, maxDay, minDay, toDay, type DayString } from './dates';
import { monthlyEquivalentCents, nextOccurrence, occurrencesBetween } from './recurrence';
import { sumCents } from './money';
import { canConvert, toDisplayCents } from './fx';

export interface CashProjectionInput {
  /** The reference "today". Passed explicitly so projections are deterministic. */
  today: string;
  /** Last day to project to. */
  to: string;
  /** The most recent manual reconciliation. */
  openingBalanceCents: number;
  /** The day that reconciliation was true for. May be in the past. */
  balanceAsOf: string;
  currency: Currency;
  /** Currency the reconciliation was recorded in. Defaults to `currency` when omitted. */
  openingCurrency?: Currency;
  incomes: IncomeSource[];
  expenses: Expense[];
  /**
   * Cash from things already sold, derived from the item/lot rows by `realisedSales()`. A sale
   * dated before `balanceAsOf` falls outside the window and is therefore never double-counted
   * against a reconciliation that already includes it.
   */
  sales?: RealisedSale[];
  /** Day to compute the headline snapshot for. Defaults to `today`. */
  snapshotDate?: string;
  /**
   * What was **really** spent by card on each past day, keyed `YYYY-MM-DD`, in `currency`.
   *
   * Supplied, a day at or before `today` uses this figure instead of its `auto`-settled
   * recurring budget — the budget said what was *meant* to happen, and for a day that has
   * already happened the captured payments say what did. Days after `today` keep their budget,
   * because nothing has happened on them yet.
   *
   * Two classes of outflow survive alongside the actuals rather than being replaced, because
   * SMS capture never sees them and dropping them would silently delete real money from the
   * projection:
   *
   * - `settlement: 'manual'` lines — the loan repayment, the utilities — are transfers and
   *   direct debits;
   * - `one_off` expenses are recorded facts with a date, not repeating budget.
   *
   * A past day absent from this map falls back to its budget entirely: no payments captured is
   * not evidence that no money was spent, and treating silence as thrift would quietly inflate
   * every balance downstream.
   */
  actualOutByDay?: Record<string, number>;
  /**
   * Rates for folding rows recorded in another currency into `currency`.
   *
   * Omitted, every amount is summed as-is — which is only correct when every row already
   * shares one currency. The salary is in USD and the card spending is in GEL, so leaving
   * this out silently adds dollars to lari.
   */
  fx?: FxContext;
}

/**
 * Restates one row's amount in the projection's currency, recording what it was before.
 *
 * `originalCurrency` is set only when a conversion actually happened, so a row that was
 * already in the display currency stays free of misleading provenance.
 */
function inProjectionCurrency(
  amountCents: number,
  currency: Currency | undefined,
  fx: FxContext | undefined,
): Pick<CashEvent, 'amountCents' | 'originalAmountCents' | 'originalCurrency'> {
  if (!fx || !currency) return { amountCents };
  const converted = toDisplayCents(amountCents, currency, fx);
  if (!converted.converted) return { amountCents };
  return {
    amountCents: converted.cents,
    originalAmountCents: amountCents,
    originalCurrency: currency,
  };
}

/** Currencies among the input rows that `fx` has no rate for. */
function unconvertedCurrencies(
  input: Pick<CashProjectionInput, 'incomes' | 'expenses' | 'sales'>,
  fx: FxContext | undefined,
): Currency[] {
  if (!fx) return [];
  const found = new Set<Currency>();
  const check = (currency?: Currency) => {
    if (currency && currency !== fx.displayCurrency && !canConvert(currency, fx))
      found.add(currency);
  };
  for (const income of input.incomes) check(income.currency);
  for (const expense of input.expenses) check(expense.currency);
  for (const sale of input.sales ?? []) check(sale.currency);
  return [...found].sort();
}

/** How far, at most, any override moves an occurrence — the padding the expansion window needs. */
function maxOverrideShiftDays(overrides: IncomeArrivalOverride[]): number {
  let max = 0;
  for (const override of overrides) {
    max = Math.max(max, Math.abs(diffDays(toDay(override.scheduledDay), toDay(override.actualDay))));
  }
  return max;
}

/**
 * Every day this income actually lands inside `[from, to]`, arrival overrides applied.
 *
 * An override *moves* its occurrence — the schedule is expanded first, then each scheduled day
 * with an override is replaced by the day the money really arrived. The expansion window is
 * padded by the largest shift so an occurrence moved into the window from just outside it is
 * found, and one moved out of the window is dropped.
 */
export function incomeOccurrences(
  income: Pick<IncomeSource, 'recurrence' | 'arrivalOverrides'>,
  from: string,
  to: string,
): DayString[] {
  const overrides = income.arrivalOverrides ?? [];
  if (overrides.length === 0) return occurrencesBetween(income.recurrence, from, to);

  const moved = new Map(overrides.map((o) => [toDay(o.scheduledDay), toDay(o.actualDay)]));
  const pad = maxOverrideShiftDays(overrides);
  const lo = toDay(from);
  const hi = toDay(to);
  return occurrencesBetween(income.recurrence, addDays(lo, -pad), addDays(hi, pad))
    .map((day) => moved.get(day) ?? day)
    .filter((day) => day >= lo && day <= hi)
    .sort();
}

/** Backstop for `nextIncomeDay`'s scan; overrides shift by days, never by fifty occurrences. */
const MAX_NEXT_SCAN = 60;

/**
 * The next day this income actually arrives on or after `from`, arrival overrides applied.
 *
 * A salary scheduled for the 7th but already received on the 4th must not be reported as "next
 * salary on the 7th" — that occurrence has happened, so the answer is next month's. Scheduled
 * occurrences are scanned from `pad` days back (a moved-earlier one can still be ahead of
 * `from`) and the earliest actual day on or after `from` wins.
 */
export function nextIncomeDay(
  income: Pick<IncomeSource, 'recurrence' | 'arrivalOverrides'>,
  from: string,
): DayString | undefined {
  const overrides = income.arrivalOverrides ?? [];
  const lo = toDay(from);
  if (overrides.length === 0) return nextOccurrence(income.recurrence, lo);

  const moved = new Map(overrides.map((o) => [toDay(o.scheduledDay), toDay(o.actualDay)]));
  const pad = maxOverrideShiftDays(overrides);
  let cursor = nextOccurrence(income.recurrence, addDays(lo, -pad));
  let best: DayString | undefined;
  for (let i = 0; cursor && i < MAX_NEXT_SCAN; i += 1) {
    // Once the scheduled day is beyond best + pad, no later occurrence can map earlier than best.
    if (best && cursor > addDays(best, pad)) break;
    const actual = moved.get(cursor) ?? cursor;
    if (actual >= lo && (!best || actual < best)) best = actual;
    cursor = nextOccurrence(income.recurrence, addDays(cursor, 1));
  }
  return best;
}

function expenseOccurrences(expense: Expense, from: string, to: string): DayString[] {
  if (!expense.active) return [];
  if (expense.kind === 'one_off') {
    if (!expense.date) return [];
    const day = toDay(expense.date);
    return day >= toDay(from) && day <= toDay(to) ? [day] : [];
  }
  if (!expense.recurrence) return [];
  return occurrencesBetween(expense.recurrence, from, to);
}

/** Flattens income sources and expenses into individual dated cash movements. */
export function buildCashEvents(
  input: Pick<CashProjectionInput, 'incomes' | 'expenses' | 'sales' | 'fx'>,
  from: string,
  to: string,
): CashEvent[] {
  const events: CashEvent[] = [];

  for (const income of input.incomes) {
    if (!income.active) continue;
    for (const date of incomeOccurrences(income, from, to)) {
      events.push({
        date,
        label: income.label,
        ...inProjectionCurrency(income.amountCents, income.currency, input.fx),
        direction: 'in',
        sourceKind: 'income',
        sourceId: income.id,
      });
    }
  }

  for (const expense of input.expenses) {
    for (const date of expenseOccurrences(expense, from, to)) {
      events.push({
        date,
        label: expense.label,
        ...inProjectionCurrency(expense.amountCents, expense.currency, input.fx),
        direction: 'out',
        sourceKind: 'expense',
        sourceId: expense.id,
        category: expense.category,
        linkedLoanId: expense.linkedLoanId,
        settlement: expense.settlement ?? 'auto',
        expenseKind: expense.kind,
      });
    }
  }

  for (const sale of input.sales ?? []) {
    const date = toDay(sale.date);
    // Fully earmarked proceeds net to zero: that money is the loan widget's, not spendable cash.
    if (sale.amountCents <= 0 || date < toDay(from) || date > toDay(to)) continue;
    events.push({
      date,
      label: sale.label,
      ...inProjectionCurrency(sale.amountCents, sale.currency, input.fx),
      direction: 'in',
      sourceKind: 'sale',
      sourceId: sale.id,
      linkedLoanId: sale.allocatedToLoanId,
    });
  }

  return events.sort((a, b) =>
    a.date === b.date ? a.direction.localeCompare(b.direction) : a.date < b.date ? -1 : 1,
  );
}

/**
 * Rolls the reconciled balance forward day by day.
 *
 * Projection starts at `balanceAsOf`, not at `today`: if the balance was last reconciled a
 * week ago, the week's expenses since then are part of the forecast rather than silently
 * assumed to have already been deducted.
 */
export function projectCash(input: CashProjectionInput): CashProjection {
  const today = toDay(input.today);
  const from = minDay(toDay(input.balanceAsOf), today) as DayString;
  const to = maxDay(toDay(input.to), today) as DayString;

  const events = buildCashEvents(input, from, to);
  const byDate = new Map<string, CashEvent[]>();
  for (const event of events) {
    const bucket = byDate.get(event.date);
    if (bucket) bucket.push(event);
    else byDate.set(event.date, [event]);
  }

  const opening = inProjectionCurrency(
    input.openingBalanceCents,
    input.openingCurrency ?? input.currency,
    input.fx,
  );

  const days: CashProjectionDay[] = [];
  let running = opening.amountCents;
  let firstShortfallDate: string | undefined;

  for (const date of eachDay(from, to)) {
    const dayEvents = byDate.get(date) ?? [];
    const inCents = sumCents(
      dayEvents.filter((e) => e.direction === 'in').map((e) => e.amountCents),
    );
    const budgetedOut = sumCents(
      dayEvents.filter((e) => e.direction === 'out').map((e) => e.amountCents),
    );
    // A day that has already happened is a fact, not a forecast — provided anything was captured
    // for it. Absent from the map, it keeps its budget: silence is not evidence of thrift.
    // Actuals replace only the auto card-spending budget; transfers, direct debits and one-off
    // records are money SMS capture cannot see, so they stay counted beside the actuals.
    const actual = input.actualOutByDay?.[date];
    const uncapturedOut = sumCents(
      dayEvents
        .filter(
          (e) =>
            e.direction === 'out' && (e.settlement === 'manual' || e.expenseKind === 'one_off'),
        )
        .map((e) => e.amountCents),
    );
    const outCents = actual != null && date <= today ? actual + uncapturedOut : budgetedOut;
    const opening = running;
    running = opening + inCents - outCents;
    // Only from today onward: the stretch between the last reconciliation and today already
    // happened, so a "you run out on the 3rd" for a date in the past is noise.
    if (running < 0 && !firstShortfallDate && date >= today) firstShortfallDate = date;
    days.push({
      date,
      openingCents: opening,
      inCents,
      outCents,
      closingCents: running,
      events: dayEvents,
    });
  }

  // Converted before the monthly equivalent is taken, not after: scaling then converting and
  // converting then scaling agree, but only one of them rounds a single time.
  const monthlyRecurringInCents = sumCents(
    input.incomes
      .filter((i) => i.active)
      .map((i) =>
        monthlyEquivalentCents(
          inProjectionCurrency(i.amountCents, i.currency, input.fx).amountCents,
          i.recurrence,
        ),
      ),
  );
  const monthlyRecurringOutCents = sumCents(
    input.expenses.map((expense) =>
      expense.active && expense.kind === 'recurring' && expense.recurrence
        ? monthlyEquivalentCents(
            inProjectionCurrency(expense.amountCents, expense.currency, input.fx).amountCents,
            expense.recurrence,
          )
        : 0,
    ),
  );

  const unconverted = unconvertedCurrencies(input, input.fx);

  return {
    from,
    to,
    openingCents: opening.amountCents,
    currency: input.currency,
    days,
    snapshot: snapshotFromDays(days, toDay(input.snapshotDate ?? today), today),
    firstShortfallDate,
    ...(unconverted.length ? { unconvertedCurrencies: unconverted } : {}),
    monthlyRecurringInCents,
    monthlyRecurringOutCents,
    monthlyNetCents: monthlyRecurringInCents - monthlyRecurringOutCents,
  };
}

/**
 * Answers the three questions the salary widget exists for, at an arbitrary date:
 * what will the balance be, how much of it is already spoken for before more money arrives,
 * and what is therefore genuinely free.
 *
 * "Before more money arrives" deliberately *excludes* the next income day itself: a loan
 * payment due on the 7th is funded by the salary that lands on the 7th, so counting it
 * against the prior balance would understate free money by a whole month's obligations.
 */
export function snapshotFromDays(
  days: CashProjectionDay[],
  date: string,
  today: string,
): CashSnapshot {
  const target = toDay(date);
  const index = days.findIndex((d) => d.date === target);
  const resolvedIndex = index >= 0 ? index : days.length - 1;
  const day = days[resolvedIndex];
  const resolvedDate = day?.date ?? target;
  const projectedBalanceCents = day?.closingCents ?? 0;

  const future = days.slice(resolvedIndex + 1);
  // Income *sources* only. A sale is cash, but it is not a payday, so it must not close the
  // committed-spending window early and overstate free money.
  const isSalary = (event: CashEvent) => event.direction === 'in' && event.sourceKind === 'income';
  const incomeDay = future.find((d) => d.events.some(isSalary));
  const nextIncomeDate = incomeDay?.date;
  const nextIncomeAmountCents = incomeDay
    ? sumCents(incomeDay.events.filter(isSalary).map((e) => e.amountCents))
    : undefined;

  const committedWindow = nextIncomeDate ? future.filter((d) => d.date < nextIncomeDate) : future;
  const committedBeforeNextIncomeCents = sumCents(committedWindow.map((d) => d.outCents));

  // Lowest point between today and the target date catches a mid-period dip that the
  // closing balance on the target date would hide.
  const dipWindow = days.filter((d) => d.date >= toDay(today) && d.date <= resolvedDate);
  const dipSource = dipWindow.length ? dipWindow : [day].filter(Boolean);
  const lowest = dipSource.reduce(
    (min, d) => (d.closingCents < min.closingCents ? d : min),
    dipSource[0] ?? { date: resolvedDate, closingCents: projectedBalanceCents },
  );

  return {
    date: resolvedDate,
    projectedBalanceCents,
    nextIncomeDate,
    nextIncomeAmountCents,
    committedBeforeNextIncomeCents,
    freeCents: projectedBalanceCents - committedBeforeNextIncomeCents,
    lowestBalanceCents: lowest.closingCents,
    lowestBalanceDate: lowest.date,
  };
}

/** Recomputes the snapshot for another date without re-expanding every recurrence. */
export function snapshotAt(projection: CashProjection, date: string, today: string): CashSnapshot {
  return snapshotFromDays(projection.days, date, today);
}

/**
 * How many days the current balance lasts if no further income arrived. Undefined when the
 * projection never runs dry inside its horizon.
 */
export function runwayDays(projection: CashProjection, today: string): number | undefined {
  const start = toDay(today);
  let running =
    projection.days.find((d) => d.date === start)?.openingCents ?? projection.openingCents;
  for (const day of projection.days) {
    if (isAfter(start, day.date)) continue;
    running -= day.outCents;
    if (running < 0) return Math.max(0, projection.days.indexOf(day));
  }
  return undefined;
}

/** Convenience horizon: one year out from `today`. */
export function defaultHorizon(today: string): DayString {
  return addDays(today, 365);
}
