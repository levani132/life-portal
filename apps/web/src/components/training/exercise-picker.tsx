'use client';

import { useEffect, useState } from 'react';
import { CATALOGUE_CREDIT, type ExerciseListItem } from '@life-portal/shared-types';
import { EmptyState, ErrorNote, Input, Spinner } from '../ui';
import { useApi } from '../../lib/hooks';
import { MEASURE_LABELS, humanise } from '../../lib/training';

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
 * Searches the catalogue (shared exercises plus the person's own). Basic in this MVP: name
 * search, alphabetical. Ranking by recent use, filters and creating exercises come with
 * spec 020's user story 2.
 */
export function ExerciseSearch({
  onPick,
  autoFocus,
}: {
  onPick?: (exercise: ExerciseListItem) => void;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  const { data, error, isLoading } = useApi<ExerciseListItem[]>(
    `/training/exercises?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
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
      {isLoading && <Spinner />}
      {error && <ErrorNote message={(error as Error).message} />}
      {data && !data.length && <EmptyState message={q ? `Nothing matches “${q}”.` : 'No exercises yet.'} />}
      {data && data.length > 0 && (
        <ul className="divide-y divide-border">
          {data.map((exercise) => (
            <li key={exercise.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 py-2.5 text-left disabled:cursor-default"
                onClick={() => onPick?.(exercise)}
                disabled={!onPick}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {exercise.name}
                    {exercise.isOwn && <span className="ml-2 text-xs text-ink-faint">(yours)</span>}
                  </span>
                  <span className="block truncate text-xs text-ink-faint">
                    {[exercise.primaryMuscles.map(humanise).join(', '), humanise(exercise.equipmentType)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-ink-faint">{MEASURE_LABELS[exercise.measure]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-ink-faint">
        <a href={CATALOGUE_CREDIT.url} target="_blank" rel="noreferrer" className="underline">
          {CATALOGUE_CREDIT.label}
        </a>
      </p>
    </div>
  );
}
