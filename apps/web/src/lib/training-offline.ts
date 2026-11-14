'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  ExerciseListItem,
  PlanDetail,
  PlannedExercise,
  SessionDetail,
  SessionExercise,
  SessionListItem,
  SessionPage,
  SetPatch,
  WorkoutSet,
  SetValues,
  SetType,
} from '@life-portal/shared-types';
import { api, ApiError, NetworkError } from './api';
import { revalidate, useApi } from './hooks';
import { getWithOfflineCopy } from './offline/reads';
import { enqueueWrite, outbox, outboxItems, subscribeOutbox, useOutbox } from './offline/runtime';
import { moduleWrites } from './offline/settling';
import { newObjectId, plannedRowId } from './offline/planned-row-id';
import {
  createdIds,
  localSession,
  metaOf,
  overlayCurrent,
  overlayHistory,
  overlaySession,
  type OfflineRow,
  type TrainingWriteMeta,
} from './offline/training-overlay';
import { earlierEditsOf } from './offline/conflicts';
import type { OutboxItem, WriteMethod } from './offline/types';
import { CURRENT_KEY, planKey, revalidateTraining, sessionKey, useWorkoutDay } from './training';

/**
 * Workouts that work without a connection (spec 028, issue #17), built on the outbox (spec 027).
 *
 * Every change to a workout — starting one, adding, swapping, moving or removing an exercise,
 * logging, correcting or unticking a set, notes, finishing, deleting — is a write kept on the
 * device and sent in order. Each create carries an id chosen here, so later writes can refer to a
 * row the server has not seen yet, and a retry is answered with the same row. The screens read
 * the server's last copy (kept on the device) with those writes applied (`training-overlay.ts`),
 * so a workout looks the same offline, after a reload, and once synced.
 *
 * Records, ranks, levels and tournaments stay the server's: nothing here computes them, and the
 * workout says that sets not yet sent are not counted.
 */

/** The exercises a workout may use offline (own, recent, in plans), kept on the device. */
export const OFFLINE_EXERCISES_KEY = '/training/exercises/offline';

// ------------------------------------------------------------------ what the screens read

const writesOf = moduleWrites('training.', () => revalidateTraining());
const isTraining = writesOf.owns;

if (typeof window !== 'undefined') {
  // An online start that finds a workout already open (a stale screen, another device) with
  // nothing logged in it yet is simply dropped, and the open workout shown — what starting did
  // before spec 028. Once something was logged against it, the person decides (sync sheet).
  subscribeOutbox(() => {
    const items = outboxItems();
    for (const item of items) {
      if (item.kind !== 'training.start' || item.state !== 'conflict' || item.lastErrorCode !== 'SESSION_CONFLICT') continue;
      if (items.some((other) => other.dependsOn?.includes(item.id))) continue;
      void outbox.discard(item.id).then(() => revalidateTraining());
    }
  });
}

/**
 * The training writes to apply, in order: everything still on the device except writes the server
 * refused (those are listed for the person to retry or discard, not shown as done), then the
 * acknowledged ones still settling.
 */
export function useTrainingWrites(): TrainingWriteMeta[] {
  const items = writesOf.useItems();
  return useMemo(
    () => items.map(metaOf).filter((meta): meta is TrainingWriteMeta => Boolean(meta)),
    [items],
  );
}

/** The plan-day update for one workout still on this device, if any (pending, or refused). */
export function usePlanUpdateItem(sessionId: string): OutboxItem | undefined {
  const snapshot = useOutbox();
  return snapshot.items.find((item) => item.kind === 'training.plan-update' && metaOf(item)?.sessionId === sessionId);
}

/** For the workout screen's notes: whether writes are waiting offline, and the latest refusal. */
export function useTrainingSync(): { waiting: number; offline: boolean; error: string | null } {
  const snapshot = useOutbox();
  return useMemo(() => {
    const training = snapshot.items.filter(isTraining);
    const waiting = training.filter((item) => item.state === 'pending' || item.state === 'auth');
    const refused = training.filter((item) => item.state === 'error' || item.state === 'conflict');
    return {
      waiting: waiting.length,
      offline: snapshot.offline && waiting.length > 0,
      error: refused.length ? (refused[refused.length - 1].lastError ?? 'Could not save.') : null,
    };
  }, [snapshot]);
}

