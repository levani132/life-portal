import type { Measure, PlanInput, PlanTarget } from '@life-portal/shared-types';
import {
  describeTarget,
  openTargets,
  planProgress,
  prefillFor,
  recentPlanIds,
  validatePlan,
  validatePlanTarget,
} from './training-plans';

const working = (extra: Partial<PlanTarget> = {}): PlanTarget => ({ type: 'working', ...extra });

describe('validatePlanTarget', () => {
  it.each<[Measure, Partial<PlanTarget>]>([
    ['weight_reps', { reps: 8 }],
    ['weight_reps', { reps: 6, repsMax: 8, weightGrams: 60_000 }],
    ['bodyweight_reps', { reps: 10, weightGrams: 10_000 }],
    ['assisted_reps', { reps: 8, assistGrams: 20_000 }],
    ['assisted_reps', { reps: 8 }],
    ['duration', { durationSeconds: 45 }],
    ['duration', { durationSeconds: 60, weightGrams: 20_000 }],
    ['distance_duration', { distanceMeters: 1000 }],
    ['distance_duration', { durationSeconds: 600 }],
    ['distance_duration', { distanceMeters: 1000, durationSeconds: 300 }],
  ])('accepts %s %j', (measure, target) => {
    expect(validatePlanTarget(measure, working(target))).toBeNull();
  });

  it.each<[Measure, Partial<PlanTarget>, string]>([
    ['weight_reps', {}, 'Reps are required.'],
    ['bodyweight_reps', { weightGrams: 5000 }, 'Reps are required.'],
    ['assisted_reps', {}, 'Reps are required.'],
    ['duration', {}, 'Time is required.'],
    ['distance_duration', {}, 'A distance or a time is required.'],
    ['weight_reps', { reps: 8, assistGrams: 1000 }, 'Assistance does not apply to this exercise.'],
    ['duration', { durationSeconds: 30, reps: 5 }, 'Reps does not apply to this exercise.'],
    ['assisted_reps', { reps: 8, weightGrams: 1000 }, 'Weight does not apply to this exercise.'],
    ['weight_reps', { reps: 0 }, 'Reps must be between 1 and 1000.'],
    ['weight_reps', { reps: 8.5 }, 'Reps must be a whole number.'],
  ])('refuses %s %j', (measure, target, message) => {
    expect(validatePlanTarget(measure, working(target))).toBe(message);
  });

  it('checks a rep range', () => {
    expect(validatePlanTarget('weight_reps', working({ reps: 8, repsMax: 8 }))).toMatch(/above its lower end/);
    expect(validatePlanTarget('weight_reps', working({ reps: 12, repsMax: 10 }))).toMatch(/above its lower end/);
    expect(validatePlanTarget('duration', working({ durationSeconds: 30, repsMax: 10 }))).toMatch(/lower end/);
    expect(validatePlanTarget('weight_reps', working({ reps: 8, repsMax: 9.5 }))).toMatch(/whole number/);
  });

  it('accepts warm-ups and refuses other set types', () => {
    expect(validatePlanTarget('weight_reps', { type: 'warmup', reps: 10 })).toBeNull();
    expect(validatePlanTarget('weight_reps', { type: 'drop' as never, reps: 10 })).toMatch(/warm-up or a working/);
  });
});

