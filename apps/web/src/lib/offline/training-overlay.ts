import { openTargets, sessionDurationSeconds } from '@life-portal/shared-domain';
import type {
  ExerciseSnapshot,
  PlannedExercise,
  SessionDetail,
  SessionExercise,
  SessionListItem,
  SessionPlan,
  SetPatch,
  SetType,
  SetValues,
  WorkoutSet,
} from '@life-portal/shared-types';

/**
 * Offline workouts (spec 028, issue #17): the workout as the person sees it is the last copy the
 * server sent (cached on the device) with every write still in the outbox applied on top, in
 * order. Pure: the same outbox and copy always give the same workout, so a reload shows exactly
 * what was there before it.
 *
 * Every write carries the ids it creates (chosen by the client, accepted by the server), so a
 * write is applied the same way before and after the server has it: applying one whose row is
 * already in the server's copy changes nothing. That is what lets an acknowledged write stay
 * applied until the refetch lands, with no flicker and no double.
 *
 * Figures the server derives — records, ranks, levels, 1RM — are not recomputed here. Until a
 * workout's writes are acknowledged they are the server's last word, and the UI says that new
 * sets are not counted yet.
 */

/** One planned exercise of a workout started offline, built from the cached plan. */
export interface OfflineRow {
  id: string;
  exerciseId: string;
  snapshot: ExerciseSnapshot;
  planned?: PlannedExercise;
  superset?: string;
  restSeconds?: number;
}

export type TrainingWriteMeta =
  | { op: 'start'; sessionId: string; day: string; startedAt: string; plan?: SessionPlan; rows: OfflineRow[] }
  | { op: 'exercise.add'; sessionId: string; row: OfflineRow }
  | { op: 'exercise.swap'; sessionId: string; fromId: string; row: OfflineRow }
  | { op: 'exercise.remove'; sessionId: string; workoutExerciseId: string }
  | {
      op: 'exercise.patch';
      sessionId: string;
      workoutExerciseId: string;
      patch: { skipped?: boolean; restSeconds?: number | null; superset?: string | null; notes?: string };
      /** Spec 030: the version the edit was made against (absent on writes queued before it). */
      baseVersion?: number;
    }
  | { op: 'exercise.order'; sessionId: string; ids: string[] }
  | {
      op: 'set.add';
      sessionId: string;
      workoutExerciseId: string;
      setId: string;
      loggedAt: string;
      value: SetValues & { type?: SetType; rpe?: number; restSeconds?: number };
    }
  | {
      op: 'set.patch';
      sessionId: string;
      setId: string;
      patch: SetPatch;
      baseVersion?: number;
      /** Spec 030: the set as it was, to log it again if another device deleted it. */
      was?: { workoutExerciseId: string; value: SetValues & { type?: SetType; rpe?: number; restSeconds?: number } };
    }
  | { op: 'set.remove'; sessionId: string; setId: string }
  | { op: 'session.patch'; sessionId: string; patch: { notes?: string; day?: string }; baseVersion?: number }
  | { op: 'session.finish'; sessionId: string; endedAt: string }
  | { op: 'session.remove'; sessionId: string }
  | { op: 'plan-update'; sessionId: string };

/** What the overlay needs of an outbox item. */
export interface OverlayItem {
  id: string;
  meta?: unknown;
}

export function metaOf(item: OverlayItem): TrainingWriteMeta | undefined {
  const meta = item.meta as Partial<TrainingWriteMeta> | undefined;
  return meta && typeof meta === 'object' && typeof meta.op === 'string' && typeof meta.sessionId === 'string'
    ? (meta as TrainingWriteMeta)
    : undefined;
}

/** The ids a write creates, so later writes can wait for it (`dependsOn`). */
export function createdIds(meta: TrainingWriteMeta): string[] {
  switch (meta.op) {
    case 'start':
      return [meta.sessionId, ...meta.rows.map((row) => row.id)];
    case 'exercise.add':
    case 'exercise.swap':
      return [meta.row.id];
    case 'set.add':
      return [meta.setId];
    default:
      return [];
  }
}

function newExercise(sessionId: string, row: OfflineRow, order: number): SessionExercise {
  return {
    id: row.id,
    sessionId,
    exerciseId: row.exerciseId,
    order,
    snapshot: row.snapshot,
    sets: [],
    ...(row.planned ? { planned: row.planned } : {}),
    openTargets: openTargets(row.planned, 0, false),
    skipped: false,
    ...(row.restSeconds != null ? { restSeconds: row.restSeconds } : {}),
    ...(row.superset ? { superset: row.superset } : {}),
  };
}