/**
 * Spec 028: a workout started on this device while another was open (usually on another device).
 * The server never merges the two; the person resolves it in the sync sheet.
 */
export function isSessionConflict(item: OutboxItem): boolean {
  return item.state === 'conflict' && item.lastErrorCode === 'SESSION_CONFLICT' && Boolean(item.lastErrorData?.['openSessionId']);
}

/**
 * Finishes the workout that is open on the server (at its last set; one with no sets is
 * discarded, as finishing an empty workout is), then sends this device's workout again.
 */
export async function finishOtherAndRetry(item: OutboxItem): Promise<void> {
  const openId = item.lastErrorData?.['openSessionId'];
  if (!openId) return;
  try {
    await api.post(`${base(openId)}/finish`, { at: 'lastSet' });
  } catch (caught) {
    if (!(caught instanceof ApiError) || caught.code !== 'EMPTY_SESSION') throw caught;
    await api.delete(base(openId));
  }
  await outbox.retry(item.id);
  await revalidateTraining();
}

/**
 * Spec 034: saves a workout refused as recorded too long ago with the times the person confirmed
 * (`movedToToday`). Each write is replaced in place, dependents before the start, so none of
 * them can be sent with the old times.
 */
export async function saveMovedWorkout(writes: readonly { id: string; body: unknown; meta: unknown }[]): Promise<void> {
  for (const write of writes) await outbox.replace(write.id, { id: crypto.randomUUID(), body: write.body, meta: write.meta });
  await revalidateTraining();
}

/** Gives up the training writes the server refused. Explicit: the person pressed Discard. */
export async function discardRefusedTraining(): Promise<void> {
  for (const item of outboxItems()) {
    if (isTraining(item) && (item.state === 'error' || item.state === 'conflict')) await outbox.discard(item.id);
  }
}

/** The open workout, with this device's writes applied. */
export function useCurrentSession(enabled = true) {
  const result = useApi<SessionDetail | null | undefined>(enabled ? CURRENT_KEY : null, {
    // A workout started on another device shows up when this one comes back to the app.
    revalidateOnFocus: true,
  });
  const writes = useTrainingWrites();
  const data = useMemo(
    () => (result.data === undefined && !writes.length ? undefined : overlayCurrent(result.data ?? null, writes) ?? undefined),
    [result.data, writes],
  );
  const usable = data !== undefined || result.data !== undefined;
  return { ...result, data, error: usable ? undefined : result.error, isLoading: result.isLoading && !usable };
}

/** One workout (History), with this device's writes applied; one made offline exists only here. */
export function useSessionDetail(id: string) {
  const result = useApi<SessionDetail>(sessionKey(id));
  const writes = useTrainingWrites();
  const mine = useMemo(() => writes.filter((meta) => meta.sessionId === id), [writes, id]);
  const data = useMemo(() => {
    if (result.data) return overlaySession(result.data, mine) ?? undefined;
    return localSession(id, mine) ?? undefined;
  }, [result.data, mine, id]);
  return { ...result, data, error: data ? undefined : result.error, isLoading: result.isLoading && !data };
}

/** History's first page, with workouts that exist only on this device at the top. */
export function useHistoryPage() {
  const result = useApi<SessionPage>('/training/sessions');
  const writes = useTrainingWrites();
  const data = useMemo<SessionPage | undefined>(() => {
    if (!result.data && !writes.length) return undefined;
    const sessions: SessionListItem[] = overlayHistory(result.data?.sessions ?? [], writes);
    return { ...(result.data ?? {}), sessions };
  }, [result.data, writes]);
  return { ...result, data, error: data ? undefined : result.error, isLoading: result.isLoading && !data };
}

// ------------------------------------------------------------------ writes

/** Items still on the device that create any of `ids`: a write about those ids waits for them. */
function creatorsOf(ids: (string | undefined)[]): string[] {
  const wanted = new Set(ids.filter(Boolean));
  return outboxItems()
    .filter((item) => {
      const meta = metaOf(item);
      return meta ? createdIds(meta).some((id) => wanted.has(id)) : false;
    })
    .map((item) => item.id);
}

