'use client';

import { mutate } from 'swr';
import type {
  Measure,
  SessionDetail,
  SetType,
  SetValues,
  TrainingProfile,
  WorkoutSet,
} from '@life-portal/shared-types';
import { useApi } from './hooks';
import { todayLocal } from './local-day';

/**
 * Training (spec 020) on the web side: SWR keys, the eater's day, and the render-edge formatting
 * of grams, metres and seconds. Stored values are always whole grams/metres/seconds; this file
 * is the only place they turn into "80 kg" or "1:30".
 */

export const CURRENT_KEY = '/training/sessions/current';
export const sessionKey = (id: string) => `/training/sessions/${id}`;

/** Refetches every training query: after a write, the session and history both move. */
export function revalidateTraining(): Promise<unknown> {
  return mutate((key) => typeof key === 'string' && key.startsWith('/training'));
}

export function useTrainingProfile(): TrainingProfile {
  const { data } = useApi<TrainingProfile>('/training/profile');
  return data ?? { weightUnit: 'kg', defaultRestSeconds: 90 };
}

/**
 * The day a workout belongs to, by the same rule as meals: the browser's clock and the Food
 * profile's day-start hour (default 4, so a 01:00 session counts for the day that is ending).
 */
export function useWorkoutDay(): () => string {
  const { data } = useApi<{ profile: { dayStartHour: number } }>('/nutrition/profile', {
    // An account without Food still trains; the default hour applies.
    shouldRetryOnError: false,
  });
  const hour = data?.profile.dayStartHour ?? 4;
  return () => todayLocal(hour);
}

export function useCurrentSession() {
  return useApi<SessionDetail | undefined>(CURRENT_KEY);
}

// ------------------------------------------------------------------ formatting

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

/** A set in one line, e.g. `80 kg × 8`, `+10 kg × 12`, `−20 kg × 8`, `2 km in 9:30`. */
export function describeSet(set: SetValues, measure: Measure): string {
  switch (measure) {
    case 'weight_reps':
      return `${formatWeight(set.weightGrams ?? 0)} × ${set.reps ?? 0}`;
    case 'bodyweight_reps':
      return set.weightGrams ? `+${formatWeight(set.weightGrams)} × ${set.reps}` : `${set.reps} reps`;
    case 'assisted_reps':
      return `−${formatWeight(set.assistGrams ?? 0)} × ${set.reps ?? 0}`;
    case 'duration':
      return set.weightGrams
        ? `${formatDuration(set.durationSeconds ?? 0)} with ${formatWeight(set.weightGrams)}`
        : formatDuration(set.durationSeconds ?? 0);
    case 'distance_duration':
      return `${formatDistance(set.distanceMeters ?? 0)} in ${formatDuration(set.durationSeconds ?? 0)}`;
  }
}

export const SET_TYPE_LABELS: Record<SetType, string> = {
  warmup: 'Warm-up',
  working: 'Working',
  drop: 'Drop set',
  failure: 'To failure',
};

export const SET_TYPE_SHORT: Record<SetType, string> = {
  warmup: 'W',
  working: '',
  drop: 'D',
  failure: 'F',
};

export const MEASURE_LABELS: Record<Measure, string> = {
  weight_reps: 'Weight × reps',
  bodyweight_reps: 'Bodyweight reps',
  assisted_reps: 'Assisted reps',
  duration: 'Time',
  distance_duration: 'Distance and time',
};

export function humanise(value: string): string {
  const text = value.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ------------------------------------------------------------------ input parsing

/** `'80'`/`'80.5'` kg → whole grams, or `undefined` for an empty or unreadable field. */
export function parseKg(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? Math.round(value * 1000) : undefined;
}

export function parseWhole(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

/** `'90'` → 90 s, `'1:30'` → 90 s, `'1:02:05'` → 3725 s. */
export function parseDuration(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0) || parts.length > 3) return undefined;
  return Math.round(parts.reduce((total, part) => total * 60 + part, 0));
}

/** The text a field shows for a stored value, so a new set can start from the last one. */
export function toFields(set: Partial<WorkoutSet> | undefined) {
  return {
    reps: set?.reps !== undefined ? String(set.reps) : '',
    weight: set?.weightGrams !== undefined ? trim(set.weightGrams / 1000, 2) : '',
    assist: set?.assistGrams !== undefined ? trim(set.assistGrams / 1000, 2) : '',
    duration: set?.durationSeconds !== undefined ? formatDuration(set.durationSeconds) : '',
    distance: set?.distanceMeters !== undefined ? String(set.distanceMeters) : '',
  };
}