function newSession(meta: Extract<TrainingWriteMeta, { op: 'start' }>): SessionDetail {
  return {
    id: meta.sessionId,
    day: meta.day,
    status: 'open',
    startedAt: meta.startedAt,
    durationSeconds: 0,
    isStale: false,
    exercises: meta.rows.map((row, order) => newExercise(meta.sessionId, row, order)),
    ...(meta.plan ? { plan: meta.plan } : {}),
  };
}

/** Derived fields, recomputed after the writes, the way the server derives them. */
function settle(session: SessionDetail): SessionDetail {
  const exercises = session.exercises
    .map((exercise, order) => ({
      ...exercise,
      order,
      openTargets: openTargets(exercise.planned, exercise.sets.length, exercise.skipped),
    }));
  const times = exercises.flatMap((exercise) => exercise.sets.map((set) => set.loggedAt)).sort();
  const lastSetAt = times[times.length - 1] ?? session.lastSetAt;
  return {
    ...session,
    exercises,
    ...(lastSetAt ? { lastSetAt } : {}),
    durationSeconds: sessionDurationSeconds({ startedAt: session.startedAt, endedAt: session.endedAt, lastSetAt }),
  };
}

const mapExercise = (session: SessionDetail, id: string, fn: (exercise: SessionExercise) => SessionExercise) => ({
  ...session,
  exercises: session.exercises.map((exercise) => (exercise.id === id ? fn(exercise) : exercise)),
});

const mapSet = (session: SessionDetail, setId: string, fn: (set: WorkoutSet) => WorkoutSet | undefined) => ({
  ...session,
  exercises: session.exercises.map((exercise) =>
    exercise.sets.some((set) => set.id === setId)
      ? {
          ...exercise,
          sets: exercise.sets
            .map((set) => (set.id === setId ? fn(set) : set))
            .filter((set): set is WorkoutSet => Boolean(set))
            .map((set, order) => ({ ...set, order })),
        }
      : exercise,
  ),
});

