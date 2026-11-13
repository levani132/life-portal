import type {
  Measure,
  NextRecord,
  ProgressMetric,
  ProgressPoint,
  ProgressRange,
  ProgressTrend,
  RecordEntry,
  WeightUnit,
} from '@life-portal/shared-types';
import { addDays, addMonths, addYears } from './dates';
import {
  ONE_REP_MAX_MAX_REPS,
  bestOneRepMax,
  effectiveLoadGrams,
  estimateOneRepMax,
  paceSecondsPerKm,
  sessionVolumeGrams,
  type ProgressSet,
} from './training';

/**
 * An exercise's progress for the statistics view (issue #6): one point per session, a range, a
 * 4-week trend and the next record to aim for. Pure; `today` is explicit (principle V). Every
 * figure comes from the sets on read, like records (spec 020 US3).
 */

export const MAX_PROGRESS_POINTS = 200;
export const TREND_WINDOW_DAYS = 28;

/** What can be charted per measure, the primary metric first. */
export function progressMetricsFor(measure: Measure): ProgressMetric[] {
  switch (measure) {
    case 'weight_reps':
      return ['one_rep_max', 'heaviest', 'volume'];
    case 'bodyweight_reps':
    case 'assisted_reps':
      return ['reps', 'volume'];
    case 'duration':
      return ['duration'];
    case 'distance_duration':
      return ['distance', 'pace', 'duration'];
  }
}

/** Pace is the one metric where lower is better. */
export const lowerIsBetter = (metric: ProgressMetric) => metric === 'pace';

function best(values: (number | undefined)[], metric: ProgressMetric): number | undefined {
  const known = values.filter((value): value is number => value !== undefined && value > 0);
  if (!known.length) return undefined;
  return lowerIsBetter(metric) ? Math.min(...known) : Math.max(...known);
}

/** One session's value for each metric, over its working sets. */
export function sessionMetrics(measure: Measure, sets: readonly ProgressSet[]): Partial<Record<ProgressMetric, number>> {
  const working = sets.filter((set) => set.type !== 'warmup');
  const values: Partial<Record<ProgressMetric, number>> = {};
  for (const metric of progressMetricsFor(measure)) {
    let value: number | undefined;
    switch (metric) {
      case 'one_rep_max':
        value = bestOneRepMax(measure, working)?.valueGrams;
        break;
      case 'heaviest':
        value = best(working.map((set) => effectiveLoadGrams(measure, set, set.body)?.grams), metric);
        break;
      case 'reps':
        value = best(working.map((set) => set.reps), metric);
        break;
      case 'duration':
        value = best(working.map((set) => set.durationSeconds), metric);
        break;
      case 'distance':
        value = best(working.map((set) => set.distanceMeters), metric);
        break;
      case 'pace':
        value = best(working.map((set) => paceSecondsPerKm(set)), metric);
        break;
      case 'volume':
        value = sessionVolumeGrams(measure, working);
        break;
    }
    if (value !== undefined && value > 0) values[metric] = value;
  }
  return values;
}

/** One point per session, oldest first, given sets in done order. Sessions of only warm-ups drop out. */
export function progressPoints(measure: Measure, sets: readonly ProgressSet[]): ProgressPoint[] {
  const groups = new Map<string, { day: string; sets: ProgressSet[] }>();
  for (const set of sets) {
    const group = groups.get(set.sessionId) ?? { day: set.day, sets: [] };
    group.sets.push(set);
    groups.set(set.sessionId, group);
  }
  return [...groups.entries()].flatMap(([sessionId, group]) => {
    const values = sessionMetrics(measure, group.sets);
    return Object.keys(values).length ? [{ day: group.day, sessionId, values }] : [];
  });
}

/** The first day a range includes, or undefined for all time. */
export function rangeStart(range: ProgressRange, today: string): string | undefined {
  if (range === '3m') return addMonths(today, -3);
  if (range === '1y') return addYears(today, -1);
  return undefined;
}

export function pointsInRange(points: readonly ProgressPoint[], range: ProgressRange, today: string): ProgressPoint[] {
  const from = rangeStart(range, today);
  return points.filter((point) => point.day <= today && (!from || point.day >= from));
}

