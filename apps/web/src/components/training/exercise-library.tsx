'use client';

import clsx from 'clsx';
import { useState } from 'react';
import useSWR from 'swr';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { Exercise, Machine } from '@life-portal/shared-types';
import { EmptyState, ErrorNote, Panel, Spinner } from '../ui';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { humanise, revalidateTraining } from '../../lib/training';
import { ExerciseDetail } from './exercise-detail';
import { ExerciseSearch } from './exercise-picker';
import { MachineForm } from './machine-form';

type View = 'exercises' | 'machines';

/** The Exercises tab: browse the catalogue and your own exercises, and manage your machines. */
export function ExerciseLibrary() {
  const [view, setView] = useState<View>('exercises');
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl bg-surface p-1 text-sm" data-no-tab-swipe>
        {(['exercises', 'machines'] as View[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setView(item)}
            className={clsx(
              'flex-1 rounded-lg px-3 py-2 font-semibold transition-colors',
              view === item ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
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
