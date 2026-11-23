import {
  MEAL_PLAN_LIMITS,
  MEAL_SLOTS,
  type EntryTotals,
  type FoodUnit,
  type MealPlanDay,
  type MealPlanDayView,
  type MealPlanEntryView,
  type MealPlanInput,
  type MealSlot,
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
      if (entry.slots && (entry.slots.some((slot) => !(MEAL_SLOTS as readonly string[]).includes(slot)) || new Set(entry.slots).size !== entry.slots.length))
        return 'Choose a meal for every line.';
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
 * Which day of the plan in use a calendar day is (spec 042). The plan's days run in order, one
 * per calendar day, round and round. A day the person picked re-anchors the order: that day is
 * the one picked and the days after follow on from it, while the days before keep what they
 * were. With no pick on or before the day, the order runs from the start day, backwards too, so
 * days before the plan was started can be compared with it.
 */
export function activePlanDayIndex(input: {
  dayIds: readonly string[];
  since: string;
  day: string;
  choices?: readonly { day: string; dayId: string }[] | null;
}): number {
  const count = input.dayIds.length;
  if (!count) return 0;
  const anchor = (input.choices ?? [])
    .filter((choice) => choice.day <= input.day && input.dayIds.includes(choice.dayId))
    .reduce<{ day: string; dayId: string } | undefined>((latest, choice) => (!latest || choice.day > latest.day ? choice : latest), undefined);
  const base = anchor ? anchor.day : input.since;
  const offset = anchor ? input.dayIds.indexOf(anchor.dayId) : 0;
  return (((offset + diffDays(base, input.day)) % count) + count) % count;
}

/** The meals a plan line may be eaten at. "Anything else" in a plan means any meal. */
export const PLAN_ANY_TIME: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export function planLineSlots(line: { slot: MealSlot; slots?: readonly MealSlot[] }): MealSlot[] {
  if (line.slots && line.slots.length) return [...line.slots];
  return line.slot === 'uncategorized' ? [...PLAN_ANY_TIME] : [line.slot];
}

/** How a line's meals read: "Lunch", "Lunch or dinner", "Any time". */
export function planSlotsLabel(slots: readonly MealSlot[]): string {
  if (PLAN_ANY_TIME.every((slot) => slots.includes(slot))) return 'Any time';
  const names = slots.map((slot) => (slot === 'uncategorized' ? 'any time' : slot));
  const text = names.length <= 2 ? names.join(' or ') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface PlanLineToMatch {
  id: string;
  slot: MealSlot;
  slots?: readonly MealSlot[];
  foodId?: string;
  savedMealId?: string;
  /** The food's name, for meals of another food by the same name. */
  name?: string;
}
export interface EntryToMatch {
  id: string;
  slot: MealSlot;
  foodId: string;
  savedMealId?: string;
  planEntryId?: string;
  name?: string;
}

/**
 * Which of the diary's meals stand for which plan lines on one day (spec 042). Derived, never
 * stored, so it holds however the meal was logged: from the plan's Log button (the meal carries
 * the line's id), as the same recipe, or as the same food from search, a suggestion or before
 * the plan was in use. A recipe line takes that recipe's meals; a food line takes one meal of
 * that food, or else of a food with the same name. A meal at one of the line's meals is preferred to one at another. Each meal stands
 * for one line at most. Returns line id → the ids of its meals; a line absent was not eaten.
 */
const foodName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

export function matchPlanDay(lines: readonly PlanLineToMatch[], entries: readonly EntryToMatch[]): Map<string, string[]> {
  const matched = new Map<string, string[]>();
  const used = new Set<string>();
  const take = (lineId: string, picked: readonly EntryToMatch[]) => {
    if (!picked.length) return;
    for (const entry of picked) used.add(entry.id);
    matched.set(lineId, [...(matched.get(lineId) ?? []), ...picked.map((entry) => entry.id)]);
  };
  const lineIds = new Set(lines.map((line) => line.id));
  // 1. Logged from the plan itself.
  for (const entry of entries) {
    if (entry.planEntryId && lineIds.has(entry.planEntryId)) take(entry.planEntryId, [entry]);
  }
  const open = (line: PlanLineToMatch) => !matched.has(line.id);
  const free = entries.filter((entry) => !used.has(entry.id));
  // 2. A recipe: that recipe's meals, at one of the line's meals if there are any there.
  for (const line of lines.filter((each) => open(each) && each.savedMealId)) {
    const allowed = planLineSlots(line);
    const candidates = free.filter((entry) => !used.has(entry.id) && entry.savedMealId === line.savedMealId);
    const slot = candidates.find((entry) => allowed.includes(entry.slot))?.slot ?? candidates[0]?.slot;
    take(line.id, candidates.filter((entry) => entry.slot === slot));
  }
  // 3. A food: one meal of it, at one of the line's meals first.
  for (const line of lines.filter((each) => open(each) && each.foodId)) {
    const allowed = planLineSlots(line);
    const candidates = free.filter((entry) => !used.has(entry.id) && entry.foodId === line.foodId);
    const pick = candidates.find((entry) => allowed.includes(entry.slot)) ?? candidates[0];
    if (pick) take(line.id, [pick]);
  }
  // 4. Another food by the same name: a plan saved from a post holds the reader's copies of its
  //    foods, while they may log their own food of that name, as they always have.
  for (const line of lines.filter((each) => open(each) && each.foodId && each.name)) {
    const allowed = planLineSlots(line);
    const wanted = foodName(line.name as string);
    const candidates = free.filter((entry) => !used.has(entry.id) && !!entry.name && foodName(entry.name) === wanted);
    const pick = candidates.find((entry) => allowed.includes(entry.slot)) ?? candidates[0];
    if (pick) take(line.id, [pick]);
  }
  return matched;
}

/** How closely one day followed its plan day: lines eaten of lines planned, and the calories. */
export function planDayAdherence(
  lines: readonly (PlanLineToMatch & { missing?: boolean; totals: { energyKcal: number } })[],
  entries: readonly (EntryToMatch & { totals: { energyKcal: number } })[],
): { planned: number; followed: number; plannedKcal: number; eatenKcal: number } {
  const counted = lines.filter((line) => !line.missing);
  const matched = matchPlanDay(counted, entries);
  const eaten = new Set([...matched.values()].flat());
  return {
    planned: counted.length,
    followed: counted.filter((line) => matched.has(line.id)).length,
    plannedKcal: counted.reduce((sum, line) => sum + line.totals.energyKcal, 0),
    eatenKcal: entries.filter((entry) => eaten.has(entry.id)).reduce((sum, entry) => sum + entry.totals.energyKcal, 0),
  };
}
