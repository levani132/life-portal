import {
  EQUIPMENT_TYPES,
  MUSCLES,
  SET_VALUE_FIELDS,
  type EquipmentType,
  type Measure,
  type Muscle,
  type SetValueField,
  type SetValues,
} from '@life-portal/shared-types';

/**
 * Training (spec 020): pure rules shared by the API, the web form and the tests.
 * No clock, no Mongo: "now" is always an argument.
 */

// ------------------------------------------------------------------ set fields per measure

export interface SetFieldRule {
  /** Fields a set of this measure may carry. Anything else is rejected, not ignored. */
  allowed: readonly SetValueField[];
  /** Fields it must carry. */
  required: readonly SetValueField[];
}

const SET_FIELD_RULES: Record<Measure, SetFieldRule> = {
  weight_reps: { allowed: ['reps', 'weightGrams'], required: ['reps', 'weightGrams'] },
  // The weight is optional added load (a belt, a vest).
  bodyweight_reps: { allowed: ['reps', 'weightGrams'], required: ['reps'] },
  assisted_reps: { allowed: ['reps', 'assistGrams'], required: ['reps', 'assistGrams'] },
  // The weight is optional (a loaded carry for time).
  duration: { allowed: ['durationSeconds', 'weightGrams'], required: ['durationSeconds'] },
  distance_duration: {
    allowed: ['distanceMeters', 'durationSeconds'],
    required: ['distanceMeters', 'durationSeconds'],
  },
};

export function setFieldsFor(measure: Measure): SetFieldRule {
  return SET_FIELD_RULES[measure];
}

/** Inclusive bounds for each value. Anything outside is implausible input (spec edge cases). */
export const SET_LIMITS: Record<SetValueField, { min: number; max: number }> = {
  reps: { min: 1, max: 1000 },
  weightGrams: { min: 0, max: 1_000_000 },
  assistGrams: { min: 1, max: 500_000 },
  durationSeconds: { min: 1, max: 86_400 },
  distanceMeters: { min: 1, max: 1_000_000 },
};

const FIELD_LABELS: Record<SetValueField, string> = {
  reps: 'Reps',
  weightGrams: 'Weight',
  assistGrams: 'Assistance',
  durationSeconds: 'Time',
  distanceMeters: 'Distance',
};

/**
 * Checks a complete set's values against its measure. Returns a message for the person, or
 * `null` when valid. `undefined` and `null` both mean "not given".
 */
export function validateSetValues(
  measure: Measure,
  values: SetValues,
): string | null {
  const rule = setFieldsFor(measure);
  for (const field of SET_VALUE_FIELDS) {
    const value = values[field];
    const given = value !== undefined && value !== null;
    if (given && !rule.allowed.includes(field)) {
      return `${FIELD_LABELS[field]} does not apply to this exercise.`;
    }
    if (!given) {
      if (rule.required.includes(field)) return `${FIELD_LABELS[field]} is required.`;
      continue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return `${FIELD_LABELS[field]} must be a whole number.`;
    }
    const { min, max } = SET_LIMITS[field];
    if (value < min || value > max) {
      return `${FIELD_LABELS[field]} must be between ${min} and ${max}.`;
    }
  }
  return null;
}

/** RPE is a 1–10 scale in half steps. */
export function isValidRpe(rpe: number): boolean {
  return rpe >= 1 && rpe <= 10 && Number.isInteger(rpe * 2);
}

// ------------------------------------------------------------------ sessions

/** An open session with no activity for this long is offered to be finished or discarded. */
export const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * A session's duration in whole seconds: to `endedAt` when finished, else to its last
 * activity (the last set, or the start). Never to "now": an open session that was abandoned
 * must not keep growing.
 */
export function sessionDurationSeconds(input: {
  startedAt: string;
  endedAt?: string;
  lastSetAt?: string;
}): number {
  const start = Date.parse(input.startedAt);
  const end = Date.parse(input.endedAt ?? input.lastSetAt ?? input.startedAt);
  return Math.max(0, Math.round((end - start) / 1000));
}

export function isStaleSession(
  input: { status: 'open' | 'finished'; startedAt: string; lastSetAt?: string },
  nowMs: number,
): boolean {
  if (input.status !== 'open') return false;
  const last = Date.parse(input.lastSetAt ?? input.startedAt);
  return nowMs - last > STALE_SESSION_MS;
}

// ------------------------------------------------------------------ catalogue

/** Lower-case, accents folded, punctuation dropped, spaces collapsed. Used for search. */
export function normaliseSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A free-exercise-db entry, as vendored (facts only). */
export interface CatalogueEntry {
  id: string;
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  category: string;
}

const EQUIPMENT_MAP: Record<string, EquipmentType> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  'body only': 'bodyweight',
  cable: 'cable',
  machine: 'machine',
  kettlebells: 'kettlebell',
  bands: 'band',
  'medicine ball': 'medicine_ball',
  'exercise ball': 'exercise_ball',
  'foam roll': 'foam_roll',
  'e-z curl bar': 'ez_bar',
  other: 'other',
};

export function catalogueEquipment(entry: Pick<CatalogueEntry, 'equipment'>): EquipmentType {
  return (entry.equipment && EQUIPMENT_MAP[entry.equipment]) || 'other';
}

/** `middle back` → `middle_back`; unknown names are dropped. */
export function catalogueMuscles(names: string[]): Muscle[] {
  const known = new Set<string>(MUSCLES);
  return [
    ...new Set(
      names.map((name) => name.replace(/ /g, '_')).filter((name) => known.has(name)),
    ),
  ] as Muscle[];
}

/**
 * How a dataset exercise is measured (research R2): cardio is distance and time, stretches and
 * static holds are time, movements without equipment are bodyweight reps, the rest weight × reps.
 */
export function catalogueMeasure(
  entry: Pick<CatalogueEntry, 'category' | 'equipment' | 'force'>,
): Measure {
  if (entry.category === 'cardio') return 'distance_duration';
  if (entry.category === 'stretching' || entry.force === 'static') return 'duration';
  if (entry.equipment === 'body only' || entry.equipment === null) return 'bodyweight_reps';
  return 'weight_reps';
}

export function isEquipmentType(value: string): value is EquipmentType {
  return (EQUIPMENT_TYPES as readonly string[]).includes(value);
}
