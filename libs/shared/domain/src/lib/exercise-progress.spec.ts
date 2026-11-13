import type { ProgressPoint, RecordEntry } from '@life-portal/shared-types';
import {
  MAX_PROGRESS_POINTS,
  loadStepGrams,
  nextRecord,
  pointsInRange,
  progressMetricsFor,
  progressPoints,
  progressTrend,
  rangeStart,
  sessionMetrics,
  thinPoints,
} from './exercise-progress';
import type { ProgressSet } from './training';

let seq = 0;
const s = (sessionId: string, day: string, values: Partial<ProgressSet> = {}): ProgressSet => ({
  id: `set-${++seq}`,
  sessionId,
  day,
  type: 'working',
  ...values,
});
const point = (day: string, value: number, metric = 'one_rep_max'): ProgressPoint => ({
  day,
  sessionId: day,
  values: { [metric]: value },
});
const record = (kind: RecordEntry['kind'], value: number): RecordEntry =>
  ({ kind, value, setId: 'x', sessionId: 'x', day: '2026-11-01' }) as RecordEntry;

describe('progressMetricsFor', () => {
  it('puts the primary metric first for every measure', () => {
    expect(progressMetricsFor('weight_reps')[0]).toBe('one_rep_max');
    expect(progressMetricsFor('bodyweight_reps')[0]).toBe('reps');
    expect(progressMetricsFor('assisted_reps')[0]).toBe('reps');
    expect(progressMetricsFor('duration')).toEqual(['duration']);
    expect(progressMetricsFor('distance_duration')).toEqual(['distance', 'pace', 'duration']);
  });
});

describe('sessionMetrics', () => {
  it('takes the best working set and ignores warm-ups', () => {
    const values = sessionMetrics('weight_reps', [
      s('a', '2026-11-01', { type: 'warmup', weightGrams: 140_000, reps: 1 }),
      s('a', '2026-11-01', { weightGrams: 100_000, reps: 5 }),
      s('a', '2026-11-01', { weightGrams: 90_000, reps: 10 }),
    ]);
    expect(values.heaviest).toBe(100_000);
    expect(values.one_rep_max).toBe(120_000); // 90 kg × 10 beats 100 kg × 5 (116.7 kg)
    expect(values.volume).toBe(1_400_000);
  });

  it('keeps the fastest pace, the lowest number', () => {
    const values = sessionMetrics('distance_duration', [
      s('a', '2026-11-01', { distanceMeters: 5000, durationSeconds: 1500 }),
      s('a', '2026-11-01', { distanceMeters: 1000, durationSeconds: 240 }),
    ]);
    expect(values.pace).toBe(240);
    expect(values.distance).toBe(5000);
    expect(values.duration).toBe(1500);
  });

  it('leaves out what cannot be known', () => {
    expect(sessionMetrics('bodyweight_reps', [s('a', '2026-11-01', { reps: 12 })])).toEqual({ reps: 12 });
  });
});

describe('progressPoints', () => {
  it('gives one point per session in done order and drops warm-up-only sessions', () => {
    const points = progressPoints('weight_reps', [
      s('a', '2026-11-01', { weightGrams: 80_000, reps: 5 }),
      s('b', '2026-11-03', { type: 'warmup', weightGrams: 40_000, reps: 10 }),
      s('c', '2026-11-05', { weightGrams: 85_000, reps: 5 }),
    ]);
    expect(points.map((p) => p.sessionId)).toEqual(['a', 'c']);
    expect(points[1].values.heaviest).toBe(85_000);
  });
});

describe('ranges', () => {
  const points = [point('2025-10-01', 1), point('2026-01-01', 2), point('2026-09-01', 3), point('2026-11-13', 4)];

  it('starts 3 months or a year back, or never', () => {
    expect(rangeStart('3m', '2026-11-13')).toBe('2026-08-13');
    expect(rangeStart('1y', '2026-11-13')).toBe('2025-11-13');
    expect(rangeStart('all', '2026-11-13')).toBeUndefined();
  });

  it('filters to the range and never past today', () => {
    expect(pointsInRange(points, '3m', '2026-11-13').map((p) => p.day)).toEqual(['2026-09-01', '2026-11-13']);
    expect(pointsInRange(points, '1y', '2026-11-13')).toHaveLength(3);
    expect(pointsInRange(points, 'all', '2026-11-12')).toHaveLength(3);
  });
});

