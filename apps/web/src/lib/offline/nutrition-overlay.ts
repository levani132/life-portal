import { decorateEntry, dayTotals } from '@life-portal/shared-domain';
import type { MealEntry, MealSlot, NutritionOverview, WeighIn } from '@life-portal/shared-types';

/**
 * Offline food (spec 029, issue #18): the day as the person sees it is the last overview the
 * server sent (kept on the device) with the meals and weigh-ins still waiting in the outbox
 * applied on top. Pure: the same outbox and copy always give the same day, so a reload shows
 * exactly what was there before it.
 *
 * Totals are recomputed with the same domain functions the server uses (`decorateEntry`,
 * `dayTotals`), so they match after sync — except when the food was corrected meanwhile, because
 * the server snapshots the food as it is when the meal arrives (the snapshot rule). A meal not yet
 * saved is marked `unsaved` and never presented as saved.
 */

/** A meal row as built on the device: no `userId`, no derived fields. */
export type LocalEntry = Omit<MealEntry, 'totals' | 'servings' | 'userId' | 'createdAt' | 'updatedAt'>;

export type NutritionWriteMeta =
  | { op: 'entry.add'; entry: LocalEntry }
  | { op: 'meal.log'; mealId: string; entries: LocalEntry[] }
  | {
      op: 'entry.patch';
      entryId: string;
      patch: { day?: string; slot?: MealSlot; amount?: number; note?: string };
      /** Spec 030: the version the correction was made against. */
      baseVersion?: number;
      /** Spec 030: the meal as it was, to log it again if another device deleted it. */
      was?: LocalEntry;
    }
  | { op: 'entry.remove'; entryId: string }
  | {
      op: 'weighin.put';
      day: string;
      weightGrams: number;
      bodyFatPct?: number;
      note?: string;
      /** Spec 030: the day's weigh-in version this device saw (0: none). */
      baseVersion?: number;
    }
  | { op: 'weighin.remove'; weighInId: string; day: string };

/** A meal on screen. `unsaved` while it (or a change to it) has not reached the server. */
export type ShownEntry = MealEntry & { unsaved?: boolean };

export interface OverlayWrite {
  meta: NutritionWriteMeta;
  /** Acknowledged by the server, waiting only for the refetch. */
  settled?: boolean;
}

export function nutritionMetaOf(meta: unknown): NutritionWriteMeta | undefined {
  const value = meta as Partial<NutritionWriteMeta> | undefined;
  return value && typeof value === 'object' && typeof value.op === 'string' ? (value as NutritionWriteMeta) : undefined;
}

/** The entry ids a write creates, so later writes about them can wait for it (`dependsOn`). */
export function createdEntryIds(meta: NutritionWriteMeta): string[] {
  if (meta.op === 'entry.add') return [meta.entry.id];
  if (meta.op === 'meal.log') return meta.entries.map((entry) => entry.id);
  return [];
}

function shown(entry: LocalEntry | MealEntry, unsaved: boolean): ShownEntry {
  const row = decorateEntry({ userId: '', createdAt: '', updatedAt: '', ...entry } as Omit<MealEntry, 'totals' | 'servings'>);
  return unsaved ? { ...row, unsaved: true } : row;
}

/**
 * Every meal the writes know of, by id: the server's rows for the viewed day, plus rows created
 * or moved by the writes (which may belong to any day).
 */
function applyEntries(base: MealEntry[], writes: readonly OverlayWrite[]): ShownEntry[] {
  const rows = new Map<string, ShownEntry>(base.map((entry) => [entry.id, entry]));
  for (const { meta, settled } of writes) {
    const unsaved = !settled;
    switch (meta.op) {
      case 'entry.add':
        if (!rows.has(meta.entry.id)) rows.set(meta.entry.id, shown(meta.entry, unsaved));
        break;
      case 'meal.log':
        for (const entry of meta.entries) if (!rows.has(entry.id)) rows.set(entry.id, shown(entry, unsaved));
        break;
      case 'entry.patch': {
        const current = rows.get(meta.entryId);
        if (!current) break;
        const next = { ...current };
        if (meta.patch.day) next.day = meta.patch.day;
        if (meta.patch.slot) next.slot = meta.patch.slot;
        if (meta.patch.amount != null) next.amount = meta.patch.amount;
        if (meta.patch.note != null) next.note = meta.patch.note;
        if (meta.baseVersion !== undefined) next.version = Math.max(current.version ?? 0, meta.baseVersion + 1);
        // The snapshot is never refreshed by a correction, here or on the server.
        rows.set(meta.entryId, shown(next, unsaved || Boolean(current.unsaved)));
        break;
      }
      case 'entry.remove':
        rows.delete(meta.entryId);
        break;
      default:
        break;
    }
  }
  return [...rows.values()];
}