function referencedIds(meta: TrainingWriteMeta): string[] {
  switch (meta.op) {
    case 'start':
      return [];
    case 'exercise.add':
      return [meta.sessionId];
    case 'exercise.swap':
      return [meta.sessionId, meta.fromId];
    case 'exercise.remove':
    case 'exercise.patch':
      return [meta.sessionId, meta.workoutExerciseId];
    case 'exercise.order':
      return [meta.sessionId, ...meta.ids];
    case 'set.add':
      return [meta.sessionId, meta.workoutExerciseId];
    case 'set.patch':
    case 'set.remove':
      return [meta.sessionId, meta.setId];
    default:
      return [meta.sessionId];
  }
}

async function write(
  meta: TrainingWriteMeta,
  request: { method: WriteMethod; path: string; body?: unknown },
  label: string,
  id: string = crypto.randomUUID(),
): Promise<void> {
  // A plan-day update is worked out from the finished workout, so it waits for all of it.
  const dependsOn =
    meta.op === 'plan-update'
      ? outboxItems().filter((item) => metaOf(item)?.sessionId === meta.sessionId).map((item) => item.id)
      : [
          ...creatorsOf(referencedIds(meta)),
          // Spec 030: a second edit of a row is made on top of the first, so it never overtakes it.
          ...earlierEditsOf(outboxItems(), { kind: `training.${meta.op}`, meta }),
        ];
  await enqueueWrite({
    id,
    kind: `training.${meta.op}`,
    ...request,
    meta,
    label,
    ...(dependsOn.length ? { dependsOn } : {}),
  });
}

/** A set's own values, as a new set would be logged with them. */
function setValueOf(set: Partial<WorkoutSet>): SetValues & { type?: SetType; rpe?: number; restSeconds?: number } {
  return Object.fromEntries(
    (['reps', 'weightGrams', 'assistGrams', 'durationSeconds', 'distanceMeters', 'type', 'rpe', 'restSeconds'] as const)
      .filter((field) => set[field] != null)
      .map((field) => [field, set[field]]),
  ) as SetValues & { type?: SetType; rpe?: number; restSeconds?: number };
}

const base = (sessionId: string) => `/training/sessions/${sessionId}`;

function rowFrom(exercise: Pick<ExerciseListItem, 'id' | 'name' | 'equipmentType' | 'measure' | 'primaryMuscles'>, id: string): OfflineRow {
  return {
    id,
    exerciseId: exercise.id,
    snapshot: {
      name: exercise.name,
      equipmentType: exercise.equipmentType,
      measure: exercise.measure,
      primaryMuscles: exercise.primaryMuscles,
    },
  };
}

/** The exercises kept for offline use, or none. Never throws. */
async function offlineExercises(): Promise<ExerciseListItem[]> {
  return getWithOfflineCopy<ExerciseListItem[]>(OFFLINE_EXERCISES_KEY).catch(() => []);
}

/**
 * The rows a plan start makes, with the ids the server will give them, from the plan as this
 * device has it. The server copies the plan as it is when the start arrives; its copy wins on sync.
 */
async function plannedRows(plan: PlanDetail, planWorkoutId: string, requestId: string): Promise<OfflineRow[] | undefined> {
  const day = plan.workouts.find((workout) => workout.id === planWorkoutId);
  if (!day?.exercises.length) return undefined;
  const known = new Map((await offlineExercises()).map((exercise) => [exercise.id, exercise]));
  return Promise.all(
    day.exercises.map(async (item) => ({
      id: await plannedRowId(requestId, item.id),
      exerciseId: item.exerciseId,
      snapshot: {
        name: item.exercise.name,
        equipmentType: item.exercise.equipmentType,
        measure: item.exercise.measure,
        primaryMuscles: known.get(item.exerciseId)?.primaryMuscles ?? [],
      },
      planned: {
        planExerciseId: item.id,
        ...(item.restSeconds != null ? { restSeconds: item.restSeconds } : {}),
        ...(item.note ? { note: item.note } : {}),
        targets: item.targets,
      },
      ...(item.superset ? { superset: item.superset } : {}),
    })),
  );
}

