'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { Exercise, PortalState, TrainingDeleteResult } from '@life-portal/shared-types';
import { ErrorNote, Modal, Spinner } from '../ui';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { MEASURE_LABELS, humanise, revalidateTraining } from '../../lib/training';
import { ExerciseForm } from './exercise-form';
import { ExerciseHistory } from './exercise-history';

export type ExerciseDetailTab = 'about' | 'progress' | 'rank' | 'history';

const TAB_LABELS: Record<ExerciseDetailTab, string> = {
  about: 'About',
  progress: 'Progress',
  rank: 'Rank',
  history: 'History',
};

/**
 * Everything about one exercise, in tabs so nothing hides below a scroll: what it is and how it
 * is done, your progress, your rank and tournament, and your past sessions. Opened from the
 * Exercises tab and from an exercise inside a workout.
 */
export function ExerciseDetail({
  id,
  onClose,
  initialTab = 'about',
}: {
  id: string;
  onClose: () => void;
  initialTab?: ExerciseDetailTab;
}) {
  const [tab, setTab] = useState<ExerciseDetailTab>(initialTab);
  const portal = useApi<PortalState>('/portal');
  const access = portal.data?.access;
  // The Rank tab holds the tournament too; without ranks there is neither.
  const tabs: ExerciseDetailTab[] = access?.trainingRanks ? ['about', 'progress', 'rank', 'history'] : ['about', 'progress', 'history'];
  const shown = tabs.includes(tab) ? tab : 'about';
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
          <div className="space-y-3">
            <div className="flex gap-1 rounded-xl bg-surface p-1 text-sm" role="tablist" data-no-tab-swipe>
              {tabs.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={shown === item}
                  onClick={() => setTab(item)}
                  className={clsx(
                    'flex-1 rounded-lg px-1 py-2 font-semibold transition-colors',
                    shown === item ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {TAB_LABELS[item]}
                </button>
              ))}
            </div>
            {shown === 'about' && (
            <div className="space-y-3 text-sm" role="tabpanel">
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
            </div>
            )}
            {shown === 'progress' && <div role="tabpanel"><ExerciseHistory exerciseId={exercise.id} section="progress" /></div>}
            {shown === 'rank' && <div role="tabpanel"><ExerciseHistory exerciseId={exercise.id} section="rank" /></div>}
            {shown === 'history' && <div role="tabpanel"><ExerciseHistory exerciseId={exercise.id} section="sessions" /></div>}
          </div>
        )}
      </Modal>
      {editing && exercise && <ExerciseForm open exercise={exercise} onClose={() => setEditing(false)} />}
    </>
  );
}
