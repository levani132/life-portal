import type { RepaymentPlan } from '@life-portal/shared-types';
import { buildLoanScenarios, buildScenario, resolvePlanAmountCents, type LoanScenarioInput } from './loan-scenarios';

const salaryPlan: RepaymentPlan = {
  id: 'plan-salary',
  userId: 'u1',
  loanId: 'loan1',
  kind: 'recurring',
  label: 'From monthly salary',
  amountCents: 100_000,
  currency: 'USD',
  cadence: 'monthly',
  dayOfMonth: 7,
  startDate: '2026-01-07',
  linkedExpenseId: 'exp-loan',
  guaranteed: true,
  enabled: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const itemsPlan: RepaymentPlan = {
  ...salaryPlan,
  id: 'plan-items',
  kind: 'items',
  label: 'Proceeds from items',
  amountCents: undefined,
  linkedExpenseId: undefined,
  guaranteed: false,
};

const stocksPlan: RepaymentPlan = {
  ...salaryPlan,
  id: 'plan-stocks',
  kind: 'stocks',
  label: 'Proceeds from shares',
  amountCents: undefined,
  linkedExpenseId: undefined,
  guaranteed: false,
};

const base: LoanScenarioInput = {
  today: '2026-08-03',
  remainingCents: 1_050_000, // $10,500 still owed on the original $17,000
  currency: 'USD',
  interestRate: 0,
  plans: [salaryPlan, itemsPlan, stocksPlan],
  linkedExpenseAmounts: { 'exp-loan': 100_000 },
  items: { expectedCents: 150_000, pessimisticCents: 100_000, optimisticCents: 200_000 },
  stocks: { nowCents: 300_000, atTargetCents: 450_000, targetHorizonMonths: 12 },
};

describe('resolvePlanAmountCents', () => {
  it('takes the amount from the linked cash-flow expense, which owns it', () => {
    expect(resolvePlanAmountCents(salaryPlan, { 'exp-loan': 120_000 })).toBe(120_000);
  });

  it('falls back to the plan amount when the linked expense is gone', () => {
    expect(resolvePlanAmountCents(salaryPlan, {})).toBe(100_000);
  });
});

describe('worst case', () => {
  const worst = () => buildScenario('worst', base);

  it('counts only guaranteed, salary-funded repayments', () => {
    const scenario = worst();
    expect(scenario.steps.every((s) => s.contributions.every((c) => c.label === 'From monthly salary'))).toBe(true);
  });

  it('clears $10,500 at $1,000 a month in 11 payments', () => {
    const scenario = worst();
    expect(scenario.steps).toHaveLength(11);
    expect(scenario.payoffDate).toBe('2027-06-07');
    expect(scenario.totalPaidCents).toBe(1_050_000);
  });

  it('caps the final payment at the outstanding balance', () => {
    const scenario = worst();
    const last = scenario.steps[scenario.steps.length - 1];
    expect(last.paidCents).toBe(50_000);
    expect(last.remainingCents).toBe(0);
  });

  it('says out loud that it assumed nothing was sold', () => {
    expect(worst().assumptions).toContain('Nothing is sold: no items, no shares.');
  });
});

describe('best case', () => {
  it('uses asking prices and target prices, and finishes sooner', () => {
    const best = buildScenario('best', base);
    const worst = buildScenario('worst', base);
    expect(best.payoffDate).toBeDefined();
    expect(best.payoffDate! < worst.payoffDate!).toBe(true);
  });

  it('applies item proceeds at asking price a month out', () => {
    const best = buildScenario('best', base);
    const itemStep = best.steps.find((s) =>
      s.contributions.some((c) => c.label === 'Proceeds from items'),
    );
    expect(itemStep?.date).toBe('2026-09-03');
    expect(itemStep?.contributions.find((c) => c.label === 'Proceeds from items')?.amountCents).toBe(200_000);
  });

  it('prefers the earliest expected sale date when the user gave one', () => {
    const best = buildScenario('best', { ...base, items: { ...base.items, earliestSaleDate: '2026-08-20' } });
    const itemStep = best.steps.find((s) => s.contributions.some((c) => c.label === 'Proceeds from items'));
    expect(itemStep?.date).toBe('2026-08-20');
  });

  it('dates the share sale at the target horizon', () => {
    // A $30,000 balance is not cleared by salary and items alone, so the share sale still
    // happens and can be checked. On the real $10,500 balance it never gets that far.
    const best = buildScenario('best', { ...base, remainingCents: 3_000_000 });
    const stockStep = best.steps.find((s) =>
      s.contributions.some((c) => c.label === 'Proceeds from shares'),
    );
    // Dated today + the 12-month target horizon, not snapped to the salary day.
    expect(stockStep?.date).toBe('2027-08-03');
    expect(stockStep?.contributions.find((c) => c.label === 'Proceeds from shares')?.amountCents).toBe(450_000);
  });

  it('never needs the share sale when salary and items already clear the balance', () => {
    const best = buildScenario('best', base);
    expect(best.steps.some((s) => s.contributions.some((c) => c.label === 'Proceeds from shares'))).toBe(false);
    expect(best.payoffDate).toBe('2027-04-07');
  });
});

describe('expected case', () => {
  it('finishes no later than salary alone, as does the best case', () => {
    const [best, expected, worst] = buildLoanScenarios(base);
    expect(best.payoffDate! <= worst.payoffDate!).toBe(true);
    expect(expected.payoffDate! <= worst.payoffDate!).toBe(true);
  });

  it('can finish sooner than the best case, because it sells shares today', () => {
    // Not a bug: holding for the target price recovers more money but takes longer. The
    // scenario labels say what each one assumes rather than ranking the outcomes.
    const [best, expected] = buildLoanScenarios(base);
    expect(expected.payoffDate! < best.payoffDate!).toBe(true);
    expect(best.assumptions).toContain(
      'Waiting for the target recovers more money but can finish later than selling today.',
    );
  });

  it("values shares at today's market price, not the target", () => {
    const expected = buildScenario('expected', base);
    const stockStep = expected.steps.find((s) =>
      s.contributions.some((c) => c.label === 'Proceeds from shares'),
    );
    expect(stockStep?.contributions.find((c) => c.label === 'Proceeds from shares')?.amountCents).toBe(300_000);
  });
});

describe('edge cases', () => {
  it('reports no payoff date when there is no funding at all', () => {
    const scenario = buildScenario('worst', { ...base, plans: [itemsPlan, stocksPlan] });
    expect(scenario.payoffDate).toBeUndefined();
    expect(scenario.steps).toHaveLength(0);
    expect(scenario.assumptions).toContain('No scheduled repayment is set up, so nothing is guaranteed.');
  });

  it('ignores disabled plans', () => {
    const scenario = buildScenario('best', {
      ...base,
      plans: [{ ...salaryPlan, enabled: false }, itemsPlan, stocksPlan],
    });
    expect(scenario.steps.some((s) => s.contributions.some((c) => c.label === 'From monthly salary'))).toBe(false);
  });

  it('never pays more than is owed even when assets exceed the balance', () => {
    const scenario = buildScenario('best', {
      ...base,
      items: { expectedCents: 2_000_000, pessimisticCents: 0, optimisticCents: 2_000_000 },
    });
    expect(scenario.totalPaidCents).toBeLessThanOrEqual(base.remainingCents);
    expect(scenario.steps[scenario.steps.length - 1].remainingCents).toBe(0);
  });

  it('takes longer once interest accrues', () => {
    const free = buildScenario('worst', base);
    const costly = buildScenario('worst', { ...base, interestRate: 0.12 });
    expect(costly.payoffDate! > free.payoffDate!).toBe(true);
    expect(costly.assumptions.some((a) => a.includes('12.00% a year'))).toBe(true);
  });

  it('handles an already-repaid loan', () => {
    const scenario = buildScenario('worst', { ...base, remainingCents: 0 });
    expect(scenario.steps).toHaveLength(0);
    expect(scenario.totalPaidCents).toBe(0);
  });
});
