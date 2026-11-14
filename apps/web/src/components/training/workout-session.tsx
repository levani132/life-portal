'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Dumbbell,
  History as HistoryIcon,
  Layers,
  Link2,
  Play,
  Plus,
  Repeat,
  SkipForward,
  Timer,
  Trash2,
  Unlink,
} from 'lucide-react';
import type {
  ExerciseListItem,
  SessionDetail,
  SessionExercise,
  WorkoutSet,
} from '@life-portal/shared-types';
import {
  formatDay,
  linkWithNext,
  setFieldsFor,
  unlinkFromNext,
  type SupersetPlace,
} from '@life-portal/shared-domain';
import { ErrorNote, Modal, Spinner, Textarea } from '../ui';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import {
  describeOneRepMax,
  describeSet,
  formatDuration,
  humanise,
  revalidateTraining,
  useCurrentSession,
  useTrainingProfile,
  useWeightUnit,
  useWorkoutDay,
} from '../../lib/training';
import { clearQueueError, enqueue, useTrainingQueue } from '../../lib/training-queue';
import { ExerciseDetail, type ExerciseDetailTab } from './exercise-detail';
import { ExerciseSearch } from './exercise-picker';
import { SuggestedPlans } from './plan-suggestions';
import { GROUP_STYLES, exerciseGroup, usePlanStyle } from '../../lib/training-colors';
import { RestTimer } from './rest-timer';
import { RestEditor } from './rest-editor';
import { exerciseRest, sessionFocus } from '../../lib/training-workout';
import { SetForm, type SetFormValue } from './set-row';
import { SetTable } from './set-table';
import { PlanDayUpdate } from './plan-day-update';

interface PendingSet {
  sessionId: string;
  workoutExerciseId: string;
  value: SetFormValue;
}

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Could not reach the server. Try again.';

/** Ticks once a second while `active`, for the workout clock. Display only. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/** The Workout tab: the open session, or a way to start one. */
export function CurrentWorkout({ onBrowsePlans }: { onBrowsePlans?: () => void }) {
  const { data, error, isLoading } = useCurrentSession();
  const workoutDay = useWorkoutDay();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      await api.post('/training/sessions', { requestId: crypto.randomUUID(), day: workoutDay() });
      await revalidateTraining();
    } catch (caught) {
      setStartError(message(caught));
    } finally {
      setStarting(false);
    }
  };

  if (isLoading) return <Spinner />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) {
    return (
      <div className="space-y-4">
        <section className="card relative overflow-hidden p-5">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-train-legs/10" />
          <div className="relative flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-train-legs-solid to-train-pull-solid text-white shadow-lg shadow-train-legs-solid/30">
              <Dumbbell className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold">Ready when you are</p>
              <p className="text-xs text-ink-faint">Start empty and add exercises as you go, or follow a plan.</p>
            </div>
          </div>
          <div className="relative mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-train-legs-solid to-train-pull-solid px-3 text-sm font-semibold text-white shadow transition-opacity hover:opacity-90 disabled:opacity-60"
              disabled={starting}
              onClick={() => void start()}
            >
              <Play className="h-4 w-4" /> {starting ? 'Starting…' : 'Start empty'}
            </button>
            {onBrowsePlans && (
              <button type="button" className="btn-ghost min-h-[2.75rem] justify-center rounded-xl" onClick={onBrowsePlans}>
                <ClipboardList className="h-4 w-4" /> Choose a plan
              </button>
            )}
          </div>
          {startError && <div className="relative mt-3"><ErrorNote message={startError} /></div>}
        </section>
        <SuggestedPlans />
      </div>
    );
  }
  return <WorkoutSession session={data} />;
}

/**
 * One session, open or finished: exercises in order, their sets as a table to tick off, and
 * the session's own controls. Finished sessions stay editable (spec 020, story 1 #5).
 */
