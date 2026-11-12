'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ClipboardList,
  Dumbbell,
  History as HistoryIcon,
  Layers,
  Play,
  Plus,
  Repeat,
  SkipForward,
  Timer,
  Trash2,
} from 'lucide-react';
import type {
  ExerciseListItem,
  SessionDetail,
  SessionExercise,
  WorkoutSet,
} from '@life-portal/shared-types';
import { formatDay, setFieldsFor } from '@life-portal/shared-domain';
import { ErrorNote, Modal, Spinner, Textarea } from '../ui';
import { api, ApiError } from '../../lib/api';
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
import { ExerciseHistory } from './exercise-history';
import { ExerciseSearch, MachineChoice } from './exercise-picker';
import { SuggestedPlans } from './plan-suggestions';
import { GROUP_STYLES, exerciseGroup, usePlanStyle } from '../../lib/training-colors';
import { RestTimer } from './rest-timer';
import { SetForm, SetLine, type SetFormValue } from './set-row';
import { SuggestionRows, suggestionValue } from './suggestion-row';

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
 * One session, open or finished: exercises in order, their sets, a form for the next set, and
 * the session's own controls. Finished sessions stay editable (spec 020, story 1 #5).
 */
export function WorkoutSession({ session, onGone }: { session: SessionDetail; onGone?: () => void }) {
  const open = session.status === 'open';
  const now = useNow(open);
  const planStyle = usePlanStyle(session.plan?.planId);
  const profile = useTrainingProfile();
  const queue = useTrainingQueue();
  const [picking, setPicking] = useState(false);
  /** Step two of adding: the exercise is chosen, the machine is not yet. */
  const [chosen, setChosen] = useState<ExerciseListItem | null>(null);
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
  const addExercise = async (exercise: ExerciseListItem, machineId: string | null) => {
    setPicking(false);
    setChosen(null);
    await run(() =>
      api.post(`${base}/exercises`, {
        requestId: crypto.randomUUID(),
        exerciseId: exercise.id,
        ...(machineId ? { machineId } : {}),
      }),
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

  // The rest after a set from a plan is the plan's rest for that exercise (spec 023).
  const lastSetExercise = session.lastSetAt
    ? session.exercises.find((exercise) => exercise.sets.some((set) => set.loggedAt === session.lastSetAt))
    : undefined;
  const restSeconds = lastSetExercise?.planned?.restSeconds ?? profile.defaultRestSeconds;

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
          {queue.offline && <p className="text-xs text-amber-400">No connection: sets are kept and sent when it is back.</p>}
          {queue.error && (
            <div>
              <ErrorNote message={queue.error} />
              <button type="button" className="mt-1 text-xs text-ink-faint underline" onClick={clearQueueError}>
                Dismiss
              </button>
            </div>
          )}
          {error && <ErrorNote message={error} />}
          {open && <RestTimer since={session.lastSetAt} seconds={restSeconds} />}
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

      {session.exercises.map((exercise, index) => (
        <ExerciseBlock
          key={exercise.id}
          session={session}
          exercise={exercise}
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
      ))}

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
        onClose={() => {
          setPicking(false);
          setChosen(null);
        }}
        title={chosen ? 'Which machine?' : 'Add exercise'}
        wide
      >
        {chosen ? (
          <MachineChoice exercise={chosen} onChoose={(machineId) => void addExercise(chosen, machineId)} />
        ) : (
          <ExerciseSearch onPick={setChosen} autoFocus />
        )}
      </Modal>
    </div>
  );
}

function ExerciseBlock({
  session,
  exercise,
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
  const [choosingMachine, setChoosingMachine] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const unit = useWeightUnit();
  const estimate = exercise.oneRepMax && describeOneRepMax(exercise.oneRepMax, unit);
  const [machineError, setMachineError] = useState<string | null>(null);
  const machineLabel = [exercise.snapshot.machineName, exercise.snapshot.machineBrand].filter(Boolean).join(' · ');

  const setMachine = async (machineId: string | null) => {
    setChoosingMachine(false);
    setMachineError(null);
    if (machineId === (exercise.machineId ?? null)) return;
    try {
      await api.patch(`/training/sessions/${session.id}/exercises/${exercise.id}`, { machineId });
      await revalidateTraining();
    } catch (caught) {
      setMachineError(caught instanceof ApiError ? caught.message : 'Could not change the machine.');
    }
  };
  const done = exercise.sets.length + pending.length;
  // Start the next set from the last one logged, else from the same set last time.
  const lastValue = pending.length ? pending[pending.length - 1].value : exercise.sets[exercise.sets.length - 1];
  // From a plan (spec 023): the open targets still to do, after any sets waiting to be sent.
  const suggestions = exercise.openTargets.slice(pending.length);
  const next = suggestions[0] ? suggestionValue(exercise, suggestions[0], done, lastValue) : undefined;
  const initial: Partial<WorkoutSet> | undefined =
    next?.value ?? lastValue ?? exercise.previous?.sets[done] ?? exercise.previous?.sets[exercise.previous.sets.length - 1];
  const fromPlan = Boolean(exercise.planned);
  const canSwap = fromPlan && done === 0 && session.status === 'open';

  const log = (value: SetFormValue) => {
    const requestId = crypto.randomUUID();
    enqueue<PendingSet>({
      id: requestId,
      meta: { sessionId: session.id, workoutExerciseId: exercise.id, value },
      run: () =>
        api.post(`/training/sessions/${session.id}/exercises/${exercise.id}/sets`, { requestId, ...value }),
      onDone: () => revalidateTraining(),
    });
  };

  const group = exerciseGroup(exercise.snapshot.primaryMuscles, measure);
  const style = GROUP_STYLES[group];
  const GroupIcon = style.icon;
  const targetCount = exercise.planned?.targets.length ?? 0;
  const complete = targetCount > 0 && done >= targetCount;
  const iconButton = 'flex h-9 w-9 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface hover:text-ink disabled:opacity-30';

  return (
    <section className={clsx('card border-l-4 p-4', style.edge, exercise.skipped && 'opacity-70')}>
      <header className="flex items-start gap-3">
        <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm', style.solid)} aria-hidden>
          <GroupIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold">{exercise.snapshot.name}</h3>
          <p className="truncate text-xs">
            <span className={clsx('font-semibold', style.text)}>
              {exercise.snapshot.primaryMuscles.map(humanise).join(', ') || style.label}
            </span>
            <span className="text-ink-faint"> · {humanise(exercise.snapshot.equipmentType)}</span>
          </p>
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
      </header>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
        <button
          type="button"
          className="text-xs text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink"
          onClick={() => setChoosingMachine(true)}
          disabled={busy}
        >
          {machineLabel ? `Machine: ${machineLabel}` : 'Choose machine'}
        </button>
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
          <button type="button" className={iconButton} onClick={() => setShowHistory(true)} aria-label={`${exercise.snapshot.name} history`}>
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
      {machineError && <ErrorNote message={machineError} />}
      <Modal open={choosingMachine} onClose={() => setChoosingMachine(false)} title="Which machine?">
        <MachineChoice
          exercise={{ id: exercise.exerciseId, name: exercise.snapshot.name, equipmentType: exercise.snapshot.equipmentType }}
          currentId={exercise.machineId ?? ''}
          onChoose={(machineId) => void setMachine(machineId)}
        />
      </Modal>
      <Modal open={showHistory} onClose={() => setShowHistory(false)} title={exercise.snapshot.name} wide>
        <ExerciseHistory exerciseId={exercise.exerciseId} />
      </Modal>
      <Modal open={swapping} onClose={() => setSwapping(false)} title={`Swap ${exercise.snapshot.name}`} wide>
        <ExerciseSearch
          autoFocus
          onPick={(replacement) => {
            setSwapping(false);
            onSwap(replacement);
          }}
        />
      </Modal>
      {exercise.planned && (
        <p className="mb-2 mt-1 text-xs text-ink-faint">
          {[
            `Plan: ${exercise.planned.targets.length} sets`,
            exercise.planned.restSeconds != null ? `rest ${formatDuration(exercise.planned.restSeconds)}` : '',
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
      <div className="mb-3">
        {exercise.sets.map((set, index) => (
          <SetLine key={set.id} index={index + 1} set={set} measure={measure} onClick={() => setEditing(set)} />
        ))}
        {pending.map((item, index) => (
          <SetLine key={`pending-${index}`} index={exercise.sets.length + index + 1} set={item.value} measure={measure} pending />
        ))}
        {estimate && (
          <p className="mt-1 px-2 text-xs">
            <span className="font-medium">{estimate.value}</span>
            <span className="text-ink-faint"> · {estimate.basis}</span>
          </p>
        )}
      </div>
      {exercise.skipped ? (
        <p className="text-sm text-ink-faint">
          Skipped.{' '}
          <button type="button" className="underline" disabled={busy} onClick={() => onSkip(false)}>
            Do it after all
          </button>
        </p>
      ) : (
        <>
          <SuggestionRows
            measure={measure}
            targets={suggestions}
            firstIndex={done + 1}
            first={next}
            onLog={log}
          />
          <SetForm key={`${done}:${suggestions.length}`} measure={measure} initial={initial} submitLabel="Log set" onSubmit={log} />
        </>
      )}
      {editing && (
        <EditSet set={editing} measure={measure} onClose={() => setEditing(null)} />
      )}
    </section>
  );
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

