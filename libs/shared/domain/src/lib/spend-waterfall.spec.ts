/**
 * The waterfall's invariants, one test named for each (contracts/domain.md).
 *
 * The fixtures are the owner's real ladder — Breakfast ₾10 then Lunch + Dinner ₾20 daily; Fuel
 * ₾80 and Chores ₾50 weekly; the loan and the three utilities settled by hand, with Health,
 * Protein, Barber and Creatin the only monthly lines a card payment may cascade into. Real
 * numbers keep the tests honest about what the cascade can and cannot reach.
 *
 * All dates are chosen around a real week boundary: 2026-08-24 is a Monday, so with the default
 * `weekStartsOn: 1` the week runs to Sunday 2026-08-30 and the next one begins on the 31st —
 * one day before the month turns. A span over 30 Aug … 2 Sep therefore crosses both.
 */
import type {
  Cadence,
  FxContext,
  SpendAllocation,
  SpendDecision,
  SpendPayment,
} from '@life-portal/shared-types';
import { sumCents } from './money';
import {
  EXTRA_LABEL,
  ORPHANED_RUNG_LABEL,
  spendWaterfall,
  startOfFinancialMonth,
  startOfFinancialYear,
  startOfWeek,
  type LadderRungBudget,
  type LadderTierBudget,
  type WaterfallInput,
} from './spend-waterfall';

const GEL: FxContext = { displayCurrency: 'GEL', rates: {} };

const DAY = '2026-08-24';

/** Rung ids, so a test says `BREAKFAST` rather than repeating a string. */
const BREAKFAST = 'breakfast';
const LUNCH_DINNER = 'lunch-dinner';
const FUEL = 'fuel';
const CHORES = 'chores';
const LOAN = 'loan';
const HEALTH = 'health';
const PROTEIN = 'protein';
const GAS = 'gas';
const ELECTRICITY = 'electricity';
const INTERNET = 'internet';
const BARBER = 'barber';
const CREATIN = 'creatin';
const FLIGHT = 'flight';

const rung = (
  expenseId: string,
  label: string,
  budgetCents: number,
  extra: Partial<LadderRungBudget> = {},
): LadderRungBudget => ({
  expenseId,
  label,
  budgetCents,
  currency: 'GEL',
  ...extra,
});

/** Daily ₾30 and weekly ₾130 — the two tiers the worked examples in the spec use. */
function mealsAndWeek(): LadderTierBudget[] {
  return [
    {
      cadence: 'daily',
      rungs: [
        rung(BREAKFAST, 'Breakfast', 1000),
        rung(LUNCH_DINNER, 'Lunch + Dinner', 2000),
      ],
    },
    {
      cadence: 'weekly',
      rungs: [rung(FUEL, 'Fuel', 8000), rung(CHORES, 'Chores', 5000)],
    },
  ];
}

/** The whole of the owner's ladder, including the lines the cascade must never touch. */
function realLadder(): LadderTierBudget[] {
  return [
    ...mealsAndWeek(),
    {
      cadence: 'monthly',
      rungs: [
        rung(LOAN, 'Loan repayment', 100_000, { settlement: 'manual' }),
        rung(HEALTH, 'Health', 20_000),
        rung(PROTEIN, 'Protein', 10_000),
        rung(GAS, 'Gas', 6000, { settlement: 'manual' }),
        rung(ELECTRICITY, 'Electricity', 6000, { settlement: 'manual' }),
        rung(INTERNET, 'Internet', 4000, { settlement: 'manual' }),
        rung(BARBER, 'Barber', 2400),
        rung(CREATIN, 'Creatin', 2000),
      ],
    },
  ];
}

let nextId = 0;
function payment(over: Partial<SpendPayment> = {}): SpendPayment {
  nextId += 1;
  const day = over.day ?? DAY;
  return {
    id: over.id ?? `p${nextId}`,
    userId: 'owner',
    amountCents: 1000,
    currency: 'GEL',
    at: `${day}T12:00:00+04:00`,
    day,
    direction: 'out',
    source: 'sms',
    status: 'recorded',
    createdAt: `${day}T12:00:00Z`,
    updatedAt: `${day}T12:00:00Z`,
    ...over,
  };
}

function confirmed(
  allocations: SpendDecision['allocations'],
  decidedAt = `${DAY}T23:00:00+04:00`,
): SpendDecision {
  return { kind: 'confirmed', allocations, decidedAt };
}

function run(
  over: Partial<WaterfallInput> & { payments: SpendPayment[] },
): ReturnType<typeof spendWaterfall> {
  return spendWaterfall({
    today: DAY,
    from: DAY,
    to: DAY,
    tiers: realLadder(),
    fx: GEL,
    ...over,
  });
}

