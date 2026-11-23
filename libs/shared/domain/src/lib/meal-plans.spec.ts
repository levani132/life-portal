import type { MealPlanDay, MealPlanInput } from '@life-portal/shared-types';
import { activePlanDayIndex, matchPlanDay, mealPlanProblem, planDayAdherence, planLineSlots, planSlotsLabel, mealPlanView, type PlanFood, type PlanRecipe } from './meal-plans';

const food = (name: string, kcal: number, proteinMg: number, extra: Partial<PlanFood> = {}): PlanFood =>
  ({ name, unit: 'g', energyKcalPer100: kcal, proteinMgPer100: proteinMg, fatMgPer100: 0, carbMgPer100: 0, ...extra }) as PlanFood;
const foods = new Map<string, PlanFood>([
  ['oats', food('Oats', 400, 12_000)],
  ['milk', food('Milk', 60, 3_000, { unit: 'ml' })],
  ['old', food('Discontinued', 100, 1_000, { archived: true })],
]);
const recipes = new Map<string, PlanRecipe>([
  ['porridge', { name: 'Porridge', components: [{ foodId: 'oats', amount: 50 }, { foodId: 'milk', amount: 200 }] }],
  ['words', { name: 'Stew in words', components: [] }],
  ['broken', { name: 'Uses a gone food', components: [{ foodId: 'old', amount: 100 }] }],
]);
const day = (id: string, entries: MealPlanDay['entries']): MealPlanDay => ({ id, name: `Day ${id}`, entries });

describe('mealPlanView (spec 042)', () => {
  it('totals each line, each day and the average day from the foods as they are now', () => {
    const view = mealPlanView(
      [
        day('1', [
          { id: 'a', slot: 'breakfast', savedMealId: 'porridge' },
          { id: 'b', slot: 'lunch', foodId: 'oats', amount: 100 },
        ]),
        day('2', [{ id: 'c', slot: 'dinner', foodId: 'milk', amount: 500 }]),
      ],
      foods,
      recipes,
    );
    // Porridge: 50 g oats (200 kcal, 6 g) + 200 ml milk (120 kcal, 6 g).
    expect(view.days[0].entries[0]).toMatchObject({ name: 'Porridge', missing: false, totals: { energyKcal: 320, proteinMg: 12_000 } });
    expect(view.days[0].entries[1]).toMatchObject({ name: 'Oats', unit: 'g', totals: { energyKcal: 400 } });
    expect(view.days[0].totals.energyKcal).toBe(720);
    expect(view.days[1].totals.energyKcal).toBe(300);
    expect(view.dailyAverage.energyKcal).toBe(510);
    expect(view.complete).toBe(true);
  });

  it('marks what no longer has numbers and counts it for nothing', () => {
    const view = mealPlanView(
      [
        day('1', [
          { id: 'a', slot: 'breakfast', savedMealId: 'words' },
          { id: 'b', slot: 'lunch', savedMealId: 'broken' },
          { id: 'c', slot: 'dinner', savedMealId: 'gone' },
          { id: 'd', slot: 'snack', foodId: 'old', amount: 100 },
          { id: 'e', slot: 'snack', foodId: 'oats', amount: 100 },
        ]),
      ],
      foods,
      recipes,
    );
    expect(view.days[0].entries.map((entry) => entry.missing)).toEqual([true, true, true, true, false]);
    expect(view.days[0].entries[3].name).toBe('Discontinued');
    expect(view.days[0].totals.energyKcal).toBe(400);
    expect(view.complete).toBe(false);
  });

  it('leaves empty days out of the average, and an empty plan is not complete', () => {
    const view = mealPlanView([day('1', [{ id: 'a', slot: 'lunch', foodId: 'oats', amount: 100 }]), day('2', [])], foods, recipes);
    expect(view.dailyAverage.energyKcal).toBe(400);
    expect(mealPlanView([day('1', [])], foods, recipes)).toMatchObject({ complete: false, dailyAverage: { energyKcal: 0 } });
  });
});

describe('mealPlanProblem (spec 042)', () => {
  const ok: MealPlanInput = { name: 'Cut', days: [{ name: 'Training day', entries: [{ slot: 'breakfast', foodId: 'oats', amount: 80 }] }] };
  it('accepts a named plan with at least one line', () => {
    expect(mealPlanProblem(ok)).toBeUndefined();
    expect(mealPlanProblem({ ...ok, days: [...ok.days, { name: 'Rest day', entries: [] }] })).toBeUndefined();
  });
  it('says what is wrong', () => {
    expect(mealPlanProblem({ ...ok, name: ' ' })).toMatch(/name/);
    expect(mealPlanProblem({ ...ok, days: [] })).toMatch(/at least one day/);
    expect(mealPlanProblem({ ...ok, days: [{ name: '', entries: ok.days[0].entries }] })).toMatch(/Name every day/);
    expect(mealPlanProblem({ ...ok, days: [{ name: 'A', entries: [] }] })).toMatch(/at least one meal/);
    expect(mealPlanProblem({ ...ok, days: [{ name: 'A', entries: [{ slot: 'lunch', foodId: 'oats' }] }] })).toMatch(/amount/);
    expect(mealPlanProblem({ ...ok, days: [{ name: 'A', entries: [{ slot: 'lunch', foodId: 'oats', amount: 10, savedMealId: 'porridge' }] }] })).toMatch(/one recipe or one food/);
    expect(mealPlanProblem({ ...ok, days: [{ name: 'A', entries: [{ slot: 'brunch' as never, foodId: 'oats', amount: 10 }] }] })).toMatch(/meal for every line/);
    expect(mealPlanProblem({ ...ok, days: Array.from({ length: 15 }, () => ok.days[0]) })).toMatch(/14 days/);
  });
});

