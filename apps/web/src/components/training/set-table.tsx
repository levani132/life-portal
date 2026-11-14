'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import type { Measure, PlanTarget, SessionExercise, SetValues, WorkoutSet } from '@life-portal/shared-types';
import { formatDay, formatWeight, setFieldsFor } from '@life-portal/shared-domain';
import { Modal } from '../ui';
import { ApiError } from '../../lib/api';
import { trainingWrites } from '../../lib/training-offline';
import {
  RECORD_LABELS,
  SET_TYPE_LABELS,
  SET_TYPE_SHORT,
  describeTarget,
  prefillFor,
  useWeightUnit,
} from '../../lib/training';
import {
  SET_TYPE_CHIPS,
  SetExtras,
  SetInput,
  fieldsFor,
  readFields,
  setColumns,
  setIssue,
  type SetColumn,
  type SetFields,
  type SetFormValue,
} from './set-row';

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Could not reach the server. Try again.';

/**
 * What the next set from a plan should start with (spec 023 research R6): last time's set at the
 * same position, else the plan's target. With no history, a weight logged earlier in this
 * workout is carried over, so the second set of a new exercise is still one tap.
 */
export function suggestionValue(
  exercise: SessionExercise,
  target: PlanTarget,
  position: number,
  lastLogged: SetValues | undefined,
): { value: SetFormValue; source: 'last_time' | 'plan' } {
  const measure = exercise.snapshot.measure;
  const prefill = prefillFor(measure, target, exercise.previous?.sets, position);
  const values: SetValues = { ...prefill.values };
  if (prefill.source === 'plan' && lastLogged) {
    // A body-weight load is added weight or assistance, never both: a target that names one is
    // not given the other from the last set.
    const signed = Boolean(values.weightGrams || values.assistGrams);
    for (const field of setFieldsFor(measure).allowed) {
      if (signed && (field === 'weightGrams' || field === 'assistGrams')) continue;
      if (values[field] === undefined && lastLogged[field] !== undefined) values[field] = lastLogged[field];
    }
  }
  return { value: { type: prefill.type, ...values }, source: prefill.source };
}

const VALUE_KEYS = ['reps', 'weightGrams', 'assistGrams', 'durationSeconds', 'distanceMeters'] as const;
/** Only the numbers of a set, so a new row can start from them without inheriting type or RPE. */
function valuesOf(set: SetValues): SetValues {
  const values: SetValues = {};
  for (const key of VALUE_KEYS) if (set[key] != null) values[key] = set[key];
  return values;
}

const INPUT = 'px-1 text-center font-semibold tabular-nums';

/**
 * The sets of one exercise as a table (spec 024 follow-up): one row per set with its inputs in
 * the row and a tick at the end. Planned sets are there from the start, pre-filled; ticking one
 * logs it, un-ticking a logged one takes it back, and the plus adds a row beyond the plan.
 * Rows not yet ticked are never data: nothing is sent until the tick.
 */
