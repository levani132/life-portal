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

/**
 * One set as the text in its inputs. For `bodyweight_reps`, `weight` is the signed external load:
 * `10` is added weight and `-20` is assistance, so one field covers both (never both at once).
 */
export type SetFields = ReturnType<typeof toFields> & { type: SetType; rpe: string };

const RPE_OPTIONS = ['', ...Array.from({ length: 19 }, (_, i) => String(1 + i / 2))];

/** The text the inputs start with for a stored set, a suggestion, or nothing. */
export function fieldsFor(
  measure: Measure,
  set: (Partial<SetValues> & { type?: SetType; rpe?: number }) | undefined,
  unit: WeightUnit,
): SetFields {
  const base = toFields(set as Partial<WorkoutSet> | undefined, unit);
  return {
    ...base,
    weight: measure === 'bodyweight_reps' && set?.assistGrams ? `-${base.assist}` : base.weight,
    type: set?.type ?? 'working',
    rpe: set?.rpe !== undefined ? String(set.rpe) : '',
  };
}

/** Reads the text fields into whole units for the measure. Fields the measure lacks are left out. */
export function readFields(measure: Measure, fields: SetFields, unit: WeightUnit): SetFormValue {
  const allowed = setFieldsFor(measure).allowed;
  const value: SetFormValue = { type: fields.type };
  if (allowed.includes('reps')) value.reps = parseWhole(fields.reps);
  if (measure === 'bodyweight_reps') {
    // One signed field: below zero is assistance, above is added weight, zero is neither.
    const grams = parseWeight(fields.weight, unit);
    if (grams !== undefined && grams < 0) value.assistGrams = -grams;
    else if (grams) value.weightGrams = grams;
  } else {
    if (allowed.includes('weightGrams')) value.weightGrams = parseWeight(fields.weight, unit);
    if (allowed.includes('assistGrams')) {
      // Assistance is a magnitude; `20` and `-20` both mean 20 off.
      const grams = parseWeight(fields.assist, unit);
      value.assistGrams = grams === undefined ? undefined : Math.abs(grams);
    }
  }
  if (allowed.includes('durationSeconds')) value.durationSeconds = parseDuration(fields.duration);
  if (allowed.includes('distanceMeters')) value.distanceMeters = parseWhole(fields.distance);
  if (fields.rpe) value.rpe = Number(fields.rpe);
  return value;
}

/** What is wrong with a set as typed, in words for the person, or `null`. */
export function setIssue(measure: Measure, value: SetFormValue): string | null {
  return (
    validateSetValues(measure, value) ??
    (value.rpe !== undefined && !isValidRpe(value.rpe) ? 'RPE must be 1–10.' : null)
  );
}

export interface SetColumn {
  key: 'weight' | 'assist' | 'reps' | 'distance' | 'duration';
  label: string;
  aria: string;
  inputMode: 'decimal' | 'numeric' | 'text';
  placeholder: string;
  /** The body-weight load: a sign switch sits in the field, as the iOS number pad has no minus. */
  signed?: boolean;
}

/**
 * The value inputs a set of this measure has, in order. Decided by `setFieldsFor`, so the UI can
 * never offer a field the API would refuse. At most two for any measure, so a row fits a phone.
 */
export function setColumns(measure: Measure, unit: WeightUnit): SetColumn[] {
  const allowed = setFieldsFor(measure).allowed;
  const columns: SetColumn[] = [];
  if (measure === 'bodyweight_reps') {
    columns.push({ key: 'weight', label: `± ${unit}`, aria: `Added weight in ${unit}, or assistance as a negative number`, inputMode: 'decimal', placeholder: '0', signed: true });
  } else if (allowed.includes('weightGrams')) {
    columns.push({ key: 'weight', label: measure === 'weight_reps' ? unit : `+ ${unit}`, aria: `Weight in ${unit}`, inputMode: 'decimal', placeholder: '0' });
  } else if (allowed.includes('assistGrams')) {
    columns.push({ key: 'assist', label: `− ${unit}`, aria: `Assistance in ${unit}`, inputMode: 'decimal', placeholder: '0' });
  }
  if (allowed.includes('reps')) columns.push({ key: 'reps', label: 'Reps', aria: 'Reps', inputMode: 'numeric', placeholder: '0' });
  if (allowed.includes('distanceMeters')) columns.push({ key: 'distance', label: 'Metres', aria: 'Distance in metres', inputMode: 'numeric', placeholder: '0' });
  if (allowed.includes('durationSeconds')) columns.push({ key: 'duration', label: 'Time', aria: 'Time, minutes:seconds', inputMode: 'text', placeholder: 'm:ss' });
  return columns;
}

/**
 * A number with a sign switch in front: `+` is added weight, `−` is assistance. Typing a minus
 * works too where the keyboard has one; the switch is for the iOS decimal pad, which does not.
 */
