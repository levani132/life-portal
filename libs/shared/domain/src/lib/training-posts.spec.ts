import type { TrainingPublication } from '@life-portal/shared-types';
import {
  canCopyTrainingPost,
  canonicalTrainingPublication,
  copiedTargets,
  copyNeedsPlanChoice,
  publishedPlanWorkouts,
  validTrainingSelection,
} from './training-posts';

const ID = 'a'.repeat(24);
const bench = { key: '0', name: 'Bench press', primaryMuscles: ['chest' as const], equipmentType: 'barbell' as const, measure: 'weight_reps' as const, exerciseId: ID };
const plank = { key: '1', name: 'Plank', primaryMuscles: ['abdominals' as const], equipmentType: 'bodyweight' as const, measure: 'duration' as const, exerciseId: 'b'.repeat(24) };

const workout = (extra: Partial<NonNullable<TrainingPublication['workout']>> = {}): TrainingPublication => ({
  kind: 'workout',
  label: 'Push day',
  exercises: [bench, plank],
  workout: {
    name: 'Push day',
    day: '2026-11-16',
    durationSeconds: 3600,
    exercises: [
      { key: '0', setTypes: ['warmup', 'working', 'working'], restSeconds: 120 },
      { key: '1', setTypes: ['working'] },
    ],
    ...extra,
  },
});

describe('validTrainingSelection', () => {
  it('accepts each kind with well-formed ids, and nothing else', () => {
    expect(validTrainingSelection({ kind: 'workout', sessionId: ID })).toBe(true);
    expect(validTrainingSelection({ kind: 'plan', planId: ID })).toBe(true);
    expect(validTrainingSelection({ kind: 'plan', planId: ID, workoutIds: ['w1', 'w2'] })).toBe(true);
    expect(validTrainingSelection({ kind: 'exercise', exerciseId: ID })).toBe(true);
    expect(validTrainingSelection({ kind: 'workout', sessionId: 'nope' })).toBe(false);
    expect(validTrainingSelection({ kind: 'plan', planId: ID, workoutIds: [] })).toBe(false);
    expect(validTrainingSelection({ kind: 'plan', planId: ID, workoutIds: ['w1', 'w1'] })).toBe(false);
    expect(validTrainingSelection({ kind: 'meal' } as never)).toBe(false);
    expect(validTrainingSelection(undefined)).toBe(false);
  });
});

describe('canonicalTrainingPublication', () => {
  it('is stable, and changes with anything a viewer would see', () => {
    const base = canonicalTrainingPublication(workout());
    expect(canonicalTrainingPublication(workout())).toBe(base);
    expect(canonicalTrainingPublication(workout({ durationSeconds: 3601 }))).not.toBe(base);
    expect(canonicalTrainingPublication(workout({ records: [{ key: '0', kind: 'heaviest', value: 100_000 }] }))).not.toBe(base);
    const withSets = workout();
    withSets.workout!.exercises[1].logged = [{ type: 'working', durationSeconds: 90 }];
    expect(canonicalTrainingPublication(withSets)).not.toBe(base);
    const withPhoto = workout();
    withPhoto.exercises[0] = { ...bench, image: { key: 'k1', width: 1, height: 1 } };
    expect(canonicalTrainingPublication(withPhoto)).not.toBe(base);
  });
});

describe('copying a published workout', () => {
  it('keeps the number and type of sets, never a weight, and fills hidden reps with a placeholder', () => {
    expect(copiedTargets('weight_reps', ['warmup', 'working'])).toEqual([
      { type: 'warmup', reps: 10 },
      { type: 'working', reps: 10 },
    ]);
    expect(copiedTargets('duration', ['working'])).toEqual([{ type: 'working', durationSeconds: 60 }]);
    expect(copiedTargets('distance_duration', ['working'])).toEqual([{ type: 'working', distanceMeters: 1000 }]);
  });

  it('uses the shared reps and time when the sets were shared, and still drops the weight', () => {
    expect(copiedTargets('weight_reps', ['working'], [{ type: 'working', reps: 5, weightGrams: 100_000 }])).toEqual([{ type: 'working', reps: 5 }]);
    expect(copiedTargets('duration', ['working'], [{ type: 'working', durationSeconds: 95 }])).toEqual([{ type: 'working', durationSeconds: 95 }]);
  });

  it('becomes one plan workout with the copier\'s exercise ids', () => {
    const [day] = publishedPlanWorkouts(workout(), (key) => `mine-${key}`);
    expect(day.name).toBe('Push day');
    expect(day.exercises.map((row) => row.exerciseId)).toEqual(['mine-0', 'mine-1']);
    expect(day.exercises[0]).toMatchObject({ restSeconds: 120, targets: [{ type: 'warmup', reps: 10 }, { type: 'working', reps: 10 }, { type: 'working', reps: 10 }] });
    expect(JSON.stringify(day)).not.toMatch(/weightGrams/);
  });
});

describe('copying a published plan', () => {
  const plan: TrainingPublication = {
    kind: 'plan',
    label: 'PPL',
    exercises: [bench, plank],
    plan: {
      name: 'PPL',
      includedWorkouts: 2,
      totalWorkouts: 5,
      workouts: [
        { name: 'Push', exercises: [{ key: '0', superset: 'a', targets: [{ type: 'working', reps: 8, repsMax: 12, weightGrams: 60_000 }] }, { key: '1', superset: 'a', note: 'slow', targets: [{ type: 'working', durationSeconds: 60 }] }] },
        { name: 'Core', exercises: [{ key: '1', superset: 'lonely', targets: [{ type: 'working', durationSeconds: 45 }] }] },
      ],
    },
  };

  it('copies the included workouts with the plan\'s own targets, in order', () => {
    const days = publishedPlanWorkouts(plan, (key) => `mine-${key}`);
    expect(days.map((day) => day.name)).toEqual(['Push', 'Core']);
    expect(days[0].exercises[0]).toEqual({ exerciseId: 'mine-0', superset: 'a', targets: [{ type: 'working', reps: 8, repsMax: 12, weightGrams: 60_000 }] });
    expect(days[0].exercises[1].note).toBe('slow');
    // A superset key with no partner is dropped.
    expect(days[1].exercises[0].superset).toBeUndefined();
  });

  it('asks for a plan only when it is a single workout', () => {
    expect(copyNeedsPlanChoice(plan)).toBe(false);
    expect(copyNeedsPlanChoice({ ...plan, plan: { ...plan.plan!, workouts: [plan.plan!.workouts[0]] } })).toBe(true);
    expect(copyNeedsPlanChoice(workout())).toBe(true);
    expect(copyNeedsPlanChoice({ kind: 'exercise', label: 'Plank', exercises: [plank], exercise: { key: '1' } })).toBe(false);
  });
});

describe('canCopyTrainingPost', () => {
  it('needs a training attachment, someone else\'s post, the permission and Training', () => {
    const yes = { own: false, allowCopy: true, viewerHasTraining: true, hasTraining: true };
    expect(canCopyTrainingPost(yes)).toBe(true);
    for (const key of ['own', 'allowCopy', 'viewerHasTraining', 'hasTraining'] as const) {
      expect(canCopyTrainingPost({ ...yes, [key]: !yes[key] })).toBe(false);
    }
  });
});