describe('thinPoints', () => {
  it('leaves a short series alone', () => {
    const points = [point('2026-01-01', 1), point('2026-01-02', 2)];
    expect(thinPoints(points, 'one_rep_max')).toEqual(points);
  });

  it('keeps at most the cap, the first, the last and the peak, in order', () => {
    const points = Array.from({ length: 1000 }, (_, i) =>
      point(`2026-01-01#${String(i).padStart(4, '0')}`, i === 333 ? 9999 : i % 50),
    );
    const thinned = thinPoints(points, 'one_rep_max');
    expect(thinned.length).toBeLessThanOrEqual(MAX_PROGRESS_POINTS);
    expect(thinned.length).toBeGreaterThan(MAX_PROGRESS_POINTS - 5);
    expect(thinned[0]).toBe(points[0]);
    expect(thinned[thinned.length - 1]).toBe(points[999]);
    expect(thinned).toContain(points[333]);
    expect(thinned.map((p) => p.day)).toEqual([...thinned.map((p) => p.day)].sort());
  });

  it('keeps the lowest pace as the peak', () => {
    const points = Array.from({ length: 30 }, (_, i) => point(`d${String(i).padStart(2, '0')}`, i === 17 ? 200 : 300, 'pace'));
    expect(thinPoints(points, 'pace', 5)).toContain(points[17]);
  });
});

describe('progressTrend', () => {
  it('compares the best of the last 28 days with the 28 before', () => {
    const points = [point('2026-09-20', 90), point('2026-10-01', 100), point('2026-10-20', 105), point('2026-11-10', 102)];
    expect(progressTrend(points, 'one_rep_max', '2026-11-13')).toEqual({ metric: 'one_rep_max', current: 105, previous: 100 });
  });

  it('is absent unless both windows have a session', () => {
    expect(progressTrend([point('2026-11-10', 100)], 'one_rep_max', '2026-11-13')).toBeUndefined();
    expect(progressTrend([point('2026-10-01', 100)], 'one_rep_max', '2026-11-13')).toBeUndefined();
  });
});

describe('nextRecord', () => {
  it('suggests the fewest reps at the last load that would beat the best 1RM', () => {
    const sets = [s('a', '2026-11-01', { weightGrams: 100_000, reps: 5 })];
    expect(nextRecord('weight_reps', [record('best_1rm', 116_667)], sets)).toEqual({
      kind: 'best_1rm',
      current: 116_667,
      target: 120_000,
      suggestion: { loadGrams: 100_000, reps: 6 },
    });
  });

  it('goes up in plate steps when the last load would need more than 10 reps', () => {
    const sets = [s('a', '2026-11-01', { weightGrams: 100_000, reps: 5 }), s('b', '2026-11-03', { weightGrams: 80_000, reps: 10 })];
    expect(nextRecord('weight_reps', [record('best_1rm', 116_667)], sets)?.suggestion).toEqual({ loadGrams: 90_000, reps: 9 });
    expect(loadStepGrams('lb')).toBe(2268);
  });

  it('aims one more rep, five more seconds or 100 more metres otherwise', () => {
    expect(nextRecord('bodyweight_reps', [record('most_reps', 12)], [])).toEqual({ kind: 'most_reps', current: 12, target: 13 });
    expect(nextRecord('duration', [record('longest_duration', 60)], [])?.target).toBe(65);
    expect(nextRecord('distance_duration', [record('longest_distance', 5000)], [])?.target).toBe(5100);
  });

  it('has nothing to beat before a record exists', () => {
    expect(nextRecord('weight_reps', [], [])).toBeUndefined();
    expect(nextRecord('duration', [], [])).toBeUndefined();
  });
});
