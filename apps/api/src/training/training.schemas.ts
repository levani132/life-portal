import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  EQUIPMENT_TYPES,
  EXERCISE_LEVELS,
  MEASURES,
  MECHANICS,
  MUSCLES,
  SET_TYPES,
  WEIGHT_UNITS,
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

/** A specific machine, private to its creator in this phase (research R10). */
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
}

export const TrainingProfileSchema = SchemaFactory.createForClass(TrainingProfile);

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
}

export const WorkoutSessionSchema = SchemaFactory.createForClass(WorkoutSession);
WorkoutSessionSchema.index({ userId: 1, requestId: 1 }, { unique: true });
WorkoutSessionSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' }, name: 'one_open_session' },
);
WorkoutSessionSchema.index({ userId: 1, day: -1, startedAt: -1 });

// ------------------------------------------------------------------ exercises in a session

class ExerciseSnapshotDoc {
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) equipmentType!: string;
  @Prop({ required: true }) measure!: string;
  @Prop({ type: [String], default: [] }) primaryMuscles!: string[];
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
  @Prop() machineId?: string;
  @Prop({ required: true, type: ExerciseSnapshotDoc }) snapshot!: ExerciseSnapshotDoc;
  @Prop({ trim: true, maxlength: 500 }) notes?: string;
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
