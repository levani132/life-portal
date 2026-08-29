/**
 * Budget proposals: the guards matter more than the arithmetic.
 *
 * Every test here is really about *not* proposing — too little history, too small a deviation,
 * a figure already refused, one expensive evening. The one test that does propose exists mostly
 * to prove the silence is deliberate rather than a bug.
 *
 * The fixtures are the owner's real ladder: Breakfast ₾10 and Lunch + Dinner ₾20 daily, Fuel ₾80
 * weekly, Health ₾120 monthly, and the loan settled by hand.
 */
import type { Cadence } from '@life-portal/shared-types';
import { addDays } from './dates';
import type { LadderTierBudget } from './spend-waterfall';
import {
  MIN_DEVIATION_CENTS,
  MINIMUM_COMPLETE_PERIODS,
  isNewLineProposal,
  median,
  newLineProposalId,
  suggestBudgets,
  type CustomPurposeHistory,
  type LinePeriodSpend,
  type SuggestBudgetsInput,
} from './spend-suggestions';

const TODAY = '2026-08-24';

const BREAKFAST = 'breakfast';
const LUNCH_DINNER = 'lunch-dinner';
const FUEL = 'fuel';
const HEALTH = 'health';
const LOAN = 'loan';

function tiers(overrides: Partial<Record<Cadence, LadderTierBudget['rungs']>> = {}) {
  const base: LadderTierBudget[] = [
    {
      cadence: 'daily',
      rungs: [
        { expenseId: BREAKFAST, label: 'Breakfast', budgetCents: 1000, currency: 'GEL' },
        { expenseId: LUNCH_DINNER, label: 'Lunch + Dinner', budgetCents: 2000, currency: 'GEL' },
      ],
    },
    {
      cadence: 'weekly',
      rungs: [{ expenseId: FUEL, label: 'Fuel', budgetCents: 8000, currency: 'GEL' }],
    },
    {
      cadence: 'monthly',
      rungs: [
        { expenseId: HEALTH, label: 'Health', budgetCents: 12000, currency: 'GEL' },
        {
          expenseId: LOAN,
          label: 'Loan repayment',
          budgetCents: 90000,
          currency: 'GEL',
          settlement: 'manual',
        },
      ],
    },
  ];
  return base.map((tier) =>
    overrides[tier.cadence] ? { ...tier, rungs: overrides[tier.cadence] as never } : tier,
  );
}

/** `count` complete daily periods ending the day before `TODAY`, each spending `spend(index)`. */
function dailyHistory(
  expenseId: string,
  count: number,
  spend: (index: number) => number,
): LinePeriodSpend[] {
  return Array.from({ length: count }, (_, index) => {
    const day = addDays(TODAY, -(count - index));
    return { expenseId, from: day, to: day, spentCents: spend(index) };
  });
}

/** `count` complete weekly periods ending before `TODAY` (a Monday), each spending `spend`. */
function weeklyHistory(
  expenseId: string,
  count: number,
  spend: (index: number) => number,
): LinePeriodSpend[] {
  return Array.from({ length: count }, (_, index) => {
    const from = addDays(TODAY, -7 * (count - index));
    return { expenseId, from, to: addDays(from, 6), spentCents: spend(index) };
  });
}

function monthlyHistory(
  expenseId: string,
  count: number,
  spend: (index: number) => number,
): LinePeriodSpend[] {
  return Array.from({ length: count }, (_, index) => {
    const from = `2026-0${index + 3}-01`;
    return { expenseId, from, to: `2026-0${index + 3}-28`, spentCents: spend(index) };
  });
}

function run(overrides: Partial<SuggestBudgetsInput> = {}) {
  return suggestBudgets({
    today: TODAY,
    tiers: tiers(),
    history: [],
    currency: 'GEL',
    ...overrides,
  });
}

describe('median', () => {
  it('takes the middle value of an odd-length set', () => {
    expect(median([100, 900, 300])).toBe(300);
  });

  it('averages the two middle values of an even-length set, in whole cents', () => {
    expect(median([100, 301, 302, 900])).toBe(302);
    expect(median([100, 300])).toBe(200);
  });

  it('is zero for no observations at all', () => {
    expect(median([])).toBe(0);
  });
});

