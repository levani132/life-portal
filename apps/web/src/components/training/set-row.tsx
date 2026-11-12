'use client';

import clsx from 'clsx';
import { useState } from 'react';
import {
  SET_TYPES,
  type Measure,
  type SetType,
  type SetValues,
  type WorkoutSet,
} from '@life-portal/shared-types';
import { isValidRpe, setFieldsFor, validateSetValues } from '@life-portal/shared-domain';
import { Input, Select } from '../ui';
import {
  SET_TYPE_LABELS,
  SET_TYPE_SHORT,
  describeSet,
  parseDuration,
  parseKg,
  parseWhole,
  toFields,
} from '../../lib/training';

export interface SetFormValue extends SetValues {
  type: SetType;
  rpe?: number;
}

type Fields = ReturnType<typeof toFields> & { type: SetType; rpe: string };

const RPE_OPTIONS = ['', ...Array.from({ length: 19 }, (_, i) => String(1 + i / 2))];

/** Reads the text fields into whole units for the measure. Fields the measure lacks are left out. */
function readFields(measure: Measure, fields: Fields): SetFormValue {
  const allowed = setFieldsFor(measure).allowed;
  const value: SetFormValue = { type: fields.type };
  if (allowed.includes('reps')) value.reps = parseWhole(fields.reps);
  if (allowed.includes('weightGrams')) value.weightGrams = parseKg(fields.weight);
  if (allowed.includes('assistGrams')) value.assistGrams = parseKg(fields.assist);
  if (allowed.includes('durationSeconds')) value.durationSeconds = parseDuration(fields.duration);
  if (allowed.includes('distanceMeters')) value.distanceMeters = parseWhole(fields.distance);
  if (fields.rpe) value.rpe = Number(fields.rpe);
  return value;
}

/**
 * The inputs for one set, decided by the exercise's measure (`setFieldsFor`), so the form can
 * never offer a field the API would refuse. Weights are typed in kg with the decimal keypad
 * (`Input` turns a Georgian-keyboard comma into a dot); everything sent is whole grams, metres
 * and seconds.
 */
export function SetForm({
  measure,
  initial,
  submitLabel,
  onSubmit,
  pending,
  compact,
}: {
  measure: Measure;
  /** Pre-fill: the previous set, so the next one is usually one tap. */
  initial?: Partial<WorkoutSet>;
  submitLabel: string;
  onSubmit: (value: SetFormValue) => void | Promise<unknown>;
  pending?: boolean;
  compact?: boolean;
}) {
  const [fields, setFields] = useState<Fields>(() => ({
    ...toFields(initial),
    type: initial?.type ?? 'working',
    rpe: initial?.rpe !== undefined ? String(initial.rpe) : '',
  }));
  const [problem, setProblem] = useState<string | null>(null);
  const allowed = setFieldsFor(measure).allowed;
  const set = (key: keyof Fields) => (event: { target: { value: string } }) => {
    setFields((current) => ({ ...current, [key]: event.target.value }));
    setProblem(null);
  };

  const submit = async () => {
    const value = readFields(measure, fields);
    const issue =
      validateSetValues(measure, value) ??
      (value.rpe !== undefined && !isValidRpe(value.rpe) ? 'RPE must be 1–10.' : null);
    if (issue) {
      setProblem(issue);
      return;
    }
    await onSubmit(value);
  };

  const weightLabel = measure === 'weight_reps' ? 'kg' : '+kg';
  return (
    <div className={clsx('space-y-2', compact && 'text-sm')}>
      <div className="flex flex-wrap items-end gap-2">
        {allowed.includes('weightGrams') && (
          <label className="w-20 shrink-0">
            <span className="label">{weightLabel}</span>
            <Input inputMode="decimal" value={fields.weight} onChange={set('weight')} placeholder="0" aria-label="Weight in kg" />
          </label>
        )}
        {allowed.includes('assistGrams') && (
          <label className="w-20 shrink-0">
            <span className="label">−kg</span>
            <Input inputMode="decimal" value={fields.assist} onChange={set('assist')} placeholder="0" aria-label="Assistance in kg" />
          </label>
        )}
        {allowed.includes('reps') && (
          <label className="w-16 shrink-0">
            <span className="label">Reps</span>
            <Input inputMode="numeric" value={fields.reps} onChange={set('reps')} placeholder="0" aria-label="Reps" />
          </label>
        )}
        {allowed.includes('distanceMeters') && (
          <label className="w-24 shrink-0">
            <span className="label">Metres</span>
            <Input inputMode="numeric" value={fields.distance} onChange={set('distance')} placeholder="0" aria-label="Distance in metres" />
          </label>
        )}
        {allowed.includes('durationSeconds') && (
          <label className="w-24 shrink-0">
            <span className="label">Time</span>
            <Input inputMode="text" value={fields.duration} onChange={set('duration')} placeholder="m:ss" aria-label="Time, minutes:seconds" />
          </label>
        )}
        <label className="w-28 shrink-0">
          <span className="label">Type</span>
          <Select value={fields.type} onChange={set('type')} aria-label="Set type">
            {SET_TYPES.map((type) => (
              <option key={type} value={type}>
                {SET_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </label>
        {!compact && (
          <label className="w-20 shrink-0">
            <span className="label">RPE</span>
            <Select value={fields.rpe} onChange={set('rpe')} aria-label="RPE">
              {RPE_OPTIONS.map((rpe) => (
                <option key={rpe} value={rpe}>
                  {rpe || '–'}
                </option>
              ))}
            </Select>
          </label>
        )}
        <button type="button" className="btn-primary shrink-0" disabled={pending} onClick={() => void submit()}>
          {submitLabel}
        </button>
      </div>
      {problem && <p className="text-xs text-rose-400">{problem}</p>}
    </div>
  );
}

/** One logged set as a line: number, type mark, the values, and RPE. */
export function SetLine({
  index,
  set,
  measure,
  pending,
  onClick,
}: {
  index: number;
  set: SetValues & { type: SetType; rpe?: number };
  measure: Measure;
  pending?: boolean;
  onClick?: () => void;
}) {
  const mark = SET_TYPE_SHORT[set.type];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={clsx(
        'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm tabular-nums',
        onClick && 'hover:bg-surface',
        pending && 'opacity-60',
      )}
    >
      <span className={clsx('w-6 shrink-0 text-center text-xs', mark ? 'font-semibold text-amber-400' : 'text-ink-faint')}>
        {mark || index}
      </span>
      <span className="min-w-0 flex-1 truncate">{describeSet(set, measure)}</span>
      {set.rpe !== undefined && <span className="shrink-0 text-xs text-ink-faint">RPE {set.rpe}</span>}
      {pending && <span className="shrink-0 text-xs text-ink-faint">saving…</span>}
    </button>
  );
}
