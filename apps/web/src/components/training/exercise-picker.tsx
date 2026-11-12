'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  CATALOGUE_CREDIT,
  EQUIPMENT_TYPES,
  MUSCLES,
  type Exercise,
  type ExerciseListItem,
  type Machine,
} from '@life-portal/shared-types';
import { EmptyState, ErrorNote, Input, Select, Spinner } from '../ui';
import { useApi } from '../../lib/hooks';
import { MEASURE_LABELS, humanise } from '../../lib/training';
import { ExerciseForm } from './exercise-form';
import { MachineForm } from './machine-form';

/** Debounced so typing "bench" sends one request, not five. */
function useDebounced(value: string, ms = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Equipment where "which machine?" is worth asking. */
const MACHINE_LIKE = new Set(['machine', 'cable', 'smith_machine']);

/**
 * Searches the catalogue (shared exercises plus the person's own). The server ranks: names that
 * start with the query first, then exercises used in the last 90 days, then by name. Filters
 * narrow by main muscle and equipment; "Create exercise" covers what the catalogue lacks.
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
  const { data, error, isLoading } = useApi<ExerciseListItem[]>(`/training/exercises?${params}`);

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
      <div className="grid grid-cols-2 gap-2">
        <Select value={muscle} onChange={(event) => setMuscle(event.target.value)} aria-label="Muscle">
          <option value="">All muscles</option>
          {MUSCLES.map((item) => (
            <option key={item} value={item}>
              {humanise(item)}
            </option>
          ))}
        </Select>
        <Select value={equipment} onChange={(event) => setEquipment(event.target.value)} aria-label="Equipment">
          <option value="">Equipment</option>
          {EQUIPMENT_TYPES.map((item) => (
            <option key={item} value={item}>
              {humanise(item)}
            </option>
          ))}
        </Select>
      </div>
      {allowCreate && (
        <button type="button" className="btn-ghost w-full justify-center" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Create exercise{q ? ` “${query.trim()}”` : ''}
        </button>
      )}
      {isLoading && <Spinner />}
      {error && <ErrorNote message={(error as Error).message} />}
      {data && !data.length && (
        <EmptyState message={q || muscle || equipment ? 'Nothing matches. Create it instead?' : 'No exercises yet.'} />
      )}
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
                    {exercise.recent && <span className="ml-2 text-xs text-accent">recent</span>}
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

/**
 * "Which machine?" for one exercise: machines linked to it first, then the person's others of the
 * same kind. Skipped (answers `null` at once) when the person has no machines and the exercise is
 * not done on one, so free-weight logging stays one tap.
 */
export function MachineChoice({
  exercise,
  currentId,
  onChoose,
}: {
  exercise: Pick<ExerciseListItem, 'id' | 'name' | 'equipmentType'>;
  currentId?: string;
  onChoose: (machineId: string | null) => void;
}) {
  const { data, error, isLoading } = useApi<Machine[]>('/training/machines');
  const [creating, setCreating] = useState(false);
  const machines = useMemo(() => {
    const all = data ?? [];
    const linked = all.filter((machine) => machine.exerciseIds.includes(exercise.id));
    const others = all.filter(
      (machine) => !machine.exerciseIds.includes(exercise.id) && machine.equipmentType === exercise.equipmentType,
    );
    return { linked, others };
  }, [data, exercise.id, exercise.equipmentType]);
  const skip = data !== undefined && !data.length && !MACHINE_LIKE.has(exercise.equipmentType) && currentId === undefined;
  // Once only: a second call would add the exercise to the workout twice.
  const skipped = useRef(false);
  useEffect(() => {
    if (!skip || skipped.current) return;
    skipped.current = true;
    onChoose(null);
  }, [skip, onChoose]);

  if (isLoading || skip) return <Spinner />;
  const row = (machine: Machine) => (
    <li key={machine.id}>
      <button type="button" className="flex w-full items-center gap-3 py-2.5 text-left" onClick={() => onChoose(machine.id)}>
        {machine.image ? (
          <img src={machine.image.url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="h-10 w-10 shrink-0 rounded-lg border border-border bg-surface" />
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {machine.name}
            {machine.id === currentId && <span className="ml-2 text-xs text-accent">current</span>}
          </span>
          {machine.brand && <span className="block truncate text-xs text-ink-faint">{machine.brand}</span>}
        </span>
      </button>
    </li>
  );
  return (
    <div className="space-y-3">
      {error && <ErrorNote message={(error as Error).message} />}
      <button type="button" className="btn-ghost w-full justify-center" onClick={() => onChoose(null)}>
        No specific machine
      </button>
      {machines.linked.length > 0 && <ul className="divide-y divide-border">{machines.linked.map(row)}</ul>}
      {machines.others.length > 0 && (
        <>
          <p className="label">Other {humanise(exercise.equipmentType).toLowerCase()} machines</p>
          <ul className="divide-y divide-border">{machines.others.map(row)}</ul>
        </>
      )}
      <button type="button" className="btn-ghost w-full justify-center" onClick={() => setCreating(true)}>
        <Plus className="h-4 w-4" /> New machine
      </button>
      {creating && (
        <MachineForm
          open
          linked={[{ id: exercise.id, name: exercise.name }]}
          onClose={() => setCreating(false)}
          onSaved={(saved) => onChoose(saved.id)}
        />
      )}
    </div>
  );
}
