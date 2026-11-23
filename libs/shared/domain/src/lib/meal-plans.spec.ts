import type { MealPlanDay, MealPlanInput } from '@life-portal/shared-types';
import { mealPlanProblem, mealPlanView, type PlanFood, type PlanRecipe } from './meal-plans';

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
