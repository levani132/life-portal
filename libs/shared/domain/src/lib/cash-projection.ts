import type {
  CashEvent,
  CashProjection,
  CashProjectionDay,
  CashSnapshot,
  Currency,
  Expense,
  IncomeSource,
} from '@life-portal/shared-types';
import { addDays, eachDay, isAfter, maxDay, minDay, toDay, type DayString } from './dates';
import { monthlyEquivalentCents, occurrencesBetween } from './recurrence';
import { sumCents } from './money';

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
  incomes: IncomeSource[];
  expenses: Expense[];
  /** Day to compute the headline snapshot for. Defaults to `today`. */
  snapshotDate?: string;
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
  input: Pick<CashProjectionInput, 'incomes' | 'expenses'>,
  from: string,
  to: string,
): CashEvent[] {
  const events: CashEvent[] = [];

  for (const income of input.incomes) {
    if (!income.active) continue;
    for (const date of occurrencesBetween(income.recurrence, from, to)) {
      events.push({
        date,
        label: income.label,
        amountCents: income.amountCents,
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
        amountCents: expense.amountCents,
        direction: 'out',
        sourceKind: 'expense',
        sourceId: expense.id,
        category: expense.category,
        linkedLoanId: expense.linkedLoanId,
      });
    }
  }

  return events.sort((a, b) => (a.date === b.date ? a.direction.localeCompare(b.direction) : a.date < b.date ? -1 : 1));
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

  const days: CashProjectionDay[] = [];
  let running = input.openingBalanceCents;
  let firstShortfallDate: string | undefined;

  for (const date of eachDay(from, to)) {
    const dayEvents = byDate.get(date) ?? [];
    const inCents = sumCents(dayEvents.filter((e) => e.direction === 'in').map((e) => e.amountCents));
    const outCents = sumCents(dayEvents.filter((e) => e.direction === 'out').map((e) => e.amountCents));
    const opening = running;
    running = opening + inCents - outCents;
    if (running < 0 && !firstShortfallDate) firstShortfallDate = date;
    days.push({ date, openingCents: opening, inCents, outCents, closingCents: running, events: dayEvents });
  }

  const monthlyRecurringInCents = sumCents(
    input.incomes.filter((i) => i.active).map((i) => monthlyEquivalentCents(i.amountCents, i.recurrence)),
  );
  const monthlyRecurringOutCents = sumCents(
    input.expenses.map((expense) =>
      expense.active && expense.kind === 'recurring' && expense.recurrence
        ? monthlyEquivalentCents(expense.amountCents, expense.recurrence)
        : 0,
    ),
  );

  return {
    from,
    to,
    openingCents: input.openingBalanceCents,
    currency: input.currency,
    days,
    snapshot: snapshotFromDays(days, toDay(input.snapshotDate ?? today), today),
    firstShortfallDate,
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
  const incomeDay = future.find((d) => d.events.some((e) => e.direction === 'in'));
  const nextIncomeDate = incomeDay?.date;
  const nextIncomeAmountCents = incomeDay
    ? sumCents(incomeDay.events.filter((e) => e.direction === 'in').map((e) => e.amountCents))
    : undefined;

  const committedWindow = nextIncomeDate
    ? future.filter((d) => d.date < nextIncomeDate)
    : future;
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
  let running = projection.days.find((d) => d.date === start)?.openingCents ?? projection.openingCents;
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