export function SetTable({
  exercise,
  onLog,
  onEdit,
}: {
  exercise: SessionExercise;
  /** Sets ticked but not yet answered by the server, in order. */
  onLog: (value: SetFormValue) => void;
  /** Opens the full editor for a logged set (type, RPE, delete). */
  onEdit: (set: WorkoutSet) => void;
}) {
  const unit = useWeightUnit();
  const measure = exercise.snapshot.measure;
  const columns = setColumns(measure, unit);
  const done = exercise.sets.length;
  const targetCount = exercise.planned?.targets.length ?? 0;
  // From a plan (spec 023): the open targets still to do, after any sets waiting to be sent.
  const suggestions = exercise.skipped ? [] : exercise.openTargets;

  /** What the person typed into rows not yet ticked, by row position. Untouched rows are derived. */
  const [edits, setEdits] = useState<Record<number, SetFields>>({});
  /** Rows added with the plus. An exercise with no plan and no sets starts with one. */
  const [extra, setExtra] = useState(() => (done === 0 && !exercise.planned ? 1 : 0));
  const [problem, setProblem] = useState<{ position: number; text: string } | null>(null);
  const [options, setOptions] = useState<number | null>(null);

  const lastLogged: SetValues | undefined = exercise.sets[exercise.sets.length - 1];
  const previous = exercise.previous?.sets;
  let above: SetValues | undefined = lastLogged;
  const drafts = exercise.skipped
    ? []
    : Array.from({ length: suggestions.length + extra }, (_, index) => {
        const position = done + index;
        const target: PlanTarget | undefined = suggestions[index];
        const suggested = target ? suggestionValue(exercise, target, position, lastLogged) : undefined;
        // A row beyond the plan starts from the row above it, else from the same set last time.
        const start =
          suggested?.value ??
          (above && valuesOf(above)) ??
          (previous?.length ? valuesOf(previous[position] ?? previous[previous.length - 1]) : undefined);
        const fields = edits[position] ?? fieldsFor(measure, start, unit);
        above = readFields(measure, fields, unit);
        return { position, target, source: suggested?.source, fields, planned: Boolean(target) };
      });

  const change = (position: number, fields: SetFields, patch: Partial<SetFields>) => {
    setEdits((current) => ({ ...current, [position]: { ...fields, ...patch } }));
    setProblem((current) => (current?.position === position ? null : current));
  };

  /** Drops the row at `position` from the typed values; `shift` says where each other row goes. */
  const dropRow = (position: number, shift: (other: number) => number) =>
    setEdits((current) => {
      const next: Record<number, SetFields> = {};
      for (const [key, value] of Object.entries(current)) {
        const other = Number(key);
        if (other !== position) next[shift(other)] = value;
      }
      return next;
    });

  const tick = (position: number, fields: SetFields) => {
    const value = readFields(measure, fields, unit);
    const issue = setIssue(measure, value);
    if (issue) {
      setProblem({ position, text: issue });
      return;
    }
    setProblem(null);
    onLog(value);
    // The ticked row becomes the next logged set; rows above it that are still open move down one.
    dropRow(position, (other) => (other < position ? other + 1 : other));
    if (!suggestions.length) setExtra((count) => Math.max(0, count - 1));
  };

  const removeRow = (position: number) => {
    setOptions(null);
    dropRow(position, (other) => (other > position ? other - 1 : other));
    setExtra((count) => Math.max(0, count - 1));
  };

  /** Un-ticking a logged set deletes it and puts its numbers back in an open row. */
  const untick = async (set: WorkoutSet, fields: SetFields) => {
    const position = exercise.sets.length - 1;
    const reopensTarget = !exercise.skipped && exercise.sets.length - 1 < targetCount;
    // Spec 028: kept on the device and applied at once; sent when there is a connection.
    await trainingWrites.removeSet(exercise.sessionId, set.id);
    setEdits((current) => ({ ...current, [position]: fields }));
    if (!reopensTarget) setExtra((count) => count + 1);
  };

  const optionsRow = drafts.find((draft) => draft.position === options);
  const empty = !exercise.sets.length && !drafts.length;

  return (
    <div>
      {!empty && (
        <div className="mb-1 flex items-center gap-2 px-1 text-[11px] font-semibold tracking-wide text-ink-faint" aria-hidden>
          <span className="w-9 shrink-0 text-center">Set</span>
          {columns.map((column) => (
            <span key={column.key} className="flex-1 text-center">
              {column.label}
            </span>
          ))}
          <span className="w-10 shrink-0" />
        </div>
      )}
      <ul className="space-y-1.5">
        {exercise.sets.map((set, index) => (
          <LoggedRow
            key={set.id}
            index={index + 1}
            sessionId={exercise.sessionId}
            set={set}
            measure={measure}
            columns={columns}
            onEdit={() => onEdit(set)}
            onUntick={(fields) => untick(set, fields)}
          />
        ))}
        {drafts.map((draft, index) => (
          <Row
            key={`draft-${draft.position}`}
            index={draft.position + 1}
            fields={draft.fields}
            columns={columns}
            state={index === 0 ? 'next' : 'open'}
            onChange={(patch) => change(draft.position, draft.fields, patch)}
            onChip={() => setOptions(draft.position)}
            onTick={() => tick(draft.position, draft.fields)}
            problem={problem?.position === draft.position ? problem.text : undefined}
            caption={
              index === 0 && draft.target
                ? `Plan: ${describeTarget(measure, draft.target, unit)}${draft.source === 'last_time' ? ' · filled from last time' : ''}`
                : undefined
            }
          />
        ))}
      </ul>
      {!exercise.skipped && (
        <button
          type="button"
          className="mt-2 flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent/40 text-sm font-semibold text-accent transition-colors hover:border-accent hover:bg-accent/5"
          onClick={() => setExtra((count) => count + 1)}
        >
          <Plus className="h-5 w-5" /> Add set
        </button>
      )}
      {optionsRow && (
        <Modal open onClose={() => setOptions(null)} title={`Set ${optionsRow.position + 1}`}>
          <div className="flex flex-wrap items-end gap-2">
            <SetExtras fields={optionsRow.fields} onChange={(patch) => change(optionsRow.position, optionsRow.fields, patch)} />
            <button type="button" className="btn-primary shrink-0" onClick={() => setOptions(null)}>
              Done
            </button>
          </div>
          {!optionsRow.planned && (
            <button type="button" className="btn-danger" onClick={() => removeRow(optionsRow.position)}>
              <Trash2 className="h-4 w-4" /> Remove set
            </button>
          )}
        </Modal>
      )}
    </div>
  );
}