function applyWeighIns(base: WeighIn[], writes: readonly OverlayWrite[]): WeighIn[] {
  const byDay = new Map(base.map((row) => [row.day, row]));
  for (const { meta } of writes) {
    if (meta.op === 'weighin.put') {
      const existing = byDay.get(meta.day);
      byDay.set(meta.day, {
        ...(existing ?? { id: `local:${meta.day}`, userId: '', createdAt: '', updatedAt: '' }),
        day: meta.day,
        weightGrams: meta.weightGrams,
        ...(meta.bodyFatPct != null ? { bodyFatPct: meta.bodyFatPct } : {}),
        ...(meta.note != null ? { note: meta.note } : {}),
        ...(meta.baseVersion !== undefined ? { version: Math.max(existing?.version ?? 0, meta.baseVersion + 1) } : {}),
      } as WeighIn);
      if (meta.bodyFatPct == null) delete (byDay.get(meta.day) as Partial<WeighIn>).bodyFatPct;
    }
    if (meta.op === 'weighin.remove') byDay.delete(meta.day);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * The overview with the writes applied. The day's slots and totals are recomputed; the week's
 * figure for that day moves by the same amount. Other derived figures (banked calories, the
 * cheat-day countdown, suggestions) stay the server's until it answers.
 */
export function overlayOverview(base: NutritionOverview, writes: readonly OverlayWrite[]): NutritionOverview {
  if (!writes.length) return base;
  const baseEntries = base.dayTotals.slots.flatMap((slot) => slot.entries);
  const entries = applyEntries(baseEntries, writes).filter((entry) => entry.day === base.day);
  const totals = dayTotals(base.day, entries);
  const delta = totals.totals.energyKcal - base.dayTotals.totals.energyKcal;
  const days = base.week.days.map((day) =>
    day.day === base.day ? { ...day, eatenKcal: day.eatenKcal + delta, logged: totals.entryCount > 0 } : day,
  );
  const eatenKcal = base.week.eatenKcal + (days.some((day) => day.day === base.day) ? delta : 0);
  return {
    ...base,
    dayTotals: totals,
    week: {
      ...base.week,
      days,
      eatenKcal,
      daysLogged: days.filter((day) => day.logged).length,
      ...(base.week.targetKcal != null ? { differenceKcal: eatenKcal - base.week.targetKcal } : {}),
    },
    weighIns: applyWeighIns(base.weighIns, writes),
  };
}

/** How many meals on the day are not saved yet: the UI says the totals include them. */
export function unsavedCount(overview: NutritionOverview): number {
  return overview.dayTotals.slots.reduce(
    (sum, slot) => sum + slot.entries.filter((entry) => (entry as ShownEntry).unsaved).length,
    0,
  );
}

/**
 * An overview for a day this device has never loaded, built from the latest one it has: the
 * person's foods, meals, targets and weigh-ins, with an empty day. Only used with no connection.
 */
export function emptyDayFrom(latest: NutritionOverview, day: string): NutritionOverview {
  return {
    ...latest,
    day,
    dayTotals: dayTotals(day, []),
    recentMeals: latest.recentMeals,
  };
}

/** The device copy keeps at most this many foods, most recently used first (owner's cap, #18). */
export const MAX_CACHED_FOODS = 2000;

/** Trims the foods kept with an overview: the most recently used, then the most used. */
export function capFoods(overview: NutritionOverview): NutritionOverview {
  if (overview.foods.length <= MAX_CACHED_FOODS) return overview;
  const foods = [...overview.foods]
    .sort((a, b) =>
      (b.lastUsedDay ?? '') !== (a.lastUsedDay ?? '')
        ? (b.lastUsedDay ?? '') > (a.lastUsedDay ?? '')
          ? 1
          : -1
        : b.useCount - a.useCount,
    )
    .slice(0, MAX_CACHED_FOODS);
  return { ...overview, foods };
}
