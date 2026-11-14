import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  EQUIPMENT_TYPES,
  EXERCISE_LEVELS,
  MEASURES,
  MECHANICS,
  MUSCLES,
  PLAN_TARGET_TYPES,
  SET_TYPES,
  WEIGHT_UNITS,
  RANK_STANDARDS,
  type PlanTargetType,
} from '@life-portal/shared-types';
import { baseSchemaOptions, requiredDayField } from '../common/mongoose';

/**
 * Training (spec 020). See `docs/modules/training.md`.
 *
 * Units: weight and assistance in whole **grams**, distance in whole **metres**, durations in
 * whole **seconds**. Optional numbers have **no default**: "no added weight" and "weight not
 * recorded" are different facts (CLAUDE.md, the `default: 0` rule).
 */
const integerValidator = {
  validator: (value: unknown) => value == null || Number.isInteger(value),
  message: 'Training values are whole grams, metres, seconds or reps',
};

const optionalInt = (min: number, max: number) =>
  ({ type: Number, min, max, validate: integerValidator }) as const;

/** A photo of a private exercise or machine. `key` never leaves the API. */
class StoredImage {
  @Prop({ required: true }) key!: string;
  @Prop({ required: true }) width!: number;
  @Prop({ required: true }) height!: number;
}

// ------------------------------------------------------------------ exercises

/**
 * The catalogue. Rows without `userId` are the shared catalogue, written only by the seeder;
 * rows with one are private to that user. Reads therefore cannot use `OwnedCrudService` and
 * build their `$or` explicitly (see `CatalogueService`).
 */
@Schema({ ...baseSchemaOptions, collection: 'exercises' })
export class Exercise {
  @Prop() userId?: string;
  @Prop({ required: true, trim: true, maxlength: 120 }) name!: string;
  @Prop({ type: [String], default: [] }) aliases!: string[];
  /** Name and aliases, normalised for search (`normaliseSearch`). Server-built. */
  @Prop({ required: true }) searchName!: string;
  @Prop({ type: [String], enum: MUSCLES, default: [] }) primaryMuscles!: string[];
  @Prop({ type: [String], enum: MUSCLES, default: [] }) secondaryMuscles!: string[];
  @Prop({ required: true, enum: EQUIPMENT_TYPES }) equipmentType!: string;
  @Prop({ required: true, enum: MEASURES }) measure!: string;
  @Prop({ enum: MECHANICS }) mechanic?: string;
  @Prop({ enum: EXERCISE_LEVELS }) level?: string;
  /** Private rows only in this phase (research R1). */
  @Prop({ type: [String], default: undefined }) instructions?: string[];
  @Prop({ type: StoredImage }) image?: StoredImage;
  /** Shared rows: `fedb:<dataset id>`. */
  @Prop() seedKey?: string;
  @Prop() seedVersion?: number;
  @Prop({ default: false }) archived!: boolean;
}

export const ExerciseSchema = SchemaFactory.createForClass(Exercise);
ExerciseSchema.index(
  { seedKey: 1 },
  { unique: true, partialFilterExpression: { seedKey: { $exists: true } } },
);
ExerciseSchema.index({ userId: 1, archived: 1, name: 1 });
ExerciseSchema.index({ searchName: 1 });

// ------------------------------------------------------------------ machines

/**
 * A specific machine, private to its creator (research R10). **Legacy since #14:** nothing creates,
 * edits or lists these any more, because an exercise names its equipment. Rows are kept, never
 * deleted, because past `workout_exercises.machineId` point at them; account deletion must still
 * remove them. `npm run training:machines-audit` reports what refers to them.
 */
@Schema({ ...baseSchemaOptions, collection: 'training_machines' })
export class TrainingMachine {
  @Prop({ required: true }) userId!: string;
  @Prop({ required: true, trim: true, maxlength: 120 }) name!: string;
  @Prop({ trim: true, maxlength: 80 }) brand?: string;
  @Prop({ required: true, enum: EQUIPMENT_TYPES }) equipmentType!: string;
  @Prop({ type: [String], default: [] }) exerciseIds!: string[];
  @Prop({ type: StoredImage }) image?: StoredImage;
  @Prop({ default: false }) archived!: boolean;
}

