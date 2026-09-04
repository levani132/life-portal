import type { Expense, IncomeSource, RealisedSale } from '@life-portal/shared-types';
import { incomeOccurrences, nextIncomeDay, projectCash, snapshotAt } from './cash-projection';

const salary: IncomeSource = {
  id: 'inc1',
  userId: 'u1',
  label: 'EPAM salary',
  amountCents: 400_000,
  currency: 'USD',
  recurrence: { cadence: 'monthly', interval: 1, dayOfMonth: 7, startDate: '2026-01-07' },
  active: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const loanRepayment: Expense = {
  id: 'exp-loan',
  userId: 'u1',
  label: 'Loan repayment',
  amountCents: 100_000,
  currency: 'USD',
  category: 'loan',
  kind: 'recurring',
  recurrence: { cadence: 'monthly', interval: 1, dayOfMonth: 7, startDate: '2026-01-07' },
  active: true,
  linkedLoanId: 'loan1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const rent: Expense = {
  id: 'exp-rent',
  userId: 'u1',
  label: 'Rent',
  amountCents: 90_000,
  currency: 'USD',
  category: 'housing',
  kind: 'recurring',
  recurrence: { cadence: 'monthly', interval: 1, dayOfMonth: 1, startDate: '2026-01-01' },
  active: true,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const baseInput = {
  today: '2026-08-03',
  to: '2026-10-31',
  openingBalanceCents: 250_000,
  balanceAsOf: '2026-08-03',
  currency: 'USD' as const,
  incomes: [salary],
  expenses: [loanRepayment, rent],
};

describe('projectCash', () => {
  it('rolls the balance forward through income and expenses', () => {
    const projection = projectCash(baseInput);
    const day = (date: string) => projection.days.find((d) => d.date === date);

    expect(day('2026-08-03')?.closingCents).toBe(250_000);
    // 7 Aug: +4000 salary, -1000 loan.
    expect(day('2026-08-07')?.inCents).toBe(400_000);
    expect(day('2026-08-07')?.outCents).toBe(100_000);
    expect(day('2026-08-07')?.closingCents).toBe(550_000);
    // 1 Sep: -900 rent.
    expect(day('2026-09-01')?.closingCents).toBe(460_000);
  });

  it('projects from the reconciliation date, not from today', () => {
    // Balance was true a week ago; the rent that fell due since then is still a forecast.
    const projection = projectCash({
      ...baseInput,
      balanceAsOf: '2026-07-28',
      openingBalanceCents: 300_000,
    });
    expect(projection.from).toBe('2026-07-28');
    expect(projection.days.find((d) => d.date === '2026-08-01')?.outCents).toBe(90_000);
    expect(projection.days.find((d) => d.date === '2026-08-03')?.closingCents).toBe(210_000);
  });

  it('computes the monthly net from recurring items only', () => {
    const projection = projectCash(baseInput);
    expect(projection.monthlyRecurringInCents).toBe(400_000);
    expect(projection.monthlyRecurringOutCents).toBe(190_000);
    expect(projection.monthlyNetCents).toBe(210_000);
  });

  it('flags the first date the balance goes negative', () => {
    // $100 on hand, no income: the 7 Aug loan repayment of $1,000 is the first shortfall.
    const projection = projectCash({
      ...baseInput,
      openingBalanceCents: 10_000,
      incomes: [],
    });
    expect(projection.firstShortfallDate).toBe('2026-08-07');
  });

  it('only reports a shortfall from today onward', () => {
    // Reconciled on 28 Jul with $100. Rent on the 1st took it negative and the salary on the
    // 2nd fixed it — all before today, so there is nothing to warn about.
    const paidOnTheSecond: IncomeSource = {
      ...salary,
      recurrence: { ...salary.recurrence, dayOfMonth: 2 },
    };
    const projection = projectCash({
      ...baseInput,
      balanceAsOf: '2026-07-28',
      openingBalanceCents: 10_000,
      incomes: [paidOnTheSecond],
      expenses: [rent],
    });
    expect(projection.days.find((d) => d.date === '2026-08-01')?.closingCents).toBeLessThan(0);
    expect(projection.days.find((d) => d.date === '2026-08-03')?.closingCents).toBeGreaterThan(0);
    expect(projection.firstShortfallDate).toBeUndefined();

    // Still negative *today* counts as now, not as history.
    expect(
      projectCash({ ...baseInput, balanceAsOf: '2026-07-28', openingBalanceCents: 10_000 })
        .firstShortfallDate,
    ).toBe('2026-08-03');

    // And a shortfall that lands later is reported on its own date.
    expect(
      projectCash({ ...baseInput, openingBalanceCents: 10_000, incomes: [] }).firstShortfallDate,
    ).toBe('2026-08-07');
  });

  it('ignores inactive income and expenses', () => {
    const projection = projectCash({
      ...baseInput,
      expenses: [{ ...rent, active: false }, loanRepayment],
    });
    expect(projection.monthlyRecurringOutCents).toBe(100_000);
  });

  it('includes one-off expenses on their date only', () => {
    const holiday: Expense = {
      ...rent,
      id: 'exp-holiday',
      label: 'Batumi trip',
      kind: 'one_off',
      recurrence: undefined,
      date: '2026-09-15',
      amountCents: 50_000,
      category: 'travel',
    };
    const projection = projectCash({ ...baseInput, expenses: [holiday] });
    expect(projection.days.find((d) => d.date === '2026-09-15')?.outCents).toBe(50_000);
    expect(projection.days.filter((d) => d.outCents > 0)).toHaveLength(1);
  });
});

describe('realised sales as inflows', () => {
  const laptopSale: RealisedSale = {
    currency: 'USD',
    id: 'item-laptop',
    label: 'MacBook Pro',
    amountCents: 80_000,
    grossCents: 80_000,
    date: '2026-08-20',
    source: 'item',
  };

  it('adds sale proceeds to the balance on the day they landed', () => {
    const projection = projectCash({ ...baseInput, sales: [laptopSale] });
    const day = projection.days.find((d) => d.date === '2026-08-20');

    expect(day?.inCents).toBe(80_000);
    expect(day?.events.map((e) => e.sourceKind)).toContain('sale');
    // 250_000 opening + 400_000 salary - 100_000 loan + 80_000 sale.
    expect(day?.closingCents).toBe(630_000);
  });

  it('ignores a sale that predates the reconciliation, which already includes the cash', () => {
    const projection = projectCash({
      ...baseInput,
      sales: [{ ...laptopSale, date: '2026-07-15' }],
    });
    expect(projection.days.some((d) => d.events.some((e) => e.sourceKind === 'sale'))).toBe(false);
    expect(projection.days.find((d) => d.date === '2026-08-03')?.closingCents).toBe(250_000);
  });

  it('leaves out proceeds that are earmarked for a debt', () => {
    // The loan widget already counts this money against the balance owed; counting it as
    // spendable cash too would let the same dollar do two jobs.
    const projection = projectCash({
      ...baseInput,
      sales: [{ ...laptopSale, amountCents: 0, allocatedToLoanId: 'loan1' }],
    });
    expect(projection.days.find((d) => d.date === '2026-08-20')?.inCents).toBe(0);
  });

  it('does not treat a sale as a payday', () => {
    // The window that "genuinely free" uses must still close at the 7 Sep salary, not at the
    // 20 Aug sale — otherwise the rent due on 1 Sep would drop out of committed spending.
    const projection = projectCash({ ...baseInput, sales: [laptopSale] });
    const snapshot = snapshotAt(projection, '2026-08-08', '2026-08-03');

    expect(snapshot.nextIncomeDate).toBe('2026-09-07');
    expect(snapshot.nextIncomeAmountCents).toBe(400_000);
    expect(snapshot.committedBeforeNextIncomeCents).toBe(90_000);
  });
});

describe('snapshot free-money semantics', () => {
  it('excludes obligations falling on the next salary day itself', () => {
    // On 3 Aug the balance is 2500. The next salary is 7 Aug. The loan repayment also falls
    // on 7 Aug, funded by that salary, so it must not be counted against today's balance.
    const projection = projectCash(baseInput);
    const snapshot = snapshotAt(projection, '2026-08-03', '2026-08-03');

    expect(snapshot.projectedBalanceCents).toBe(250_000);
    expect(snapshot.nextIncomeDate).toBe('2026-08-07');
    expect(snapshot.nextIncomeAmountCents).toBe(400_000);
    expect(snapshot.committedBeforeNextIncomeCents).toBe(0);
    expect(snapshot.freeCents).toBe(250_000);
  });

  it('counts obligations that fall strictly before the next salary', () => {
    // Asking on 8 Aug: rent on 1 Sep is due before the 7 Sep salary, so it is committed.
    const projection = projectCash(baseInput);
    const snapshot = snapshotAt(projection, '2026-08-08', '2026-08-03');

    expect(snapshot.projectedBalanceCents).toBe(550_000);
    expect(snapshot.nextIncomeDate).toBe('2026-09-07');
    expect(snapshot.committedBeforeNextIncomeCents).toBe(90_000);
    expect(snapshot.freeCents).toBe(460_000);
  });

  it('reports a mid-period dip that the closing balance would hide', () => {
    // Rent of $900 on 1 Sep bites before the 7 Sep salary arrives, so a healthy 30 Sep
    // balance conceals a near-zero moment. That dip is the number worth surfacing.
    // 1000 → 7 Aug +4000 −1000 = 4000 → 1 Sep −900 = 3100 → 7 Sep +4000 −1000 = 6100.
    const projection = projectCash({ ...baseInput, openingBalanceCents: 100_000 });
    const snapshot = snapshotAt(projection, '2026-09-30', '2026-08-03');

    expect(snapshot.projectedBalanceCents).toBe(610_000);
    expect(snapshot.lowestBalanceDate).toBe('2026-08-03');
    expect(snapshot.lowestBalanceCents).toBe(100_000);
    expect(snapshot.lowestBalanceCents).toBeLessThan(snapshot.projectedBalanceCents);
  });

  it('finds a dip that occurs after today rather than on it', () => {
    // No salary, so the balance only falls: rent on 1 Sep and 1 Oct takes 3000 to 1200,
    // and the low is the last rent day rather than today.
    const projection = projectCash({
      ...baseInput,
      openingBalanceCents: 300_000,
      incomes: [],
      expenses: [rent],
    });
    const snapshot = snapshotAt(projection, '2026-10-31', '2026-08-03');
    expect(snapshot.lowestBalanceDate).toBe('2026-10-01');
    expect(snapshot.lowestBalanceCents).toBe(120_000);
  });

  it('falls back to the last projected day when asked beyond the horizon', () => {
    const projection = projectCash(baseInput);
    const snapshot = snapshotAt(projection, '2027-06-01', '2026-08-03');
    expect(snapshot.date).toBe('2026-10-31');
  });
});

describe('mixed currencies', () => {
  // The real shape of this user's data: a salary paid in USD, card spending in GEL.
  const fx = {
    displayCurrency: 'GEL' as const,
    rates: { USD_GEL: 2.6121, GEL_USD: 1 / 2.6121 },
    rateDate: '2026-08-25',
  };

  const salary: IncomeSource = {
    id: 'inc1',
    userId: 'u1',
    label: 'EPAM salary',
    amountCents: 384_411,
    currency: 'USD',
    recurrence: { cadence: 'monthly', interval: 1, dayOfMonth: 7, startDate: '2026-01-07' },
    active: true,
    createdAt: '2026-01-07',
    updatedAt: '2026-01-07',
  };

  const breakfast: Expense = {
    id: 'exp1',
    userId: 'u1',
    label: 'Breakfast',
    amountCents: 1_000,
    currency: 'USD',
    category: 'food',
    kind: 'recurring',
    recurrence: { cadence: 'daily', interval: 1, startDate: '2026-08-01' },
    active: true,
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
  };

  it('restates a foreign salary and expense in the display currency', () => {
    const projection = projectCash({
      today: '2026-08-25',
      to: '2026-08-25',
      openingBalanceCents: 100_000,
      balanceAsOf: '2026-08-25',
      currency: 'GEL',
      openingCurrency: 'GEL',
      fx,
      incomes: [salary],
      expenses: [breakfast],
    });

    const day = projection.days[0];
    // $10 at 2.6121 is ₾26.12, not ₾10.
    expect(day.outCents).toBe(2_612);
    expect(day.events[0].originalAmountCents).toBe(1_000);
    expect(day.events[0].originalCurrency).toBe('USD');
    expect(projection.unconvertedCurrencies).toBeUndefined();
  });

  it('converts the reconciled balance out of its own currency', () => {
    const projection = projectCash({
      today: '2026-08-25',
      to: '2026-08-25',
      openingBalanceCents: 100_000,
      balanceAsOf: '2026-08-25',
      currency: 'GEL',
      openingCurrency: 'USD',
      fx,
      incomes: [],
      expenses: [],
    });
    expect(projection.openingCents).toBe(261_210);
  });

  it('flags a currency it has no rate for instead of pretending', () => {
    const projection = projectCash({
      today: '2026-08-25',
      to: '2026-08-25',
      openingBalanceCents: 0,
      balanceAsOf: '2026-08-25',
      currency: 'GEL',
      fx: { displayCurrency: 'GEL', rates: {} },
      incomes: [],
      expenses: [{ ...breakfast, currency: 'EUR' }],
    });
    // Still counted — understating an outflow is the more dangerous error — but named.
    expect(projection.days[0].outCents).toBe(1_000);
    expect(projection.unconvertedCurrencies).toEqual(['EUR']);
  });

  it('adds dollars to lari when no rates are supplied, which is why fx is threaded through', () => {
    const projection = projectCash({
      today: '2026-08-25',
      to: '2026-08-25',
      openingBalanceCents: 0,
      balanceAsOf: '2026-08-25',
      currency: 'GEL',
      incomes: [],
      expenses: [breakfast],
    });
    expect(projection.days[0].outCents).toBe(1_000);
  });
});

describe('actual spending replaces the budget for days already past', () => {
  const breakfast: Expense = {
    id: 'exp1',
    userId: 'u1',
    label: 'Breakfast',
    amountCents: 3_000,
    currency: 'GEL',
    category: 'food',
    kind: 'recurring',
    recurrence: { cadence: 'daily', interval: 1, startDate: '2026-08-01' },
    active: true,
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
  };

  const base = {
    today: '2026-08-25',
    to: '2026-08-26',
    openingBalanceCents: 100_000,
    balanceAsOf: '2026-08-24',
    currency: 'GEL' as const,
    incomes: [],
    expenses: [breakfast],
  };

  it('uses what was really spent on a past day rather than what was budgeted', () => {
    const projection = projectCash({ ...base, actualOutByDay: { '2026-08-24': 1_822 } });
    expect(projection.days.find((d) => d.date === '2026-08-24')?.outCents).toBe(1_822);
  });

  it('leaves a future day on its budget, because nothing has happened on it yet', () => {
    const projection = projectCash({ ...base, actualOutByDay: { '2026-08-26': 1 } });
    expect(projection.days.find((d) => d.date === '2026-08-26')?.outCents).toBe(3_000);
  });

  it('falls back to the budget for a past day with nothing captured, never to zero', () => {
    // No payments captured is not evidence that no money was spent. Treating it as zero would
    // quietly inflate every balance after it.
    const projection = projectCash({ ...base, actualOutByDay: { '2026-08-25': 500 } });
    expect(projection.days.find((d) => d.date === '2026-08-24')?.outCents).toBe(3_000);
  });

  it('behaves exactly as before when no actuals are supplied', () => {
    const withMap = projectCash({ ...base, actualOutByDay: {} });
    const without = projectCash(base);
    expect(withMap.days.map((d) => d.outCents)).toEqual(without.days.map((d) => d.outCents));
  });
});

describe('actuals never displace money SMS capture cannot see', () => {
  const loan: Expense = {
    id: 'loan1',
    userId: 'u1',
    label: 'Loan repayment to friend',
    amountCents: 100_000,
    currency: 'GEL',
    category: 'loan',
    kind: 'recurring',
    settlement: 'manual',
    recurrence: { cadence: 'monthly', interval: 1, dayOfMonth: 24, startDate: '2026-01-24' },
    active: true,
    createdAt: '2026-01-24',
    updatedAt: '2026-01-24',
  };
  const food: Expense = {
    id: 'food1',
    userId: 'u1',
    label: 'Breakfast',
    amountCents: 3_000,
    currency: 'GEL',
    category: 'food',
    kind: 'recurring',
    recurrence: { cadence: 'daily', interval: 1, startDate: '2026-08-01' },
    active: true,
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
  };
  const gift: Expense = {
    id: 'gift1',
    userId: 'u1',
    label: "Beka's grandma passing away",
    amountCents: 8_000,
    currency: 'GEL',
    category: 'family',
    kind: 'one_off',
    date: '2026-08-24',
    active: true,
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
  };

  const base = {
    today: '2026-08-25',
    to: '2026-08-25',
    openingBalanceCents: 500_000,
    balanceAsOf: '2026-08-24',
    currency: 'GEL' as const,
    incomes: [],
  };

  it('keeps a manual-settlement transfer counted beside the captured card spending', () => {
    // The loan repayment is a transfer no SMS reports. Replacing the whole day with captured
    // payments would silently delete it from the projection.
    const projection = projectCash({
      ...base,
      expenses: [loan, food],
      actualOutByDay: { '2026-08-24': 1_822 },
    });
    expect(projection.days.find((d) => d.date === '2026-08-24')?.outCents).toBe(101_822);
  });

  it('keeps a one-off record counted beside the captured card spending', () => {
    const projection = projectCash({
      ...base,
      expenses: [gift, food],
      actualOutByDay: { '2026-08-24': 1_822 },
    });
    expect(projection.days.find((d) => d.date === '2026-08-24')?.outCents).toBe(9_822);
  });

  it('still replaces the auto card-spending budget with the actuals', () => {
    const projection = projectCash({
      ...base,
      expenses: [food],
      actualOutByDay: { '2026-08-24': 1_822 },
    });
    expect(projection.days.find((d) => d.date === '2026-08-24')?.outCents).toBe(1_822);
  });
});

describe('arrival overrides — the salary paid early', () => {
  // September's payday (scheduled the 7th) landed on the 4th, before a holiday.
  const paidEarly: IncomeSource = {
    ...salary,
    arrivalOverrides: [{ scheduledDay: '2026-09-07', actualDay: '2026-09-04' }],
  };

  it('moves the occurrence, never duplicating it', () => {
    const days = incomeOccurrences(paidEarly, '2026-08-01', '2026-10-31');
    expect(days).toEqual(['2026-08-07', '2026-09-04', '2026-10-07']);
  });

  it('finds an occurrence moved into the window from just outside it', () => {
    // The window ends the 5th; the schedule says the 7th, but the money arrived on the 4th.
    expect(incomeOccurrences(paidEarly, '2026-09-01', '2026-09-05')).toEqual(['2026-09-04']);
    // And the scheduled day itself no longer carries anything.
    expect(incomeOccurrences(paidEarly, '2026-09-06', '2026-09-30')).toEqual([]);
  });

  it('projects the salary onto the day it really arrives', () => {
    const projection = projectCash({ ...baseInput, incomes: [paidEarly] });
    expect(projection.days.find((d) => d.date === '2026-09-04')?.inCents).toBe(400_000);
    expect(projection.days.find((d) => d.date === '2026-09-07')?.inCents).toBe(0);
  });

  it('closes the free-money window on the real arrival, not the scheduled day', () => {
    // Asking on 8 Aug: the next salary is now 4 Sep, so the 1 Sep rent stays committed but
    // nothing between the 4th and the old 7th does.
    const projection = projectCash({ ...baseInput, incomes: [paidEarly] });
    const snapshot = snapshotAt(projection, '2026-08-08', '2026-08-03');
    expect(snapshot.nextIncomeDate).toBe('2026-09-04');
    expect(snapshot.committedBeforeNextIncomeCents).toBe(90_000);
  });

  it('does not report an early salary already received as the next one', () => {
    // Today is the 5th: the 7th's occurrence landed on the 4th, so the next payday is October's.
    expect(nextIncomeDay(paidEarly, '2026-09-05')).toBe('2026-10-07');
    // On the 3rd it is still ahead, on its real day.
    expect(nextIncomeDay(paidEarly, '2026-09-03')).toBe('2026-09-04');
  });

  it('keeps a payday moved later visible until it arrives', () => {
    const paidLate: IncomeSource = {
      ...salary,
      arrivalOverrides: [{ scheduledDay: '2026-09-07', actualDay: '2026-09-09' }],
    };
    // The 8th is after the scheduled day but before the money: still the next payday.
    expect(nextIncomeDay(paidLate, '2026-09-08')).toBe('2026-09-09');
    expect(incomeOccurrences(paidLate, '2026-09-01', '2026-09-30')).toEqual(['2026-09-09']);
  });

  it('changes nothing when there are no overrides', () => {
    expect(nextIncomeDay(salary, '2026-09-05')).toBe('2026-09-07');
    expect(incomeOccurrences(salary, '2026-09-01', '2026-09-30')).toEqual(['2026-09-07']);
  });
});
