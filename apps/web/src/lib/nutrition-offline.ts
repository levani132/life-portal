'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { snapshotFacts } from '@life-portal/shared-domain';
import type { Food, MealEntry, MealSlot, NutritionOverview, SavedMeal } from '@life-portal/shared-types';
import { useApi, revalidate } from './hooks';
import { newObjectId } from './offline/planned-row-id';
import {
  createdEntryIds,
  nutritionMetaOf,
  overlayOverview,
  type LocalEntry,
  type NutritionWriteMeta,
  type OverlayWrite,
  type ShownEntry,
} from './offline/nutrition-overlay';
import { enqueueWrite, outbox, outboxItems, useOutbox } from './offline/runtime';
import { earlierEditsOf } from './offline/conflicts';
import { moduleWrites } from './offline/settling';
import type { OutboxItem, WriteMethod } from './offline/types';
import { decorateEntry } from '@life-portal/shared-domain';

/**
 * Food that works without a connection (spec 029, issue #18), on the outbox (spec 027).
 *
 * Logging, correcting and removing a meal, logging a saved meal and weighing in are writes kept
 * on the device and sent in order, each create with the id chosen here. The Food day reads the
 * server's last copy of that day (kept on the device, `offline/reads.ts`) with those writes
 * applied (`offline/nutrition-overlay.ts`), so the totals move at once and match after sync.
 *
 * The facts a meal is shown with offline are the food's as this device has it. The server still
 * takes its own snapshot when the meal arrives and its numbers win; if they differ, the meal says
 * it was updated after sync. Everything else (foods, saved meals, the cheat queue, the profile,
 * lookups) needs a connection and says so.
 */

const nutritionWrites$ = moduleWrites('nutrition.', async (item, result) => {
  noteServerFacts(item, result);
  // The Home card's figures come from `/dashboard`.
  await Promise.all([revalidate('/nutrition'), revalidate('/dashboard')]);
});

// ------------------------------------------------------------------ "updated after sync"

/** Meals whose saved numbers differ from the ones shown before sync: id → kcal before. */
let corrected = new Map<string, number>();
const correctedListeners = new Set<() => void>();
const subscribeCorrected = (listener: () => void) => {
  correctedListeners.add(listener);
  return () => correctedListeners.delete(listener);
};

function noteServerFacts(item: OutboxItem, result: unknown) {
  const meta = nutritionMetaOf(item.meta);
  if (!meta || (meta.op !== 'entry.add' && meta.op !== 'meal.log')) return;
  const local = meta.op === 'entry.add' ? [meta.entry] : meta.entries;
  const saved = (Array.isArray(result) ? result : [result]) as Partial<MealEntry>[];
  let changed = false;
  for (const entry of local) {
    const server = saved.find((row) => row?.id === entry.id);
    if (!server?.facts) continue;
    const mine = entry.facts;
    const theirs = server.facts;
    if (
      mine.energyKcalPer100 !== theirs.energyKcalPer100 ||
      mine.proteinMgPer100 !== theirs.proteinMgPer100 ||
      mine.fatMgPer100 !== theirs.fatMgPer100 ||
      mine.carbMgPer100 !== theirs.carbMgPer100
    ) {
      corrected = new Map(corrected).set(entry.id, decorateEntry({ ...entry, userId: '', createdAt: '', updatedAt: '' }).totals.energyKcal);
      changed = true;
    }
  }
  if (changed) correctedListeners.forEach((listener) => listener());
}

/**
 * The kcal a meal showed before sync, when the server saved it with different numbers (the food
 * was corrected meanwhile, on this device or another). Kept for this visit only.
 */
export function useUpdatedAfterSync(): ReadonlyMap<string, number> {
  return useSyncExternalStore(subscribeCorrected, () => corrected, () => corrected);
}

// ------------------------------------------------------------------ what the screens read

function useNutritionWrites(): OverlayWrite[] {
  const items = nutritionWrites$.useItems();
  const snapshot = useOutbox();
  return useMemo(() => {
    const live = new Set(snapshot.items.map((item) => item.id));
    return items.flatMap((item) => {
      const meta = nutritionMetaOf(item.meta);
      return meta ? [{ meta, settled: !live.has(item.id) }] : [];
    });
  }, [items, snapshot]);
}