export const TrainingMachineSchema = SchemaFactory.createForClass(TrainingMachine);
TrainingMachineSchema.index({ userId: 1, archived: 1, name: 1 });
TrainingMachineSchema.index({ userId: 1, exerciseIds: 1 });

// ------------------------------------------------------------------ preferences

@Schema({ ...baseSchemaOptions, collection: 'training_profiles' })
export class TrainingProfile {
  @Prop({ required: true, unique: true }) userId!: string;
  @Prop({ required: true, enum: WEIGHT_UNITS, default: 'kg' }) weightUnit!: string;
  @Prop({ required: true, min: 0, max: 900, default: 90, validate: integerValidator })
  defaultRestSeconds!: number;
  /** Strength-rank standards (issue #5b), the member's own choice; absent until chosen. */
  @Prop({ enum: RANK_STANDARDS }) rankStandards?: string;
}

export const TrainingProfileSchema = SchemaFactory.createForClass(TrainingProfile);

// ------------------------------------------------------------------ plans (spec 023)

/** One planned set. Same fields and units as a set; which apply follows the exercise's measure. */
@Schema({ _id: false, versionKey: false })
class PlanTargetDoc {
  @Prop({ type: String, required: true, enum: PLAN_TARGET_TYPES, default: 'working' }) type!: PlanTargetType;
  @Prop(optionalInt(1, 1000)) reps?: number;
  @Prop(optionalInt(1, 1000)) repsMax?: number;
  @Prop(optionalInt(0, 1_000_000)) weightGrams?: number;
  @Prop(optionalInt(1, 500_000)) assistGrams?: number;
  @Prop(optionalInt(1, 86_400)) durationSeconds?: number;
  @Prop(optionalInt(1, 1_000_000)) distanceMeters?: number;
}
const PlanTargetSchema = SchemaFactory.createForClass(PlanTargetDoc);

@Schema({ _id: false, versionKey: false })
class PlanExerciseDoc {
  /** Stable within the plan (research R2). */
  @Prop({ required: true }) id!: string;
  @Prop({ required: true }) exerciseId!: string;
  @Prop(optionalInt(0, 900)) restSeconds?: number;
  @Prop({ trim: true, maxlength: 200 }) note?: string;
  /** Spec 025: neighbours with the same key are a superset. */
  @Prop({ maxlength: 40 }) superset?: string;
  @Prop({ type: [PlanTargetSchema], default: [] }) targets!: PlanTargetDoc[];
}
const PlanExerciseSchema = SchemaFactory.createForClass(PlanExerciseDoc);

@Schema({ _id: false, versionKey: false })
class PlanWorkoutDoc {
  /** Stable: sessions point at it, so progress survives edits and re-seeds. */
  @Prop({ required: true }) id!: string;
  @Prop({ required: true, trim: true, maxlength: 80 }) name!: string;
  @Prop({ type: [PlanExerciseSchema], default: [] }) exercises!: PlanExerciseDoc[];
  /**
   * Issue #15: bumped whenever this day's exercises change, for optimistic concurrency. Absent on
   * days never changed since; read as 0. No default, so an old row and a new one read the same.
   */
  @Prop({ type: Number, min: 0 }) revision?: number;
}
const PlanWorkoutSchema = SchemaFactory.createForClass(PlanWorkoutDoc);

class CopiedFromDoc {
  @Prop({ required: true }) planId!: string;
  @Prop({ required: true }) name!: string;
}

/**
 * A workout plan. Shared (ready-made) plans have no `userId` and are written only by
 * `PlanSeeder`, like catalogue exercises; own plans belong to one person. One document holds the
 * whole plan, because it is read and saved whole (research R1).
 */