describe('activePlanDayIndex (spec 042)', () => {
  const dayIds = ['a', 'b', 'c'];
  const at = (day: string, choices?: { day: string; dayId: string }[]) => activePlanDayIndex({ dayIds, since: '2026-11-23', day, choices });
  it('walks the plan a day at a time from the day it was started, and starts again', () => {
    expect(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-12-01'].map((day) => at(day))).toEqual([0, 1, 2, 0, 2]);
  });
  it('runs backwards before the start, so earlier days can be compared with the plan', () => {
    expect(['2026-11-22', '2026-11-21', '2026-11-20'].map((day) => at(day))).toEqual([2, 1, 0]);
  });
  it('re-anchors on a picked day: the days after follow on, the days before keep theirs', () => {
    const choices = [{ day: '2026-11-24', dayId: 'c' }];
    expect(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'].map((day) => at(day, choices))).toEqual([0, 2, 0, 1]);
    // The latest pick on or before the day wins; a pick for a day that is gone is ignored.
    const more = [...choices, { day: '2026-11-26', dayId: 'a' }, { day: '2026-11-25', dayId: 'gone' }];
    expect(['2026-11-25', '2026-11-26', '2026-11-27'].map((day) => at(day, more))).toEqual([0, 0, 1]);
  });
  it('is the first day with no days', () => {
    expect(activePlanDayIndex({ dayIds: [], since: '2026-11-23', day: '2026-11-30' })).toBe(0);
  });
});

describe('plan lines at more than one meal (spec 042)', () => {
  it('reads the meals a line allows, with "anything else" as any time', () => {
    expect(planLineSlots({ slot: 'lunch' })).toEqual(['lunch']);
    expect(planLineSlots({ slot: 'lunch', slots: ['lunch', 'dinner'] })).toEqual(['lunch', 'dinner']);
    expect(planLineSlots({ slot: 'uncategorized' })).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(planSlotsLabel(['lunch', 'dinner'])).toBe('Lunch or dinner');
    expect(planSlotsLabel(['breakfast', 'lunch', 'snack'])).toBe('Breakfast, lunch or snack');
    expect(planSlotsLabel(['snack', 'dinner', 'lunch', 'breakfast'])).toBe('Any time');
  });
  it('refuses an unknown or repeated meal', () => {
    const plan = (slots: string[]) => ({ name: 'P', days: [{ name: 'D', entries: [{ slot: 'lunch' as const, slots: slots as never, foodId: 'f', amount: 100 }] }] });
    expect(mealPlanProblem(plan(['lunch', 'dinner']))).toBeUndefined();
    expect(mealPlanProblem(plan(['lunch', 'lunch']))).toBe('Choose a meal for every line.');
    expect(mealPlanProblem(plan(['brunch']))).toBe('Choose a meal for every line.');
  });
});

describe('matchPlanDay (spec 042)', () => {
  const entry = (id: string, slot: string, foodId: string, extra: Record<string, string> = {}) => ({ id, slot: slot as never, foodId, ...extra });
  it('counts a food however it was logged, preferring one of the line\'s meals', () => {
    const lines = [
      { id: 'l1', slot: 'lunch' as const, slots: ['lunch' as const, 'dinner' as const], foodId: 'rice' },
      { id: 'l2', slot: 'dinner' as const, foodId: 'rice' },
    ];
    const match = matchPlanDay(lines, [entry('e1', 'breakfast', 'rice'), entry('e2', 'dinner', 'rice')]);
    // l1 takes the dinner rice (one of its meals); l2 takes what is left, at another meal.
    expect(Object.fromEntries(match)).toEqual({ l1: ['e2'], l2: ['e1'] });
  });
  it('lets a meal logged from the plan stand for its own line first, and each meal for one line', () => {
    const lines = [{ id: 'l1', slot: 'lunch' as const, foodId: 'rice' }, { id: 'l2', slot: 'lunch' as const, foodId: 'rice' }];
    const match = matchPlanDay(lines, [entry('e1', 'lunch', 'rice', { planEntryId: 'l2' })]);
    expect(Object.fromEntries(match)).toEqual({ l2: ['e1'] });
  });
  it('takes a recipe\'s meals together', () => {
    const lines = [{ id: 'r', slot: 'breakfast' as const, savedMealId: 'porridge' }, { id: 'f', slot: 'breakfast' as const, foodId: 'oats' }];
    const entries = [entry('a', 'breakfast', 'oats', { savedMealId: 'porridge' }), entry('b', 'breakfast', 'milk', { savedMealId: 'porridge' }), entry('c', 'breakfast', 'oats')];
    expect(Object.fromEntries(matchPlanDay(lines, entries))).toEqual({ r: ['a', 'b'], f: ['c'] });
  });
  it('says how closely the day was followed', () => {
    const lines = [
      { id: 'l1', slot: 'lunch' as const, foodId: 'rice', totals: { energyKcal: 260 } },
      { id: 'l2', slot: 'dinner' as const, foodId: 'chicken', totals: { energyKcal: 150 } },
      { id: 'l3', slot: 'dinner' as const, foodId: 'gone', missing: true, totals: { energyKcal: 0 } },
    ];
    const entries = [{ ...entry('e1', 'lunch', 'rice'), totals: { energyKcal: 300 } }, { ...entry('e2', 'lunch', 'cake'), totals: { energyKcal: 400 } }];
    expect(planDayAdherence(lines, entries)).toEqual({ planned: 2, followed: 1, plannedKcal: 410, eatenKcal: 300 });
  });
});