/** Everything a rung took in the period containing `date`, whoever put it there. */
function consumedOn(
  result: ReturnType<typeof spendWaterfall>,
  date: string,
  expenseId: string,
): number {
  for (const tier of result.ladderFor(date).tiers) {
    const found = tier.rungs.find((r) => r.expenseId === expenseId);
    if (found) return found.consumedCents;
  }
  throw new Error(`no rung ${expenseId}`);
}

function tierOn(
  result: ReturnType<typeof spendWaterfall>,
  date: string,
  cadence: Cadence,
) {
  const tier = result.ladderFor(date).tiers.find((t) => t.cadence === cadence);
  if (!tier) throw new Error(`no ${cadence} tier`);
  return tier;
}

const totalOf = (allocations: SpendAllocation[]) =>
  sumCents(allocations.map((a) => a.amountCents));

const on = (allocations: SpendAllocation[], expenseId: string) =>
  sumCents(
    allocations
      .filter((a) => a.expenseId === expenseId)
      .map((a) => a.amountCents),
  );

describe('period boundaries', () => {
  it('starts a week on the configured weekday', () => {
    // 2026-08-24 is a Monday.
    expect(startOfWeek('2026-08-26', 1)).toBe('2026-08-24');
    expect(startOfWeek('2026-08-24', 1)).toBe('2026-08-24');
    expect(startOfWeek('2026-08-23', 1)).toBe('2026-08-17');
    // Sunday-start weeks put the same Sunday at the head instead.
    expect(startOfWeek('2026-08-26', 0)).toBe('2026-08-23');
  });

  it('takes a financial month from the day it begins, not the 1st', () => {
    expect(startOfFinancialMonth('2026-09-03', 1)).toBe('2026-09-01');
    // With monthStartsOn 7, 3 September still belongs to the month that began on 7 August.
    expect(startOfFinancialMonth('2026-09-03', 7)).toBe('2026-08-07');
    expect(startOfFinancialMonth('2026-09-07', 7)).toBe('2026-09-07');
    expect(startOfFinancialYear('2026-09-03', 1)).toBe('2026-01-01');
    expect(startOfFinancialYear('2026-01-03', 7)).toBe('2025-01-07');
  });
});

