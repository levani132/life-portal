import type {
  Currency,
  Id,
  LoanScenario,
  LoanScenarioStep,
  RepaymentPlan,
  ResolvedInflow,
} from '@life-portal/shared-types';
import { addMonths, dayInMonthOf, diffMonths, toDay, type DayString } from './dates';
import { clampPositive, scaleCents, sumCents } from './money';

/** A dated inflow the simulator can apply against a balance. */
export interface ScenarioInflow {
  label: string;
  amountCents: number;
  /** Undefined lumps are dropped — the caller decides when an asset sale lands. */
  date: string;
  planId?: Id;
  kind: ResolvedInflow['kind'];
  guaranteed: boolean;
}

/** Proceeds the items widget makes available to *this* loan, after allocation ratios. */
export interface ItemsProceeds {
  expectedCents: number;
  pessimisticCents: number;
  optimisticCents: number;
  /** Earliest realistic sale date, if the user gave one. */
  earliestSaleDate?: string;
}

/** Proceeds the stocks widget makes available to *this* loan, after tax and allocation. */
export interface StocksProceeds {
  /** Liquidating today at market prices. */
  nowCents: number;
  /** Liquidating once every holding reaches its target price. */
  atTargetCents: number;
  /** Longest target horizon across the holdings, in months. */
  targetHorizonMonths: number;
}

export interface LoanScenarioInput {
  today: string;
  /** Outstanding balance, i.e. principal less payments already made. */
  remainingCents: number;
  currency: Currency;
  /** Annual rate as a decimal. Zero for informal loans. */
  interestRate: number;
  plans: RepaymentPlan[];
  /**
   * Amounts owned by linked cash-flow expenses, keyed by expense id. A recurring plan with
   * a `linkedExpenseId` takes its amount from here, never from its own `amountCents`
   * (constitution principle IV).
   */
  linkedExpenseAmounts: Record<Id, number>;
  items: ItemsProceeds;
  stocks: StocksProceeds;
  /** Modelling ceiling. Beyond this the scenario reports "not repaid". */
  horizonMonths?: number;
}

const DEFAULT_HORIZON_MONTHS = 120;

/** How long an asset sale is assumed to take in each scenario. */
const ITEM_SALE_DELAY_MONTHS = { best: 1, expected: 3 } as const;
const STOCK_SALE_DELAY_MONTHS_EXPECTED = 1;

/** The amount a plan actually contributes, honouring the linked-expense source of truth. */
export function resolvePlanAmountCents(
  plan: RepaymentPlan,
  linkedExpenseAmounts: Record<Id, number>,
): number {
  if (plan.linkedExpenseId) {
    return linkedExpenseAmounts[plan.linkedExpenseId] ?? plan.amountCents ?? 0;
  }
  return plan.amountCents ?? 0;
}

/** Expands a recurring or one-off plan into dated inflows inside the horizon. */
function expandScheduledPlan(
  plan: RepaymentPlan,
  input: LoanScenarioInput,
  horizonEnd: DayString,
): ScenarioInflow[] {
  const amountCents = resolvePlanAmountCents(plan, input.linkedExpenseAmounts);
  if (amountCents <= 0) return [];

  if (plan.kind === 'one_off') {
    const date = plan.date ? toDay(plan.date) : undefined;
    if (!date || date > horizonEnd) return [];
    return [{ label: plan.label, amountCents, date, planId: plan.id, kind: plan.kind, guaranteed: plan.guaranteed }];
  }

  if (plan.kind !== 'recurring') return [];

  const today = toDay(input.today);
  const start = plan.startDate ? toDay(plan.startDate) : today;
  const end = plan.endDate ? toDay(plan.endDate) : horizonEnd;
  const stepMonths = plan.cadence === 'yearly' ? 12 : 1;
  const dayOfMonth = plan.dayOfMonth ?? 1;

  const out: ScenarioInflow[] = [];
  // First occurrence on or after both the plan start and today.
  let cursor = dayInMonthOf(start > today ? start : today, dayOfMonth);
  if (cursor < (start > today ? start : today)) {
    cursor = dayInMonthOf(addMonths(cursor, stepMonths), dayOfMonth);
  }
  while (cursor <= end && cursor <= horizonEnd && out.length < 500) {
    out.push({ label: plan.label, amountCents, date: cursor, planId: plan.id, kind: plan.kind, guaranteed: plan.guaranteed });
    cursor = dayInMonthOf(addMonths(cursor, stepMonths), dayOfMonth);
  }
  return out;
}

