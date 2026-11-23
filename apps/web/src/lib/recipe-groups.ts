import type { MealEntry } from '@life-portal/shared-types';

/** A row of a meal: one food, or the foods logged together from one recipe (spec 044). */
export type MealItem =
  | { kind: 'entry'; entry: MealEntry }
  | { kind: 'group'; id: string; savedMealId?: string; servings?: number; entries: MealEntry[] };

/**
 * A meal's entries as rows: those logged together from a recipe (one `mealLogId`) become one row,
 * at the place of the first of them. Recipes logged before groups existed share their recipe and
 * the minute they were logged. Everything else stays a row of its own.
 */
export function recipeGroups(entries: readonly MealEntry[]): MealItem[] {
  const items: MealItem[] = [];
  const groups = new Map<string, Extract<MealItem, { kind: 'group' }>>();
  for (const entry of entries) {
    const key = entry.mealLogId ?? (entry.savedMealId ? `legacy:${entry.savedMealId}:${(entry.createdAt ?? '').slice(0, 16)}` : undefined);
    if (!key) {
      items.push({ kind: 'entry', entry });
      continue;
    }
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
      continue;
    }
    const created = {
      kind: 'group' as const,
      id: key,
      ...(entry.savedMealId ? { savedMealId: entry.savedMealId } : {}),
      ...(entry.mealServings ? { servings: entry.mealServings } : {}),
      entries: [entry],
    };
    groups.set(key, created);
    items.push(created);
  }
  return items;
}
