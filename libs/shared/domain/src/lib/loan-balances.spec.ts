import type { Loan, LoanPayment, RepaymentPlan } from '@life-portal/shared-types';
import { loanBalance } from './loan-balances';

const loan: Loan = {
  id: 'loan1',
  userId: 'u1',
  lender: 'Friend',
  principalCents: 1_700_000,
  currency: 'USD',
  startDate: '2025-09-01',
  interestRate: 0,
  priority: 1,
  status: 'active',
  createdAt: '2025-09-01',
  updatedAt: '2025-09-01',
};

/** The seeded opening adjustment: $6,500 already repaid before any schedule existed. */
const openingAdjustment: LoanPayment = {
  id: 'pay-open',
  userId: 'u1',
  loanId: 'loan1',
  amountCents: 650_000,
  currency: 'USD',
  date: '2025-09-01',
  source: 'other',
  note: 'Opening balance adjustment',
  createdAt: '2025-09-01',
  updatedAt: '2025-09-01',
};

/** $1,000 a month on the 7th, funded by salary, owned by a cash-flow expense. */
const salaryPlan: RepaymentPlan = {
  id: 'plan-salary',
  userId: 'u1',
  loanId: 'loan1',
  kind: 'recurring',
  label: 'From monthly salary',
  currency: 'USD',
  cadence: 'monthly',
  dayOfMonth: 7,
  startDate: '2026-06-01',
  linkedExpenseId: 'exp-loan',
  guaranteed: true,
  enabled: true,
  createdAt: '2026-06-01',
  updatedAt: '2026-06-01',
};

const itemsPlan: RepaymentPlan = {
  ...salaryPlan,
  id: 'plan-items',
  kind: 'items',
  label: 'Proceeds from items sold',
  cadence: undefined,
  dayOfMonth: undefined,
  linkedExpenseId: undefined,
  guaranteed: false,
};

const linked = { 'exp-loan': 100_000 };

describe('loanBalance', () => {
  it('reports the recorded balance untouched', () => {
    const balance = loanBalance(loan, [openingAdjustment], [], {}, '2026-08-18');
    expect(balance.paidCents).toBe(650_000);
    expect(balance.remainingCents).toBe(1_050_000);
    expect(balance.expectedRemainingCents).toBe(1_050_000);
    expect(balance.unrecordedScheduledCents).toBe(0);
  });

  it('flags scheduled repayments that have fallen due with nothing recorded', () => {
    // Plan starts 1 Jun 2026, so 7 Jun, 7 Jul and 7 Aug have all passed by 18 Aug.
    const balance = loanBalance(loan, [openingAdjustment], [salaryPlan], linked, '2026-08-18');
    expect(balance.unrecordedCount).toBe(3);
    expect(balance.unrecordedScheduledCents).toBe(300_000);
    expect(balance.unrecordedFromDate).toBe('2026-06-07');
    // Owed if the plan was kept to; the recorded figure stays $10,500.
    expect(balance.expectedRemainingCents).toBe(750_000);
    expect(balance.remainingCents).toBe(1_050_000);
  });

  it('does not count a payment made before the schedule began twice', () => {
    // The $6,500 opening adjustment predates the plan, so it cannot cover any instalment.
    const balance = loanBalance(loan, [openingAdjustment], [salaryPlan], linked, '2026-06-07');
    expect(balance.unrecordedCount).toBe(1);
    expect(balance.unrecordedScheduledCents).toBe(100_000);
  });

  it('treats recorded payments as covering the instalments in order', () => {
    const june: LoanPayment = { ...openingAdjustment, id: 'p1', amountCents: 100_000, date: '2026-06-07' };
    const july: LoanPayment = { ...openingAdjustment, id: 'p2', amountCents: 100_000, date: '2026-07-07' };
    const balance = loanBalance(
      loan,
      [openingAdjustment, june, july],
      [salaryPlan],
      linked,
      '2026-08-18',
    );
    // Only August is missing now, and the "since" date moves with it.
    expect(balance.unrecordedCount).toBe(1);
    expect(balance.unrecordedScheduledCents).toBe(100_000);
    expect(balance.unrecordedFromDate).toBe('2026-08-07');
  });

  it('ignores instalments that have not fallen due yet', () => {
    const balance = loanBalance(loan, [openingAdjustment], [salaryPlan], linked, '2026-06-06');
    expect(balance.unrecordedCount).toBe(0);
    expect(balance.expectedRemainingCents).toBe(1_050_000);
  });

  it('ignores asset sales, disabled plans and plans with no amount', () => {
    const disabled = { ...salaryPlan, id: 'plan-off', enabled: false };
    const unfunded = { ...salaryPlan, id: 'plan-bare', linkedExpenseId: undefined, amountCents: undefined };
    const balance = loanBalance(
      loan,
      [openingAdjustment],
      [itemsPlan, disabled, unfunded],
      linked,
      '2026-08-18',
    );
    expect(balance.unrecordedScheduledCents).toBe(0);
  });

  it('never claims more was repaid than is owed', () => {
    // A schedule running since 2024 would "cover" the debt several times over.
    const longRunning = { ...salaryPlan, startDate: '2024-01-01' };
    const balance = loanBalance(loan, [openingAdjustment], [longRunning], linked, '2026-08-18');
    expect(balance.unrecordedScheduledCents).toBe(1_050_000);
    expect(balance.expectedRemainingCents).toBe(0);
  });

  it('counts a one-off plan whose date has passed', () => {
    const bonus: RepaymentPlan = {
      ...salaryPlan,
      id: 'plan-bonus',
      kind: 'one_off',
      label: 'Annual bonus',
      cadence: undefined,
      dayOfMonth: undefined,
      linkedExpenseId: undefined,
      amountCents: 200_000,
      date: '2026-08-01',
    };
    expect(loanBalance(loan, [], [bonus], {}, '2026-08-18').unrecordedScheduledCents).toBe(200_000);
    expect(loanBalance(loan, [], [bonus], {}, '2026-07-31').unrecordedScheduledCents).toBe(0);
  });
});