describe('validatePlan', () => {
  const measures: Record<string, Measure> = { bench: 'weight_reps', plank: 'duration' };
  const measureOf = (id: string) => measures[id];
  const exercise = (targets = 3) => ({
    exerciseId: 'bench',
    restSeconds: 90,
    targets: Array.from({ length: targets }, () => working({ reps: 8 })),
  });
  const plan = (workouts: number, exercises = 1, targets = 3): PlanInput => ({
    name: 'Plan',
    workouts: Array.from({ length: workouts }, (_, i) => ({
      name: `W${i}`,
      exercises: Array.from({ length: exercises }, () => exercise(targets)),
    })),
  });
  const paths = (input: PlanInput) => validatePlan(input, measureOf).map((p) => p.path);

  it('allows an empty plan and empty workouts while building', () => {
    expect(paths(plan(0))).toEqual([]);
    expect(paths(plan(2, 0))).toEqual([]);
  });

  it('enforces the workout, exercise and target counts', () => {
    expect(paths(plan(14))).toEqual([]);
    expect(paths(plan(15))).toEqual(['workouts']);
    expect(paths(plan(1, 30))).toEqual([]);
    expect(paths(plan(1, 31))).toEqual(['workouts.0.exercises']);
    expect(paths(plan(1, 1, 20))).toEqual([]);
    expect(paths(plan(1, 1, 21))).toEqual(['workouts.0.exercises.0.targets']);
    expect(paths(plan(1, 1, 0))).toEqual(['workouts.0.exercises.0.targets']);
  });

  it('checks names, description, rest, note and exercise ids', () => {
    const input = plan(1);
    input.name = ' ';
    input.description = 'x'.repeat(1001);
    input.workouts[0].name = 'y'.repeat(81);
    input.workouts[0].exercises[0].restSeconds = 901;
    input.workouts[0].exercises[0].note = 'z'.repeat(201);
    input.workouts[0].exercises.push({ exerciseId: 'nope', targets: [working({ reps: 5 })] });
    expect(paths(input)).toEqual([
      'name',
      'description',
      'workouts.0.name',
      'workouts.0.exercises.0.restSeconds',
      'workouts.0.exercises.0.note',
      'workouts.0.exercises.1.exerciseId',
    ]);
    const fine = plan(1);
    fine.workouts[0].exercises[0].restSeconds = 900;
    fine.name = 'n'.repeat(80);
    expect(paths(fine)).toEqual([]);
  });

  it('checks each target against its own exercise', () => {
    const input = plan(1);
    input.workouts[0].exercises.push({ exerciseId: 'plank', targets: [working({ reps: 10 })] });
    expect(validatePlan(input, measureOf)).toEqual([
      { path: 'workouts.0.exercises.1.targets.0', message: 'Reps does not apply to this exercise.' },
    ]);
  });
});

describe('describeTarget', () => {
  it('describes each measure', () => {
    expect(describeTarget('weight_reps', working({ reps: 8, repsMax: 12 }))).toBe('8–12 reps');
    expect(describeTarget('weight_reps', working({ reps: 5, weightGrams: 60_000 }))).toBe('60 kg × 5');
    expect(describeTarget('bodyweight_reps', working({ reps: 8, weightGrams: 10_000 }))).toBe('+10 kg × 8');
    expect(describeTarget('assisted_reps', working({ reps: 6, repsMax: 8, assistGrams: 20_000 }))).toBe('−20 kg × 6–8');
    expect(describeTarget('duration', working({ durationSeconds: 45 }))).toBe('0:45');
    expect(describeTarget('distance_duration', working({ distanceMeters: 1000, durationSeconds: 300 }))).toBe('1 km in 5:00');
    expect(describeTarget('distance_duration', working({ distanceMeters: 400 }))).toBe('400 m');
    expect(describeTarget('weight_reps', { type: 'warmup', reps: 10 })).toBe('Warm-up 10 reps');
  });

  it('uses the display unit', () => {
    expect(describeTarget('weight_reps', working({ reps: 5, weightGrams: 102_058 }), 'lb')).toBe('225 lb × 5');
  });
});

describe('openTargets', () => {
  const planned = { targets: [working({ reps: 8 }), working({ reps: 8 }), working({ reps: 6 })] };

  it('uses targets up in order as sets are logged', () => {
    expect(openTargets(planned, 0)).toHaveLength(3);
    expect(openTargets(planned, 1)).toEqual([working({ reps: 8 }), working({ reps: 6 })]);
    expect(openTargets(planned, 3)).toEqual([]);
    expect(openTargets(planned, 5)).toEqual([]);
  });

  it('suggests nothing when skipped or not from a plan', () => {
    expect(openTargets(planned, 0, true)).toEqual([]);
    expect(openTargets(undefined, 0)).toEqual([]);
  });
});