describe('suggestBudgets — revising an existing line', () => {
  it('proposes a lower budget for a line that is consistently underspent', () => {
    // ₾10 budgeted, ₾4.00 really spent, every day for four weeks.
    const proposals = run({ history: dailyHistory(BREAKFAST, 28, () => 400) });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].expenseId).toBe(BREAKFAST);
    expect(proposals[0].suggestedCents).toBe(400);
    expect(proposals[0].value).toBe(400);
    expect(proposals[0].currentCents).toBe(1000);
    expect(proposals[0].cadence).toBe('daily');
    expect(proposals[0].basis).toBe(
      'Median of 28 complete days was ₾4.00 against a ₾10.00 allowance',
    );
    expect(proposals[0].assumptions).toMatchObject({
      periods: 28,
      cadence: 'daily',
      medianCents: 400,
      statistic: 'median',
    });
    expect(proposals[0].confidence).toBe('low');
  });

  it('proposes a higher budget for a line that is consistently overspent', () => {
    const proposals = run({ history: weeklyHistory(FUEL, 8, () => 11000) });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].expenseId).toBe(FUEL);
    expect(proposals[0].suggestedCents).toBe(11000);
    expect(proposals[0].currentCents).toBe(8000);
    expect(proposals[0].cadence).toBe('weekly');
    expect(proposals[0].basis).toContain('8 complete weeks');
  });

  it('reports higher confidence the more complete periods stand behind the figure', () => {
    const long = run({ history: dailyHistory(BREAKFAST, 56, () => 400) });
    expect(long[0].confidence).toBe('high');

    const middling = run({ history: dailyHistory(BREAKFAST, 44, () => 400) });
    expect(middling[0].confidence).toBe('medium');
  });

  it('proposes for a monthly line once four months are complete', () => {
    const proposals = run({ history: monthlyHistory(HEALTH, 4, () => 4000) });
    expect(proposals.map((p) => p.expenseId)).toEqual([HEALTH]);
    expect(proposals[0].suggestedCents).toBe(4000);
  });
});

describe('suggestBudgets — when it must stay silent', () => {
  it('proposes nothing from too little history (FR-037)', () => {
    // 27 days of a very obvious underspend is still one day short of the minimum.
    const short = MINIMUM_COMPLETE_PERIODS['daily'] - 1;
    expect(run({ history: dailyHistory(BREAKFAST, short, () => 100) })).toEqual([]);

    // And one more day is enough.
    expect(run({ history: dailyHistory(BREAKFAST, short + 1, () => 100) })).toHaveLength(1);
  });

  it('proposes nothing for a deviation under the proportional threshold', () => {
    // ₾19.40 against a ₾20.00 allowance: 3% out, and ₾0.60 in absolute terms. Noise.
    expect(run({ history: dailyHistory(LUNCH_DINNER, 28, () => 1940) })).toEqual([]);
  });

  it('proposes nothing for a deviation under the absolute threshold', () => {
    // A ₾20 line spent at ₾15.50 clears 15% but only by ₾4.50, under the ~₾5 floor.
    expect(MIN_DEVIATION_CENTS).toBe(500);
    expect(run({ history: dailyHistory(LUNCH_DINNER, 28, () => 1550) })).toEqual([]);

    // ₾14.90 clears both, so the floor is the only thing that was stopping it.
    expect(run({ history: dailyHistory(LUNCH_DINNER, 28, () => 1490) })).toHaveLength(1);
  });

  it('never proposes on a line settled by hand', () => {
    // The cascade never charges the loan, so its consumption reads as zero — which would
    // otherwise propose cutting a ₾900 repayment to nothing.
    const history = monthlyHistory(LOAN, 6, () => 0);
    expect(run({ history })).toEqual([]);
  });

  it('never proposes on a planned one-off', () => {
    const oneOff: LadderTierBudget['rungs'] = [
      {
        expenseId: 'new-phone',
        label: 'New phone',
        budgetCents: 250000,
        currency: 'GEL',
        kind: 'one_off',
      },
    ];
    const history = monthlyHistory('new-phone', 6, () => 0);
    expect(run({ tiers: tiers({ monthly: oneOff }), history })).toEqual([]);
  });

  it('never proposes on a line held in another currency', () => {
    // The median is in the display currency; writing it into a dollar allowance would turn a
    // $40 line into ₾40 without anything looking wrong.
    const inDollars: LadderTierBudget['rungs'] = [
      { expenseId: 'vpn', label: 'VPN', budgetCents: 4000, currency: 'USD' },
    ];
    const history = monthlyHistory('vpn', 6, () => 12000);
    expect(run({ tiers: tiers({ monthly: inDollars }), history })).toEqual([]);
  });

  it('ignores the period in progress, and periods before capture began', () => {
    const history = [
      ...dailyHistory(BREAKFAST, 28, () => 400),
      // Today itself: nothing spent yet, which is not evidence of anything.
      { expenseId: BREAKFAST, from: TODAY, to: TODAY, spentCents: 0 },
    ];
    expect(run({ history })[0].assumptions?.['periods']).toBe(28);

    // With capture only reaching back a fortnight, the earlier "zero" days are silence rather
    // than thrift, and there is no longer enough history to say anything.
    expect(run({ history, observedFrom: addDays(TODAY, -14) })).toEqual([]);
  });
});

