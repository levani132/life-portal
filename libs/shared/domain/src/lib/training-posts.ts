import {
  PLAN_LIMITS,
  TRAINING_POST_KINDS,
  type Measure,
  type PlanExerciseInput,
  type PlanTarget,
  type PlanWorkoutInput,
  type PublishedSet,
  type SetType,
  type TrainingPostSelection,
  type TrainingPublication,
} from '@life-portal/shared-types';
import { setFieldsFor } from './training';

/**
 * Training sharing (spec 036): the pure parts. What a selection may ask for, the fixed form a
 * publication is hashed in (the preview-then-publish check), and how a published workout or plan
 * becomes plan input for the person copying it.
 */

const ID = /^[a-f0-9]{24}$/i;

/** A selection the API will act on. Ids are only shape-checked here; ownership is the API's. */
export function validTrainingSelection(selection: TrainingPostSelection | undefined | null): boolean {
  if (!selection || !(TRAINING_POST_KINDS as readonly string[]).includes(selection.kind)) return false;
  switch (selection.kind) {
    case 'workout':
      return ID.test(selection.sessionId);
    case 'plan': {
      if (!ID.test(selection.planId)) return false;
      const ids = selection.workoutIds;
      if (ids === undefined) return true;
      return (
        Array.isArray(ids) &&
        ids.length >= 1 &&
        ids.length <= PLAN_LIMITS.workouts &&
        new Set(ids).size === ids.length &&
        ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)
      );
    }
    case 'exercise':
      return ID.test(selection.exerciseId);
  }
}

const values = (set: PlanTarget | PublishedSet) => [
  set.type,
  set.reps ?? null,
  'repsMax' in set ? (set.repsMax ?? null) : null,
  set.weightGrams ?? null,
  set.assistGrams ?? null,
  set.durationSeconds ?? null,
  set.distanceMeters ?? null,
];

/**
 * Fixed-order form of a publication, for the server-side hash. Everything a viewer would see is
 * in it, so any change between preview and publish changes the hash. An exercise's photo counts
 * by the key it had when read (the author's own copy), which changes when the photo does.
 */
export function canonicalTrainingPublication(publication: TrainingPublication): string {
  return JSON.stringify([
    publication.kind,
    publication.label,
    publication.exercises.map((exercise) => [
      exercise.key,
      exercise.name,
      exercise.primaryMuscles,
      exercise.equipmentType,
      exercise.measure,
      exercise.exerciseId ?? null,
      exercise.own ? [exercise.sourceId ?? null, exercise.secondaryMuscles ?? [], exercise.instructions ?? []] : null,
      exercise.image ? [exercise.image.key, exercise.image.width, exercise.image.height] : null,
    ]),
    publication.workout
      ? [
          publication.workout.name,
          publication.workout.day,
          publication.workout.durationSeconds,
          publication.workout.exercises.map((row) => [
            row.key,
            row.setTypes,
            row.restSeconds ?? null,
            row.superset ?? null,
            row.logged ? row.logged.map(values) : null,
          ]),
          publication.workout.records
            ? publication.workout.records.map((record) => [record.key, record.kind, record.value, record.loadGrams ?? null])
            : null,
        ]
      : null,
    publication.plan
      ? [
          publication.plan.name,
          publication.plan.description ?? null,
          publication.plan.includedWorkouts,
          publication.plan.totalWorkouts,
          publication.plan.workouts.map((workout) => [
            workout.name,
            workout.exercises.map((row) => [row.key, row.restSeconds ?? null, row.note ?? null, row.superset ?? null, row.targets.map(values)]),
          ]),
        ]
      : null,
    publication.exercise ? publication.exercise.key : null,
  ]);
}

/**
 * What a plan needs where the author's numbers were not shared. A planned set must say how many
 * reps (or how long, or how far), so a copied workout whose reps were hidden gets these; the
 * person copying edits them. They are placeholders, not the author's figures.
 */