describe('prefillFor', () => {
  const target = working({ reps: 8, repsMax: 12 });

  it('takes the same-position set from last time', () => {
    const previous = [{ reps: 10, weightGrams: 60_000 }, { reps: 9, weightGrams: 62_500 }];
    expect(prefillFor('weight_reps', target, previous, 1)).toEqual({
      type: 'working',
      values: { reps: 9, weightGrams: 62_500 },
      source: 'last_time',
    });
  });

  it('repeats last time’s last set when it had fewer sets', () => {
    const previous = [{ reps: 10, weightGrams: 60_000 }];
    expect(prefillFor('weight_reps', target, previous, 3).values).toEqual({ reps: 10, weightGrams: 60_000 });
  });

  it('falls back to the target: low end of a range, weight left empty', () => {
    expect(prefillFor('weight_reps', target, [], 0)).toEqual({ type: 'working', values: { reps: 8 }, source: 'plan' });
    expect(prefillFor('weight_reps', target, undefined, 0).values).toEqual({ reps: 8 });
  });

  it('uses planned weight, time and the target’s set type', () => {
    expect(prefillFor('weight_reps', { type: 'warmup', reps: 10, weightGrams: 40_000 }, [], 0)).toEqual({
      type: 'warmup',
      values: { reps: 10, weightGrams: 40_000 },
      source: 'plan',
    });
    expect(prefillFor('duration', working({ durationSeconds: 45 }), [], 0).values).toEqual({ durationSeconds: 45 });
  });

  it('keeps only fields the measure allows', () => {
    const previous = [{ reps: 10, weightGrams: 5000, assistGrams: 9000 }];
    expect(prefillFor('assisted_reps', working({ reps: 8 }), previous, 0).values).toEqual({ reps: 10, assistGrams: 9000 });
  });
});

describe('planProgress', () => {
  const ids = ['a', 'b', 'c'];
  const session = (planWorkoutId: string, day: string, startedAt = 0, planId = 'p') => ({ planId, planWorkoutId, day, startedAt });

  it('suggests the first workout when none was done', () => {
    expect(planProgress(ids, [])).toEqual({ lastDoneDay: {}, nextWorkoutId: 'a' });
    expect(planProgress([], [])).toEqual({ lastDoneDay: {} });
  });

  it('suggests the one after the most recent, by day then start time, and wraps', () => {
    expect(planProgress(ids, [session('a', '2026-11-01'), session('b', '2026-11-03')])).toEqual({
      lastDoneDay: { a: '2026-11-01', b: '2026-11-03' },
      nextWorkoutId: 'c',
    });
    expect(planProgress(ids, [session('b', '2026-11-03', 2), session('c', '2026-11-03', 1)]).nextWorkoutId).toBe('c');
    expect(planProgress(ids, [session('c', '2026-11-05')]).nextWorkoutId).toBe('a');
  });

  it('keeps the latest day for a workout done twice', () => {
    expect(planProgress(ids, [session('a', '2026-11-01'), session('a', '2026-11-08')]).lastDoneDay).toEqual({ a: '2026-11-08' });
  });

  it('passes over sessions for workouts no longer in the plan', () => {
    expect(planProgress(ids, [session('gone', '2026-11-09')])).toEqual({ lastDoneDay: {}, nextWorkoutId: 'a' });
    expect(planProgress(ids, [session('a', '2026-11-01'), session('gone', '2026-11-09')]).nextWorkoutId).toBe('b');
  });
});

describe('recentPlanIds', () => {
  const session = (planId: string, day: string, startedAt = 0) => ({ planId, planWorkoutId: 'w', day, startedAt });

  it('lists plans used in the last 28 days, newest first, once each, at most three', () => {
    const sessions = [
      session('old', '2026-10-15'),
      session('edge', '2026-10-16'),
      session('p1', '2026-11-10'),
      session('p2', '2026-11-11'),
      session('p1', '2026-11-12'),
    ];
    expect(recentPlanIds(sessions, '2026-11-12')).toEqual(['p1', 'p2', 'edge']);
    expect(recentPlanIds(sessions, '2026-11-12', 28, 2)).toEqual(['p1', 'p2']);
    expect(recentPlanIds([], '2026-11-12')).toEqual([]);
  });
});