function SignedInput({
  value,
  onChange,
  column,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  column: SetColumn;
  disabled?: boolean;
  className?: string;
}) {
  const negative = value.startsWith('-');
  const magnitude = value.replace(/^[-+]/, '');
  return (
    <span className="relative block">
      <button
        type="button"
        className={clsx(
          'absolute inset-y-1 left-1 flex w-8 items-center justify-center rounded-md text-base font-bold leading-none transition-colors disabled:opacity-50',
          negative ? 'bg-amber-500/15 text-amber-400' : 'bg-border/40 text-ink-muted hover:text-ink',
        )}
        disabled={disabled}
        onClick={() => onChange(negative ? magnitude : `-${magnitude}`)}
        aria-label={negative ? 'Assistance. Switch to added weight' : 'Added weight. Switch to assistance'}
        title={negative ? 'Assistance (taken off your body weight)' : 'Added weight'}
      >
        {negative ? '−' : '+'}
      </button>
      <Input
        inputMode="decimal"
        className={clsx('pl-10', className)}
        value={magnitude}
        disabled={disabled}
        placeholder={column.placeholder}
        aria-label={column.aria}
        onChange={(event) => {
          const raw = event.target.value;
          const next = raw.includes('-') ? true : raw.includes('+') ? false : negative;
          onChange(`${next ? '-' : ''}${raw.replace(/[-+]/g, '')}`);
        }}
      />
    </span>
  );
}

/** The input for one column of a set. */
export function SetInput({
  column,
  fields,
  onChange,
  disabled,
  className,
}: {
  column: SetColumn;
  fields: SetFields;
  onChange: (key: SetColumn['key'], value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (column.signed) {
    return (
      <SignedInput
        column={column}
        value={fields[column.key]}
        onChange={(value) => onChange(column.key, value)}
        disabled={disabled}
        className={className}
      />
    );
  }
  return (
    <Input
      inputMode={column.inputMode}
      className={className}
      value={fields[column.key]}
      disabled={disabled}
      placeholder={column.placeholder}
      aria-label={column.aria}
      onChange={(event) => onChange(column.key, event.target.value)}
    />
  );
}

/** Type and RPE: the two things about a set that are not a number typed in its row. */
export function SetExtras({
  fields,
  onChange,
}: {
  fields: SetFields;
  onChange: (patch: Partial<SetFields>) => void;
}) {
  return (
    <>
      <label className="w-28 shrink-0">
        <span className="label">Type</span>
        <Select value={fields.type} onChange={(event) => onChange({ type: event.target.value as SetType })} aria-label="Set type">
          {SET_TYPES.map((type) => (
            <option key={type} value={type}>
              {SET_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </label>
      <label className="w-20 shrink-0">
        <span className="label">RPE</span>
        <Select value={fields.rpe} onChange={(event) => onChange({ rpe: event.target.value })} aria-label="RPE">
          {RPE_OPTIONS.map((rpe) => (
            <option key={rpe} value={rpe}>
              {rpe || '–'}
            </option>
          ))}
        </Select>
      </label>
    </>
  );
}

/**
 * The whole of one set as a form (the edit dialog). Weights are typed in the person's unit (kg or
 * lb, converted to grams once) with the decimal keypad (`Input` turns a Georgian-keyboard comma
 * into a dot); everything sent is whole grams, metres and seconds.
 */
export function SetForm({
  measure,
  initial,
  submitLabel,
  onSubmit,
  pending,
}: {
  measure: Measure;
  initial?: Partial<WorkoutSet>;
  submitLabel: string;
  onSubmit: (value: SetFormValue) => void | Promise<unknown>;
  pending?: boolean;
}) {
  const unit = useWeightUnit();
  const [fields, setFields] = useState<SetFields>(() => fieldsFor(measure, initial, unit));
  // The fields hold text in a unit. If the unit changes under them (the profile loading after the
  // form, or a switch elsewhere), re-fill the weights from grams so "100" kg never goes out as lb.
  const filledIn = useRef(unit);
  useEffect(() => {
    if (filledIn.current === unit) return;
    filledIn.current = unit;
    const next = fieldsFor(measure, initial, unit);
    setFields((current) => ({ ...current, weight: next.weight, assist: next.assist }));
  }, [unit, initial, measure]);
  const [problem, setProblem] = useState<string | null>(null);
  const patch = (change: Partial<SetFields>) => {
    setFields((current) => ({ ...current, ...change }));
    setProblem(null);
  };

  const submit = async () => {
    const value = readFields(measure, fields, unit);
    const issue = setIssue(measure, value);
    if (issue) {
      setProblem(issue);
      return;
    }
    await onSubmit(value);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        {setColumns(measure, unit).map((column) => (
          <label key={column.key} className={clsx('shrink-0', column.signed ? 'w-28' : 'w-20')}>
            <span className="label normal-case">{column.label}</span>
            <SetInput column={column} fields={fields} onChange={(key, value) => patch({ [key]: value })} />
          </label>
        ))}
        <SetExtras fields={fields} onChange={patch} />
        <button type="button" className="btn-primary shrink-0" disabled={pending} onClick={() => void submit()}>
          {submitLabel}
        </button>
      </div>
      {problem && <p className="text-xs text-rose-400">{problem}</p>}
    </div>
  );
}

/** Set types in colour (spec 024); the letter or number stays, so colour is never the only cue. */
export const SET_TYPE_CHIPS: Record<SetType, string> = {
  warmup: 'bg-train-core/15 text-train-core',
  working: 'bg-accent/15 text-accent',
  drop: 'bg-train-arms/15 text-train-arms',
  failure: 'bg-rose-500/15 text-rose-400',
};

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
      <span
        className={clsx(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
          SET_TYPE_CHIPS[set.type],
        )}
        title={SET_TYPE_LABELS[set.type]}
        aria-label={`Set ${index}, ${SET_TYPE_LABELS[set.type].toLowerCase()}`}
      >
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