/** A logged set: its numbers stay editable in place and save when the row is left. */
function LoggedRow({
  index,
  sessionId,
  set,
  measure,
  columns,
  onEdit,
  onUntick,
}: {
  index: number;
  sessionId: string;
  set: WorkoutSet;
  measure: Measure;
  columns: SetColumn[];
  onEdit: () => void;
  onUntick: (fields: SetFields) => Promise<unknown>;
}) {
  const unit = useWeightUnit();
  const allowed = setFieldsFor(measure).allowed;
  // What the server holds, in the unit shown. When it changes, the row shows it again.
  const stored = JSON.stringify([unit, set.type, set.rpe, ...allowed.map((field) => set[field] ?? null)]);
  const [fields, setFields] = useState(() => fieldsFor(measure, set, unit));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = useRef(stored);
  const row = useRef<HTMLLIElement>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (shown.current === stored) return;
    shown.current = stored;
    setFields(fieldsFor(measure, set, unit));
    setProblem(null);
  }, [stored, measure, set, unit]);

  /** Saves the row's numbers if they changed, once the person is no longer typing in it. */
  const commit = async () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && row.current?.contains(focused)) return;
    if (saving.current || busy) return;
    const value = readFields(measure, fields, unit);
    if (allowed.every((field) => (value[field] ?? 0) === (set[field] ?? 0))) return;
    const issue = setIssue(measure, value);
    if (issue) {
      setProblem(issue);
      return;
    }
    saving.current = true;
    try {
      // Every field the measure allows is sent, `null` for an emptied one, so clearing works.
      await trainingWrites.patchSet(sessionId, set.id, Object.fromEntries(allowed.map((field) => [field, value[field] ?? null])));
    } catch (caught) {
      setProblem(message(caught));
    } finally {
      saving.current = false;
    }
  };
  const latest = useRef(commit);
  latest.current = commit;
  // After a change that is not typing (the sign switch): iOS does not focus a tapped button, so
  // no blur follows it.
  useEffect(() => {
    void latest.current();
  }, [fields]);

  const untick = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await onUntick(fields);
    } catch (caught) {
      setProblem(message(caught));
      setBusy(false);
    }
  };

  const records = set.records ?? [];
  const load = set.effectiveLoad;
  const notes = [
    set.rpe !== undefined ? `RPE ${set.rpe}` : '',
    // Bodyweight and assisted sets: the load they moved, labelled with the weigh-in it came from.
    load ? `${formatWeight(load.grams, unit)} load · from weigh-in ${formatDay(load.bodyWeightDay)}` : '',
  ].filter(Boolean);

  return (
    <Row
      ref={row}
      index={index}
      fields={fields}
      columns={columns}
      state={busy ? 'saving' : 'done'}
      onChange={(patch) => {
        setFields((current) => ({ ...current, ...patch }));
        setProblem(null);
      }}
      onBlur={() => setTimeout(() => void latest.current(), 0)}
      onChip={onEdit}
      onTick={() => void untick()}
      problem={problem ?? undefined}
      caption={notes.join(' · ') || undefined}
      badge={
        records.length > 0 ? (
          <span
            className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
            title={`Personal record: ${records.map((kind) => RECORD_LABELS[kind]).join(', ')}`}
            aria-label={`Personal record: ${records.map((kind) => RECORD_LABELS[kind]).join(', ')}`}
          >
            PR
          </span>
        ) : undefined
      }
    />
  );
}