@Schema({ ...baseSchemaOptions, collection: 'training_plans' })
export class TrainingPlan {
  @Prop() userId?: string;
  @Prop({ required: true, trim: true, maxlength: 80 }) name!: string;
  @Prop({ trim: true, maxlength: 1000 }) description?: string;
  @Prop({ type: [PlanWorkoutSchema], default: [] }) workouts!: PlanWorkoutDoc[];
  @Prop() seedKey?: string;
  @Prop() seedVersion?: number;
  /** Where a copy came from. Informational only; never followed for data. */
  @Prop({ type: CopiedFromDoc }) copiedFrom?: CopiedFromDoc;
  @Prop() requestId?: string;
  /** Shared plans dropped from the seed file. Hidden from lists, still readable by id. */
  @Prop({ default: false }) archived!: boolean;
}

export const TrainingPlanSchema = SchemaFactory.createForClass(TrainingPlan);
TrainingPlanSchema.index({ userId: 1, archived: 1, updatedAt: -1 });
TrainingPlanSchema.index({ seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $exists: true } } });
TrainingPlanSchema.index(
  { userId: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $exists: true } } },
);
TrainingPlanSchema.index({ userId: 1, 'workouts.exercises.exerciseId': 1 });

class SessionPlanDoc {
  @Prop({ required: true }) planId!: string;
  @Prop({ required: true }) planWorkoutId!: string;
  @Prop({ required: true }) planName!: string;
  @Prop({ required: true }) workoutName!: string;
  /** Issue #15: the day's revision when the workout started. Absent on older sessions. */
  @Prop({ type: Number }) revision?: number;
}

/** Issue #15: this workout updated a plan day. Written once; a retry with the same id returns it. */
class PlanUpdateDoc {
  @Prop({ required: true }) requestId!: string;
  @Prop({ required: true }) planId!: string;
  @Prop({ required: true }) planWorkoutId!: string;
  @Prop({ required: true }) copied!: boolean;
  @Prop({ required: true, type: Date }) at!: Date;
}

/** A plan exercise's targets, copied onto a workout exercise at start. Never edited. */
class PlannedDoc {
  @Prop({ required: true }) planExerciseId!: string;
  @Prop() restSeconds?: number;
  @Prop() note?: string;
  @Prop({ type: [PlanTargetSchema], default: [] }) targets!: PlanTargetDoc[];
}

// ------------------------------------------------------------------ sessions

@Schema({ ...baseSchemaOptions, collection: 'workout_sessions' })
export class WorkoutSession {
  @Prop({ required: true }) userId!: string;
  @Prop({ required: true }) requestId!: string;
  /** The eater's day, decided in the browser with `dayStartHour`, as for meals. */
  @Prop(requiredDayField) day!: string;
  /**
   * Stored next to `endedAt` only so a partial unique index can allow one open session per
   * person (research R5): Mongo cannot index "field absent".
   */
  @Prop({ required: true, enum: ['open', 'finished'], default: 'open' }) status!: string;
  @Prop({ required: true, type: Date }) startedAt!: Date;
  @Prop({ type: Date }) endedAt?: Date;
  @Prop({ trim: true, maxlength: 2000 }) notes?: string;
  /**
   * Spec 023: the plan workout it was started from, with the names as they were then. Frozen:
   * renaming or deleting the plan never changes a past or open workout.
   */
  @Prop({ type: SessionPlanDoc }) plan?: SessionPlanDoc;
  /**
   * Issue #15: plan exercises removed from this workout on purpose. Finishing drops not-done
   * planned rows too, so without this a removal and a skip would look the same afterwards.
   */
  @Prop({ type: [String], default: undefined }) removedPlanExerciseIds?: string[];
  @Prop({ type: PlanUpdateDoc }) planUpdate?: PlanUpdateDoc;
}

export const WorkoutSessionSchema = SchemaFactory.createForClass(WorkoutSession);
WorkoutSessionSchema.index({ userId: 1, requestId: 1 }, { unique: true });
WorkoutSessionSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' }, name: 'one_open_session' },
);
WorkoutSessionSchema.index({ userId: 1, day: -1, startedAt: -1 });
WorkoutSessionSchema.index({ userId: 1, 'plan.planId': 1, day: -1 });

// ------------------------------------------------------------------ exercises in a session

