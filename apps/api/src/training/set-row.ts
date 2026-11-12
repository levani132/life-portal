import type { SetType, WorkoutSet as WorkoutSetDto } from '@life-portal/shared-types';
import type { WorkoutSet } from './training.schemas';

export type SetRow = WorkoutSet & { _id: unknown };

/** A stored set as the API returns it. Shared by sessions and progress. */
export function toSet(row: SetRow): WorkoutSetDto {
  return {
    id: String(row._id),
    workoutExerciseId: row.workoutExerciseId,
    exerciseId: row.exerciseId,
    order: row.order,
    type: row.type as SetType,
    reps: row.reps,
    weightGrams: row.weightGrams,
    assistGrams: row.assistGrams,
    durationSeconds: row.durationSeconds,
    distanceMeters: row.distanceMeters,
    rpe: row.rpe,
    restSeconds: row.restSeconds,
    loggedAt: row.loggedAt.toISOString(),
  };
}
