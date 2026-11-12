'use client';

import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, History as HistoryIcon, Plus, Repeat, SkipForward, Trash2 } from 'lucide-react';
import type {
  ExerciseListItem,
  SessionDetail,
  SessionExercise,
  WorkoutSet,
} from '@life-portal/shared-types';
import { formatDay, setFieldsFor } from '@life-portal/shared-domain';
import { EmptyState, ErrorNote, Modal, Panel, Spinner, Textarea } from '../ui';
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
      <Panel>
        <EmptyState
          message="No workout in progress."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-primary" disabled={starting} onClick={() => void start()}>
                {starting ? 'Starting…' : 'Start empty workout'}
              </button>
              {onBrowsePlans && (
                <button type="button" className="btn-ghost" onClick={onBrowsePlans}>
                  Choose a plan
                </button>
              )}
            </div>
          }
        />
        {startError && <div className="mt-3"><ErrorNote message={startError} /></div>}
      </Panel>
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

  return (
    <div className="space-y-4">
      <Panel
        title={
          session.plan
            ? `${session.plan.workoutName} · ${session.plan.planName}`
            : open
              ? 'Workout in progress'
              : `Workout · ${formatDay(session.day)}`
        }
        description={`${formatDay(session.day)} · ${formatDuration(elapsed)}${open ? '' : ' · finished'}`}
        actions={
          open ? (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void finish('now')}>
              Finish
            </button>
          ) : undefined
        }
      >
        {session.isStale && (
          <div className="mb-3 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
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
          <p className="mb-3 text-xs text-amber-400">No connection: sets are kept and sent when it is back.</p>
        )}
        {queue.error && (
          <div className="mb-3">
            <ErrorNote message={queue.error} />
            <button type="button" className="mt-1 text-xs text-ink-faint underline" onClick={clearQueueError}>
              Dismiss
            </button>
          </div>
        )}
        {error && <div className="mb-3"><ErrorNote message={error} /></div>}
        {open && <RestTimer since={session.lastSetAt} seconds={restSeconds} />}
        <Textarea
          className="mt-3"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={saveNotes}
          placeholder="Notes"
          rows={2}
          maxLength={2000}
          aria-label="Workout notes"
        />
      </Panel>

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
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setPicking(true)}>
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

  return (
    <Panel
      title={exercise.snapshot.name}
      description={[
        exercise.snapshot.primaryMuscles.map(humanise).join(', '),
        humanise(exercise.snapshot.equipmentType),
      ]
        .filter(Boolean)
        .join(' · ')}
      actions={
        <>
          {canSwap && (
            <button type="button" className="text-ink-faint hover:text-ink" disabled={busy} onClick={() => setSwapping(true)} aria-label={`Swap ${exercise.snapshot.name}`} title="Swap for another exercise">
              <Repeat className="h-4 w-4" />
            </button>
          )}
          {fromPlan && session.status === 'open' && (
            <button
              type="button"
              className={clsx('hover:text-ink', exercise.skipped ? 'text-amber-400' : 'text-ink-faint')}
              disabled={busy}
              onClick={() => onSkip(!exercise.skipped)}
              aria-label={exercise.skipped ? `Do ${exercise.snapshot.name} after all` : `Skip ${exercise.snapshot.name}`}
              title={exercise.skipped ? 'Un-skip' : 'Skip'}
            >
              <SkipForward className="h-4 w-4" />
            </button>
          )}
          <button type="button" className="text-ink-faint hover:text-ink" onClick={() => setShowHistory(true)} aria-label={`${exercise.snapshot.name} history`}>
            <HistoryIcon className="h-4 w-4" />
          </button>
          <button type="button" className="text-ink-faint hover:text-ink disabled:opacity-30" disabled={!canMoveUp || busy} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp className="h-4 w-4" />
          </button>
          <button type="button" className="text-ink-faint hover:text-ink disabled:opacity-30" disabled={!canMoveDown || busy} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown className="h-4 w-4" />
          </button>
          <button type="button" className="text-ink-faint hover:text-rose-400" disabled={busy} onClick={onRemove} aria-label="Remove exercise">
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      }
    >
      <button
        type="button"
        className="mb-2 text-xs text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink"
        onClick={() => setChoosingMachine(true)}
        disabled={busy}
      >
        {machineLabel ? `Machine: ${machineLabel}` : 'Choose machine'}
      </button>
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
        <p className="mb-2 text-xs text-ink-faint">
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
    </Panel>
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

