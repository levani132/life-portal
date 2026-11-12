'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, CopyPlus, Link2, Plus, Trash2, Unlink, X } from 'lucide-react';
import {
  PLAN_LIMITS,
  type ExerciseListItem,
  type Measure,
  type PlanDetail,
  type PlanInput,
  type PlanTarget,
  type PlanTargetType,
  type WeightUnit,
} from '@life-portal/shared-types';
import {
  gramsToDisplay,
  linkWithNext,
  setFieldsFor,
  supersetRuns,
  unlinkFromNext,
  validatePlan,
  type PlanProblem,
} from '@life-portal/shared-domain';
import { ErrorNote, Input, Modal, Panel, Textarea } from '../ui';
import { api, ApiError } from '../../lib/api';
import {
  PLANS_KEY,
  formatDuration,
  parseDuration,
  parseWeight,
  parseWhole,
  planKey,
  useWeightUnit,
} from '../../lib/training';
import { mutate } from 'swr';
import { ExerciseSearch } from './exercise-picker';

/**
 * Creating and editing an own plan (spec 023 US2). The whole plan is edited here and sent in one
 * request (POST, or PUT with the ids it was given, so sessions keep pointing at their workout).
 * Reordering is up/down buttons only: no drag, so it works the same with a finger, a mouse and a
 * screen reader. Problems are checked with the same `validatePlan` the API runs.
 */

interface DraftTarget {
  type: PlanTargetType;
  /** `8` or a range, `8-12`. */
  reps: string;
  weight: string;
  assist: string;
  duration: string;
  distance: string;
}

interface DraftExercise {
  key: string;
  id?: string;
  exerciseId: string;
  name: string;
  measure: Measure;
  archived: boolean;
  rest: string;
  note: string;
  /** Spec 025: neighbours with the same key are a superset. */
  superset?: string;
  targets: DraftTarget[];
}

interface DraftWorkout {
  key: string;
  id?: string;
  name: string;
  exercises: DraftExercise[];
}

interface Draft {
  name: string;
  description: string;
  workouts: DraftWorkout[];
}

const key = () => crypto.randomUUID();

const REP_MEASURES: readonly Measure[] = ['weight_reps', 'bodyweight_reps', 'assisted_reps'];

function fromTarget(target: PlanTarget, unit: WeightUnit): DraftTarget {
  return {
    type: target.type,
    reps: target.reps == null ? '' : target.repsMax ? `${target.reps}-${target.repsMax}` : String(target.reps),
    weight: target.weightGrams != null ? String(gramsToDisplay(target.weightGrams, unit)) : '',
    assist: target.assistGrams != null ? String(gramsToDisplay(target.assistGrams, unit)) : '',
    duration: target.durationSeconds != null ? formatDuration(target.durationSeconds) : '',
    distance: target.distanceMeters != null ? String(target.distanceMeters) : '',
  };
}

function fromPlan(plan: PlanDetail, unit: WeightUnit): Draft {
  return {
    name: plan.name,
    description: plan.description ?? '',
    workouts: plan.workouts.map((workout) => ({
      key: key(),
      id: workout.id,
      name: workout.name,
      exercises: workout.exercises.map((exercise) => ({
        key: key(),
        id: exercise.id,
        exerciseId: exercise.exerciseId,
        name: exercise.exercise.name,
        measure: exercise.exercise.measure,
        archived: exercise.exercise.archived,
        rest: exercise.restSeconds != null ? formatDuration(exercise.restSeconds) : '',
        note: exercise.note ?? '',
        ...(exercise.superset ? { superset: exercise.superset } : {}),
        targets: exercise.targets.map((target) => fromTarget(target, unit)),
      })),
    })),
  };
}

/** A fresh exercise starts with three working sets of a sensible shape for its measure. */
function newExercise(exercise: ExerciseListItem): DraftExercise {
  const blank: DraftTarget = { type: 'working', reps: '', weight: '', assist: '', duration: '', distance: '' };
  const first: DraftTarget = REP_MEASURES.includes(exercise.measure)
    ? { ...blank, reps: '8-12' }
    : exercise.measure === 'duration'
      ? { ...blank, duration: '0:45' }
      : { ...blank, distance: '1000' };
  const count = exercise.measure === 'distance_duration' ? 1 : 3;
  return {
    key: key(),
    exerciseId: exercise.id,
    name: exercise.name,
    measure: exercise.measure,
    archived: false,
    rest: REP_MEASURES.includes(exercise.measure) ? '1:30' : '1:00',
    note: '',
    targets: Array.from({ length: count }, () => ({ ...first })),
  };
}

