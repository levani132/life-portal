import {
  MEAL_PLAN_LIMITS,
  MEAL_SLOTS,
  type EntryTotals,
  type FoodUnit,
  type MealPlanDay,
  type MealPlanDayView,
  type MealPlanEntryView,
  type MealPlanInput,
  type NutritionFacts,
} from '@life-portal/shared-types';
import { diffDays } from './dates';
import { emptyTotals, entryTotals, sumTotals } from './nutrition';

/** A food as a meal plan needs it: its name, unit and facts per 100. */
export type PlanFood = NutritionFacts & { name: string; unit: FoodUnit; archived?: boolean };
/** A recipe as a meal plan needs it: its name and its foods with amounts. */
export interface PlanRecipe {
  name: string;
  components: { foodId: string; amount: number }[];
}

/**
 * A meal plan's days with today's numbers (spec 042). Nothing derived is stored: every total is
 * worked out here from the foods as they are now. An entry whose food or recipe is gone, or
 * whose recipe has no foods with numbers, is `missing` and counts for nothing.
 */
export function mealPlanView(
  days: readonly MealPlanDay[],
  foods: ReadonlyMap<string, PlanFood>,
  recipes: ReadonlyMap<string, PlanRecipe>,
): { days: MealPlanDayView[]; dailyAverage: EntryTotals; complete: boolean } {
  const usable = (id: string) => {
    const food = foods.get(id);
    return food && !food.archived ? food : undefined;
  };
  const view = days.map((day): MealPlanDayView => {
    const entries = day.entries.map((entry): MealPlanEntryView => {
      if (entry.savedMealId) {
        const recipe = recipes.get(entry.savedMealId);
        const parts = recipe?.components.map((component) => ({ component, food: usable(component.foodId) })) ?? [];
        const missing = !recipe || !parts.length || parts.some((part) => !part.food);
        return {
          ...entry,
          name: recipe?.name ?? 'A recipe that is gone',
          totals: missing ? emptyTotals() : sumTotals(parts.map((part) => entryTotals(part.component.amount, part.food as PlanFood))),
          missing,
        };
      }
      const food = entry.foodId ? usable(entry.foodId) : undefined;
      const amount = entry.amount ?? 0;
      const missing = !food || amount < 1;
      return {
        ...entry,
        name: food?.name ?? (entry.foodId ? foods.get(entry.foodId)?.name : undefined) ?? 'A food that is gone',
        ...(food ? { unit: food.unit } : {}),
        totals: missing ? emptyTotals() : entryTotals(amount, food as PlanFood),
        missing,
      };
    });
    return { id: day.id, name: day.name, entries, totals: sumTotals(entries.map((entry) => entry.totals)) };
  });
  const filled = view.filter((day) => day.entries.length > 0);
  const sum = sumTotals(filled.map((day) => day.totals));
  const dailyAverage = filled.length
    ? (Object.fromEntries(Object.entries(sum).map(([key, value]) => [key, Math.round((value as number) / filled.length)])) as unknown as EntryTotals)
    : emptyTotals();
  return { days: view, dailyAverage, complete: filled.length > 0 && view.every((day) => day.entries.every((entry) => !entry.missing)) };
}

/** Why a meal plan cannot be saved as sent, or nothing when it can. */
export function mealPlanProblem(input: MealPlanInput): string | undefined {
  if (!input.name.trim()) return 'Give the plan a name.';
  if (input.name.trim().length > MEAL_PLAN_LIMITS.name) return `A plan's name can be ${MEAL_PLAN_LIMITS.name} characters at most.`;
  if ((input.description ?? '').length > MEAL_PLAN_LIMITS.description) return 'The description is too long.';
  if (!input.days.length) return 'A plan needs at least one day.';
  if (input.days.length > MEAL_PLAN_LIMITS.days) return `A plan can have ${MEAL_PLAN_LIMITS.days} days at most.`;
  for (const day of input.days) {
    if (!day.name.trim()) return 'Name every day.';
    if (day.name.trim().length > MEAL_PLAN_LIMITS.dayName) return `A day's name can be ${MEAL_PLAN_LIMITS.dayName} characters at most.`;
    if (day.entries.length > MEAL_PLAN_LIMITS.entriesPerDay) return `A day can hold ${MEAL_PLAN_LIMITS.entriesPerDay} meals and foods at most.`;
    for (const entry of day.entries) {
      if (!(MEAL_SLOTS as readonly string[]).includes(entry.slot)) return 'Choose a meal for every line.';
      const recipe = !!entry.savedMealId;
      const food = !!entry.foodId;
      if (recipe === food) return 'Each line is one recipe or one food.';
      if (food && !(Number.isInteger(entry.amount) && (entry.amount as number) >= 1 && (entry.amount as number) <= 20_000)) return 'Give every food an amount.';
    }
  }
  if (!input.days.some((day) => day.entries.length)) return 'Add at least one meal or food.';
  return undefined;
}

/**
 * Which day of an active plan is today's (spec 042): the plan's days in order, one per calendar
 * day from the day it was started, round and round. A choice made for today wins, for today
 * only. Before the start day, or with no days, it is the first.
 */
export function activePlanDayIndex(input: {
  dayIds: readonly string[];
  since: string;
  today: string;
  override?: { day: string; dayId: string } | null;
}): number {
  if (!input.dayIds.length) return 0;
  if (input.override && input.override.day === input.today) {
    const chosen = input.dayIds.indexOf(input.override.dayId);
    if (chosen >= 0) return chosen;
  }
  const elapsed = diffDays(input.since, input.today);
  return elapsed > 0 ? elapsed % input.dayIds.length : 0;
}