/** Asset-sale inflows for a given scenario, derived from the items and stocks widgets. */
function assetInflows(
  scenario: 'best' | 'expected' | 'worst',
  input: LoanScenarioInput,
  horizonEnd: DayString,
): ScenarioInflow[] {
  if (scenario === 'worst') return [];

  const today = toDay(input.today);
  const out: ScenarioInflow[] = [];

  const itemsPlan = input.plans.find((p) => p.kind === 'items' && p.enabled);
  const itemsCents = scenario === 'best' ? input.items.optimisticCents : input.items.expectedCents;
  if (itemsCents > 0) {
    const delay = ITEM_SALE_DELAY_MONTHS[scenario];
    const date =
      scenario === 'best' && input.items.earliestSaleDate
        ? toDay(input.items.earliestSaleDate)
        : addMonths(today, delay);
    if (date <= horizonEnd) {
      out.push({
        label: itemsPlan?.label ?? 'Proceeds from items sold',
        amountCents: itemsCents,
        date: date > today ? date : today,
        planId: itemsPlan?.id,
        kind: 'items',
        guaranteed: false,
      });
    }
  }

  const stocksPlan = input.plans.find((p) => p.kind === 'stocks' && p.enabled);
  const stocksCents = scenario === 'best' ? input.stocks.atTargetCents : input.stocks.nowCents;
  if (stocksCents > 0) {
    const delay =
      scenario === 'best'
        ? Math.max(1, input.stocks.targetHorizonMonths)
        : STOCK_SALE_DELAY_MONTHS_EXPECTED;
    const date = addMonths(today, delay);
    if (date <= horizonEnd) {
      out.push({
        label: stocksPlan?.label ?? 'Proceeds from shares sold',
        amountCents: stocksCents,
        date,
        planId: stocksPlan?.id,
        kind: 'stocks',
        guaranteed: false,
      });
    }
  }

  return out;
}

/**
 * Applies inflows to the balance in date order, accruing interest monthly.
 *
 * Payments are capped at the outstanding balance, so a scenario never reports paying more
 * than is owed, and the final step is the payoff date.
 */
