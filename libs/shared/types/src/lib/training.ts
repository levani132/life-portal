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

// ------------------------------------------------------------------ progress (spec 020 US3)

/**
 * What a personal record is a record of. Which kinds apply depends on the measure; warm-ups never
 * count. `most_reps` on a loaded exercise means "more reps than ever at this load or heavier".
 */
export const RECORD_KINDS = [
  'heaviest',
  'best_1rm',
  'most_reps',
  'longest_duration',
  'longest_distance',
  'fastest_pace',
] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/**
 * An estimated one-rep max, always with how it was worked out (principle 6). `weightGrams` is the
 * load the estimate came from; `bodyWeightDay` is set when that load includes a weigh-in.
 */
export interface OneRepMaxEstimate {
  valueGrams: number;
  basis: {
    formula: 'epley';
    fromSetId: string;
    weightGrams: number;
    reps: number;
    bodyWeightDay?: string;
  };
}

/** The current best of one kind, and the set that holds it. */
export interface RecordEntry {
  kind: RecordKind;
  /** Grams, reps, seconds, metres, or seconds per kilometre for pace. */
  value: number;
  setId: string;
  sessionId: string;
  day: string;
  /** Set when the value depends on a weigh-in (bodyweight or assisted loads). */
  bodyWeightDay?: string;
  /** For `most_reps` on a loaded exercise: the load those reps were done at. */
  loadGrams?: number;
}

export interface ExerciseHistorySession {
  sessionId: string;
  day: string;
  sets: WorkoutSet[];
  /** The session's best working set: highest 1RM, else load, reps, distance or time. */
  bestSetId?: string;
  /** Load × reps over working sets with a known load. */
  volumeGrams?: number;
  oneRepMax?: OneRepMaxEstimate;
}

/** The Home card's figures (research R11). No energy figure anywhere (FR-025). */
export interface TrainingSummary {
  /** Sessions whose day is in this Monday-based week, up to today. */
  workoutsThisWeek: number;
  secondsThisWeek: number;
  /** The newest record set in the last 14 days, if any. */
  latestRecord?: RecordEntry & { exerciseName: string };
  /** Days since the last workout's day, when there is no recent record. */
  daysSinceLast?: number;
  /** The person's display unit, so the server-built card shows a record as the page would. */
  weightUnit: WeightUnit;
  /** The open workout, if one is in progress: the card then offers Resume. */
  openSessionId?: string;
}

export interface ExerciseHistory {
  exercise: ExerciseListItem;
  sessions: ExerciseHistorySession[];
  /** Over every set of this exercise the caller ever logged, not just this page. */
  records: RecordEntry[];
  nextCursor?: string;
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
  /** Records this set set when it was done (computed on read; empty or absent for most sets). */
  records?: RecordKind[];
  /**
   * Bodyweight and assisted sets only: the load the set moved, body weight from the weigh-in on
   * or before the session's day (± added load or assistance). Absent without a weigh-in: no load
   * is invented (FR-020). Computed on read, never stored.
   */
  effectiveLoad?: { grams: number; bodyWeightDay: string };
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
  /** The best estimate from this session's sets of the exercise. */
  oneRepMax?: OneRepMaxEstimate;
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