describe('suggestBudgets — the median resists an outlier the mean would not', () => {
  it('ignores one expensive evening in an otherwise routine month', () => {
    // 27 ordinary ₾20 days on a ₾20 allowance, and one ₾500 dinner.
    const spends = Array.from({ length: 28 }, (_, index) => (index === 13 ? 50000 : 2000));
    const history = dailyHistory(LUNCH_DINNER, 28, (index) => spends[index]);

    expect(suggestBudgets({ today: TODAY, tiers: tiers(), history, currency: 'GEL' })).toEqual([]);

    // The point of the test: a mean would have crossed both thresholds comfortably and
    // proposed nearly doubling the allowance on the strength of one dinner.
    const mean = Math.round(spends.reduce((a, b) => a + b, 0) / spends.length);
    expect(mean).toBe(3714);
    expect(Math.abs(mean - 2000)).toBeGreaterThan(MIN_DEVIATION_CENTS);
    expect(Math.abs(mean - 2000) / 2000).toBeGreaterThan(0.15);
    expect(median(spends)).toBe(2000);
  });
});

describe('suggestBudgets — dismissals', () => {
  const history = dailyHistory(BREAKFAST, 28, () => 400);

  it('suppresses the figure the owner refused', () => {
    const dismissals = { [BREAKFAST]: { at: '2026-08-01', cents: 400 } };
    expect(run({ history, dismissals })).toEqual([]);
  });

  it('still suppresses a figure that has barely moved since the refusal', () => {
    // ₾4.50 refused, ₾4.00 observed: 50 tetri is not a change of habit.
    const dismissals = { [BREAKFAST]: { at: '2026-08-01', cents: 450 } };
    expect(run({ history, dismissals })).toEqual([]);
  });

  it('proposes again once the median has moved materially away from it', () => {
    // ₾4.00 refused; breakfast has since climbed to ₾20.00, which is a different claim.
    const moved = dailyHistory(BREAKFAST, 28, () => 2000);
    const dismissals = { [BREAKFAST]: { at: '2026-08-01', cents: 400 } };
    const proposals = run({ history: moved, dismissals });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].suggestedCents).toBe(2000);
  });

  it('does not silence a line for ever because a proposal of zero was refused', () => {
    // A line the owner never spends on is proposed at ₾0. Taking a proportion against zero
    // would suppress it whatever it later cost, so the absolute floor is the whole test.
    const dismissals = { [BREAKFAST]: { at: '2026-08-01', cents: 0 } };
    expect(run({ history: dailyHistory(BREAKFAST, 28, () => 2000), dismissals })).toHaveLength(1);

    // …while spending that really is still nothing stays refused.
    expect(run({ history: dailyHistory(BREAKFAST, 28, () => 0), dismissals })).toEqual([]);
  });

  it('leaves other lines alone', () => {
    const proposals = run({
      history: [...history, ...weeklyHistory(FUEL, 8, () => 11000)],
      dismissals: { [BREAKFAST]: { at: '2026-08-01', cents: 400 } },
    });
    expect(proposals.map((p) => p.expenseId)).toEqual([FUEL]);
  });
});

