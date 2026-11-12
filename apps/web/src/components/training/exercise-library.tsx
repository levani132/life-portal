'use client';

import clsx from 'clsx';
import { useState } from 'react';
import useSWR from 'swr';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Exercise, Machine, TrainingDeleteResult } from '@life-portal/shared-types';
import { EmptyState, ErrorNote, Modal, Panel, Spinner } from '../ui';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { MEASURE_LABELS, humanise, revalidateTraining } from '../../lib/training';
import { ExerciseForm } from './exercise-form';
import { ExerciseHistory } from './exercise-history';
import { ExerciseSearch } from './exercise-picker';
import { MachineForm } from './machine-form';

type View = 'exercises' | 'machines';

/** The Exercises tab: browse the catalogue and your own exercises, and manage your machines. */
export function ExerciseLibrary() {
  const [view, setView] = useState<View>('exercises');
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-border p-1 text-sm" data-no-tab-swipe>
        {(['exercises', 'machines'] as View[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setView(item)}
            className={clsx(
              'flex-1 rounded-md px-3 py-1.5',
              view === item ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink',
            )}
          >
            {item === 'exercises' ? 'Exercises' : 'My machines'}
          </button>
        ))}
      </div>
      {view === 'exercises' ? (
        <Panel title="Exercises" description="Search the catalogue, or create your own.">
          <ExerciseSearch onPick={(exercise) => setOpenId(exercise.id)} />
        </Panel>
      ) : (
        <MachineList />
      )}
      {openId && <ExerciseDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ExerciseDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: exercise, error } = useApi<Exercise>(`/training/exercises/${id}`);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const remove = async () => {
    if (!exercise || !window.confirm(`Delete ${exercise.name}?`)) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.delete<TrainingDeleteResult>(`/training/exercises/${id}`);
      await revalidateTraining();
      if ('archived' in result) {
        window.alert('It is in past workouts, so it was archived: hidden from search, kept in your history.');
      }
      onClose();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not delete it.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={!editing} onClose={onClose} title={exercise?.name ?? 'Exercise'} wide>
        {error && <ErrorNote message={(error as Error).message} />}
        {!exercise && !error && <Spinner />}
        {exercise && (
          <div className="space-y-3 text-sm">
            {exercise.image && (
              <img src={exercise.image.url} alt="" className="max-h-64 w-full rounded-xl object-cover" />
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-ink-faint">Main muscles</dt>
              <dd>{exercise.primaryMuscles.map(humanise).join(', ') || '—'}</dd>
              {exercise.secondaryMuscles.length > 0 && (
                <>
                  <dt className="text-ink-faint">Also works</dt>
                  <dd>{exercise.secondaryMuscles.map(humanise).join(', ')}</dd>
                </>
              )}
              <dt className="text-ink-faint">Equipment</dt>
              <dd>{humanise(exercise.equipmentType)}</dd>
              <dt className="text-ink-faint">Measured by</dt>
              <dd>{MEASURE_LABELS[exercise.measure]}</dd>
              {exercise.mechanic && (
                <>
                  <dt className="text-ink-faint">Type</dt>
                  <dd>{humanise(exercise.mechanic)}</dd>
                </>
              )}
              {exercise.level && (
                <>
                  <dt className="text-ink-faint">Level</dt>
                  <dd>{humanise(exercise.level)}</dd>
                </>
              )}
              {exercise.aliases.length > 0 && (
                <>
                  <dt className="text-ink-faint">Also called</dt>
                  <dd>{exercise.aliases.join(', ')}</dd>
                </>
              )}
            </dl>
            {exercise.instructions && exercise.instructions.length > 0 && (
              <ol className="list-decimal space-y-1 pl-5 text-ink-muted">
                {exercise.instructions.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            )}
            {exercise.archived && <p className="text-xs text-amber-400">Archived: kept for past workouts, hidden from search.</p>}
            {exercise.attribution && (
              <p className="text-[11px] text-ink-faint">
                <a href={exercise.attribution.url} target="_blank" rel="noreferrer" className="underline">
                  {exercise.attribution.label}
                </a>
              </p>
            )}
            {actionError && <ErrorNote message={actionError} />}
            {exercise.isOwn && !exercise.archived && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> Edit
                </button>
                <button type="button" className="btn-danger" disabled={busy} onClick={() => void remove()}>
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            )}
            <section className="border-t border-border pt-3">
              <h4 className="mb-2 text-sm font-semibold">Your history</h4>
              <ExerciseHistory exerciseId={exercise.id} />
            </section>
          </div>
        )}
      </Modal>
      {editing && exercise && <ExerciseForm open exercise={exercise} onClose={() => setEditing(false)} />}
    </>
  );
}

function MachineList() {
  const { data, error, isLoading } = useApi<Machine[]>('/training/machines');
  const [editing, setEditing] = useState<Machine | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Names for the linked exercises, so the edit form can show them as chips.
  const ids = [...new Set((data ?? []).flatMap((machine) => machine.exerciseIds))];
  // Keyed under /training so revalidateTraining() refreshes it after an edit.
  const names = useSWR(
    ids.length ? `/training/machines#names:${ids.join(',')}` : null,
    () => Promise.all(ids.map((id) => api.get<Exercise>(`/training/exercises/${id}`))),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const nameOf = Object.fromEntries((names.data ?? []).map((exercise) => [exercise.id, exercise.name]));

  const remove = async (machine: Machine) => {
    if (!window.confirm(`Delete ${machine.name}?`)) return;
    setActionError(null);
    try {
      await api.delete(`/training/machines/${machine.id}`);
      await revalidateTraining();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Could not delete it.');
    }
  };

  return (
    <Panel
      title="My machines"
      description="Specific machines at your gym. Only you see them."
      actions={
        <button type="button" className="btn-ghost" onClick={() => setEditing('new')}>
          <Plus className="h-4 w-4" /> Add
        </button>
      }
    >
      {isLoading && <Spinner />}
      {error && <ErrorNote message={(error as Error).message} />}
      {actionError && <ErrorNote message={actionError} />}
      {data && !data.length && <EmptyState message="No machines yet. Add one, or pick “New machine” while logging." />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-border">
          {data.map((machine) => (
            <li key={machine.id} className="flex items-center gap-3 py-2.5">
              {machine.image ? (
                <img src={machine.image.url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="h-12 w-12 shrink-0 rounded-lg border border-border bg-surface" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{machine.name}</span>
                <span className="block truncate text-xs text-ink-faint">
                  {[machine.brand, humanise(machine.equipmentType), machine.exerciseIds.map((id) => nameOf[id]).filter(Boolean).join(', ')]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <button type="button" className="text-ink-faint hover:text-ink" aria-label={`Edit ${machine.name}`} onClick={() => setEditing(machine)}>
                <Pencil className="h-4 w-4" />
              </button>
              <button type="button" className="text-ink-faint hover:text-rose-400" aria-label={`Delete ${machine.name}`} onClick={() => void remove(machine)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <MachineForm
          key={editing === 'new' ? 'new' : `${editing.id}:${Object.keys(nameOf).length}`}
          open
          machine={editing === 'new' ? undefined : editing}
          exerciseNames={nameOf}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}
