import {
  PLAN_LIMITS,
  type Measure,
  type PlanDayChange,
  type PlanDayLine,
  type PlanExerciseInput,
  type PlanTarget,
  type SetType,
} from '@life-portal/shared-types';
import { setFieldsFor } from './training';

/**
 * Issue #15: what a finished workout would change in the plan day it was started from. Pure: no
 * clock, no Mongo. See `docs/modules/training.md` ("Updating a plan day from a workout").
 *
 * It is a patch, not a copy. Only what the workout changed is applied to the day *as it is now*:
 * an exercise the workout did not touch stays exactly as the plan has it, including edits made
 * after the workout started. The rules:
 *
 * - **added**: an exercise added during the workout (no `planned`) with at least one logged set.
 * - **removed**: a plan exercise explicitly removed during the workout (`removed`). Skipped and
 *   not-done exercises are not removals; they stay.
 * - **replaced**: a swap (a `planned` row whose exercise differs from the plan's).
 * - **moved**: a plan exercise whose place among the others changed.
 * - **rest** / **superset**: the workout's own choice differs from the plan's.
 *
 * Prescriptions never come from performance. A kept or same-measure swapped exercise keeps the
 * plan's planned sets. A new exercise, or a swap to another measure, gets one planned set per
 * *logged* set with its type and its reps, time or distance, never a weight. Unlogged sets are
 * not sets at all, so they never become targets.
 */

/** A plan day's exercise as stored. */
export interface PlanDayExercise {
  id: string;
  exerciseId: string;
  restSeconds?: number;
  note?: string;
  superset?: string;
  targets: PlanTarget[];
}

/** A logged set, as far as a plan cares. */
export interface PlanUpdateSet {
  type: SetType | string;
  reps?: number;
  durationSeconds?: number;
  distanceMeters?: number;
}

/** A finished workout's exercise, in workout order. */
export interface PlanUpdateSessionExercise {
  exerciseId: string;
  name: string;
  measure: Measure;
  /** The plan exercise it was copied from; absent for one added during the workout. */
  planExerciseId?: string;
  /** This workout's own rest, when the person changed it. */
  restSeconds?: number;
  superset?: string;
  sets: PlanUpdateSet[];
}

export interface PlanDayUpdateInput {
  day: readonly PlanDayExercise[];
  /** Name and measure of a plan exercise's exercise, for display and the measure check. */
  lookup: (exerciseId: string) => { name: string; measure: Measure } | undefined;
  session: readonly PlanUpdateSessionExercise[];
  /** Plan exercise ids removed during the workout. */
  removed: readonly string[];
}

export interface PlanDayUpdateDiff {
  /** The day's exercises after the update: kept ones carry their `id`, new ones have none. */
  exercises: PlanExerciseInput[];
  changes: PlanDayChange[];
  before: PlanDayLine[];
  after: PlanDayLine[];
}

/** Planned sets from logged ones: type plus reps, time or distance; never a weight. */
export function targetsFromSets(measure: Measure, sets: readonly PlanUpdateSet[]): PlanTarget[] {
  const allowed = setFieldsFor(measure).allowed;
  return sets.slice(0, PLAN_LIMITS.targetsMax).map((set) => {
    const target: PlanTarget = { type: set.type === 'warmup' ? 'warmup' : 'working' };
    for (const field of ['reps', 'durationSeconds', 'distanceMeters'] as const) {
      const value = set[field];
      if (allowed.includes(field) && value != null) target[field] = value;
    }
    return target;
  });
}

/** Indices (into `seq`) of one longest increasing subsequence: the items that did not move. */
function longestIncreasing(seq: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = prev[k]) keep.add(k);
  return keep;
}

type Slot =
  | { kind: 'plan'; exercise: PlanDayExercise; row?: PlanUpdateSessionExercise }
  | { kind: 'added'; row: PlanUpdateSessionExercise };