describe('suggestBudgets — new lines from custom purposes (FR-049)', () => {
  /** Four haircuts, one a month, ₾30 each — a habit with no budget line. */
  const barber: CustomPurposeHistory = {
    purpose: 'Barber',
    occurrences: [
      { day: '2026-05-06', amountCents: 3000 },
      { day: '2026-06-04', amountCents: 3000 },
      { day: '2026-07-03', amountCents: 3000 },
      { day: '2026-08-05', amountCents: 3000 },
    ],
  };

  it('proposes a monthly line for a purpose that has become a habit', () => {
    const proposals = run({ purposes: [barber] });

    expect(proposals).toHaveLength(1);
    const [proposal] = proposals;
    expect(isNewLineProposal(proposal)).toBe(true);
    expect(proposal.expenseId).toBe(newLineProposalId('Barber'));
    expect(proposal.label).toBe('Barber');
    expect(proposal.cadence).toBe('monthly');
    expect(proposal.currentCents).toBe(0);
    expect(proposal.suggestedCents).toBe(3000);
    expect(proposal.basis).toContain('no budget line');
    expect(proposal.assumptions).toMatchObject({ occurrences: 4, purpose: 'Barber' });
  });

  it('proposes nothing for a purpose bought only a few times', () => {
    const twice = { ...barber, occurrences: barber.occurrences.slice(0, 2) };
    expect(run({ purposes: [twice] })).toEqual([]);
  });

  it('proposes nothing for four purchases crammed into one week', () => {
    const burst: CustomPurposeHistory = {
      purpose: 'Moving flat',
      occurrences: [
        { day: '2026-06-01', amountCents: 9000 },
        { day: '2026-06-03', amountCents: 9000 },
        { day: '2026-06-05', amountCents: 9000 },
        { day: '2026-06-07', amountCents: 9000 },
      ],
    };
    expect(run({ purposes: [burst] })).toEqual([]);
  });

  it('counts an empty month as zero, so a twice-a-year purchase is not a monthly line', () => {
    const rare: CustomPurposeHistory = {
      purpose: 'Car insurance',
      occurrences: [
        { day: '2026-01-10', amountCents: 40000 },
        { day: '2026-01-11', amountCents: 40000 },
        { day: '2026-07-10', amountCents: 40000 },
        { day: '2026-07-11', amountCents: 40000 },
      ],
    };
    // Five of the seven months in the span are empty, so the median month is ₾0.
    expect(run({ purposes: [rare] })).toEqual([]);
  });

  it('never proposes a purpose that has already been promoted to a line', () => {
    expect(run({ purposes: [{ ...barber, promotedToExpenseId: 'abc' }] })).toEqual([]);
  });

  it('honours a dismissal of a new-line proposal', () => {
    const dismissals = { [newLineProposalId('Barber')]: { at: '2026-08-10', cents: 3000 } };
    expect(run({ purposes: [barber], dismissals })).toEqual([]);
  });
});

describe('suggestBudgets — ordering', () => {
  it('puts the largest change first, whichever way it goes', () => {
    const proposals = run({
      history: [
        ...dailyHistory(BREAKFAST, 28, () => 400), // ₾6.00 down
        ...weeklyHistory(FUEL, 8, () => 11000), // ₾30.00 up
        ...monthlyHistory(HEALTH, 4, () => 4000), // ₾80.00 down
      ],
    });
    expect(proposals.map((p) => p.expenseId)).toEqual([HEALTH, FUEL, BREAKFAST]);
  });
});