/** The Food day for `key` (`/nutrition?today=&day=`), with this device's waiting writes applied. */
export function useNutritionDay(key: string | null) {
  const result = useApi<NutritionOverview>(key);
  const writes = useNutritionWrites();
  const data = useMemo(() => (result.data ? overlayOverview(result.data, writes) : undefined), [result.data, writes]);
  return { ...result, data };
}

/** Food writes the server refused (a deleted food, a changed meal): shown with the reason, never dropped. */
export function useRefusedFood(): OutboxItem[] {
  const snapshot = useOutbox();
  return useMemo(
    () => snapshot.items.filter((item) => nutritionWrites$.owns(item) && (item.state === 'error' || item.state === 'conflict')),
    [snapshot],
  );
}

/** Whether Food writes are waiting with no connection, for a one-line note. */
export function useFoodOffline(): boolean {
  const snapshot = useOutbox();
  return snapshot.offline && snapshot.items.some((item) => nutritionWrites$.owns(item) && item.state === 'pending');
}

export function discardFoodWrite(id: string): Promise<void> {
  return outbox.discard(id);
}

export function isUnsaved(entry: MealEntry): boolean {
  return Boolean((entry as ShownEntry).unsaved);
}

// ------------------------------------------------------------------ writes

/** Items still on the device that create any of `ids`. */
function creatorsOf(ids: string[]): string[] {
  const wanted = new Set(ids);
  return outboxItems()
    .filter((item) => {
      const meta = nutritionWrites$.owns(item) ? nutritionMetaOf(item.meta) : undefined;
      return meta ? createdEntryIds(meta).some((id) => wanted.has(id)) : false;
    })
    .map((item) => item.id);
}

async function write(
  meta: NutritionWriteMeta,
  request: { method: WriteMethod; path: string; body?: unknown },
  label: string,
  dependsOn: string[] = [],
  id: string = crypto.randomUUID(),
): Promise<void> {
  // Spec 030: a second edit of a row is made on top of the first, so it never overtakes it.
  const after = [...dependsOn, ...earlierEditsOf(outboxItems(), { kind: `nutrition.${meta.op}`, meta })];
  await enqueueWrite({
    id,
    kind: `nutrition.${meta.op}`,
    ...request,
    meta,
    label,
    ...(after.length ? { dependsOn: after } : {}),
  });
}

function localEntry(food: Food, input: { day: string; slot: MealSlot; amount: number; note?: string }, id = newObjectId()): LocalEntry {
  return {
    id,
    day: input.day,
    slot: input.slot,
    foodId: food.id,
    amount: input.amount,
    unit: food.unit,
    // Provisional: the server takes its own snapshot when the meal arrives (the snapshot rule).
    facts: snapshotFacts(food),
    ...(input.note ? { note: input.note } : {}),
  };
}

/** What a write's result looks like before the server answers: the meal as this device sees it. */
const asShown = (entry: LocalEntry): MealEntry =>
  ({ ...decorateEntry({ ...entry, userId: '', createdAt: '', updatedAt: '' }), unsaved: true }) as MealEntry;

