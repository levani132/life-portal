'use client';

import { mutate } from 'swr';
import {
  displayToGrams,
  formatDay,
  formatDistance,
  formatDuration,
  formatWeight,
  gramsToDisplay,
} from '@life-portal/shared-domain';
import type {
  Measure,
  OneRepMaxEstimate,
  SessionDetail,
  SetType,
  SetValues,
  TrainingProfile,
  WeightUnit,
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

export const PROFILE_KEY = '/training/profile';

/** Spec 023: plans. */
export const PLANS_KEY = '/training/plans';
export const planKey = (id: string) => `/training/plans/${id}`;

export function useTrainingProfile(): TrainingProfile & { loaded: boolean } {
  const { data } = useApi<TrainingProfile>(PROFILE_KEY);
  return { ...(data ?? { weightUnit: 'kg', defaultRestSeconds: 90 }), loaded: !!data };
}

/** The person's display unit (spec 020 US5). Display and input only; stored weights are grams. */
export function useWeightUnit(): WeightUnit {
  return useTrainingProfile().weightUnit;
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

// Weight, time, distance, pace and record values: pure, shared with the Home card's server side.
export {
  RECORD_LABELS,
  formatDistance,
  formatDuration,
  formatPace,
  formatRecordValue,
  formatWeight,
} from '@life-portal/shared-domain';
export { describeTarget, prefillFor } from '@life-portal/shared-domain';

/** A set in one line, e.g. `80 kg × 8`, `+10 kg × 12`, `−20 kg × 8`, `2 km in 9:30`. */
export function describeSet(set: SetValues, measure: Measure, unit: WeightUnit = 'kg'): string {
  const w = (grams: number) => formatWeight(grams, unit);
  switch (measure) {
    case 'weight_reps':
      return `${w(set.weightGrams ?? 0)} × ${set.reps ?? 0}`;
    case 'bodyweight_reps':
      return set.weightGrams ? `+${w(set.weightGrams)} × ${set.reps}` : `${set.reps} reps`;
    case 'assisted_reps':
      return `−${w(set.assistGrams ?? 0)} × ${set.reps ?? 0}`;
    case 'duration':
      return set.weightGrams
        ? `${formatDuration(set.durationSeconds ?? 0)} with ${w(set.weightGrams)}`
        : formatDuration(set.durationSeconds ?? 0);
    case 'distance_duration':
      return `${formatDistance(set.distanceMeters ?? 0)} in ${formatDuration(set.durationSeconds ?? 0)}`;
  }
}

/** Where a body-weight-based figure came from, e.g. `body weight from weigh-in 1 Nov`. */
export function bodyWeightNote(day: string | undefined): string {
  return day ? `body weight from weigh-in ${formatDay(day)}` : '';
}

/**
 * An estimate is never shown without its basis (principle 6):
 * `est. 1RM 116.67 kg`, and `Epley, from 100 kg × 5`.
 */
export function describeOneRepMax(
  estimate: OneRepMaxEstimate,
  unit: WeightUnit = 'kg',
): { value: string; basis: string } {
  const { basis } = estimate;
  const note = bodyWeightNote(basis.bodyWeightDay);
  return {
    value: `est. 1RM ${formatWeight(estimate.valueGrams, unit)}`,
    basis: `Epley, from ${formatWeight(basis.weightGrams, unit)} × ${basis.reps}${note ? `; ${note}` : ''}`,
  };
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

/**
 * `'80'`/`'80.5'` in the person's unit → whole grams, converted once, or `undefined` for an empty
 * or unreadable field.
 */
export function parseWeight(text: string, unit: WeightUnit = 'kg'): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? displayToGrams(value, unit) : undefined;
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
export function toFields(set: Partial<WorkoutSet> | undefined, unit: WeightUnit = 'kg') {
  return {
    reps: set?.reps !== undefined ? String(set.reps) : '',
    weight: set?.weightGrams !== undefined ? String(gramsToDisplay(set.weightGrams, unit)) : '',
    assist: set?.assistGrams !== undefined ? String(gramsToDisplay(set.assistGrams, unit)) : '',
    duration: set?.durationSeconds !== undefined ? formatDuration(set.durationSeconds) : '',
    distance: set?.distanceMeters !== undefined ? String(set.distanceMeters) : '',
  };
}