function applyPatch<T extends object>(target: T, patch: Record<string, unknown>): T {
  const next = { ...target } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

/**
 * Spec 030: the version a row has once an edit made against `base` is applied. Taking the larger
 * of the two keeps it right both before the server has the edit and after the refetch, so a
 * second edit queued behind the first is made against the version the first will produce.
 */
export function versionAfter<T extends { version?: number }>(row: T, base: number | undefined): T {
  return base === undefined ? row : { ...row, version: Math.max(row.version ?? 0, base + 1) };
}

/**
 * One write applied to one workout. Returns `null` when the write deletes it. Writes for another
 * workout leave it as it is. Every case is idempotent.
 */
export function applyWrite(session: SessionDetail | null, meta: TrainingWriteMeta): SessionDetail | null {
  if (meta.op === 'start') return session?.id === meta.sessionId ? session : newSession(meta);
  if (!session || session.id !== meta.sessionId) return session;
  switch (meta.op) {
    case 'exercise.add':
      if (session.exercises.some((exercise) => exercise.id === meta.row.id)) return session;
      return { ...session, exercises: [...session.exercises, newExercise(session.id, meta.row, session.exercises.length)] };
    case 'exercise.swap': {
      if (session.exercises.some((exercise) => exercise.id === meta.row.id)) return session;
      const index = session.exercises.findIndex((exercise) => exercise.id === meta.fromId);
      if (index < 0) return session;
      const from = session.exercises[index];
      const swapped = newExercise(session.id, {
        ...meta.row,
        restSeconds: meta.row.restSeconds ?? from.restSeconds,
        superset: meta.row.superset ?? from.superset,
      }, index);
      const exercises = [...session.exercises];
      exercises[index] = swapped;
      return { ...session, exercises };
    }
    case 'exercise.remove':
      return { ...session, exercises: session.exercises.filter((exercise) => exercise.id !== meta.workoutExerciseId) };
    case 'exercise.patch':
      return mapExercise(session, meta.workoutExerciseId, (exercise) => versionAfter(applyPatch(exercise, meta.patch), meta.baseVersion));
    case 'exercise.order': {
      const byId = new Map(session.exercises.map((exercise) => [exercise.id, exercise]));
      if (meta.ids.length !== byId.size || meta.ids.some((id) => !byId.has(id))) return session;
      return { ...session, exercises: meta.ids.map((id) => byId.get(id) as SessionExercise) };
    }
    case 'set.add': {
      if (session.exercises.some((exercise) => exercise.sets.some((set) => set.id === meta.setId))) return session;
      return mapExercise(session, meta.workoutExerciseId, (exercise) => {
        const { type, ...values } = meta.value;
        const set: WorkoutSet = {
          ...values,
          id: meta.setId,
          workoutExerciseId: exercise.id,
          exerciseId: exercise.exerciseId,
          order: exercise.sets.length,
          type: type ?? 'working',
          loggedAt: meta.loggedAt,
        };
        return { ...exercise, sets: [...exercise.sets, set] };
      });
    }
    case 'set.patch':
      return mapSet(session, meta.setId, (set) => versionAfter(applyPatch(set, meta.patch as Record<string, unknown>), meta.baseVersion));
    case 'set.remove':
      return mapSet(session, meta.setId, () => undefined);
    case 'session.patch':
      return versionAfter(applyPatch(session, meta.patch), meta.baseVersion);
    case 'session.finish':
      if (session.status === 'finished') return session;
      // Unlogged planned exercises are dropped on finish, as the server does.
      return {
        ...session,
        status: 'finished',
        endedAt: meta.endedAt,
        exercises: session.exercises.filter((exercise) => !exercise.planned || exercise.sets.length > 0),
      };
    case 'session.remove':
      return null;
    case 'plan-update':
      return session;
  }
}

/** `writes` applied in order to one workout, with its derived fields recomputed. */
export function overlaySession(base: SessionDetail | null, writes: readonly TrainingWriteMeta[]): SessionDetail | null {
  let session = base;
  for (const meta of writes) session = applyWrite(session, meta);
  return session ? (session === base ? base : settle(session)) : null;
}

/**
 * The open workout: the server's (or cached) current one with the writes applied. A workout
 * started offline takes the slot; a finished or deleted one leaves it.
 */
export function overlayCurrent(base: SessionDetail | null, writes: readonly TrainingWriteMeta[]): SessionDetail | null {
  let current = base;
  for (const meta of writes) {
    if (meta.op === 'start' && current?.id !== meta.sessionId) {
      current = applyWrite(null, meta);
      continue;
    }
    current = applyWrite(current, meta);
    if (current?.status === 'finished') current = null;
  }
  return current ? (current === base ? base : settle(current)) : null;
}

/**
 * A workout that exists only on the device: started offline and not yet in any server copy.
 * Built from its writes alone, for its own page and for history.
 */
export function localSession(sessionId: string, writes: readonly TrainingWriteMeta[]): SessionDetail | null {
  return writes.some((meta) => meta.op === 'start' && meta.sessionId === sessionId) ? overlaySession(null, writes) : null;
}

export function listItemOf(session: SessionDetail): SessionListItem {
  return {
    id: session.id,
    day: session.day,
    status: session.status,
    startedAt: session.startedAt,
    ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    durationSeconds: session.durationSeconds,
    exerciseNames: session.exercises.map((exercise) => exercise.snapshot.name),
    setCount: session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
    ...(session.plan ? { plan: { planName: session.plan.planName, workoutName: session.plan.workoutName } } : {}),
  };
}

/**
 * History: the server's first page, with workouts that exist only on the device added at the top
 * and deleted ones removed. Edits to listed workouts show once they are synced.
 */
export function overlayHistory(base: SessionListItem[], writes: readonly TrainingWriteMeta[]): SessionListItem[] {
  const removed = new Set(writes.filter((meta) => meta.op === 'session.remove').map((meta) => meta.sessionId));
  const known = new Set(base.map((item) => item.id));
  const local = [...new Set(writes.filter((meta) => meta.op === 'start').map((meta) => meta.sessionId))]
    .filter((id) => !known.has(id) && !removed.has(id))
    .map((id) => localSession(id, writes.filter((meta) => meta.sessionId === id)))
    .filter((session): session is SessionDetail => Boolean(session))
    .map(listItemOf)
    .reverse();
  return [...local, ...base.filter((item) => !removed.has(item.id))];
}