export const foodWrites = {
  /** Kept on the device and shown at once; returns the meal as shown (not yet saved). */
  async logEntry(food: Food, input: { day: string; slot: MealSlot; amount: number; note?: string }): Promise<MealEntry> {
    const entry = localEntry(food, input);
    await write(
      { op: 'entry.add', entry },
      {
        method: 'POST',
        path: '/nutrition/entries',
        body: { id: entry.id, day: entry.day, slot: entry.slot, foodId: food.id, amount: entry.amount, ...(input.note ? { note: input.note } : {}) },
      },
      `Meal · ${food.name}`,
    );
    return asShown(entry);
  },

  /** Spec 030: made against the version shown, so a change made meanwhile elsewhere is not lost. */
  updateEntry(entry: MealEntry, patch: { day?: string; slot?: MealSlot; amount?: number; note?: string }): Promise<void> {
    const baseVersion = entry.version ?? 0;
    return write(
      {
        op: 'entry.patch',
        entryId: entry.id,
        patch,
        baseVersion,
        was: {
          id: entry.id,
          day: entry.day,
          slot: entry.slot,
          foodId: entry.foodId,
          amount: entry.amount,
          unit: entry.unit,
          facts: entry.facts,
          ...(entry.note ? { note: entry.note } : {}),
        },
      },
      { method: 'PATCH', path: `/nutrition/entries/${entry.id}`, body: { ...patch, baseVersion } },
      `Correct meal · ${entry.facts.name}`,
      creatorsOf([entry.id]),
    );
  },

  /**
   * A meal never sent is simply withdrawn, with any correction to it; a saved one is deleted on
   * the server once there is a connection.
   */
  async removeEntry(entry: MealEntry): Promise<void> {
    const creators = creatorsOf([entry.id]);
    const created = outboxItems().filter((item) => creators.includes(item.id));
    if (created.length && created.every((item) => nutritionMetaOf(item.meta)?.op === 'entry.add')) {
      // Discarding the create also discards what depends on it (its corrections).
      for (const item of created) await outbox.discard(item.id);
      return;
    }
    await write(
      { op: 'entry.remove', entryId: entry.id },
      { method: 'DELETE', path: `/nutrition/entries/${entry.id}` },
      `Remove meal · ${entry.facts.name}`,
      creators,
    );
  },

  /**
   * Spec 030: a meal deleted on another device while this one corrected it, logged again as a new
   * meal (a new id) with the correction. The server snapshots the food as it is now.
   */
  logAgain(was: LocalEntry, patch: { day?: string; slot?: MealSlot; amount?: number; note?: string }): Promise<void> {
    const entry: LocalEntry = { ...was, ...patch, id: newObjectId() };
    return write(
      { op: 'entry.add', entry },
      {
        method: 'POST',
        path: '/nutrition/entries',
        body: { id: entry.id, day: entry.day, slot: entry.slot, foodId: entry.foodId, amount: entry.amount, ...(entry.note ? { note: entry.note } : {}) },
      },
      `Meal · ${entry.facts.name}`,
    );
  },

  /** One meal per component, with ids chosen here, from this device's copy of the foods. */
  async logSavedMeal(meal: SavedMeal, foods: Food[], input: { day: string; slot?: MealSlot }): Promise<void> {
    const byId = new Map(foods.map((food) => [food.id, food]));
    const slot = input.slot ?? meal.defaultSlot ?? 'uncategorized';
    const entries = meal.components.map((component) => {
      const food = byId.get(component.foodId);
      if (!food) throw new Error(`"${meal.name}" uses a food this device does not have. Log it once you are online.`);
      return localEntry(food, { day: input.day, slot, amount: component.amount });
    });
    await write(
      { op: 'meal.log', mealId: meal.id, entries },
      {
        method: 'POST',
        path: `/nutrition/meals/${meal.id}/log`,
        body: { day: input.day, ...(input.slot ? { slot: input.slot } : {}), ids: entries.map((entry) => entry.id) },
      },
      `Saved meal · ${meal.name}`,
    );
  },

  /**
   * One weigh-in per day on the server, so a replay or a second weigh-in the same day corrects it.
   * Spec 030: sent with the version of the day's weigh-in shown here (0: none), so one made on
   * another device meanwhile is never overwritten; the person chooses in the sync sheet.
   */
  putWeighIn(
    input: { day: string; weightGrams: number; bodyFatPct?: number; note?: string },
    shown?: { version?: number },
  ): Promise<void> {
    const baseVersion = shown?.version ?? 0;
    return write(
      { op: 'weighin.put', ...input, baseVersion },
      { method: 'PUT', path: '/nutrition/weigh-ins', body: { ...input, baseVersion } },
      `Weigh-in · ${input.day}`,
    );
  },

  /** A weigh-in only on this device is withdrawn; a saved one is deleted once there is a connection. */
  async removeWeighIn(weighIn: { id: string; day: string }): Promise<void> {
    const local = outboxItems().filter((item) => {
      const meta = nutritionMetaOf(item.meta);
      return nutritionWrites$.owns(item) && meta?.op === 'weighin.put' && meta.day === weighIn.day;
    });
    for (const item of local) await outbox.discard(item.id);
    if (weighIn.id.startsWith('local:')) return;
    await write(
      { op: 'weighin.remove', weighInId: weighIn.id, day: weighIn.day },
      { method: 'DELETE', path: `/nutrition/weigh-ins/${weighIn.id}` },
      `Remove weigh-in · ${weighIn.day}`,
    );
  },
};
