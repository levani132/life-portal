import type { EquipmentType, Measure, Muscle, PlanTarget, RecordKind, SetType, SetValues } from './training';

/**
 * Training sharing (spec 036): a post's Training attachment. Like a food publication it is a
 * snapshot the API builds from the author's own data at publishing time; it is never accepted
 * from a request and never refreshed. It is self-contained (FR-030): nothing here assumes it is
 * the post's only attachment.
 */
export const TRAINING_POST_KINDS = ['workout', 'plan', 'exercise'] as const;
export type TrainingPostKind = (typeof TRAINING_POST_KINDS)[number];

/** What the author asks to share. Ids are theirs; the API reads the rest. */
export type TrainingPostSelection =
  | {
      kind: 'workout';
      sessionId: string;
      /** Show each logged set's weight and reps. Off by default. */
      includeSets?: boolean;
      /** Show the personal records the workout set, with their values. Off by default. */
      showRecords?: boolean;
    }
  | {
      kind: 'plan';
      planId: string;
      /** The plan workouts to include, by id. Absent: all of them. */
      workoutIds?: string[];
    }
  | { kind: 'exercise'; exerciseId: string };

/**
 * One exercise used by the attachment. A catalogue exercise is referenced (`exerciseId`: every
 * member has it); one that was the author's own carries its details, so the post is readable and
 * copyable without access to their private exercises.
 */
export interface PublishedExercise {
  /** Referenced by the workout, plan or exercise part. Ordinal within this publication. */
  key: string;
  name: string;
  primaryMuscles: Muscle[];
  equipmentType: EquipmentType;
  measure: Measure;
  /** A shared catalogue row: copies use it directly. */
  exerciseId?: string;
  /** The author's own exercise: `sourceId` is its id there, used to copy it once per viewer. */
  own?: boolean;
  sourceId?: string;
  secondaryMuscles?: Muscle[];
  instructions?: string[];
}

export interface PublishedSet extends SetValues {
  type: SetType;
}

export interface PublishedRecord {
  /** The exercise's `key` in `exercises`. */
  key: string;
  kind: RecordKind;
  /** As `RecordEntry.value`: grams, reps, seconds, metres, or seconds per kilometre. */
  value: number;
  loadGrams?: number;
}

export interface PublishedWorkoutExercise {
  key: string;
  /** How many sets were logged, and whether each was a warm-up. Never a weight or reps. */
  setTypes: SetType[];
  restSeconds?: number;
  superset?: string;
  /** Only with `includeSets`: the sets as logged. Never body weight. */
  logged?: PublishedSet[];
}

export interface PublishedPlanExercise {
  key: string;
  restSeconds?: number;
  note?: string;
  superset?: string;
  targets: PlanTarget[];
}

interface PublicationBase {
  kind: TrainingPostKind;
  label: string;
  workout?: {
    name: string;
    day: string;
    durationSeconds: number;
    exercises: PublishedWorkoutExercise[];
    /** Only with `showRecords`. */
    records?: PublishedRecord[];
  };
  plan?: {
    name: string;
    description?: string;
    /** `includedWorkouts` of `totalWorkouts`: a partial plan says so, and nothing more. */
    includedWorkouts: number;
    totalWorkouts: number;
    workouts: { name: string; exercises: PublishedPlanExercise[] }[];
  };
  exercise?: { key: string };
}

/** As stored on the post. An own exercise's photo is the post's own copy, by storage key. */
export interface TrainingPublication extends PublicationBase {
  exercises: (PublishedExercise & { image?: { key: string; width: number; height: number } })[];
}

/** As returned to a viewer: photos are short-lived signed links. A storage key never leaves the API. */
export interface TrainingAttachment extends PublicationBase {
  exercises: (PublishedExercise & { image?: { url: string; width: number; height: number } })[];
}

export interface TrainingPostPreview {
  training: TrainingAttachment;
  trainingHash: string;
}

/** Where a copied post went. `reused`: it had been copied before and that copy is returned. */
export interface TrainingCopyResult {
  kind: TrainingPostKind;
  planId?: string;
  planWorkoutId?: string;
  exerciseId?: string;
  reused: boolean;
}

/**
 * `POST /posts/:id/training-copy`. A single workout (a workout post, or a plan post holding one
 * workout) goes into an existing own plan (`planId`) or a new one (`planName`); exactly one. A
 * whole plan and an exercise take neither.
 */
export interface TrainingCopyInput {
  requestId: string;
  planId?: string;
  planName?: string;
}

/** `GET /posts/:id/training-copy`: what copying would do, before doing it. */
export interface TrainingCopyPreview {
  kind: TrainingPostKind;
  /** The copy this viewer already has, if any. */
  existing?: TrainingCopyResult;
  /** A single workout: the viewer chooses a plan. */
  needsPlanChoice: boolean;
  /** Own exercises that would be created (those of the author's not copied before). */
  newExercises: string[];
}

/** Where a copy came from, shown on a copied plan or exercise. Survives the post's deletion. */
export interface TrainingAttribution {
  label: string;
  postId?: string;
  authorId?: string;
}
