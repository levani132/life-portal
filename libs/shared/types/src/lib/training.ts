/**
 * Training (spec 020): exercise catalogue and workout logging.
 *
 * Units: weight and assistance in whole **grams**, distance in whole **metres**, durations in
 * whole **seconds**. kg/lb is a display preference only. Calendar days are `YYYY-MM-DD`;
 * `startedAt`/`endedAt`/`loggedAt` are ISO instants.
 */

export const MUSCLES = [
  'abdominals',
  'abductors',
  'adductors',
  'biceps',
  'calves',
  'chest',
  'forearms',
  'glutes',
  'hamstrings',
  'lats',
  'lower_back',
  'middle_back',
  'neck',
  'quadriceps',
  'shoulders',
  'traps',
  'triceps',
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const EQUIPMENT_TYPES = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'cable',
  'machine',
  'smith_machine',
  'band',
  'bodyweight',
  'ez_bar',
  'trap_bar',
  'plate',
  'medicine_ball',
  'exercise_ball',
  'foam_roll',
  'other',
] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

/** What a set of an exercise records. One per exercise; see research R2. */
export const MEASURES = [
  'weight_reps',
  'bodyweight_reps',
  'assisted_reps',
  'duration',
  'distance_duration',
] as const;
export type Measure = (typeof MEASURES)[number];

export const SET_TYPES = ['warmup', 'working', 'drop', 'failure'] as const;
export type SetType = (typeof SET_TYPES)[number];

export const WEIGHT_UNITS = ['kg', 'lb'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const MECHANICS = ['compound', 'isolation'] as const;
export type Mechanic = (typeof MECHANICS)[number];

export const EXERCISE_LEVELS = ['beginner', 'intermediate', 'expert'] as const;
export type ExerciseLevel = (typeof EXERCISE_LEVELS)[number];

/** The numeric fields a set may carry. Which apply depends on the exercise's measure. */
export const SET_VALUE_FIELDS = [
  'reps',
  'weightGrams',
  'assistGrams',
  'durationSeconds',
  'distanceMeters',
] as const;
export type SetValueField = (typeof SET_VALUE_FIELDS)[number];

export interface SetValues {
  reps?: number;
  weightGrams?: number;
  assistGrams?: number;
  durationSeconds?: number;
  distanceMeters?: number;
}

/** Shown on every shared catalogue exercise (research R1). */
export const CATALOGUE_CREDIT = {
  label: 'Exercise list based on free-exercise-db',
  url: 'https://github.com/yuhonas/free-exercise-db',
} as const;

// ------------------------------------------------------------------ catalogue

export interface ExerciseListItem {
  id: string;
  name: string;
  primaryMuscles: Muscle[];
  equipmentType: EquipmentType;
  measure: Measure;
  /** A private exercise of the caller's, rather than a shared catalogue row. */
  isOwn: boolean;
  /** The caller logged it in the last 90 days; such rows are listed first. */
  recent?: boolean;
}

/** A signed, short-lived link to a stored photo. The storage key never leaves the API. */
export interface TrainingImage {
  url: string;
  width: number;
  height: number;
}

export interface Exercise extends ExerciseListItem {
  aliases: string[];
  secondaryMuscles: Muscle[];
  mechanic?: Mechanic;
  level?: ExerciseLevel;
  instructions?: string[];
  archived: boolean;
  /** Set on shared rows taken from a dataset. */
  attribution?: { label: string; url: string };
  image?: TrainingImage;
}

/** A specific machine, private to its creator in this phase. */
export interface Machine {
  id: string;
  name: string;
  brand?: string;
  equipmentType: EquipmentType;
  exerciseIds: string[];
  archived: boolean;
  image?: TrainingImage;
}

export interface TrainingProfile {
  weightUnit: WeightUnit;
  defaultRestSeconds: number;
}

// ------------------------------------------------------------------ sessions

export type SessionStatus = 'open' | 'finished';

/** Frozen at the moment an exercise is added to a session. Never refreshed. */
export interface ExerciseSnapshot {
  name: string;
  equipmentType: EquipmentType;
  measure: Measure;
  primaryMuscles: Muscle[];
  machineName?: string;
  machineBrand?: string;
}

export interface WorkoutSet extends SetValues {
  id: string;
  workoutExerciseId: string;
  exerciseId: string;
  order: number;
  type: SetType;
  rpe?: number;
  restSeconds?: number;
  loggedAt: string;
}

export interface SessionExercise {
  id: string;
  sessionId: string;
  exerciseId: string;
  machineId?: string;
  order: number;
  snapshot: ExerciseSnapshot;
  notes?: string;
  sets: WorkoutSet[];
  /** The caller's sets of this exercise from their most recent earlier session. */
  previous?: { sessionId: string; day: string; sets: WorkoutSet[] };
}

export interface SessionListItem {
  id: string;
  day: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  exerciseNames: string[];
  setCount: number;
}

export interface SessionDetail {
  id: string;
  day: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  notes?: string;
  /** Derived: to `endedAt`, or to the last activity while open. */
  durationSeconds: number;
  /** Derived: open, and nothing happened in it for more than 12 hours. */
  isStale: boolean;
  /** When the last set was logged, if any. */
  lastSetAt?: string;
  exercises: SessionExercise[];
  /** Set when `POST /sessions` found a session already open. */
  resumed?: boolean;
}

export interface SessionPage {
  sessions: SessionListItem[];
  nextCursor?: string;
}

// ------------------------------------------------------------------ requests

export interface StartSessionInput {
  requestId: string;
  day: string;
}

export interface AddSessionExerciseInput {
  requestId: string;
  exerciseId: string;
  machineId?: string;
}

/** A private exercise. Shared catalogue rows cannot be written. */
export interface ExerciseInput {
  name: string;
  aliases?: string[];
  primaryMuscles: Muscle[];
  secondaryMuscles?: Muscle[];
  equipmentType: EquipmentType;
  measure: Measure;
  instructions?: string[];
  imageMediaId?: string;
}

export type ExercisePatch = Partial<ExerciseInput> & { removeImage?: boolean };

export interface MachineInput {
  name: string;
  brand?: string;
  equipmentType: EquipmentType;
  exerciseIds?: string[];
  imageMediaId?: string;
}

export type MachinePatch = Partial<MachineInput> & { removeImage?: boolean };

/** `DELETE` of an exercise or machine: removed, or archived because a workout refers to it. */
export type TrainingDeleteResult = { id: string; deleted: true } | { id: string; archived: true };

export interface SetInput extends SetValues {
  requestId: string;
  type?: SetType;
  rpe?: number;
  restSeconds?: number;
}

export type SetPatch = Partial<Omit<SetInput, 'requestId'>>;