class ExerciseSnapshotDoc {
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) equipmentType!: string;
  @Prop({ required: true }) measure!: string;
  @Prop({ type: [String], default: [] }) primaryMuscles!: string[];
  /** Legacy (before #14): the machine it was logged on, frozen. Never written any more. */
  @Prop() machineName?: string;
  @Prop() machineBrand?: string;
}

/**
 * An exercise within a session. `snapshot` freezes the exercise as it was when added, so
 * renaming or correcting a catalogue row never rewrites a past workout: the same rule as
 * `meal_entries.facts`. It is built by the server, never accepted from a request, and never
 * refreshed on PATCH; `exerciseId` is not editable.
 */
@Schema({ ...baseSchemaOptions, collection: 'workout_exercises' })
export class WorkoutExercise {
  @Prop({ required: true }) userId!: string;
  @Prop({ required: true }) sessionId!: string;
  @Prop({ required: true }) requestId!: string;
  @Prop({ required: true, default: 0 }) order!: number;
  @Prop({ required: true }) exerciseId!: string;
  /** Legacy (before #14): a `training_machines` id. Still read by ranks; never written. */
  @Prop() machineId?: string;
  @Prop({ required: true, type: ExerciseSnapshotDoc }) snapshot!: ExerciseSnapshotDoc;
  @Prop({ trim: true, maxlength: 500 }) notes?: string;
  /**
   * Spec 023: the plan's targets for this exercise, copied at start: the snapshot rule applied to
   * suggestions. Built by the server, never accepted from a request, never refreshed.
   */
  @Prop({ type: PlannedDoc }) planned?: PlannedDoc;
  @Prop() skipped?: boolean;
  /**
   * Spec 025: the rest after a set, as changed during this workout. Not part of `planned`, which
   * stays as the plan said; this is what the person chose here.
   */
  @Prop(optionalInt(0, 900)) restSeconds?: number;
  /** Spec 025: neighbours with the same key are a superset. Copied from the plan, then editable. */
  @Prop({ maxlength: 40 }) superset?: string;
}

export const WorkoutExerciseSchema = SchemaFactory.createForClass(WorkoutExercise);
WorkoutExerciseSchema.index({ userId: 1, requestId: 1 }, { unique: true });
WorkoutExerciseSchema.index({ sessionId: 1, order: 1 });
WorkoutExerciseSchema.index({ userId: 1, exerciseId: 1, createdAt: -1 });

// ------------------------------------------------------------------ sets

/** The event row. Volume, records and estimates are computed from these on read. */
@Schema({ ...baseSchemaOptions, collection: 'workout_sets' })
export class WorkoutSet {
  @Prop({ required: true }) userId!: string;
  @Prop({ required: true }) sessionId!: string;
  @Prop({ required: true }) workoutExerciseId!: string;
  /** Copied from the workout exercise at creation: an immutable reference, for history. */
  @Prop({ required: true }) exerciseId!: string;
  @Prop({ required: true }) requestId!: string;
  @Prop({ required: true, default: 0 }) order!: number;
  @Prop({ required: true, enum: SET_TYPES, default: 'working' }) type!: string;
  @Prop(optionalInt(1, 1000)) reps?: number;
  @Prop(optionalInt(0, 1_000_000)) weightGrams?: number;
  @Prop(optionalInt(1, 500_000)) assistGrams?: number;
  @Prop(optionalInt(1, 86_400)) durationSeconds?: number;
  @Prop(optionalInt(1, 1_000_000)) distanceMeters?: number;
  /** A 1–10 scale in half steps, not a quantity, so not an integer. */
  @Prop({ min: 1, max: 10 }) rpe?: number;
  @Prop(optionalInt(0, 3600)) restSeconds?: number;
  @Prop({ required: true, type: Date }) loggedAt!: Date;
}

export const WorkoutSetSchema = SchemaFactory.createForClass(WorkoutSet);
WorkoutSetSchema.index({ userId: 1, requestId: 1 }, { unique: true });
WorkoutSetSchema.index({ workoutExerciseId: 1, order: 1 });
WorkoutSetSchema.index({ userId: 1, exerciseId: 1, loggedAt: -1 });
WorkoutSetSchema.index({ userId: 1, sessionId: 1 });
