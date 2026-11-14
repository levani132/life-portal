'use client';

import { useSyncExternalStore } from 'react';
import { restAfter, supersetRuns, workoutFocus, type FocusExercise, type SupersetPlace } from '@life-portal/shared-domain';
import type { PlanDetail, PlanInput, SessionDetail, SessionExercise } from '@life-portal/shared-types';

/**
 * Spec 025 on the web side: what an open workout is focused on, and the rest after a set. All of
 * it is derived from the session and the sets still being sent; nothing here is stored, except
 * the rest timer's skip and ±15 s, which live in memory for the current rest only.
 */

export interface SessionFocus {
  doneIds: Set<string>;
  currentId?: string;
  current?: SessionExercise;
  /** The exercise of the most recent set, sent or still waiting. */
  lastId?: string;
  /** Seconds to rest after that set; 0 mid-way through a superset round. */
  restSeconds: number;
  supersets: Map<string, SupersetPlace>;
}

/** The rest an exercise asks for: chosen in this workout, else the plan's. Absent: the default. */
export const exerciseRest = (exercise: SessionExercise): number | undefined =>
  exercise.restSeconds ?? exercise.planned?.restSeconds;

export function sessionFocus(
  session: SessionDetail,
  pending: readonly { workoutExerciseId: string }[],
  defaultRestSeconds: number,
): SessionFocus {
  const waiting = new Map<string, number>();
  for (const item of pending) waiting.set(item.workoutExerciseId, (waiting.get(item.workoutExerciseId) ?? 0) + 1);
  const items: FocusExercise[] = session.exercises.map((exercise) => ({
    id: exercise.id,
    superset: exercise.superset,
    skipped: exercise.skipped,
    targetCount: exercise.planned?.targets.length ?? 0,
    logged: exercise.sets.length + (waiting.get(exercise.id) ?? 0),
    restSeconds: exerciseRest(exercise),
  }));
  const lastId = pending.length
    ? pending[pending.length - 1].workoutExerciseId
    : session.lastSetAt
      ? session.exercises.find((exercise) => exercise.sets.some((set) => set.loggedAt === session.lastSetAt))?.id
      : undefined;
  const focus = workoutFocus(items, lastId);
  return {
    ...focus,
    current: session.exercises.find((exercise) => exercise.id === focus.currentId),
    lastId,
    restSeconds: restAfter(items, lastId, focus.currentId, defaultRestSeconds),
    supersets: supersetRuns(session.exercises),
  };
}

// ------------------------------------------------------------------ the current rest

interface RestState {
  /** The `lastSetAt` the state belongs to; a new set starts a fresh rest. */
  since?: string;
  skipped: boolean;
  addSeconds: number;
}

let restState: RestState = { skipped: false, addSeconds: 0 };
const listeners = new Set<() => void>();

function setRest(since: string, change: (state: RestState) => Partial<RestState>) {
  const base = restState.since === since ? restState : { since, skipped: false, addSeconds: 0 };
  restState = { ...base, ...change(base) };
  listeners.forEach((listener) => listener());
}

/** Skip and ±15 s for the rest after the set logged at `since`, shared by the timer and the pinned bar. */
export function useRestControls(since: string | undefined) {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => restState,
    () => restState,
  );
  const mine = since && state.since === since ? state : { skipped: false, addSeconds: 0 };
  return {
    skipped: mine.skipped,
    addSeconds: mine.addSeconds,
    skip: () => since && setRest(since, () => ({ skipped: true })),
    adjust: (by: number) => since && setRest(since, (current) => ({ addSeconds: current.addSeconds + by })),
  };
}

/**
 * Seconds of rest left (negative once over), or `undefined` when there is no rest to show: no
 * set, no rest, skipped, or more than a minute past the end.
 */
export function restLeft(
  since: string | undefined,
  seconds: number,
  controls: { skipped: boolean; addSeconds: number },
  now: number,
): number | undefined {
  if (!since || controls.skipped) return undefined;
  const total = seconds + controls.addSeconds;
  if (total <= 0) return undefined;
  const elapsed = Math.floor((now - Date.parse(since)) / 1000);
  if (elapsed < 0 || elapsed > total + 60) return undefined;
  return total - elapsed;
}

// ------------------------------------------------------------------ plans

/** A plan as it would be sent back whole by `PUT /plans/:id`, keeping every id. */
export function planInputOf(plan: PlanDetail): PlanInput {
  return {
    name: plan.name,
    ...(plan.description ? { description: plan.description } : {}),
    workouts: plan.workouts.map((workout) => ({
      id: workout.id,
      // Issue #15: a save over a newer edit of this day answers 409 instead of undoing it.
      revision: workout.revision,
      name: workout.name,
      exercises: workout.exercises.map((exercise) => ({
        id: exercise.id,
        exerciseId: exercise.exerciseId,
        ...(exercise.restSeconds != null ? { restSeconds: exercise.restSeconds } : {}),
        ...(exercise.note ? { note: exercise.note } : {}),
        ...(exercise.superset ? { superset: exercise.superset } : {}),
        targets: exercise.targets,
      })),
    })),
  };
}

// ------------------------------------------------------------------ the pinned workout bar

let workoutOnScreen = false;
const screenListeners = new Set<() => void>();

/** Set by the Training page while its Workout tab is showing: the pinned bar then hides itself. */
export function setWorkoutOnScreen(value: boolean) {
  if (workoutOnScreen === value) return;
  workoutOnScreen = value;
  screenListeners.forEach((listener) => listener());
}

export function useWorkoutOnScreen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      screenListeners.add(listener);
      return () => screenListeners.delete(listener);
    },
    () => workoutOnScreen,
    () => false,
  );
}

/** Asks an already-open Training page to show its Workout tab (the bar's tap on `/training`). */
export const OPEN_WORKOUT_EVENT = 'training:open-workout';