/** Text that does not parse is sent as a non-number, so `validatePlan` names the field. */
const unreadable = Number.NaN;

function toTarget(measure: Measure, draft: DraftTarget, unit: WeightUnit): PlanTarget {
  const allowed = setFieldsFor(measure).allowed;
  const target: PlanTarget = { type: draft.type };
  const text = (value: string, parse: (text: string) => number | undefined) =>
    value.trim() ? (parse(value) ?? unreadable) : undefined;
  if (allowed.includes('reps') && draft.reps.trim()) {
    const [low, high] = draft.reps.split(/[-–]/).map((part) => part.trim());
    target.reps = parseWhole(low) ?? unreadable;
    if (high) target.repsMax = parseWhole(high) ?? unreadable;
  }
  if (allowed.includes('weightGrams')) target.weightGrams = text(draft.weight, (v) => parseWeight(v, unit));
  if (allowed.includes('assistGrams')) target.assistGrams = text(draft.assist, (v) => parseWeight(v, unit));
  if (allowed.includes('durationSeconds')) target.durationSeconds = text(draft.duration, parseDuration);
  if (allowed.includes('distanceMeters')) target.distanceMeters = text(draft.distance, parseWhole);
  for (const field of Object.keys(target) as (keyof PlanTarget)[]) if (target[field] === undefined) delete target[field];
  return target;
}

function toInput(draft: Draft, unit: WeightUnit): PlanInput {
  return {
    name: draft.name.trim(),
    ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
    workouts: draft.workouts.map((workout) => ({
      ...(workout.id ? { id: workout.id } : {}),
      name: workout.name.trim(),
      exercises: workout.exercises.map((exercise) => {
        const rest = exercise.rest.trim() ? (parseDuration(exercise.rest) ?? unreadable) : undefined;
        return {
          ...(exercise.id ? { id: exercise.id } : {}),
          exerciseId: exercise.exerciseId,
          ...(rest !== undefined ? { restSeconds: rest } : {}),
          ...(exercise.note.trim() ? { note: exercise.note.trim() } : {}),
          ...(exercise.superset ? { superset: exercise.superset } : {}),
          targets: exercise.targets.map((target) => toTarget(exercise.measure, target, unit)),
        };
      }),
    })),
  };
}

/** `workouts.0.exercises.1.targets.2` → `Day 1 · Bench press · set 3`. */
function where(draft: Draft, path: string): string {
  const parts = path.split('.');
  const workout = parts[0] === 'workouts' && parts[1] !== undefined ? draft.workouts[Number(parts[1])] : undefined;
  const exercise = workout && parts[2] === 'exercises' && parts[3] !== undefined ? workout.exercises[Number(parts[3])] : undefined;
  const label = [
    workout ? workout.name.trim() || `Workout ${Number(parts[1]) + 1}` : null,
    exercise?.name ?? null,
    exercise && parts[4] === 'targets' && parts[5] !== undefined ? `set ${Number(parts[5]) + 1}` : null,
  ].filter(Boolean);
  return label.length ? label.join(' · ') : path === 'name' ? 'Plan name' : path === 'description' ? 'Description' : 'Plan';
}

/** A short superset key: it only needs to be unique within one workout. */
const supersetKey = () => crypto.randomUUID().slice(0, 8);

/** `Push` → `Push (2)`, or the next free number, within the name limit. */
function copyName(name: string, taken: readonly string[]): string {
  const base = name.trim().replace(/ \(\d+\)$/, '') || 'Workout';
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, PLAN_LIMITS.name - suffix.length)}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/**
 * Spec 025: a copy of a workout, placed right after it. Everything is copied (exercises, targets,
 * rest, notes, supersets) but no ids, so the server gives it new ones and past sessions keep
 * pointing at the original.
 */
function duplicateWorkout(workout: DraftWorkout, taken: readonly string[]): DraftWorkout {
  return {
    key: key(),
    name: copyName(workout.name, taken),
    exercises: workout.exercises.map(({ id: _id, ...exercise }) => ({
      ...exercise,
      key: key(),
      targets: exercise.targets.map((target) => ({ ...target })),
    })),
  };
}