export const trainingWrites = {
  /**
   * Starts a workout — the plan's, when the plan and its day are on this device and the day has
   * exercises; otherwise an empty one (as Home's Play always fell back). Resolves with its id once
   * it is stored, connection or not.
   */
  async start(day: string, from?: { planId: string; planWorkoutId: string }): Promise<string> {
    const requestId = crypto.randomUUID();
    const sessionId = newObjectId();
    const startedAt = new Date().toISOString();
    let plan: PlanDetail | undefined;
    if (from) {
      try {
        plan = await getWithOfflineCopy<PlanDetail>(planKey(from.planId));
      } catch (caught) {
        if (caught instanceof NetworkError) throw new Error('This plan is not saved on this device. Start an empty workout instead.');
        // The plan is gone (deleted since this screen loaded): an empty workout, as Play always did.
        if (!(caught instanceof ApiError) || (caught.status !== 404 && caught.status !== 400)) throw caught;
      }
    }
    const rows = plan && from ? await plannedRows(plan, from.planWorkoutId, requestId) : undefined;
    const workout = rows && plan?.workouts.find((item) => item.id === from?.planWorkoutId);
    const usePlan = Boolean(rows && workout && from);
    await write(
      {
        op: 'start',
        sessionId,
        day,
        startedAt,
        rows: rows ?? [],
        ...(usePlan && from && plan && workout
          ? { plan: { planId: from.planId, planWorkoutId: from.planWorkoutId, planName: plan.name, workoutName: workout.name } }
          : {}),
      },
      {
        method: 'POST',
        path: '/training/sessions',
        body: { requestId, day, id: sessionId, startedAt, ...(usePlan && from ? from : {}) },
      },
      usePlan && workout ? `Start workout · ${workout.name}` : 'Start workout',
      requestId,
    );
    return sessionId;
  },

  addExercise(sessionId: string, exercise: ExerciseListItem): Promise<void> {
    const requestId = crypto.randomUUID();
    const id = newObjectId();
    return write(
      { op: 'exercise.add', sessionId, row: rowFrom(exercise, id) },
      { method: 'POST', path: `${base(sessionId)}/exercises`, body: { requestId, exerciseId: exercise.id, id } },
      `Add exercise · ${exercise.name}`,
      requestId,
    );
  },

  /** Replaces an exercise with no sets in place; planned targets carry over as the server does. */
  swap(sessionId: string, from: SessionExercise, exercise: ExerciseListItem): Promise<void> {
    const requestId = crypto.randomUUID();
    const id = newObjectId();
    const planned: PlannedExercise | undefined = from.planned
      ? {
          ...from.planned,
          targets:
            exercise.measure === from.snapshot.measure
              ? from.planned.targets
              : from.planned.targets.map((target) => ({ type: target.type })),
        }
      : undefined;
    return write(
      { op: 'exercise.swap', sessionId, fromId: from.id, row: { ...rowFrom(exercise, id), ...(planned ? { planned } : {}) } },
      { method: 'POST', path: `${base(sessionId)}/exercises/${from.id}/swap`, body: { requestId, exerciseId: exercise.id, id } },
      `Swap ${from.snapshot.name} for ${exercise.name}`,
      requestId,
    );
  },

  removeExercise(sessionId: string, exercise: Pick<SessionExercise, 'id' | 'snapshot'>): Promise<void> {
    return write(
      { op: 'exercise.remove', sessionId, workoutExerciseId: exercise.id },
      { method: 'DELETE', path: `${base(sessionId)}/exercises/${exercise.id}` },
      `Remove ${exercise.snapshot.name}`,
    );
  },

  /** Spec 030: every edit is made against the version shown (`STALE_EDIT` if it moved on). */
  patchExercise(
    sessionId: string,
    exercise: Pick<SessionExercise, 'id' | 'snapshot' | 'version'>,
    patch: { skipped?: boolean; restSeconds?: number | null; superset?: string | null; notes?: string },
  ): Promise<void> {
    const baseVersion = exercise.version ?? 0;
    return write(
      { op: 'exercise.patch', sessionId, workoutExerciseId: exercise.id, patch, baseVersion },
      { method: 'PATCH', path: `${base(sessionId)}/exercises/${exercise.id}`, body: { ...patch, baseVersion } },
      `Change ${exercise.snapshot.name}`,
    );
  },

  reorder(sessionId: string, ids: string[]): Promise<void> {
    return write(
      { op: 'exercise.order', sessionId, ids },
      { method: 'POST', path: `${base(sessionId)}/exercises/order`, body: { ids } },
      'Reorder exercises',
    );
  },

  logSet(
    sessionId: string,
    exercise: Pick<SessionExercise, 'id' | 'snapshot'>,
    value: SetValues & { type?: SetType; rpe?: number; restSeconds?: number },
  ): Promise<void> {
    const requestId = crypto.randomUUID();
    const setId = newObjectId();
    const loggedAt = new Date().toISOString();
    return write(
      { op: 'set.add', sessionId, workoutExerciseId: exercise.id, setId, loggedAt, value },
      {
        method: 'POST',
        path: `${base(sessionId)}/exercises/${exercise.id}/sets`,
        body: { requestId, id: setId, loggedAt, ...value },
      },
      `Set · ${exercise.snapshot.name}`,
      requestId,
    );
  },

  patchSet(sessionId: string, set: Pick<WorkoutSet, 'id' | 'version'>, patch: SetPatch): Promise<void> {
    const baseVersion = set.version ?? 0;
    const { id: _id, version: _version, workoutExerciseId, ...was } = set as WorkoutSet;
    return write(
      {
        op: 'set.patch',
        sessionId,
        setId: set.id,
        patch,
        baseVersion,
        // Spec 030: enough to log the set again if it was deleted on another device meanwhile.
        ...(workoutExerciseId ? { was: { workoutExerciseId, value: setValueOf(was as WorkoutSet) } } : {}),
      },
      { method: 'PATCH', path: `/training/sets/${set.id}`, body: { ...patch, baseVersion } },
      'Correct a set',
    );
  },

  removeSet(sessionId: string, setId: string): Promise<void> {
    return write({ op: 'set.remove', sessionId, setId }, { method: 'DELETE', path: `/training/sets/${setId}` }, 'Remove a set');
  },

  /**
   * Issue #15 offline: the update the person reviewed, sent with the day's revision it was
   * reviewed against. If the day changed since, the server refuses (`PLAN_CHANGED`) and the
   * person reviews it again; nothing is merged.
   */
  planUpdate(sessionId: string, requestId: string, revision: number, workoutName?: string): Promise<void> {
    return write(
      { op: 'plan-update', sessionId },
      { method: 'POST', path: `${base(sessionId)}/plan-update`, body: { requestId, revision } },
      `Update plan day${workoutName ? ` · ${workoutName}` : ''}`,
      requestId,
    );
  },

  patchSession(session: Pick<SessionDetail, 'id' | 'version'>, patch: { notes?: string; day?: string }): Promise<void> {
    const baseVersion = session.version ?? 0;
    return write(
      { op: 'session.patch', sessionId: session.id, patch, baseVersion },
      { method: 'PATCH', path: base(session.id), body: { ...patch, baseVersion } },
      'Workout notes',
    );
  },

  /** Finishes at now, or at the last set. The time is this device's, sent with it. */
  finish(session: SessionDetail, at: 'now' | 'lastSet' = 'now'): Promise<void> {
    const endedAt = at === 'lastSet' && session.lastSetAt ? session.lastSetAt : new Date().toISOString();
    return write(
      { op: 'session.finish', sessionId: session.id, endedAt },
      { method: 'POST', path: `${base(session.id)}/finish`, body: { endedAt } },
      'Finish workout',
    );
  },

  remove(sessionId: string): Promise<void> {
    return write({ op: 'session.remove', sessionId }, { method: 'DELETE', path: base(sessionId) }, 'Delete workout');
  },
};

/** Whether this workout still has writes on the device: its records and ranks are not final. */
export function hasUnsyncedWrites(writes: readonly TrainingWriteMeta[], sessionId: string): boolean {
  return writes.some((meta) => meta.sessionId === sessionId && meta.op !== 'plan-update');
}

/**
 * Home's Play (issue #7): start the plan workout the card names, or an empty one, then open
 * Training. Works offline (spec 028). Taps while a start is being stored are ignored.
 */
export function useStartWorkout() {
  const router = useRouter();
  const workoutDay = useWorkoutDay();
  const [error, setError] = useState<string | null>(null);
  const starting = useRef(false);
  const start = useCallback(
    async (plan?: { planId: string; planWorkoutId: string }) => {
      if (starting.current) return;
      starting.current = true;
      setError(null);
      try {
        await trainingWrites.start(workoutDay(), plan);
        void revalidate('/dashboard');
        router.push('/training');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not start the workout.');
      } finally {
        starting.current = false;
      }
    },
    [router, workoutDay],
  );
  return { start, error };
}