export function WorkoutSession({ session, onGone }: { session: SessionDetail; onGone?: () => void }) {
  const open = session.status === 'open';
  const now = useNow(open);
  const planStyle = usePlanStyle(session.plan?.planId);
  const profile = useTrainingProfile();
  const queue = useTrainingQueue();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(session.notes ?? '');
  useEffect(() => setNotes(session.notes ?? ''), [session.notes]);

  const pending = useMemo(
    () =>
      queue.jobs
        .map((job) => job.meta as PendingSet)
        .filter((meta) => meta.sessionId === session.id),
    [queue.jobs, session.id],
  );

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await revalidateTraining();
      return true;
    } catch (caught) {
      setError(message(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const base = `/training/sessions/${session.id}`;
  /** One step (#14): the exercise names its equipment, so there is no "which machine?". */
  const addExercise = async (exercise: ExerciseListItem) => {
    setPicking(false);
    await run(() =>
      api.post(`${base}/exercises`, { requestId: crypto.randomUUID(), exerciseId: exercise.id }),
    );
  };

  const discard = async () => {
    if (!window.confirm('Discard this workout and every set in it?')) return;
    if (await run(() => api.delete(base))) onGone?.();
  };

  const finish = async (at: 'now' | 'lastSet' = 'now') => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`${base}/finish`, { at });
      await revalidateTraining();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        // Nothing was logged: offer to throw it away rather than keep an empty workout.
        setBusy(false);
        await discard();
        return;
      }
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };

  const saveNotes = () => {
    if (notes === (session.notes ?? '')) return;
    void run(() => api.patch(base, { notes }));
  };

  const move = (index: number, by: -1 | 1) => {
    const ids = session.exercises.map((exercise) => exercise.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved);
    void run(() => api.post(`${base}/exercises/order`, { ids }));
  };

  // Spec 025: which exercise is done and which is current, and the rest after the last set (the
  // exercise's own rest, 0 mid-way through a superset round). Derived on every render.
  const focus = sessionFocus(session, pending, profile.defaultRestSeconds);
  const upNext = focus.current && focus.current.id !== focus.lastId ? focus.current.snapshot.name : undefined;

  /** Spec 025: links or splits a superset; saves only the exercises whose key changed. */
  const relink = (index: number, link: boolean) => {
    const keys = session.exercises.map((exercise) => exercise.superset);
    const makeKey = () => crypto.randomUUID().slice(0, 8);
    const changed = link ? linkWithNext(keys, index, makeKey) : unlinkFromNext(keys, index, makeKey);
    void run(async () => {
      for (const [i, exercise] of session.exercises.entries()) {
        if (changed[i] === exercise.superset) continue;
        await api.patch(`${base}/exercises/${exercise.id}`, { superset: changed[i] ?? null });
      }
    });
  };

  const elapsed = open
    ? Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000))
    : session.durationSeconds;

  // Planned sets done over planned (spec 024): skipped exercises are left out, sets waiting to be
  // sent count, and extra sets beyond the plan do not overfill the bar.
  const planned = session.exercises.filter((exercise) => exercise.planned && !exercise.skipped);
  const plannedTotal = planned.reduce((sum, exercise) => sum + (exercise.planned?.targets.length ?? 0), 0);
  const plannedDone = planned.reduce((sum, exercise) => {
    const logged = exercise.sets.length + pending.filter((item) => item.workoutExerciseId === exercise.id).length;
    return sum + Math.min(logged, exercise.planned?.targets.length ?? 0);
  }, 0);
  const setCount = session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0) + pending.length;

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden p-0">
        <div className={clsx('relative bg-gradient-to-br p-4 text-white', planStyle.gradient)}>
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10" />
          <div className="relative flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">
                {open ? 'In progress' : 'Finished'} · {formatDay(session.day)}
              </p>
              <h2 className="truncate text-lg font-bold leading-snug">
                {session.plan ? session.plan.workoutName : open ? 'Workout' : `Workout · ${formatDay(session.day)}`}
              </h2>
              {session.plan && <p className="truncate text-sm text-white/85">{session.plan.planName}</p>}
            </div>
            {open && (
              <button
                type="button"
                className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-900 shadow transition-colors hover:bg-white/90 disabled:opacity-60"
                disabled={busy}
                onClick={() => void finish('now')}
              >
                Finish
              </button>
            )}
          </div>
          <div className="relative mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium tabular-nums">
            <span className="flex items-center gap-1.5">
              <Timer className="h-4 w-4 text-white/80" /> {formatDuration(elapsed)}
            </span>
            <span className="flex items-center gap-1.5">
              <Layers className="h-4 w-4 text-white/80" /> {setCount} {setCount === 1 ? 'set' : 'sets'}
            </span>
            <span className="flex items-center gap-1.5">
              <Dumbbell className="h-4 w-4 text-white/80" /> {session.exercises.length}{' '}
              {session.exercises.length === 1 ? 'exercise' : 'exercises'}
            </span>
          </div>
          {plannedTotal > 0 && (
            <div className="relative mt-3">
              <div
                className="h-2 overflow-hidden rounded-full bg-white/25"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={plannedTotal}
                aria-valuenow={plannedDone}
                aria-label="Planned sets done"
              >
                <div
                  className="h-full rounded-full bg-white transition-[width] duration-500 motion-reduce:transition-none"
                  style={{ width: `${Math.round((plannedDone / plannedTotal) * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-white/80">
                {plannedDone} of {plannedTotal} planned sets
              </p>
            </div>
          )}
        </div>
        <div className="space-y-3 p-4">
          {session.isStale && (
            <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              <p>This workout has been open for over 12 hours.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-ghost" disabled={busy || !session.lastSetAt} onClick={() => void finish('lastSet')}>
                  Finish at last set
                </button>
                <button type="button" className="btn-danger" disabled={busy} onClick={() => void discard()}>
                  Discard
                </button>
              </div>
            </div>
          )}
          {queue.offline && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              No connection: sets are kept on this device and sent when it is back.
            </p>
          )}
          {queue.error && (
            <div>
              <ErrorNote message={queue.error} />
              <button
                type="button"
                className="mt-1 text-xs text-ink-faint underline"
                onClick={() => {
                  if (window.confirm('Discard the sets that could not be saved? They are not on the server.')) clearQueueError();
                }}
              >
                Discard unsaved sets
              </button>
            </div>
          )}
          {error && <ErrorNote message={error} />}
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            onBlur={saveNotes}
            placeholder="Notes"
            rows={2}
            maxLength={2000}
            aria-label="Workout notes"
          />
        </div>
      </section>

      {/* Issue #15: a finished plan workout may offer to update its plan day. Never blocks. */}
      {!open && session.plan && <PlanDayUpdate sessionId={session.id} />}

      {/* Outside the card, so it can stick while the exercises scroll (see RestTimer). */}
      {open && <RestTimer since={session.lastSetAt} seconds={focus.restSeconds} next={upNext} />}

      {session.exercises.map((exercise, index) => {
        const place = focus.supersets.get(exercise.id);
        const next = session.exercises[index + 1];
        const linked = Boolean(place && next && focus.supersets.get(next.id)?.ids === place.ids);
        return (
        <div key={exercise.id}>
        <ExerciseBlock
          session={session}
          exercise={exercise}
          state={!open ? 'idle' : focus.doneIds.has(exercise.id) ? 'done' : focus.currentId === exercise.id ? 'current' : 'idle'}
          superset={place}
          defaultRest={profile.defaultRestSeconds}
          pending={pending.filter((item) => item.workoutExerciseId === exercise.id)}
          canMoveUp={index > 0}
          canMoveDown={index < session.exercises.length - 1}
          onMove={(by) => move(index, by)}
          onRemove={() => {
            if (window.confirm(`Remove ${exercise.snapshot.name} and its sets from this workout?`)) {
              void run(() => api.delete(`${base}/exercises/${exercise.id}`));
            }
          }}
          onSkip={(skipped) => void run(() => api.patch(`${base}/exercises/${exercise.id}`, { skipped }))}
          onSwap={(replacement) =>
            void run(() =>
              api.post(`${base}/exercises/${exercise.id}/swap`, {
                requestId: crypto.randomUUID(),
                exerciseId: replacement.id,
              }),
            )
          }
          busy={busy}
        />
        {next && (open || linked) && (
          <div className={clsx('flex justify-center', linked ? '-my-1' : 'py-0.5')}>
            {open ? (
              <button
                type="button"
                className={clsx(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                  linked ? 'text-train-pull hover:bg-train-pull/10' : 'text-ink-faint hover:bg-surface hover:text-ink',
                )}
                disabled={busy}
                onClick={() => relink(index, !linked)}
                aria-label={linked ? `Split the superset after ${exercise.snapshot.name}` : `Superset ${exercise.snapshot.name} with ${next.snapshot.name}`}
              >
                {linked ? <Unlink className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                {linked ? `Superset ${place?.label}` : 'Superset with next'}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-train-pull">
                <Link2 className="h-3.5 w-3.5" /> Superset {place?.label}
              </span>
            )}
          </div>
        )}
        </div>
        );
      })}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex min-h-[2.75rem] flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent/40 px-4 text-sm font-semibold text-accent transition-colors hover:border-accent hover:bg-accent/5"
          disabled={busy}
          onClick={() => setPicking(true)}
        >
          <Plus className="h-4 w-4" /> Add exercise
        </button>
        {!open && (
          <button type="button" className="btn-danger" disabled={busy} onClick={() => void discard()}>
            <Trash2 className="h-4 w-4" /> Delete workout
          </button>
        )}
      </div>

      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title="Add exercise"
        wide
      >
        <ExerciseSearch onPick={(exercise) => void addExercise(exercise)} autoFocus />
      </Modal>
    </div>
  );
}

function ExerciseBlock({
  session,
  exercise,
  state,
  superset,
  defaultRest,
  pending,
  canMoveUp,
  canMoveDown,
  onMove,
  onRemove,
  onSkip,
  onSwap,
  busy,
}: {
  session: SessionDetail;
  exercise: SessionExercise;
  /** Spec 025: done exercises collapse; the current one is marked. Finished workouts are all idle. */
  state: 'done' | 'current' | 'idle';
  superset?: SupersetPlace;
  defaultRest: number;
  pending: PendingSet[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onSkip: (skipped: boolean) => void;
  onSwap: (exercise: ExerciseListItem) => void;
  busy: boolean;
}) {
  const measure = exercise.snapshot.measure;
  const [editing, setEditing] = useState<WorkoutSet | null>(null);
  /** The exercise's details (how it is done, progress, rank, history), opened on a tab. */
  const [detail, setDetail] = useState<ExerciseDetailTab | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [editingRest, setEditingRest] = useState(false);
  /** A done exercise opened again, to look at it or add a set. Stays open until closed. */
  const [expanded, setExpanded] = useState(false);
  const unit = useWeightUnit();
  const estimate = exercise.oneRepMax && describeOneRepMax(exercise.oneRepMax, unit);
  /** A workout logged before #14 may name a machine; it is history, shown but never edited. */
  const machineLabel = [exercise.snapshot.machineName, exercise.snapshot.machineBrand].filter(Boolean).join(' · ');
  const done = exercise.sets.length + pending.length;
  const fromPlan = Boolean(exercise.planned);
  const canSwap = fromPlan && done === 0 && session.status === 'open';

  const log = (value: SetFormValue) => {
    const requestId = crypto.randomUUID();
    enqueue<PendingSet>({
      id: requestId,
      meta: { sessionId: session.id, workoutExerciseId: exercise.id, value },
      method: 'POST',
      path: `/training/sessions/${session.id}/exercises/${exercise.id}/sets`,
      body: { requestId, ...value },
      label: `Set · ${exercise.snapshot.name}`,
    });
  };

  const group = exerciseGroup(exercise.snapshot.primaryMuscles, measure);
  const style = GROUP_STYLES[group];
  const GroupIcon = style.icon;
  const targetCount = exercise.planned?.targets.length ?? 0;
  const complete = targetCount > 0 && done >= targetCount;
  const iconButton = 'flex h-9 w-9 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface hover:text-ink disabled:opacity-30';
  const isDone = state === 'done';
  const collapsed = isDone && !expanded;
  const rest = exerciseRest(exercise);
  const allSets = [...exercise.sets, ...pending.map((item) => item.value)];

  return (
    <section
      className={clsx(
        'card border-l-4 p-4 transition-colors',
        isDone ? 'border-l-emerald-500 bg-emerald-500/[0.06]' : style.edge,
        state === 'current' && 'ring-2 ring-train-pull/60',
        exercise.skipped && 'opacity-70',
        collapsed && 'py-3',
      )}
      aria-current={state === 'current' ? 'step' : undefined}
    >
      <header
        className={clsx('flex items-start gap-3', isDone && 'cursor-pointer')}
        onClick={isDone ? () => setExpanded((value) => !value) : undefined}
      >
        <span
          className={clsx(
            'flex shrink-0 items-center justify-center rounded-xl shadow-sm',
            collapsed ? 'h-9 w-9' : 'h-11 w-11',
            isDone ? 'bg-emerald-500 text-white' : style.solid,
          )}
          aria-hidden
        >
          {isDone ? <Check className="h-5 w-5" /> : <GroupIcon className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            {superset && (
              <span
                className="shrink-0 rounded-md bg-train-pull-solid px-1.5 py-0.5 text-[11px] font-bold leading-none text-white"
                title={`Superset ${superset.label}, exercise ${superset.position} of ${superset.size}`}
              >
                {superset.label}
                {superset.position}
              </span>
            )}
            <button
              type="button"
              className="truncate text-left underline decoration-ink-faint/50 decoration-dotted underline-offset-4 hover:decoration-ink"
              onClick={(event) => {
                event.stopPropagation();
                setDetail('about');
              }}
              aria-label={`${exercise.snapshot.name}: details, progress and rank`}
            >
              {exercise.snapshot.name}
            </button>
            {state === 'current' && (
              <span className="shrink-0 rounded-full bg-train-pull-solid px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Now
              </span>
            )}
          </h3>
          {collapsed ? (
            <p className="truncate text-xs text-ink-muted">
              {allSets.map((set) => describeSet(set, measure, unit)).join(', ')}
            </p>
          ) : (
          <p className="truncate text-xs">
            <span className={clsx('font-semibold', style.text)}>
              {exercise.snapshot.primaryMuscles.map(humanise).join(', ') || style.label}
            </span>
            <span className="text-ink-faint"> · {humanise(exercise.snapshot.equipmentType)}</span>
          </p>
          )}
        </div>
        {targetCount > 0 && !exercise.skipped && (
          <span
            className={clsx(
              'flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums',
              complete ? 'bg-emerald-500/15 text-emerald-400' : clsx(style.tint, style.text),
            )}
            aria-label={`${Math.min(done, targetCount)} of ${targetCount} planned sets done`}
          >
            {complete && <Check className="h-3.5 w-3.5" />}
            {Math.min(done, targetCount)}/{targetCount}
          </span>
        )}
        {isDone && (
          <span className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center text-ink-faint" aria-hidden>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        )}
      </header>
      {isDone && (
        <button type="button" className="sr-only" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? `Collapse ${exercise.snapshot.name}` : `Show ${exercise.snapshot.name} and add sets`}
        </button>
      )}
      {!collapsed && (
      <>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {machineLabel && <span className="text-xs text-ink-faint">On {machineLabel}</span>}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink"
            onClick={() => setEditingRest(true)}
            disabled={busy}
            aria-label={`Rest after ${exercise.snapshot.name}: ${formatDuration(rest ?? defaultRest)}. Change it`}
          >
            <Timer className="h-3.5 w-3.5" /> Rest {formatDuration(rest ?? defaultRest)}
          </button>
        </div>
        <div className="-mr-2 flex items-center">
          {canSwap && (
            <button type="button" className={iconButton} disabled={busy} onClick={() => setSwapping(true)} aria-label={`Swap ${exercise.snapshot.name}`} title="Swap for another exercise">
              <Repeat className="h-4 w-4" />
            </button>
          )}
          {fromPlan && session.status === 'open' && (
            <button
              type="button"
              className={clsx(iconButton, exercise.skipped && 'text-amber-400')}
              disabled={busy}
              onClick={() => onSkip(!exercise.skipped)}
              aria-label={exercise.skipped ? `Do ${exercise.snapshot.name} after all` : `Skip ${exercise.snapshot.name}`}
              title={exercise.skipped ? 'Un-skip' : 'Skip'}
            >
              <SkipForward className="h-4 w-4" />
            </button>
          )}
          <button type="button" className={iconButton} onClick={() => setDetail('progress')} aria-label={`${exercise.snapshot.name} progress and history`} title="Progress, rank and history">
            <HistoryIcon className="h-4 w-4" />
          </button>
          <button type="button" className={iconButton} disabled={!canMoveUp || busy} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" className={iconButton} disabled={!canMoveDown || busy} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" className={clsx(iconButton, 'hover:text-rose-400')} disabled={busy} onClick={onRemove} aria-label="Remove exercise">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <Modal open={swapping} onClose={() => setSwapping(false)} title={`Swap ${exercise.snapshot.name}`} wide>
        <ExerciseSearch
          autoFocus
          onPick={(replacement) => {
            setSwapping(false);
            onSwap(replacement);
          }}
        />
      </Modal>
      {editingRest && (
        <RestEditor session={session} exercise={exercise} defaultSeconds={defaultRest} onClose={() => setEditingRest(false)} />
      )}
      <LoadHint exerciseId={exercise.exerciseId} />
      {exercise.planned && (
        <p className="mb-2 mt-1 text-xs text-ink-faint">
          {[
            `Plan: ${exercise.planned.targets.length} sets`,
            exercise.planned.note ?? '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {exercise.previous && (
        <p className="mb-2 text-xs text-ink-faint">
          Last time ({formatDay(exercise.previous.day)}):{' '}
          {exercise.previous.sets.map((set) => describeSet(set, measure, unit)).join(', ')}
        </p>
      )}
      <SetTable
        exercise={exercise}
        pending={pending.map((item) => item.value)}
        onLog={log}
        onEdit={setEditing}
      />
      {estimate && (
        <p className="mt-2 px-2 text-xs">
          <span className="font-medium">{estimate.value}</span>
          <span className="text-ink-faint"> · {estimate.basis}</span>
        </p>
      )}
      {exercise.skipped && (
        <p className="mt-2 text-sm text-ink-faint">
          Skipped.{' '}
          <button type="button" className="underline" disabled={busy} onClick={() => onSkip(false)}>
            Do it after all
          </button>
        </p>
      )}
      </>
      )}
      {detail && <ExerciseDetail id={exercise.exerciseId} initialTab={detail} onClose={() => setDetail(null)} />}
      {editing && (
        <EditSet set={editing} measure={measure} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

/**
 * How to enter the weight for this exercise (per dumbbell, the bar and plates, one stack…), from
 * its rank standard, so a set is logged the way its rank reads it. Nothing for other exercises.
 */
function LoadHint({ exerciseId }: { exerciseId: string }) {
  const { data } = useApi<ExerciseListItem>(`/training/exercises/${exerciseId}`);
  if (!data?.loadNote) return null;
  return <p className="mt-1 text-xs text-ink-faint">Weight: {data.loadNote}</p>;
}

function EditSet({
  set,
  measure,
  onClose,
}: {
  set: WorkoutSet;
  measure: SessionExercise['snapshot']['measure'];
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      await revalidateTraining();
      onClose();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setPending(false);
    }
  };
  const save = (value: SetFormValue) => {
    // Every field the measure allows is sent, `null` for an emptied one, so clearing works.
    const body: Record<string, unknown> = { type: value.type, rpe: value.rpe ?? null };
    for (const field of setFieldsFor(measure).allowed) body[field] = value[field] ?? null;
    return act(() => api.patch(`/training/sets/${set.id}`, body));
  };
  return (
    <Modal open onClose={onClose} title="Edit set" error={error}>
      <SetForm measure={measure} initial={set} submitLabel="Save" onSubmit={save} pending={pending} />
      <button
        type="button"
        className="btn-danger"
        disabled={pending}
        onClick={() => void act(() => api.delete(`/training/sets/${set.id}`))}
      >
        <Trash2 className="h-4 w-4" /> Delete set
      </button>
    </Modal>
  );
}

