import type { RecordEntry, RecordKind, WeightUnit } from '@life-portal/shared-types';

/**
 * Training's render-edge formatting (spec 020): whole grams, metres and seconds become "80 kg",
 * "2.5 km" and "1:30". Stored values never pass through here. Shared so the Home card, built on
 * the server, reads the same as the training page.
 */

const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)));

/** The international avoirdupois pound, exactly. */
export const GRAMS_PER_POUND = 453.59237;

const GRAMS_PER_UNIT: Record<WeightUnit, number> = { kg: 1000, lb: GRAMS_PER_POUND };

/**
 * Whole grams as the person's unit, to two decimals: `102058` → `102.06` kg or `225` lb. Display
 * only (research R9); a stored weight is never converted.
 */
export function gramsToDisplay(grams: number, unit: WeightUnit = 'kg'): number {
  return Number((grams / GRAMS_PER_UNIT[unit]).toFixed(2));
}

/** A typed weight in the person's unit → whole grams, rounded once: `225` lb → `102058`. */
export function displayToGrams(value: number, unit: WeightUnit = 'kg'): number {
  return Math.round(value * GRAMS_PER_UNIT[unit]);
}

export function formatWeight(grams: number, unit: WeightUnit = 'kg'): string {
  return `${trim(gramsToDisplay(grams, unit), 2)} ${unit}`;
}

/** `95` → `1:35`, `3725` → `1:02:05`. */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${trim(meters / 1000, 2)} km`;
}

/** `280` → `4:40 /km`. */
export function formatPace(secondsPerKm: number): string {
  return `${formatDuration(secondsPerKm)} /km`;
}

export const RECORD_LABELS: Record<RecordKind, string> = {
  heaviest: 'Heaviest',
  best_1rm: 'Best est. 1RM',
  most_reps: 'Most reps',
  longest_duration: 'Longest time',
  longest_distance: 'Longest distance',
  fastest_pace: 'Fastest pace',
};

/** A record's value, e.g. `120 kg`, `12 reps at 80 kg`, `4:40 /km`. */
export function formatRecordValue(record: RecordEntry, unit: WeightUnit = 'kg'): string {
  switch (record.kind) {
    case 'heaviest':
    case 'best_1rm':
      return formatWeight(record.value, unit);
    case 'most_reps':
      return record.loadGrams !== undefined
        ? `${record.value} reps at ${formatWeight(record.loadGrams, unit)}`
        : `${record.value} reps`;
    case 'longest_duration':
      return formatDuration(record.value);
    case 'longest_distance':
      return formatDistance(record.value);
    case 'fastest_pace':
      return formatPace(record.value);
  }
}