describe('spendWaterfall', () => {
  beforeEach(() => {
    nextId = 0;
  });

  describe('resolving payments', () => {
    it('drops money in and unparsed rows before anything else', () => {
      const result = run({
        payments: [
          payment({ id: 'in', direction: 'in', amountCents: 500_000 }),
          payment({
            id: 'queued',
            status: 'unparsed',
            amountCents: 9999,
            raw: 'gibberish',
          }),
          payment({ id: 'real', amountCents: 700 }),
        ],
      });

      expect(result.allocationsByPayment['in']).toBeUndefined();
      expect(result.allocationsByPayment['queued']).toBeUndefined();
      expect(consumedOn(result, DAY, BREAKFAST)).toBe(700);
    });

    it('counts money paid back as neither spending nor consumption', () => {
      // Dinner for two, half of it paid back: only the owner's half reaches the ladder.
      const result = run({
        payments: [payment({ amountCents: 4000, notReallySpentCents: 3000 })],
      });
      expect(tierOn(result, DAY, 'daily').consumedCents).toBe(1000);
    });

    it('converts each payment at its own day rate, never at todays', () => {
      const ratesByDay: Record<string, FxContext> = {
        '2026-08-24': { displayCurrency: 'GEL', rates: { USD_GEL: 2.6 } },
        '2026-08-25': { displayCurrency: 'GEL', rates: { USD_GEL: 2.7 } },
      };
      const result = run({
        from: '2026-08-24',
        to: '2026-08-25',
        ratesByDay,
        payments: [
          payment({
            id: 'a',
            day: '2026-08-24',
            amountCents: 1000,
            currency: 'USD',
          }),
          payment({
            id: 'b',
            day: '2026-08-25',
            amountCents: 1000,
            currency: 'USD',
          }),
        ],
      });

      expect(totalOf(result.allocationsByPayment['a'])).toBe(2600);
      expect(totalOf(result.allocationsByPayment['b'])).toBe(2700);
    });

    it('reports a currency it could not convert rather than implying it is comparable', () => {
      const result = run({
        payments: [payment({ amountCents: 1000, currency: 'EUR' })],
      });
      expect(result.unconvertedCurrencies).toEqual(['EUR']);
      expect(result.ladderFor(DAY).unconvertedCurrencies).toEqual(['EUR']);
    });
  });

  describe('the cascade', () => {
    it("a payment's allocations sum exactly to its spendable amount", () => {
      // Every shape a payment can take, in one window: plain, split, partly confirmed,
      // spread, custom, orphaned, and partly paid back.
      const payments = [
        payment({ id: 'plain', amountCents: 700 }),
        payment({ id: 'split', amountCents: 2500 }),
        payment({
          id: 'partly',
          amountCents: 3000,
          decision: confirmed([{ expenseId: LUNCH_DINNER, amountCents: 800 }]),
        }),
        payment({
          id: 'spread',
          amountCents: 1001,
          decision: confirmed([
            {
              expenseId: BREAKFAST,
              amountCents: 1001,
              forDay: DAY,
              throughDay: '2026-08-26',
            },
          ]),
        }),
        payment({
          id: 'custom',
          amountCents: 4500,
          decision: {
            kind: 'custom',
            purpose: 'vase',
            decidedAt: `${DAY}T20:00:00+04:00`,
          },
        }),
        payment({
          id: 'orphan',
          amountCents: 1200,
          decision: confirmed([
            { expenseId: 'deleted-line', amountCents: 1200 },
          ]),
        }),
        payment({ id: 'repaid', amountCents: 5000, notReallySpentCents: 1500 }),
        payment({ id: 'huge', amountCents: 500_000 }),
      ];
      const spendable: Record<string, number> = {
        plain: 700,
        split: 2500,
        partly: 3000,
        spread: 1001,
        custom: 4500,
        orphan: 1200,
        repaid: 3500,
        huge: 500_000,
      };

      const result = run({ from: DAY, to: '2026-08-31', payments });

      for (const [id, expected] of Object.entries(spendable)) {
        expect(totalOf(result.allocationsByPayment[id])).toBe(expected);
      }
    });

    it('splits one payment across rungs in order, filling each before the next', () => {
      const result = run({ payments: [payment({ amountCents: 2500 })] });
      const allocations = result.allocationsByPayment['p1'];

      expect(allocations).toEqual([
        {
          target: 'expense',
          expenseId: BREAKFAST,
          label: 'Breakfast',
          amountCents: 1000,
          forDay: DAY,
          projected: true,
        },
        {
          target: 'expense',
          expenseId: LUNCH_DINNER,
          label: 'Lunch + Dinner',
          amountCents: 1500,
          forDay: DAY,
          projected: true,
        },
      ]);
    });

    it('cascades daily, then weekly, then monthly, then into extra', () => {
      // ₾2,000 in one evening: ₾30 daily + ₾130 weekly + the ₾344 of monthly the cascade may
      // reach, and the rest is extra unplanned spending.
      const result = run({ payments: [payment({ amountCents: 200_000 })] });
      const allocations = result.allocationsByPayment['p1'];

      expect(on(allocations, BREAKFAST)).toBe(1000);
      expect(on(allocations, LUNCH_DINNER)).toBe(2000);
      expect(on(allocations, FUEL)).toBe(8000);
      expect(on(allocations, CHORES)).toBe(5000);
      expect(on(allocations, HEALTH)).toBe(20_000);
      expect(on(allocations, PROTEIN)).toBe(10_000);
      expect(on(allocations, BARBER)).toBe(2400);
      expect(on(allocations, CREATIN)).toBe(2000);

      const extra = allocations.filter((a) => a.target === 'extra');
      expect(extra).toHaveLength(1);
      expect(extra[0].amountCents).toBe(200_000 - 50_400);
      expect(extra[0].label).toBe(EXTRA_LABEL);
      expect(result.extraByMonth['2026-08-01']).toBe(149_600);
    });

    it('a manual rung and a planned one-off never receive a cascade allocation', () => {
      const tiers = realLadder();
      const monthly = tiers.find((t) => t.cadence === 'monthly');
      monthly?.rungs.push(
        rung(FLIGHT, 'Flight to Warsaw', 50_000, { kind: 'one_off' }),
      );

      const result = run({
        tiers,
        payments: [payment({ amountCents: 200_000 })],
      });
      const allocations = result.allocationsByPayment['p1'];

      // One expensive evening must not repay the loan, pay the utilities, or take the flight.
      for (const id of [LOAN, GAS, ELECTRICITY, INTERNET, FLIGHT]) {
        expect(on(allocations, id)).toBe(0);
      }
      // They still count towards the tier's budget, so the ladder shows what is committed.
      expect(tierOn(result, DAY, 'monthly').budgetCents).toBe(200_400);
    });

    it('accepts a confirmation against a planned one-off even though it never cascades', () => {
      const tiers = realLadder();
      tiers
        .find((t) => t.cadence === 'monthly')
        ?.rungs.push(
          rung(FLIGHT, 'Flight to Warsaw', 50_000, { kind: 'one_off' }),
        );

      const result = run({
        tiers,
        payments: [
          payment({
            amountCents: 48_000,
            decision: confirmed([{ expenseId: FLIGHT, amountCents: 48_000 }]),
          }),
        ],
      });

      expect(consumedOn(result, DAY, FLIGHT)).toBe(48_000);
    });
  });

  describe('confirmations', () => {
    it('places a confirmation before every projection, whatever the clock said', () => {
      // The evening payment is confirmed as the whole day's food; the morning one, decided
      // hours earlier and never touched, must still find the daily rungs already accounted
      // for. Walking by clock order would give the morning payment the daily allowance.
      const morning = payment({
        id: 'morning',
        amountCents: 3000,
        at: `${DAY}T08:00:00+04:00`,
      });
      const evening = payment({
        id: 'evening',
        amountCents: 3000,
        at: `${DAY}T20:00:00+04:00`,
        decision: confirmed([
          { expenseId: BREAKFAST, amountCents: 1000 },
          { expenseId: LUNCH_DINNER, amountCents: 2000 },
        ]),
      });

      const result = run({
        tiers: mealsAndWeek(),
        payments: [morning, evening],
      });

      expect(on(result.allocationsByPayment['evening'], BREAKFAST)).toBe(1000);
      expect(on(result.allocationsByPayment['morning'], FUEL)).toBe(3000);
      expect(on(result.allocationsByPayment['morning'], BREAKFAST)).toBe(0);
    });

    it('confirming payment A re-proposes payment B without B being touched', () => {
      const meals = () => [
        { expenseId: BREAKFAST, amountCents: 1000 },
        { expenseId: LUNCH_DINNER, amountCents: 2000 },
      ];
      const scenario = (decideOn: 'none' | 'morning' | 'evening') =>
        run({
          tiers: mealsAndWeek(),
          payments: [
            payment({
              id: 'morning',
              amountCents: 3000,
              at: `${DAY}T08:00:00+04:00`,
              decision: decideOn === 'morning' ? confirmed(meals()) : undefined,
            }),
            payment({
              id: 'evening',
              amountCents: 3000,
              at: `${DAY}T20:00:00+04:00`,
              decision: decideOn === 'evening' ? confirmed(meals()) : undefined,
            }),
          ],
        });

      // Left alone, the earlier payment takes the daily rungs and the later one overflows.
      const baseline = scenario('none');
      expect(on(baseline.allocationsByPayment['morning'], BREAKFAST)).toBe(
        1000,
      );
      expect(on(baseline.allocationsByPayment['evening'], FUEL)).toBe(3000);

      // Morning confirmed as the day's food → the evening payment re-proposes to weekly.
      const morningConfirmed = scenario('morning');
      expect(
        on(morningConfirmed.allocationsByPayment['morning'], BREAKFAST),
      ).toBe(1000);
      expect(on(morningConfirmed.allocationsByPayment['evening'], FUEL)).toBe(
        3000,
      );
      expect(
        morningConfirmed.allocationsByPayment['evening'][0].projected,
      ).toBe(true);

      // Evening confirmed instead → the *morning* payment moves to weekly, untouched.
      const eveningConfirmed = scenario('evening');
      expect(
        on(eveningConfirmed.allocationsByPayment['evening'], BREAKFAST),
      ).toBe(1000);
      expect(on(eveningConfirmed.allocationsByPayment['morning'], FUEL)).toBe(
        3000,
      );
      expect(
        on(eveningConfirmed.allocationsByPayment['morning'], BREAKFAST),
      ).toBe(0);
    });

    it("a partly confirmed payment's remainder cascades from where it would have", () => {
      // ₾8 of this was Lunch + Dinner; work out the rest. Breakfast is still open, so the
      // ₾17 remainder starts there and spills into the weekly allowance.
      const result = run({
        payments: [
          payment({
            amountCents: 2500,
            decision: confirmed([
              { expenseId: LUNCH_DINNER, amountCents: 800 },
            ]),
          }),
        ],
      });
      const allocations = result.allocationsByPayment['p1'];

      expect(allocations).toEqual([
        expect.objectContaining({
          expenseId: LUNCH_DINNER,
          amountCents: 800,
          projected: false,
        }),
        expect.objectContaining({
          expenseId: BREAKFAST,
          amountCents: 1000,
          projected: true,
        }),
        expect.objectContaining({
          expenseId: FUEL,
          amountCents: 700,
          projected: true,
        }),
      ]);
      expect(totalOf(allocations)).toBe(2500);
    });

    it('a confirmed rung is skipped by the cascade for that period, and its remainder reads as saved', () => {
      // Breakfast cost ₾7 of its ₾10. No guess may take the other ₾3 — the owner earned it.
      const result = run({
        payments: [
          payment({
            id: 'breakfast',
            amountCents: 700,
            at: `${DAY}T08:00:00+04:00`,
            decision: confirmed([{ expenseId: BREAKFAST, amountCents: 700 }]),
          }),
          payment({
            id: 'later',
            amountCents: 500,
            at: `${DAY}T13:00:00+04:00`,
          }),
        ],
      });

      const daily = tierOn(result, DAY, 'daily');
      const breakfast = daily.rungs.find((r) => r.expenseId === BREAKFAST);
      expect(breakfast).toMatchObject({
        consumedCents: 700,
        remainingCents: 300,
        confirmed: true,
      });
      // The later payment found Breakfast closed and moved on.
      expect(on(result.allocationsByPayment['later'], BREAKFAST)).toBe(0);
      expect(on(result.allocationsByPayment['later'], LUNCH_DINNER)).toBe(500);
      // ₾30 budgeted, ₾12 consumed: the ₾3 is part of the ₾18 the day saved.
      expect(daily.savingCents).toBe(1800);
    });

    it('a confirmed rung still accepts a second confirmation, which adds to it', () => {
      // Coffee in one place, dessert in another: one meal, two payments.
      const result = run({
        payments: [
          payment({
            id: 'coffee',
            amountCents: 700,
            decision: confirmed([{ expenseId: BREAKFAST, amountCents: 700 }]),
          }),
          payment({
            id: 'dessert',
            amountCents: 500,
            decision: confirmed([{ expenseId: BREAKFAST, amountCents: 500 }]),
          }),
        ],
      });

      expect(consumedOn(result, DAY, BREAKFAST)).toBe(1200);
      // Past its budget, so nothing remains — but a debt is never reported as capacity.
      const breakfast = tierOn(result, DAY, 'daily').rungs.find(
        (r) => r.expenseId === BREAKFAST,
      );
      expect(breakfast?.remainingCents).toBe(0);
      // Confirming past the budget overspends the rung and the tier says so.
      expect(tierOn(result, DAY, 'daily').savingCents).toBe(1800);
    });

    it('un-confirming reopens the rung and the projections re-fill it', () => {
      const payments = (decide: boolean) => [
        payment({
          id: 'first',
          amountCents: 700,
          at: `${DAY}T08:00:00+04:00`,
          decision: decide
            ? confirmed([{ expenseId: BREAKFAST, amountCents: 700 }])
            : undefined,
        }),
        payment({
          id: 'second',
          amountCents: 500,
          at: `${DAY}T13:00:00+04:00`,
        }),
      ];

      const withDecision = run({ payments: payments(true) });
      expect(consumedOn(withDecision, DAY, BREAKFAST)).toBe(700);
      expect(
        on(withDecision.allocationsByPayment['second'], LUNCH_DINNER),
      ).toBe(500);

      const undone = run({ payments: payments(false) });
      const breakfast = tierOn(undone, DAY, 'daily').rungs.find(
        (r) => r.expenseId === BREAKFAST,
      );
      expect(breakfast).toMatchObject({
        consumedCents: 1000,
        confirmed: false,
      });
      expect(on(undone.allocationsByPayment['second'], BREAKFAST)).toBe(300);
      expect(on(undone.allocationsByPayment['second'], LUNCH_DINNER)).toBe(200);
    });

    it('never lets a projection borrow back capacity a confirmation already spent', () => {
      // ₾40 confirmed against a ₾10 rung leaves it with zero, not minus thirty.
      const result = run({
        payments: [
          payment({
            id: 'over',
            amountCents: 4000,
            decision: confirmed([{ expenseId: BREAKFAST, amountCents: 4000 }]),
          }),
          payment({ id: 'after', amountCents: 500 }),
        ],
      });

      expect(on(result.allocationsByPayment['after'], BREAKFAST)).toBe(0);
      expect(on(result.allocationsByPayment['after'], LUNCH_DINNER)).toBe(500);
    });

    it('never lets a confirmation claim more than the payment it came from', () => {
      // A stored confirmation that outgrew its payment is trimmed rather than inventing money.
      const result = run({
        payments: [
          payment({
            amountCents: 1000,
            decision: confirmed([
              { expenseId: BREAKFAST, amountCents: 800 },
              { expenseId: LUNCH_DINNER, amountCents: 900 },
            ]),
          }),
        ],
      });
      expect(totalOf(result.allocationsByPayment['p1'])).toBe(1000);
      expect(on(result.allocationsByPayment['p1'], LUNCH_DINNER)).toBe(200);
    });

    it('routes a custom purpose to extra and leaves the ladder untouched', () => {
      const result = run({
        payments: [
          payment({
            id: 'vase',
            amountCents: 4500,
            decision: {
              kind: 'custom',
              purpose: 'vase',
              decidedAt: `${DAY}T20:00:00+04:00`,
            },
          }),
          payment({ id: 'coffee', amountCents: 400 }),
        ],
      });

      expect(result.allocationsByPayment['vase']).toEqual([
        {
          target: 'extra',
          label: 'vase',
          amountCents: 4500,
          forDay: DAY,
          projected: false,
        },
      ]);
      // The next payment is proposed as though the vase had never touched the ladder.
      expect(on(result.allocationsByPayment['coffee'], BREAKFAST)).toBe(400);
      expect(result.extraByMonth['2026-08-01']).toBe(4500);
    });

    it('surfaces a confirmation whose line item no longer exists rather than dropping it', () => {
      const result = run({
        payments: [
          payment({
            id: 'orphan',
            amountCents: 1200,
            decision: confirmed([
              { expenseId: 'deleted-line', amountCents: 1200 },
            ]),
          }),
        ],
      });

      expect(result.orphanedAllocations).toEqual([
        {
          paymentId: 'orphan',
          expenseId: 'deleted-line',
          amountCents: 1200,
          forDay: DAY,
        },
      ]);
      expect(result.allocationsByPayment['orphan']).toEqual([
        {
          target: 'extra',
          expenseId: 'deleted-line',
          label: ORPHANED_RUNG_LABEL,
          amountCents: 1200,
          forDay: DAY,
          projected: false,
        },
      ]);
      expect(result.extraByMonth['2026-08-01']).toBe(1200);
    });
  });

  describe('spreading across days', () => {
    it("a spread's per-day parts sum exactly to the amount spread", () => {
      // ₾10.01 of milk over three breakfasts: 3.34 / 3.34 / 3.33, never a lost tetri.
      const result = run({
        from: DAY,
        to: '2026-08-26',
        payments: [
          payment({
            amountCents: 1001,
            decision: confirmed([
              {
                expenseId: BREAKFAST,
                amountCents: 1001,
                forDay: DAY,
                throughDay: '2026-08-26',
              },
            ]),
          }),
        ],
      });
      const allocations = result.allocationsByPayment['p1'];

      expect(allocations.map((a) => [a.forDay, a.amountCents])).toEqual([
        [DAY, 334],
        ['2026-08-25', 334],
        ['2026-08-26', 333],
      ]);
      expect(totalOf(allocations)).toBe(1001);
      expect(consumedOn(result, '2026-08-26', BREAKFAST)).toBe(333);
    });

    it('closes each day in the span, so no guess fills a breakfast already bought', () => {
      const result = run({
        from: DAY,
        to: '2026-08-27',
        payments: [
          payment({
            id: 'milk',
            amountCents: 1200,
            decision: confirmed([
              {
                expenseId: BREAKFAST,
                amountCents: 1200,
                forDay: DAY,
                throughDay: '2026-08-27',
              },
            ]),
          }),
          payment({ id: 'later', day: '2026-08-26', amountCents: 500 }),
        ],
      });

      // 2026-08-26's Breakfast is closed by the spread, so the later payment goes past it.
      expect(on(result.allocationsByPayment['later'], BREAKFAST)).toBe(0);
      expect(on(result.allocationsByPayment['later'], LUNCH_DINNER)).toBe(500);
      for (const day of [DAY, '2026-08-25', '2026-08-26', '2026-08-27']) {
        const rungs = tierOn(result, day, 'daily').rungs;
        expect(rungs.find((r) => r.expenseId === BREAKFAST)?.confirmed).toBe(
          true,
        );
      }
    });

    it('draws each part of a span from the period that day falls in, across week and month ends', () => {
      // 30 Aug is the last day of the week that began on Monday 24th; 31 Aug opens the next
      // week and is still August; 1 and 2 September are a new month inside that same week.
      const result = run({
        from: DAY,
        to: '2026-09-06',
        payments: [
          payment({
            id: 'fuel',
            day: '2026-08-30',
            amountCents: 1000,
            decision: confirmed([
              {
                expenseId: FUEL,
                amountCents: 1000,
                forDay: '2026-08-30',
                throughDay: '2026-09-02',
              },
            ]),
          }),
          payment({
            id: 'health',
            day: '2026-08-30',
            amountCents: 1000,
            decision: confirmed([
              {
                expenseId: HEALTH,
                amountCents: 1000,
                forDay: '2026-08-30',
                throughDay: '2026-09-02',
              },
            ]),
          }),
        ],
      });

      // The weekly rung: one day in the old week, three in the new one.
      expect(consumedOn(result, '2026-08-24', FUEL)).toBe(250);
      expect(consumedOn(result, '2026-08-31', FUEL)).toBe(750);
      // The monthly rung: two days each side of the month end, in the same straddling week.
      expect(consumedOn(result, '2026-08-15', HEALTH)).toBe(500);
      expect(consumedOn(result, '2026-09-15', HEALTH)).toBe(500);
    });

    it("draws a straddling week's monthly overflow from the month the spending day falls in", () => {
      // Both payments are in the week beginning 31 August; only the second is in September.
      // ₾200 each exhausts the daily and weekly allowances, so the overflow reaches monthly —
      // and each payment's overflow must land on its own month.
      const result = run({
        from: '2026-08-01',
        to: '2026-09-30',
        payments: [
          payment({ id: 'aug', day: '2026-08-31', amountCents: 20_000 }),
          payment({ id: 'sep', day: '2026-09-01', amountCents: 20_000 }),
        ],
      });

      // August: ₾30 daily + ₾130 weekly gone, ₾40 into Health.
      expect(on(result.allocationsByPayment['aug'], HEALTH)).toBe(4000);
      // September: a fresh day, but the *same* week — so no weekly allowance is left.
      expect(on(result.allocationsByPayment['sep'], FUEL)).toBe(0);
      expect(on(result.allocationsByPayment['sep'], HEALTH)).toBe(17_000);
      expect(consumedOn(result, '2026-08-15', HEALTH)).toBe(4000);
      expect(consumedOn(result, '2026-09-15', HEALTH)).toBe(17_000);
    });
  });

  describe('savings', () => {
    it('THE TOTAL SAVED FOR A WINDOW IS IDENTICAL HOWEVER ITS PAYMENTS WERE DECIDED', () => {
      // Research §2, table one: ₾40 against a ₾30 daily and a ₾130 weekly allowance.
      const asProjection = run({
        tiers: mealsAndWeek(),
        payments: [payment({ amountCents: 4000 })],
      });
      const asBreakfast = run({
        tiers: mealsAndWeek(),
        payments: [
          payment({
            amountCents: 4000,
            decision: confirmed([{ expenseId: BREAKFAST, amountCents: 4000 }]),
          }),
        ],
      });

      expect(asProjection.cumulative).toMatchObject({
        daily: 0,
        weekly: 12_000,
        totalCents: 12_000,
      });
      expect(asBreakfast.cumulative).toMatchObject({
        daily: -1000,
        weekly: 13_000,
        totalCents: 12_000,
      });

      // Research §2, table two: ₾35 spent, ₾20 of it confirmed across the meals. This is the
      // case closing a rung exists for — the ₾10 saved on food only becomes visible in the
      // second reading, and the total is the same ₾125 in both.
      const nothingConfirmed = run({
        tiers: mealsAndWeek(),
        payments: [
          payment({
            id: 'meals',
            amountCents: 2000,
            at: `${DAY}T09:00:00+04:00`,
          }),
          payment({
            id: 'rest',
            amountCents: 1500,
            at: `${DAY}T18:00:00+04:00`,
          }),
        ],
      });
      const mealsConfirmed = run({
        tiers: mealsAndWeek(),
        payments: [
          payment({
            id: 'meals',
            amountCents: 2000,
            at: `${DAY}T09:00:00+04:00`,
            decision: confirmed([
              { expenseId: BREAKFAST, amountCents: 700 },
              { expenseId: LUNCH_DINNER, amountCents: 1300 },
            ]),
          }),
          payment({
            id: 'rest',
            amountCents: 1500,
            at: `${DAY}T18:00:00+04:00`,
          }),
        ],
      });

      expect(nothingConfirmed.cumulative).toMatchObject({
        daily: 0,
        weekly: 12_500,
        totalCents: 12_500,
      });
      expect(mealsConfirmed.cumulative).toMatchObject({
        daily: 1000,
        weekly: 11_500,
        totalCents: 12_500,
      });
    });

    it('cumulative daily plus weekly plus monthly equals the total', () => {
      const result = run({
        from: '2026-08-01',
        to: '2026-08-31',
        payments: [
          payment({ id: 'a', day: '2026-08-04', amountCents: 4000 }),
          payment({ id: 'b', day: '2026-08-17', amountCents: 250_000 }),
          payment({
            id: 'c',
            day: '2026-08-24',
            amountCents: 3000,
            decision: confirmed([{ expenseId: BARBER, amountCents: 3000 }]),
          }),
        ],
      });

      const { daily, weekly, monthly, totalCents } = result.cumulative;
      expect(daily + weekly + monthly).toBe(totalCents);
    });

    it("a projected tier's saving is never negative; a confirmed rung's may be", () => {
      // Nothing confirmed: the overflow leaves each tier, so no tier reports a debt (FR-031a).
      const projected = run({
        from: '2026-08-01',
        to: '2026-08-31',
        payments: [payment({ amountCents: 500_000 })],
      });
      for (const period of projected.savings) {
        expect(period.savingCents).toBeGreaterThanOrEqual(0);
      }
      expect(projected.cumulative.extraCents).toBeGreaterThan(0);

      // Confirmed against a ₾10 rung, ₾40 overspends it and the tier says so (FR-031b).
      const overspent = run({
        payments: [
          payment({
            amountCents: 4000,
            decision: confirmed([{ expenseId: BREAKFAST, amountCents: 4000 }]),
          }),
        ],
      });
      expect(tierOn(overspent, DAY, 'daily').savingCents).toBe(-1000);
      expect(
        overspent.savings.find((s) => s.cadence === 'daily')?.savingCents,
      ).toBe(-1000);
    });

    it('reports a period that had no spending as having saved its whole allowance', () => {
      const result = run({ from: DAY, to: '2026-08-25', payments: [] });
      const daily = result.savings.filter((s) => s.cadence === 'daily');
      expect(daily).toHaveLength(2);
      expect(
        daily.every((s) => s.savingCents === 3000 && s.spentCents === 0),
      ).toBe(true);
    });

    it('nets extra unplanned spending off the saving rather than hiding it', () => {
      const result = run({
        tiers: mealsAndWeek(),
        payments: [
          payment({
            amountCents: 5000,
            decision: {
              kind: 'custom',
              purpose: 'vase',
              decidedAt: `${DAY}T20:00:00+04:00`,
            },
          }),
        ],
      });
      const daily = result.savings.find((s) => s.cadence === 'daily');
      expect(daily).toMatchObject({
        budgetCents: 3000,
        spentCents: 0,
        savingCents: 3000,
        extraCents: 5000,
        netCents: -2000,
      });
    });
  });

  describe('order independence', () => {
    it('reordering rungs leaves total real spending unchanged', () => {
      const reordered = mealsAndWeek();
      const daily = reordered.find((t) => t.cadence === 'daily');
      if (daily) daily.rungs = [...daily.rungs].reverse();

      const payments = () => [payment({ id: 'one', amountCents: 2500 })];
      const inOrder = run({ tiers: mealsAndWeek(), payments: payments() });
      const flipped = run({ tiers: reordered, payments: payments() });

      // The attribution moves…
      expect(consumedOn(inOrder, DAY, BREAKFAST)).toBe(1000);
      expect(consumedOn(flipped, DAY, BREAKFAST)).toBe(500);
      // …and nothing else does.
      expect(flipped.cumulative).toEqual(inOrder.cumulative);
      expect(totalOf(flipped.allocationsByPayment['one'])).toBe(
        totalOf(inOrder.allocationsByPayment['one']),
      );
      expect(tierOn(flipped, DAY, 'daily').consumedCents).toBe(
        tierOn(inOrder, DAY, 'daily').consumedCents,
      );
    });

    it('the result does not depend on the order decisions were made in', () => {
      const build = () => [
        payment({
          id: 'a',
          amountCents: 2200,
          at: `${DAY}T08:15:00+04:00`,
          decision: confirmed(
            [{ expenseId: BREAKFAST, amountCents: 900 }],
            `${DAY}T23:50:00+04:00`,
          ),
        }),
        payment({ id: 'b', amountCents: 1700, at: `${DAY}T13:40:00+04:00` }),
        payment({
          id: 'c',
          amountCents: 6000,
          at: `${DAY}T19:05:00+04:00`,
          decision: confirmed(
            [{ expenseId: CHORES, amountCents: 6000 }],
            `${DAY}T08:20:00+04:00`,
          ),
        }),
        payment({
          id: 'd',
          amountCents: 900,
          at: `${DAY}T21:30:00+04:00`,
          decision: {
            kind: 'custom',
            purpose: 'vase',
            decidedAt: `${DAY}T09:00:00+04:00`,
          },
        }),
      ];

      const forward = run({ payments: build() });
      const backward = run({ payments: build().reverse() });
      const shuffled = (() => {
        const p = build();
        return run({ payments: [p[2], p[0], p[3], p[1]] });
      })();

      const shape = (result: ReturnType<typeof spendWaterfall>) => ({
        allocationsByPayment: result.allocationsByPayment,
        savings: result.savings,
        cumulative: result.cumulative,
        extraByMonth: result.extraByMonth,
        ladder: result.ladderFor(DAY),
      });

      expect(shape(backward)).toEqual(shape(forward));
      expect(shape(shuffled)).toEqual(shape(forward));
    });
  });
});