/**
 * At most `max` points: evenly spaced, always keeping the first, the last and the session holding
 * the best of `metric`, so thinning never hides the peak or where you are now.
 */
export function thinPoints(points: readonly ProgressPoint[], metric: ProgressMetric, max = MAX_PROGRESS_POINTS): ProgressPoint[] {
  if (points.length <= max) return [...points];
  const keep = new Set<number>([0, points.length - 1]);
  let peak: number | undefined;
  points.forEach((point, index) => {
    const value = point.values[metric];
    if (value === undefined) return;
    const top = peak === undefined ? undefined : points[peak].values[metric];
    if (top === undefined || (lowerIsBetter(metric) ? value < top : value > top)) peak = index;
  });
  if (peak !== undefined) keep.add(peak);
  const slots = max - keep.size;
  for (let i = 0; keep.size < max && i <= slots; i += 1) {
    keep.add(Math.round((i * (points.length - 1)) / Math.max(1, slots)));
  }
  return [...keep].sort((a, b) => a - b).slice(0, max).map((index) => points[index]);
}

/** The best of `metric` in the last 28 days against the 28 before, when both have one. */
export function progressTrend(points: readonly ProgressPoint[], metric: ProgressMetric, today: string): ProgressTrend | undefined {
  const recentFrom = addDays(today, -(TREND_WINDOW_DAYS - 1));
  const previousFrom = addDays(today, -(2 * TREND_WINDOW_DAYS - 1));
  const current = best(points.filter((p) => p.day >= recentFrom && p.day <= today).map((p) => p.values[metric]), metric);
  const previous = best(points.filter((p) => p.day >= previousFrom && p.day < recentFrom).map((p) => p.values[metric]), metric);
  return current !== undefined && previous !== undefined ? { metric, current, previous } : undefined;
}

/** A plate step for suggestions: 2.5 kg, or 5 lb in grams. */
export function loadStepGrams(unit: WeightUnit): number {
  return unit === 'lb' ? 2268 : 2500;
}

/**
 * The next record to aim for. For a weighted lift: beat the best estimated 1RM, with one set
 * that would do it at the load last used (heavier in plate steps if that would take more than
 * 10 reps). Otherwise one more rep, 5 more seconds or 100 more metres than the best.
 */
export function nextRecord(
  measure: Measure,
  records: readonly RecordEntry[],
  sets: readonly ProgressSet[],
  unit: WeightUnit = 'kg',
): NextRecord | undefined {
  const find = (kind: RecordEntry['kind']) => records.find((record) => record.kind === kind);
  if (measure === 'weight_reps') {
    const record = find('best_1rm');
    if (!record) return undefined;
    const lastSession = [...sets].reverse().find((set) => set.type !== 'warmup' && set.weightGrams)?.sessionId;
    const lastLoad = Math.max(
      0,
      ...sets.filter((set) => set.sessionId === lastSession && set.type !== 'warmup').map((set) => set.weightGrams ?? 0),
    );
    let load = lastLoad;
    for (let guard = 0; load > 0 && guard < 200; guard += 1, load += loadStepGrams(unit)) {
      for (let reps = 1; reps <= Math.min(10, ONE_REP_MAX_MAX_REPS); reps += 1) {
        const estimate = estimateOneRepMax(load, reps);
        if (estimate !== undefined && estimate > record.value) {
          return { kind: 'best_1rm', current: record.value, target: estimate, suggestion: { loadGrams: load, reps } };
        }
      }
    }
    return { kind: 'best_1rm', current: record.value, target: record.value + 1 };
  }
  if (measure === 'bodyweight_reps' || measure === 'assisted_reps') {
    const record = find('most_reps');
    return record && { kind: 'most_reps', current: record.value, target: record.value + 1 };
  }
  if (measure === 'duration') {
    const record = find('longest_duration');
    return record && { kind: 'longest_duration', current: record.value, target: record.value + 5 };
  }
  const record = find('longest_distance');
  return record && { kind: 'longest_distance', current: record.value, target: record.value + 100 };
}
