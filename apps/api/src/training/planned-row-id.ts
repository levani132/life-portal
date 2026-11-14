import { createHash } from 'node:crypto';

/**
 * Spec 028: the id of the workout exercise a plan start makes for one planned exercise. Derived
 * from the start's `requestId` and the plan exercise id, so a device that started the workout
 * offline (and chose that `requestId`) knows every row's id before the server has seen it.
 * `apps/web/src/lib/offline/planned-row-id.ts` computes the same value; both test one vector.
 */
export function plannedRowId(requestId: string, planExerciseId: string): string {
  return createHash('sha256').update(`lp-planned:${requestId}:${planExerciseId}`).digest('hex').slice(0, 24);
}