export function simulatePayoff(
  remainingCents: number,
  inflows: ScenarioInflow[],
  input: Pick<LoanScenarioInput, 'today' | 'interestRate'>,
  horizonMonths: number,
): { steps: LoanScenarioStep[]; payoffDate?: DayString; totalPaidCents: number } {
  const today = toDay(input.today);
  const sorted = [...inflows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const byDate = new Map<string, ScenarioInflow[]>();
  for (const inflow of sorted) {
    const bucket = byDate.get(inflow.date);
    if (bucket) bucket.push(inflow);
    else byDate.set(inflow.date, [inflow]);
  }

  const monthlyRate = input.interestRate > 0 ? input.interestRate / 12 : 0;
  const steps: LoanScenarioStep[] = [];
  let remaining = remainingCents;
  let totalPaid = 0;
  let payoffDate: DayString | undefined;
  let lastInterestMonth = -1;

  for (const [date, dayInflows] of byDate) {
    if (remaining <= 0) break;
    if (diffMonths(today, date) > horizonMonths) break;

    if (monthlyRate > 0) {
      const monthIndex = diffMonths(today, date);
      if (monthIndex > lastInterestMonth) {
        const periods = monthIndex - Math.max(lastInterestMonth, 0);
        remaining += scaleCents(remaining, monthlyRate * periods);
        lastInterestMonth = monthIndex;
      }
    }

    const contributions: { label: string; amountCents: number }[] = [];
    let paidToday = 0;
    for (const inflow of dayInflows) {
      const applied = Math.min(inflow.amountCents, clampPositive(remaining - paidToday));
      if (applied <= 0) continue;
      contributions.push({ label: inflow.label, amountCents: applied });
      paidToday += applied;
    }
    if (paidToday <= 0) continue;

    remaining = clampPositive(remaining - paidToday);
    totalPaid += paidToday;
    steps.push({ date, paidCents: paidToday, remainingCents: remaining, contributions });
    if (remaining === 0) {
      payoffDate = date;
      break;
    }
  }

  return { steps, payoffDate, totalPaidCents: totalPaid };
}

/**
 * Labels describe what each scenario *assumes*, not whether the outcome is good.
 *
 * "Best case" maximises money recovered, which can make it finish *later* than "Realistic":
 * holding shares until they reach the target price pays more but takes longer than selling
 * at today's price. Naming them by assumption rather than by "best/worst" keeps that from
 * reading as a bug in the UI.
 */
const SCENARIO_LABELS: Record<'best' | 'expected' | 'worst', string> = {
  best: 'Everything sells at target',
  expected: 'Realistic',
  worst: 'Salary only',
};

function describeAssumptions(
  scenario: 'best' | 'expected' | 'worst',
  input: LoanScenarioInput,
  inflows: ScenarioInflow[],
): string[] {
  const lines: string[] = [];
  const scheduled = inflows.filter((i) => i.kind === 'recurring');
  if (scheduled.length) {
    const monthly = sumCents(
      [...new Map(scheduled.map((i) => [i.planId ?? i.label, i.amountCents])).values()],
    );
    lines.push(`Scheduled repayments continue (about ${(monthly / 100).toFixed(0)} per month).`);
  } else {
    lines.push('No scheduled repayment is set up, so nothing is guaranteed.');
  }

  // Interest applies to every scenario, so it is stated before the worst-case early return.
  if (input.interestRate > 0) {
    lines.push(`Interest accrues at ${(input.interestRate * 100).toFixed(2)}% a year.`);
  }

  if (scenario === 'worst') {
    lines.push('Nothing is sold: no items, no shares.');
    lines.push('Only guaranteed, salary-funded repayments count.');
    return lines;
  }

  const hasItems = inflows.some((i) => i.kind === 'items');
  if (hasItems) {
    lines.push(
      scenario === 'best'
        ? `Every listed item sells at its asking price within ${ITEM_SALE_DELAY_MONTHS.best} month.`
        : `Items sell at their realistic price within ${ITEM_SALE_DELAY_MONTHS.expected} months.`,
    );
  }

  const hasStocks = inflows.some((i) => i.kind === 'stocks');
  if (hasStocks) {
    if (scenario === 'best') {
      lines.push(
        `All shares are sold once they reach their target price, assumed within ${Math.max(1, input.stocks.targetHorizonMonths)} months.`,
      );
      lines.push(
        'Waiting for the target recovers more money but can finish later than selling today.',
      );
    } else {
      lines.push("All shares are sold at today's market price within a month.");
    }
  }
  return lines;
}

/** Builds one named scenario. */
export function buildScenario(
  key: 'best' | 'expected' | 'worst',
  input: LoanScenarioInput,
): LoanScenario {
  const horizonMonths = input.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const horizonEnd = addMonths(toDay(input.today), horizonMonths);

  const enabled = input.plans.filter((p) => p.enabled);
  const scheduledSource = key === 'worst' ? enabled.filter((p) => p.guaranteed) : enabled;
  const scheduled = scheduledSource.flatMap((plan) => expandScheduledPlan(plan, input, horizonEnd));
  const assets = assetInflows(key, input, horizonEnd);
  const inflows = [...scheduled, ...assets];

  const { steps, payoffDate, totalPaidCents } = simulatePayoff(
    input.remainingCents,
    inflows,
    input,
    horizonMonths,
  );

  return {
    key,
    label: SCENARIO_LABELS[key],
    payoffDate,
    monthsToPayoff: payoffDate ? Math.max(0, diffMonths(toDay(input.today), payoffDate)) : undefined,
    steps,
    assumptions: describeAssumptions(key, input, inflows),
    totalPaidCents,
  };
}

/** Best, expected and worst case for one loan. */
export function buildLoanScenarios(input: LoanScenarioInput): LoanScenario[] {
  return [buildScenario('best', input), buildScenario('expected', input), buildScenario('worst', input)];
}

/** Flattens the plans into the display list shown under "how this gets repaid". */
export function resolveInflows(input: LoanScenarioInput): ResolvedInflow[] {
  const horizonEnd = addMonths(toDay(input.today), input.horizonMonths ?? DEFAULT_HORIZON_MONTHS);
  const out: ResolvedInflow[] = [];

  for (const plan of input.plans) {
    if (plan.kind === 'recurring' || plan.kind === 'one_off') {
      const amountCents = resolvePlanAmountCents(plan, input.linkedExpenseAmounts);
      const next = expandScheduledPlan(plan, input, horizonEnd)[0];
      out.push({
        planId: plan.id,
        label: plan.label,
        amountCents,
        date: next?.date,
        kind: plan.kind,
        guaranteed: plan.guaranteed,
      });
    } else if (plan.kind === 'items') {
      out.push({
        planId: plan.id,
        label: plan.label,
        amountCents: input.items.expectedCents,
        date: input.items.earliestSaleDate,
        kind: 'items',
        guaranteed: false,
      });
    } else if (plan.kind === 'stocks') {
      out.push({
        planId: plan.id,
        label: plan.label,
        amountCents: input.stocks.atTargetCents,
        date: addMonths(toDay(input.today), Math.max(1, input.stocks.targetHorizonMonths)),
        kind: 'stocks',
        guaranteed: false,
      });
    }
  }

  return out;
}
