'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  CATALOGUE_CREDIT,
  EQUIPMENT_TYPES,
  MUSCLES,
  type Exercise,
  type ExerciseListItem,
  type ExerciseRankBadge,
  type Muscle,
  type PortalState,
} from '@life-portal/shared-types';
import { matchesExerciseSearch } from '@life-portal/shared-domain';
import { EmptyState, ErrorNote, Input, Select, Spinner } from '../ui';
import { NetworkError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { OFFLINE_EXERCISES_KEY } from '../../lib/training-offline';
import { MEASURE_LABELS, humanise, useWorkoutDay } from '../../lib/training';
import { GROUP_ORDER, GROUP_STYLES, exerciseGroup, muscleGroup, type GroupStyle } from '../../lib/training-colors';
import { ExerciseForm } from './exercise-form';
import { MuscleFigure, hasMuscleFigure } from './muscle-figure';
import { RankEmblem } from './rank-emblem';

/** Debounced so typing "bench" sends one request, not five. */
function useDebounced(value: string, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Spec 028: with no connection the search runs over the exercises kept on this device (own,
 * recent and those in plans). Everything else is unavailable until the connection is back.
 */
function searchOffline(
  list: ExerciseListItem[],
  { q, muscle, equipment }: { q: string; muscle: string; equipment: string },
): ExerciseListItem[] {
  return list.filter(
    (exercise) =>
      (!muscle || exercise.primaryMuscles.includes(muscle as never)) &&
      (!equipment || exercise.equipmentType === equipment) &&
      matchesExerciseSearch(exercise.searchName ?? exercise.name, q),
  );
}

/** Muscles as filter chips, grouped by colour so a row of push muscles reads as one. */
const MUSCLE_CHIPS = [...MUSCLES].sort(
  (a, b) => GROUP_ORDER.indexOf(muscleGroup(a)) - GROUP_ORDER.indexOf(muscleGroup(b)),
);

/**
 * What leads an exercise's row: its muscle figure, the targeted muscles lit in the group colour.
 * With a strength rank, the figure moves inside the rank's emblem (one mark for rank and muscle);
 * an inactive rank (the highest ever, not kept up) is greyed. Cardio and exercises with no muscle
 * keep the group's icon.
 */
function ExerciseMark({ style, muscles, rank }: { style: GroupStyle; muscles: readonly Muscle[]; rank?: ExerciseRankBadge }) {
  const Icon = style.icon;
  if (rank) {
    return (
      <span className="flex h-11 w-10 shrink-0 items-center justify-center">
        <RankEmblem
          tier={rank.tier}
          division={rank.division}
          size={38}
          muted={rank.status === 'inactive'}
          muscles={muscles}
          label={`${rank.tier} ${rank.division}${rank.status === 'inactive' ? ', inactive' : ''}`}
        />
      </span>
    );
  }
  return (
    <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', style.tint, style.text)} aria-hidden>
      {hasMuscleFigure(muscles) ? (
        <MuscleFigure muscles={muscles} lit="currentColor" dim="color-mix(in srgb, currentColor 30%, rgb(var(--surface-raised)))" gap="rgb(var(--surface-raised))" className="h-[34px] w-[34px]" />
      ) : (
        <Icon className="h-5 w-5" />
      )}
    </span>
  );
}

/**
 * Searches the catalogue (shared exercises plus the person's own). The server ranks: names that
 * start with the query first, then exercises used in the last 90 days, then by name. Filters
 * narrow by main muscle and equipment; "Create exercise" covers what the catalogue lacks.
 *
 * Picking is the whole choice (#14): an exercise's name says its equipment ("Butterfly
 * (Machine)"), and equipment is a filter and a label here, never a second question.
 */
export function ExerciseSearch({
  onPick,
  autoFocus,
  allowCreate = true,
}: {
  onPick?: (exercise: ExerciseListItem) => void;
  autoFocus?: boolean;
  allowCreate?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState('');
  const [equipment, setEquipment] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useDebounced(query.trim());
  const params = new URLSearchParams({ limit: '50' });
  if (q) params.set('q', q);
  if (muscle) params.set('muscle', muscle);
  if (equipment) params.set('equipment', equipment);
  const search = useApi<ExerciseListItem[]>(`/training/exercises?${params}`);
  // Read whenever the picker is open, so the device copy is fresh for the next offline workout.
  const saved = useApi<ExerciseListItem[]>(OFFLINE_EXERCISES_KEY, { shouldRetryOnError: false });
  const offline = search.error instanceof NetworkError;
  const data = offline ? (saved.data ? searchOffline(saved.data, { q, muscle, equipment }) : undefined) : search.data;
  const error = offline ? (saved.data ? undefined : search.error) : search.error;
  const isLoading = search.isLoading && !data;
  const canCreate = allowCreate && !offline;
  // Strength ranks (#5b) mark the rows of ranked exercises. Decoration: the list never waits for it.
  const portal = useApi<PortalState>('/portal');
  const today = useWorkoutDay()();
  const ranks = useApi<ExerciseRankBadge[]>(portal.data?.access.trainingRanks ? `/training/ranks?today=${today}` : null, {
    shouldRetryOnError: false,
  });
  const rankOf = new Map((ranks.data ?? []).map((rank) => [rank.exerciseId, rank]));

  return (
    <div className="space-y-3">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search exercises"
        aria-label="Search exercises"
        autoFocus={autoFocus}
      />
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" data-no-tab-swipe role="group" aria-label="Muscle">
        <button
          type="button"
          aria-pressed={!muscle}
          onClick={() => setMuscle('')}
          className={clsx(
            'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
            !muscle ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink-muted hover:text-ink',
          )}
        >
          All
        </button>
        {MUSCLE_CHIPS.map((item) => {
          const style = GROUP_STYLES[muscleGroup(item)];
          const selected = muscle === item;
          return (
            <button
              key={item}
              type="button"
              aria-pressed={selected}
              onClick={() => setMuscle(selected ? '' : item)}
              className={clsx(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                selected ? clsx('border-transparent', style.solid) : clsx(style.border, style.tint, style.text),
              )}
            >
              {!selected && <span className={clsx('h-1.5 w-1.5 rounded-full', style.dot)} aria-hidden />}
              {humanise(item)}
            </button>
          );
        })}
      </div>
      <Select value={equipment} onChange={(event) => setEquipment(event.target.value)} aria-label="Equipment">
        <option value="">All equipment</option>
        {EQUIPMENT_TYPES.map((item) => (
          <option key={item} value={item}>
            {humanise(item)}
          </option>
        ))}
      </Select>
      {offline && saved.data && (
        <p className="text-xs text-warning">
          No connection: showing the exercises saved on this device (yours, recent and in your plans). Others are
          unavailable offline.
        </p>
      )}
      {canCreate && (
        <button type="button" className="btn-ghost w-full justify-center" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Create exercise{q ? ` “${query.trim()}”` : ''}
        </button>
      )}
      {isLoading && <Spinner />}
      {error && (
        <ErrorNote
          message={offline ? 'No connection, and no exercises are saved on this device yet.' : (error as Error).message}
        />
      )}
      {data && !data.length && (
        <EmptyState
          message={
            offline
              ? 'Nothing saved on this device matches. It is unavailable until the connection is back.'
              : q || muscle || equipment
                ? 'Nothing matches. Create it instead?'
                : 'No exercises yet.'
          }
        />
      )}
      {data && data.length > 0 && (
        <ul className="space-y-1.5">
          {data.map((exercise) => {
            const style = GROUP_STYLES[exerciseGroup(exercise.primaryMuscles, exercise.measure)];
            return (
              <li key={exercise.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-xl px-1 py-2 text-left transition-colors enabled:hover:bg-surface disabled:cursor-default"
                  onClick={() => onPick?.(exercise)}
                  disabled={!onPick}
                >
                  <ExerciseMark
                    style={style}
                    muscles={exercise.measure === 'distance_duration' ? [] : exercise.primaryMuscles}
                    rank={rankOf.get(exercise.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{exercise.name}</span>
                    <span className="block truncate text-xs">
                      <span className={clsx('font-medium', style.text)}>{exercise.primaryMuscles.map(humanise).join(', ') || style.label}</span>
                      <span className="text-ink-faint">
                        {' · '}
                        {humanise(exercise.equipmentType)} · {MEASURE_LABELS[exercise.measure]}
                      </span>
                    </span>
                  </span>
                  {(exercise.isOwn || exercise.recent) && (
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {exercise.isOwn && (
                        <span className="rounded-full bg-ink-faint/10 px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">yours</span>
                      )}
                      {exercise.recent && (
                        <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent">recent</span>
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] text-ink-faint">
        <a href={CATALOGUE_CREDIT.url} target="_blank" rel="noreferrer" className="underline">
          {CATALOGUE_CREDIT.label}
        </a>
      </p>
      {creating && (
        <ExerciseForm
          open
          initialName={query.trim()}
          onClose={() => setCreating(false)}
          onSaved={(saved: Exercise) => onPick?.(saved)}
        />
      )}
    </div>
  );
}
