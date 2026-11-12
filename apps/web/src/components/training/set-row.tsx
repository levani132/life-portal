'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import {
  SET_TYPES,
  type Measure,
  type RecordKind,
  type SetType,
  type SetValues,
  type WeightUnit,
  type WorkoutSet,
} from '@life-portal/shared-types';
import { formatDay, formatWeight, isValidRpe, setFieldsFor, validateSetValues } from '@life-portal/shared-domain';
import { Input, Select } from '../ui';
import {
  RECORD_LABELS,
  SET_TYPE_LABELS,
  SET_TYPE_SHORT,
  describeSet,
  parseDuration,
  parseWeight,
  parseWhole,
  toFields,
  useWeightUnit,
} from '../../lib/training';

export interface SetFormValue extends SetValues {
  type: SetType;
  rpe?: number;
}

type Fields = ReturnType<typeof toFields> & { type: SetType; rpe: string };

const RPE_OPTIONS = ['', ...Array.from({ length: 19 }, (_, i) => String(1 + i / 2))];

/** Reads the text fields into whole units for the measure. Fields the measure lacks are left out. */
function readFields(measure: Measure, fields: Fields, unit: WeightUnit): SetFormValue {
  const allowed = setFieldsFor(measure).allowed;
  const value: SetFormValue = { type: fields.type };
  if (allowed.includes('reps')) value.reps = parseWhole(fields.reps);
  if (allowed.includes('weightGrams')) value.weightGrams = parseWeight(fields.weight, unit);
  if (allowed.includes('assistGrams')) value.assistGrams = parseWeight(fields.assist, unit);
  if (allowed.includes('durationSeconds')) value.durationSeconds = parseDuration(fields.duration);
  if (allowed.includes('distanceMeters')) value.distanceMeters = parseWhole(fields.distance);
  if (fields.rpe) value.rpe = Number(fields.rpe);
  return value;
}

/**
 * The inputs for one set, decided by the exercise's measure (`setFieldsFor`), so the form can
 * never offer a field the API would refuse. Weights are typed in the person's unit (kg or lb,
converted to grams once) with the decimal keypad
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
  const unit = useWeightUnit();
  const [fields, setFields] = useState<Fields>(() => ({
    ...toFields(initial, unit),
    type: initial?.type ?? 'working',
    rpe: initial?.rpe !== undefined ? String(initial.rpe) : '',
  }));
  // The fields hold text in a unit. If the unit changes under them (the profile loading after the
  // form, or a switch elsewhere), re-fill the weights from grams so "100" kg never goes out as lb.
  const filledIn = useRef(unit);
  useEffect(() => {
    if (filledIn.current === unit) return;
    filledIn.current = unit;
    const next = toFields(initial, unit);
    setFields((current) => ({ ...current, weight: next.weight, assist: next.assist }));
  }, [unit, initial]);
  const [problem, setProblem] = useState<string | null>(null);
  const allowed = setFieldsFor(measure).allowed;
  const set = (key: keyof Fields) => (event: { target: { value: string } }) => {
    setFields((current) => ({ ...current, [key]: event.target.value }));
    setProblem(null);
  };

  const submit = async () => {
    const value = readFields(measure, fields, unit);
    const issue =
      validateSetValues(measure, value) ??
      (value.rpe !== undefined && !isValidRpe(value.rpe) ? 'RPE must be 1–10.' : null);
    if (issue) {
      setProblem(issue);
      return;
    }
    await onSubmit(value);
  };

  const weightLabel = measure === 'weight_reps' ? unit : `+${unit}`;
  return (
    <div className={clsx('space-y-2', compact && 'text-sm')}>
      <div className="flex flex-wrap items-end gap-2">
        {allowed.includes('weightGrams') && (
          <label className="w-20 shrink-0">
            <span className="label">{weightLabel}</span>
            <Input inputMode="decimal" value={fields.weight} onChange={set('weight')} placeholder="0" aria-label={`Weight in ${unit}`} />
          </label>
        )}
        {allowed.includes('assistGrams') && (
          <label className="w-20 shrink-0">
            <span className="label">−{unit}</span>
            <Input inputMode="decimal" value={fields.assist} onChange={set('assist')} placeholder="0" aria-label={`Assistance in ${unit}`} />
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
  best,
}: {
  index: number;
  set: SetValues & {
    type: SetType;
    rpe?: number;
    records?: RecordKind[];
    effectiveLoad?: WorkoutSet['effectiveLoad'];
  };
  measure: Measure;
  pending?: boolean;
  onClick?: () => void;
  /** Highlights the session's best set in history. */
  best?: boolean;
}) {
  const unit = useWeightUnit();
  const mark = SET_TYPE_SHORT[set.type];
  const records = set.records ?? [];
  // Bodyweight and assisted sets: the load they moved, labelled with the weigh-in it came from
  // (FR-020). Without a weigh-in the API sends none and nothing is shown.
  const load = set.effectiveLoad;
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
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate', best && 'font-semibold')}>{describeSet(set, measure, unit)}</span>
        {load && (
          <span className="block truncate text-xs text-ink-faint">
            {formatWeight(load.grams, unit)} load · from weigh-in {formatDay(load.bodyWeightDay)}
          </span>
        )}
      </span>
      {records.length > 0 && (
        <span
          className="shrink-0 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
          title={`Personal record: ${records.map((kind) => RECORD_LABELS[kind]).join(', ')}`}
          aria-label={`Personal record: ${records.map((kind) => RECORD_LABELS[kind]).join(', ')}`}
        >
          PR
        </span>
      )}
      {set.rpe !== undefined && <span className="shrink-0 text-xs text-ink-faint">RPE {set.rpe}</span>}
      {pending && <span className="shrink-0 text-xs text-ink-faint">saving…</span>}
    </button>
  );
}