export const COPY_PLACEHOLDER = { reps: 10, durationSeconds: 60, distanceMeters: 1000 } as const;

/**
 * Planned sets for a copied workout exercise: one per logged set, warm-ups kept as warm-ups.
 * With the sets shared, each takes its reps, time or distance; never a weight, shared or not.
 */
export function copiedTargets(measure: Measure, setTypes: readonly SetType[], logged?: readonly PublishedSet[]): PlanTarget[] {
  const allowed = setFieldsFor(measure).allowed;
  return setTypes.slice(0, PLAN_LIMITS.targetsMax).map((type, index) => {
    const target: PlanTarget = { type: type === 'warmup' ? 'warmup' : 'working' };
    const set = logged?.[index];
    for (const field of ['reps', 'durationSeconds', 'distanceMeters'] as const) {
      if (allowed.includes(field) && set?.[field] != null) target[field] = set[field];
    }
    if (allowed.includes('reps')) target.reps ??= COPY_PLACEHOLDER.reps;
    else if (target.durationSeconds == null && target.distanceMeters == null) {
      if (allowed.includes('durationSeconds') && !allowed.includes('distanceMeters')) target.durationSeconds = COPY_PLACEHOLDER.durationSeconds;
      else target.distanceMeters = COPY_PLACEHOLDER.distanceMeters;
    }
    return target;
  });
}

/** A superset key is kept only where a neighbour still shares it. */
function paired<T extends { superset?: string }>(rows: readonly T[], index: number): string | undefined {
  const key = rows[index].superset;
  return key !== undefined && (rows[index - 1]?.superset === key || rows[index + 1]?.superset === key) ? key : undefined;
}

/**
 * The plan workouts a publication copies into, given the copier's exercise id for each published
 * exercise `key`. A workout post gives one workout; a plan post gives the included ones, in
 * order; an exercise post gives none.
 */
export function publishedPlanWorkouts(publication: TrainingPublication, exerciseIdOf: (key: string) => string): PlanWorkoutInput[] {
  const measureOf = new Map(publication.exercises.map((exercise) => [exercise.key, exercise.measure]));
  if (publication.workout) {
    const rows = publication.workout.exercises.filter((row) => row.setTypes.length);
    const exercises: PlanExerciseInput[] = rows.map((row, index) => {
      const superset = paired(rows, index);
      return {
        exerciseId: exerciseIdOf(row.key),
        ...(row.restSeconds != null ? { restSeconds: row.restSeconds } : {}),
        ...(superset ? { superset } : {}),
        targets: copiedTargets(measureOf.get(row.key) as Measure, row.setTypes, row.logged),
      };
    });
    return [{ name: publication.workout.name, exercises }];
  }
  if (publication.plan) {
    return publication.plan.workouts.map((workout) => ({
      name: workout.name,
      exercises: workout.exercises.map((row, index) => {
        const superset = paired(workout.exercises, index);
        return {
          exerciseId: exerciseIdOf(row.key),
          ...(row.restSeconds != null ? { restSeconds: row.restSeconds } : {}),
          ...(row.note ? { note: row.note } : {}),
          ...(superset ? { superset } : {}),
          // A plan's weights are the author's to share: they wrote them into the plan they published.
          targets: row.targets.map((target) => ({ ...target })),
        };
      }),
    }));
  }
  return [];
}

/** A single workout (a workout post, or a plan post holding one) goes into a plan the copier picks. */
export function copyNeedsPlanChoice(publication: TrainingPublication): boolean {
  return !!publication.workout || publication.plan?.workouts.length === 1;
}

/** May this viewer copy? Their own post never offers it: it is already theirs. */
export function canCopyTrainingPost(input: { own: boolean; allowCopy: boolean; viewerHasTraining: boolean; hasTraining: boolean }): boolean {
  return input.hasTraining && !input.own && input.allowCopy && input.viewerHasTraining;
}