/** One row of the table: the set's number, its inputs, and the tick. */
function Row({
  ref,
  index,
  fields,
  columns,
  state,
  onChange,
  onBlur,
  onChip,
  onTick,
  problem,
  caption,
  badge,
}: {
  ref?: React.Ref<HTMLLIElement>;
  index: number;
  fields: SetFields;
  columns: SetColumn[];
  /** `done` is logged, `saving` is on its way, `next` is the first open row, `open` the rest. */
  state: 'done' | 'saving' | 'next' | 'open';
  onChange?: (patch: Partial<SetFields>) => void;
  onBlur?: () => void;
  onChip?: () => void;
  onTick?: () => void;
  problem?: string;
  caption?: string;
  badge?: React.ReactNode;
}) {
  const ticked = state === 'done' || state === 'saving';
  const typeLabel = SET_TYPE_LABELS[fields.type];
  return (
    <li
      ref={ref}
      onBlur={onBlur}
      className={clsx(
        'rounded-xl p-1 transition-colors',
        ticked && 'bg-emerald-500/10',
        state === 'next' && 'bg-accent/[0.07]',
        state === 'saving' && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <button
          type="button"
          className={clsx(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums',
            SET_TYPE_CHIPS[fields.type],
            !ticked && 'border border-dashed border-current bg-transparent',
          )}
          disabled={!onChip || state === 'saving'}
          onClick={onChip}
          title={`${typeLabel} set. Change type and RPE`}
          aria-label={`Set ${index}, ${typeLabel.toLowerCase()}. Change type and RPE`}
        >
          {SET_TYPE_SHORT[fields.type] || index}
        </button>
        {columns.map((column) => (
          <div key={column.key} className="flex-1">
            <SetInput
              column={column}
              fields={fields}
              disabled={!onChange || state === 'saving'}
              className={clsx(INPUT, ticked && 'border-transparent bg-transparent')}
              onChange={(key, value) => onChange?.({ [key]: value })}
            />
          </div>
        ))}
        <button
          type="button"
          role="checkbox"
          aria-checked={ticked}
          aria-label={ticked ? `Set ${index} done. Untick to take it back` : `Mark set ${index} done`}
          title={ticked ? 'Done. Tap to take it back' : 'Mark as done'}
          disabled={!onTick || state === 'saving'}
          onClick={onTick}
          className={clsx(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border-2 transition-colors',
            ticked
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-border text-ink-faint hover:border-emerald-500 hover:text-emerald-400',
            state === 'saving' && 'animate-pulse',
          )}
        >
          <Check className="h-5 w-5" strokeWidth={3} />
        </button>
      </div>
      {(caption || badge || problem) && (
        <p className="mt-0.5 flex items-center gap-1.5 pl-11 pr-12 text-[11px] text-ink-faint">
          {badge}
          {problem ? <span className="text-rose-400">{problem}</span> : <span className="truncate">{caption}</span>}
        </p>
      )}
    </li>
  );
}