function move<T>(items: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function PlanEditor({
  plan,
  onDone,
}: {
  /** The plan to edit; a new plan when absent. */
  plan?: PlanDetail;
  onDone: (id?: string) => void;
}) {
  const unit = useWeightUnit();
  const [draft, setDraft] = useState<Draft>(() =>
    plan ? fromPlan(plan, unit) : { name: '', description: '', workouts: [{ key: key(), name: 'Workout A', exercises: [] }] },
  );
  // One id per editor, so a retried save never makes a second plan.
  const [requestId] = useState(() => crypto.randomUUID());
  const [picking, setPicking] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string[] | null>(null);

  const measures = useMemo(
    () => new Map(draft.workouts.flatMap((w) => w.exercises.map((e) => [e.exerciseId, e.measure] as const))),
    [draft],
  );
  const problems: PlanProblem[] = useMemo(
    () => validatePlan(toInput(draft, unit), (id) => measures.get(id)),
    [draft, unit, measures],
  );

  const update = (change: (draft: Draft) => Draft) => {
    setDraft(change);
    setServerError(null);
  };
  const updateWorkout = (w: number, change: (workout: DraftWorkout) => DraftWorkout) =>
    update((d) => ({ ...d, workouts: d.workouts.map((workout, i) => (i === w ? change(workout) : workout)) }));
  const updateExercise = (w: number, e: number, change: (exercise: DraftExercise) => DraftExercise) =>
    updateWorkout(w, (workout) => ({
      ...workout,
      exercises: workout.exercises.map((exercise, i) => (i === e ? change(exercise) : exercise)),
    }));

  const save = async () => {
    setTried(true);
    if (problems.length) return;
    setSaving(true);
    setServerError(null);
    try {
      const body = toInput(draft, unit);
      const saved = plan
        ? await api.put<PlanDetail>(`/training/plans/${plan.id}`, body)
        : await api.post<PlanDetail>('/training/plans', { requestId, ...body });
      await Promise.all([mutate(PLANS_KEY), mutate(planKey(saved.id), saved, { revalidate: false })]);
      onDone(saved.id);
    } catch (caught) {
      setServerError(
        caught instanceof ApiError ? (caught.details ?? [caught.message]) : ['Could not reach the server. Try again.'],
      );
    } finally {
      setSaving(false);
    }
  };

  const atLimit = draft.workouts.length >= PLAN_LIMITS.workouts;

  return (
    <div className="space-y-3">
      <button type="button" className="btn-ghost" onClick={() => onDone(plan?.id)}>
        <ChevronLeft className="h-4 w-4" /> Cancel
      </button>

      <Panel title={plan ? 'Edit plan' : 'New plan'}>
        <div className="space-y-3">
          <label className="block">
            <span className="label">Name</span>
            <Input
              value={draft.name}
              maxLength={PLAN_LIMITS.name}
              onChange={(event) => update((d) => ({ ...d, name: event.target.value }))}
              placeholder="e.g. My upper / lower"
            />
          </label>
          <label className="block">
            <span className="label">Description (optional)</span>
            <Textarea
              rows={2}
              value={draft.description}
              maxLength={PLAN_LIMITS.description}
              onChange={(event) => update((d) => ({ ...d, description: event.target.value }))}
            />
          </label>
        </div>
      </Panel>

      {draft.workouts.map((workout, w) => (
        <Panel
          key={workout.key}
          actions={
            <>
              <IconButton label="Move workout up" disabled={w === 0} onClick={() => update((d) => ({ ...d, workouts: move(d.workouts, w, -1) }))}>
                <ArrowUp className="h-4 w-4" />
              </IconButton>
              <IconButton
                label="Move workout down"
                disabled={w === draft.workouts.length - 1}
                onClick={() => update((d) => ({ ...d, workouts: move(d.workouts, w, 1) }))}
              >
                <ArrowDown className="h-4 w-4" />
              </IconButton>
              <IconButton
                label={`Duplicate ${workout.name || 'workout'}`}
                disabled={atLimit}
                onClick={() =>
                  update((d) => {
                    const workouts = [...d.workouts];
                    workouts.splice(w + 1, 0, duplicateWorkout(d.workouts[w], d.workouts.map((item) => item.name.trim())));
                    return { ...d, workouts };
                  })
                }
              >
                <CopyPlus className="h-4 w-4" />
              </IconButton>
              <IconButton
                label="Remove workout"
                onClick={() => {
                  if (workout.exercises.length && !window.confirm(`Remove ${workout.name || 'this workout'} and its exercises?`)) return;
                  update((d) => ({ ...d, workouts: d.workouts.filter((_, i) => i !== w) }));
                }}
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </>
          }
        >
          <label className="mb-3 block">
            <span className="label">Workout name</span>
            <Input
              value={workout.name}
              maxLength={PLAN_LIMITS.name}
              onChange={(event) => updateWorkout(w, (current) => ({ ...current, name: event.target.value }))}
            />
          </label>

          <ol>
            {workout.exercises.map((exercise, e) => {
              const runs = supersetRuns(workout.exercises.map((item) => ({ id: item.key, superset: item.superset })));
              const place = runs.get(exercise.key);
              const next = workout.exercises[e + 1];
              const linked = Boolean(place && next && runs.get(next.key)?.ids === place.ids);
              const keys = workout.exercises.map((item) => item.superset);
              const setKeys = (changed: (string | undefined)[]) =>
                updateWorkout(w, (current) => ({
                  ...current,
                  exercises: current.exercises.map((item, i) => ({ ...item, superset: changed[i] })),
                }));
              return (
              <li key={exercise.key}>
              <div className={clsx('rounded-lg border p-3', place ? 'border-train-pull/50 bg-train-pull/5' : 'border-border')}>
                <div className="mb-2 flex items-start gap-2">
                  {place && (
                    <span
                      className="mt-0.5 shrink-0 rounded-md bg-train-pull-solid px-1.5 py-0.5 text-[11px] font-bold text-white"
                      title={`Superset ${place.label}, exercise ${place.position} of ${place.size}`}
                    >
                      {place.label}
                      {place.position}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 text-sm font-medium">
                    {exercise.name}
                    {exercise.archived && <span className="ml-2 text-xs font-normal text-ink-faint">archived</span>}
                  </span>
                  <IconButton
                    label="Move exercise up"
                    disabled={e === 0}
                    onClick={() => updateWorkout(w, (current) => ({ ...current, exercises: move(current.exercises, e, -1) }))}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label="Move exercise down"
                    disabled={e === workout.exercises.length - 1}
                    onClick={() => updateWorkout(w, (current) => ({ ...current, exercises: move(current.exercises, e, 1) }))}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    label={`Remove ${exercise.name}`}
                    onClick={() =>
                      updateWorkout(w, (current) => ({ ...current, exercises: current.exercises.filter((_, i) => i !== e) }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>

                <TargetRows
                  measure={exercise.measure}
                  unit={unit}
                  targets={exercise.targets}
                  onChange={(targets) => updateExercise(w, e, (current) => ({ ...current, targets }))}
                />

                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="w-20 shrink-0">
                    <span className="label">Rest</span>
                    <Input
                      inputMode="text"
                      value={exercise.rest}
                      placeholder="m:ss"
                      onChange={(event) => updateExercise(w, e, (current) => ({ ...current, rest: event.target.value }))}
                      aria-label="Rest, minutes:seconds"
                    />
                  </label>
                  <label className="min-w-[10rem] flex-1">
                    <span className="label">Note</span>
                    <Input
                      value={exercise.note}
                      maxLength={PLAN_LIMITS.note}
                      placeholder="e.g. pause at the bottom"
                      onChange={(event) => updateExercise(w, e, (current) => ({ ...current, note: event.target.value }))}
                    />
                  </label>
                </div>
              </div>
              {next && (
                <div className="flex justify-center py-1">
                  <button
                    type="button"
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                      linked ? 'text-train-pull hover:bg-train-pull/10' : 'text-ink-faint hover:bg-surface hover:text-ink',
                    )}
                    onClick={() => setKeys(linked ? unlinkFromNext(keys, e, supersetKey) : linkWithNext(keys, e, supersetKey))}
                    aria-label={linked ? `Split the superset after ${exercise.name}` : `Superset ${exercise.name} with ${next.name}`}
                  >
                    {linked ? <Unlink className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                    {linked ? 'Unlink' : 'Superset with next'}
                  </button>
                </div>
              )}
              </li>
              );
            })}
          </ol>

          <button
            type="button"
            className="btn-ghost mt-3"
            disabled={workout.exercises.length >= PLAN_LIMITS.exercises}
            onClick={() => setPicking(w)}
          >
            <Plus className="h-4 w-4" /> Add exercise
          </button>
        </Panel>
      ))}

      <button
        type="button"
        className="btn-ghost"
        disabled={atLimit}
        title={atLimit ? `A plan has at most ${PLAN_LIMITS.workouts} workouts` : undefined}
        onClick={() =>
          update((d) => ({
            ...d,
            workouts: [...d.workouts, { key: key(), name: `Workout ${String.fromCharCode(65 + (d.workouts.length % 26))}`, exercises: [] }],
          }))
        }
      >
        <Plus className="h-4 w-4" /> Add workout
      </button>

      <Panel>
        {tried && problems.length > 0 && (
          <ul className="mb-3 space-y-1 text-sm text-rose-300">
            {problems.slice(0, 8).map((problem) => (
              <li key={problem.path}>
                <span className="text-ink-muted">{where(draft, problem.path)}:</span> {problem.message}
              </li>
            ))}
            {problems.length > 8 && <li className="text-ink-faint">…and {problems.length - 8} more</li>}
          </ul>
        )}
        {serverError && (
          <div className="mb-3 space-y-1">
            {serverError.map((text) => (
              <ErrorNote key={text} message={text} />
            ))}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onDone(plan?.id)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : plan ? 'Save changes' : 'Create plan'}
          </button>
        </div>
      </Panel>

      <Modal open={picking !== null} onClose={() => setPicking(null)} title="Add exercise" wide>
        <ExerciseSearch
          autoFocus
          onPick={(exercise) => {
            if (picking !== null) {
              updateWorkout(picking, (current) => ({ ...current, exercises: [...current.exercises, newExercise(exercise)] }));
            }
            setPicking(null);
          }}
        />
      </Modal>
    </div>
  );
}

/** The planned sets of one exercise: the fields its measure allows, plus a warm-up toggle. */
function TargetRows({
  measure,
  unit,
  targets,
  onChange,
}: {
  measure: Measure;
  unit: WeightUnit;
  targets: DraftTarget[];
  onChange: (targets: DraftTarget[]) => void;
}) {
  const allowed = setFieldsFor(measure).allowed;
  const set = (index: number, change: Partial<DraftTarget>) =>
    onChange(targets.map((target, i) => (i === index ? { ...target, ...change } : target)));
  const field = (index: number, name: keyof DraftTarget, label: string, props: { inputMode: 'numeric' | 'decimal' | 'text'; placeholder: string; width: string }) => (
    <label className={clsx(props.width, 'shrink-0')}>
      <span className="label">{label}</span>
      <Input
        inputMode={props.inputMode}
        value={targets[index][name]}
        placeholder={props.placeholder}
        onChange={(event) => set(index, { [name]: event.target.value })}
        aria-label={`Set ${index + 1} ${label}`}
      />
    </label>
  );
  const weightLabel = measure === 'weight_reps' ? unit : `+${unit}`;
  return (
    <div className="space-y-2">
      {targets.map((target, index) => (
        <div key={index} className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            className={clsx(
              'mb-1 w-8 shrink-0 rounded-md border px-1 py-1 text-center text-xs tabular-nums',
              target.type === 'warmup' ? 'border-amber-500/50 text-amber-300' : 'border-border text-ink-faint',
            )}
            onClick={() => set(index, { type: target.type === 'warmup' ? 'working' : 'warmup' })}
            aria-label={target.type === 'warmup' ? `Set ${index + 1} is a warm-up; make it a working set` : `Set ${index + 1} is a working set; make it a warm-up`}
            title="Tap to switch warm-up / working"
          >
            {target.type === 'warmup' ? 'W' : index + 1}
          </button>
          {allowed.includes('reps') && field(index, 'reps', 'Reps', { inputMode: 'text', placeholder: '8-12', width: 'w-20' })}
          {allowed.includes('weightGrams') &&
            field(index, 'weight', weightLabel, { inputMode: 'decimal', placeholder: 'any', width: 'w-20' })}
          {allowed.includes('assistGrams') &&
            field(index, 'assist', `−${unit}`, { inputMode: 'decimal', placeholder: 'any', width: 'w-20' })}
          {allowed.includes('distanceMeters') &&
            field(index, 'distance', 'Metres', { inputMode: 'numeric', placeholder: '0', width: 'w-24' })}
          {allowed.includes('durationSeconds') &&
            field(index, 'duration', 'Time', { inputMode: 'text', placeholder: 'm:ss', width: 'w-20' })}
          <IconButton
            label={`Remove set ${index + 1}`}
            disabled={targets.length <= PLAN_LIMITS.targetsMin}
            onClick={() => onChange(targets.filter((_, i) => i !== index))}
          >
            <X className="h-4 w-4" />
          </IconButton>
        </div>
      ))}
      <button
        type="button"
        className="btn-ghost text-xs"
        disabled={targets.length >= PLAN_LIMITS.targetsMax}
        onClick={() => onChange([...targets, { ...(targets[targets.length - 1] ?? { type: 'working', reps: '', weight: '', assist: '', duration: '', distance: '' }), type: 'working' }])}
      >
        <Plus className="h-3.5 w-3.5" /> Add set
      </button>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="btn-ghost shrink-0 px-2 disabled:opacity-30"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
