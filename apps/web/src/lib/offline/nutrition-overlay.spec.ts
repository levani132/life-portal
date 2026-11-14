import { dayTotals, decorateEntry } from '@life-portal/shared-domain';
import type { FoodWithUsage, MealEntry, NutritionOverview } from '@life-portal/shared-types';
import {
  MAX_CACHED_FOODS,
  capFoods,
  createdEntryIds,
  emptyDayFrom,
  overlayOverview,
  unsavedCount,
  type LocalEntry,
  type OverlayWrite,
  type ShownEntry,
} from './nutrition-overlay';

const DAY = '2026-11-14';
const facts = { name: 'Matsoni', servingSize: 200, energyKcalPer100: 60, proteinMgPer100: 3_000, fatMgPer100: 3_200, carbMgPer100: 4_000 };
const local = (id: string, amount: number, day = DAY): LocalEntry => ({ id, day, slot: 'breakfast', foodId: 'f1', amount, unit: 'g', facts });
const saved = (id: string, amount: number): MealEntry =>
  decorateEntry({ ...local(id, amount), userId: 'u', createdAt: '', updatedAt: '' });

function overview(entries: MealEntry[] = []): NutritionOverview {
  const totals = dayTotals(DAY, entries);
  return {
    today: DAY,
    day: DAY,
    dayTotals: totals,
    week: {
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      eatenKcal: 1000 + totals.totals.energyKcal,
      targetKcal: 14000,
      differenceKcal: 1000 + totals.totals.energyKcal - 14000,
      daysLogged: 1 + (entries.length ? 1 : 0),
      bankedKcal: 0,
      days: [
        { day: '2026-11-13', eatenKcal: 1000, logged: true, isToday: false },
        { day: DAY, eatenKcal: totals.totals.energyKcal, logged: entries.length > 0, isToday: true },
      ],
    },
    weighIns: [{ id: 'w1', userId: 'u', day: '2026-11-10', weightGrams: 80_000, createdAt: '', updatedAt: '' }],
    foods: [],
  } as unknown as NutritionOverview;
}

const add = (id: string, amount: number, settled = false): OverlayWrite => ({ meta: { op: 'entry.add', entry: local(id, amount) }, settled });

describe('Food day offline (spec 029)', () => {
  it('adds a meal logged offline to the day, its totals and the week, marked not saved', () => {
    const day = overlayOverview(overview(), [add('e1', 150)]);
    const [entry] = day.dayTotals.slots.find((slot) => slot.slot === 'breakfast')?.entries as ShownEntry[];
    expect(entry.id).toBe('e1');
    expect(entry.unsaved).toBe(true);
    expect(day.dayTotals.totals.energyKcal).toBe(90);
    expect(day.week.days[1]).toMatchObject({ eatenKcal: 90, logged: true });
    expect(day.week.eatenKcal).toBe(1090);
    expect(day.week.differenceKcal).toBe(1090 - 14000);
    expect(unsavedCount(day)).toBe(1);
  });

  it('is idempotent: an acknowledged meal already in the refetched copy is not counted twice', () => {
    const fresh = overview([saved('e1', 150)]);
    const day = overlayOverview(fresh, [add('e1', 150, true)]);
    expect(day.dayTotals.entryCount).toBe(1);
    expect(day.dayTotals.totals.energyKcal).toBe(90);
    expect(unsavedCount(day)).toBe(0);
  });

  it('corrects, moves and removes meals, saved or not, without refreshing the snapshot', () => {
    const base = overview([saved('s1', 100)]);
    const day = overlayOverview(base, [
      add('e1', 150),
      { meta: { op: 'entry.patch', entryId: 's1', patch: { amount: 300 } } },
      { meta: { op: 'entry.patch', entryId: 'e1', patch: { day: '2026-11-13' } } },
    ]);
    const entries = day.dayTotals.slots.flatMap((slot) => slot.entries) as ShownEntry[];
    expect(entries.map((entry) => entry.id)).toEqual(['s1']);
    expect(entries[0]).toMatchObject({ amount: 300, unsaved: true, facts: { energyKcalPer100: 60 } });
    expect(day.dayTotals.totals.energyKcal).toBe(180);
    const removed = overlayOverview(base, [{ meta: { op: 'entry.remove', entryId: 's1' } }]);
    expect(removed.dayTotals.entryCount).toBe(0);
    expect(removed.week.days[1]).toMatchObject({ eatenKcal: 0, logged: false });
  });

  it('logs a saved meal as one row per component, each with its own id', () => {
    const meta = { op: 'meal.log' as const, mealId: 'm1', entries: [local('a', 100), local('b', 50)] };
    expect(createdEntryIds(meta)).toEqual(['a', 'b']);
    const day = overlayOverview(overview(), [{ meta }]);
    expect(day.dayTotals.entryCount).toBe(2);
    expect(day.dayTotals.totals.energyKcal).toBe(90);
  });

  it('weighs in for a day once: a second weigh-in corrects it, removing takes it away', () => {
    const day = overlayOverview(overview(), [
      { meta: { op: 'weighin.put', day: DAY, weightGrams: 81_000, bodyFatPct: 0.2 } },
      { meta: { op: 'weighin.put', day: DAY, weightGrams: 80_500 } },
    ]);
    expect(day.weighIns.map((row) => [row.day, row.weightGrams, row.bodyFatPct])).toEqual([
      ['2026-11-10', 80_000, undefined],
      [DAY, 80_500, undefined],
    ]);
    const removed = overlayOverview(overview(), [{ meta: { op: 'weighin.remove', weighInId: 'w1', day: '2026-11-10' } }]);
    expect(removed.weighIns).toEqual([]);
  });

  it('builds a day never opened on this device from the latest copy, with nothing eaten', () => {
    const latest = overview([saved('s1', 100)]);
    const next = emptyDayFrom(latest, '2026-11-15');
    expect(next.day).toBe('2026-11-15');
    expect(next.dayTotals).toMatchObject({ day: '2026-11-15', entryCount: 0 });
    expect(next.weighIns).toBe(latest.weighIns);
  });

  it('keeps at most 2,000 foods on the device, most recently used first', () => {
    const foods = Array.from({ length: MAX_CACHED_FOODS + 5 }, (_, i) => ({
      id: `f${i}`,
      useCount: i,
      ...(i < 10 ? { lastUsedDay: `2026-11-${String(i + 1).padStart(2, '0')}` } : {}),
    })) as unknown as FoodWithUsage[];
    const kept = capFoods({ ...overview(), foods }).foods;
    expect(kept).toHaveLength(MAX_CACHED_FOODS);
    expect(kept[0].id).toBe('f9');
    expect(kept.slice(0, 10).every((food) => food.lastUsedDay)).toBe(true);
  });
});