export function planDayUpdate({ day, lookup, session, removed }: PlanDayUpdateInput): PlanDayUpdateDiff {
  const changes: PlanDayChange[] = [];
  const nameOf = (exerciseId: string) => lookup(exerciseId)?.name ?? 'Exercise no longer available';
  const byId = new Map(day.map((exercise) => [exercise.id, exercise]));
  const removedIds = new Set(removed.filter((id) => byId.has(id)));

  // The workout's rows that still point at this day, and those added during it. A planned row
  // whose plan exercise has since been deleted from the day is not brought back.
  const sequence: Slot[] = [];
  const claimed = new Set<string>();
  for (const row of session) {
    if (row.planExerciseId) {
      const exercise = byId.get(row.planExerciseId);
      if (!exercise || removedIds.has(exercise.id) || claimed.has(exercise.id)) continue;
      claimed.add(exercise.id);
      sequence.push({ kind: 'plan', exercise, row });
    } else if (row.sets.length) {
      sequence.push({ kind: 'added', row });
    }
  }

  // Order: the plan exercises the workout did keep fill their own places in the order they were
  // done; untouched ones stay where they are; added ones follow whatever was done before them.
  const kept = day.filter((exercise) => !removedIds.has(exercise.id));
  const doneRefs = sequence.filter((slot): slot is Extract<Slot, { kind: 'plan' }> => slot.kind === 'plan');
  const leading: Slot[] = [];
  const after = new Map<string, Slot[]>();
  let last: string | undefined;
  for (const slot of sequence) {
    if (slot.kind === 'plan') last = slot.exercise.id;
    else if (last === undefined) leading.push(slot);
    else after.set(last, [...(after.get(last) ?? []), slot]);
  }
  const result: Slot[] = [];
  let next = 0;
  for (const exercise of kept) {
    if (claimed.has(exercise.id)) {
      const slot = doneRefs[next++];
      if (next === 1) result.push(...leading);
      result.push(slot, ...(after.get(slot.exercise.id) ?? []));
    } else {
      result.push({ kind: 'plan', exercise });
    }
  }
  if (!doneRefs.length) result.push(...leading);

  // Moves: among the plan exercises that remain, the fewest that changed place.
  const originalIndex = new Map(kept.map((exercise, index) => [exercise.id, index]));
  const planSlots = result.filter((slot): slot is Extract<Slot, { kind: 'plan' }> => slot.kind === 'plan');
  const stay = longestIncreasing(planSlots.map((slot) => originalIndex.get(slot.exercise.id) ?? 0));
  const moved = new Set<string>();
  planSlots.forEach((slot, index) => {
    if (!stay.has(index)) moved.add(slot.exercise.id);
  });

  for (const id of removedIds) {
    const exercise = byId.get(id);
    if (exercise) changes.push({ kind: 'removed', planExerciseId: id, name: nameOf(exercise.exerciseId) });
  }

  const exercises: PlanExerciseInput[] = [];
  const afterLines: PlanDayLine[] = [];
  for (const slot of result) {
    if (slot.kind === 'added') {
      const { row } = slot;
      const targets = targetsFromSets(row.measure, row.sets);
      exercises.push({
        exerciseId: row.exerciseId,
        ...(row.restSeconds != null ? { restSeconds: row.restSeconds } : {}),
        ...(row.superset ? { superset: row.superset } : {}),
        targets,
      });
      afterLines.push(line(row.name, row.measure, targets, row.restSeconds, row.superset, 'added'));
      changes.push({ kind: 'added', exerciseId: row.exerciseId, name: row.name, sets: targets.length });
      continue;
    }
    const { exercise, row } = slot;
    const planned = lookup(exercise.exerciseId);
    let exerciseId = exercise.exerciseId;
    let targets = exercise.targets;
    let restSeconds = exercise.restSeconds;
    let superset = exercise.superset;
    let measure: Measure = planned?.measure ?? 'weight_reps';
    let name = nameOf(exercise.exerciseId);
    let change: PlanDayLine['change'] = moved.has(exercise.id) ? 'moved' : undefined;
    if (row) {
      if (row.exerciseId !== exercise.exerciseId) {
        const targetsKept = planned?.measure === row.measure;
        if (!targetsKept) targets = targetsFromSets(row.measure, row.sets);
        changes.push({ kind: 'replaced', planExerciseId: exercise.id, fromName: name, toName: row.name, targetsKept });
        exerciseId = row.exerciseId;
        measure = row.measure;
        name = row.name;
        change = 'replaced';
      }
      if (row.restSeconds != null && row.restSeconds !== exercise.restSeconds) {
        changes.push({ kind: 'rest', planExerciseId: exercise.id, name, from: exercise.restSeconds, to: row.restSeconds });
        restSeconds = row.restSeconds;
        change ??= 'changed';
      }
      if ((row.superset ?? undefined) !== (exercise.superset ?? undefined)) {
        changes.push({ kind: 'superset', planExerciseId: exercise.id, name, from: exercise.superset, to: row.superset });
        superset = row.superset;
        change ??= 'changed';
      }
    }
    if (moved.has(exercise.id)) {
      changes.push({
        kind: 'moved',
        planExerciseId: exercise.id,
        name,
        from: day.indexOf(exercise) + 1,
        to: exercises.length + 1,
      });
    }
    exercises.push({
      id: exercise.id,
      exerciseId,
      ...(restSeconds != null ? { restSeconds } : {}),
      ...(exercise.note ? { note: exercise.note } : {}),
      ...(superset ? { superset } : {}),
      targets,
    });
    afterLines.push(line(name, measure, targets, restSeconds, superset, change));
  }

  const before = day.map((exercise) =>
    line(nameOf(exercise.exerciseId), lookup(exercise.exerciseId)?.measure ?? 'weight_reps', exercise.targets, exercise.restSeconds, exercise.superset),
  );
  const order: Record<PlanDayChange['kind'], number> = { replaced: 0, added: 1, removed: 2, moved: 3, rest: 4, superset: 5 };
  changes.sort((a, b) => order[a.kind] - order[b.kind]);
  return { exercises, changes, before, after: afterLines };
}

function line(
  name: string,
  measure: Measure,
  targets: PlanTarget[],
  restSeconds?: number,
  superset?: string,
  change?: PlanDayLine['change'],
): PlanDayLine {
  return {
    name,
    measure,
    targets,
    ...(restSeconds != null ? { restSeconds } : {}),
    ...(superset ? { superset } : {}),
    ...(change ? { change } : {}),
  };
}
