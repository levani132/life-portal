import type { RecordEntry, RecordKind } from '@life-portal/shared-types';

/**
 * Training's render-edge formatting (spec 020): whole grams, metres and seconds become "80 kg",
 * "2.5 km" and "1:30". Stored values never pass through here. Shared so the Home card, built on
 * the server, reads the same as the training page.
 */

const trim = (value: number, digits: number) => String(Number(value.toFixed(digits)));

export function formatWeight(grams: number): string {
  return `${trim(grams / 1000, 2)} kg`;
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
export function formatRecordValue(record: RecordEntry): string {
  switch (record.kind) {
    case 'heaviest':
    case 'best_1rm':
      return formatWeight(record.value);
    case 'most_reps':
      return record.loadGrams !== undefined ? `${record.value} reps at ${formatWeight(record.loadGrams)}` : `${record.value} reps`;
    case 'longest_duration':
      return formatDuration(record.value);
    case 'longest_distance':
      return formatDistance(record.value);
    case 'fastest_pace':
      return formatPace(record.value);
  }
}

