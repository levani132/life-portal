import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateIf,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  EQUIPMENT_TYPES,
  MEASURES,
  MUSCLES,
  PLAN_LIMITS,
  PLAN_TARGET_TYPES,
  SET_TYPES,
  WEIGHT_UNITS,
  RANK_STANDARDS,
  type EquipmentType,
  type Measure,
  type Muscle,
} from '@life-portal/shared-types';

/**
 * Bounds that depend on the exercise's measure (which fields apply, their ranges) are checked
 * by `validateSetValues` in the service, so the API, the form and the tests share one table.
 * These DTOs only check shape. There is deliberately no field for `snapshot`, `loggedAt`,
 * `exerciseId` on a PATCH, or `userId` anywhere: `forbidNonWhitelisted` turns them into 400s.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SUPERSET_KEY = /^[A-Za-z0-9_-]+$/;

export class StartSessionDto {
  @IsUUID() requestId!: string;
  @Matches(DAY, { message: 'day must be a calendar date in YYYY-MM-DD form' }) day!: string;
  /** Spec 023: start a plan's workout. Both or neither; checked in the service. */
  @IsOptional() @IsMongoId() planId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) planWorkoutId?: string;
}

export class UpdateSessionDto {
  @IsOptional() @Matches(DAY, { message: 'day must be a calendar date in YYYY-MM-DD form' })
  day?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

/** Spec 025: when this rest ends, or `null` to cancel. Required, so a missing field is a 400. */
export class RestAlarmDto {
  @ValidateIf((_, value) => value !== null) @IsISO8601({ strict: true }) at!: string | null;
}

export class FinishSessionDto {
  @IsOptional() @IsIn(['now', 'lastSet']) at?: 'now' | 'lastSet';
}

/**
 * There is no `machineId` (#14): the exercise names its equipment. An old client that still sends
 * one gets a 400 from `forbidNonWhitelisted` rather than having it silently dropped.
 */
export class AddSessionExerciseDto {
  @IsUUID() requestId!: string;
  @IsMongoId() exerciseId!: string;
}

export class UpdateSessionExerciseDto {
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** Spec 023: only for an exercise that came from a plan. */
  @IsOptional() @IsBoolean() skipped?: boolean;
  /** Spec 025: this workout's rest after a set of it; `null` goes back to the plan or default. */
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(0) @Max(PLAN_LIMITS.restMax)
  restSeconds?: number | null;
  /** Spec 025: the superset key; `null` takes it out of any superset. */
  @IsOptional() @ValidateIf((_, value) => value !== null) @Matches(SUPERSET_KEY) @MaxLength(PLAN_LIMITS.superset)
  superset?: string | null;
}

/** Spec 023: the replacement for an exercise with no sets. There is no field for `planned`. */
export class SwapSessionExerciseDto {
  @IsUUID() requestId!: string;
  @IsMongoId() exerciseId!: string;
}

// ------------------------------------------------------------------ own exercises
// Create and update are separate classes on purpose: a subclass cannot drop the parent's
// `@IsOptional()`, so "required on create" would silently become optional.

export class CreateExerciseDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(120, { each: true })
  aliases?: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MUSCLES.length) @IsIn(MUSCLES, { each: true })
  primaryMuscles!: Muscle[];
  @IsOptional() @IsArray() @ArrayMaxSize(MUSCLES.length) @IsIn(MUSCLES, { each: true })
  secondaryMuscles?: Muscle[];
  @IsIn(EQUIPMENT_TYPES) equipmentType!: EquipmentType;
  @IsIn(MEASURES) measure!: Measure;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(500, { each: true })
  instructions?: string[];
  @IsOptional() @IsMongoId() imageMediaId?: string;
}

export class UpdateExerciseDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(120, { each: true })
  aliases?: string[];
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MUSCLES.length) @IsIn(MUSCLES, { each: true })
  primaryMuscles?: Muscle[];
  @IsOptional() @IsArray() @ArrayMaxSize(MUSCLES.length) @IsIn(MUSCLES, { each: true })
  secondaryMuscles?: Muscle[];
  @IsOptional() @IsIn(EQUIPMENT_TYPES) equipmentType?: EquipmentType;
  @IsOptional() @IsIn(MEASURES) measure?: Measure;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(500, { each: true })
  instructions?: string[];
  @IsOptional() @IsMongoId() imageMediaId?: string;
  @IsOptional() @IsBoolean() removeImage?: boolean;
}

export class ReorderDto {
  @IsArray() @ArrayMaxSize(100) @IsMongoId({ each: true }) ids!: string[];
}

export class UpdateSetDto {
  @IsOptional() @IsIn(SET_TYPES) type?: (typeof SET_TYPES)[number];
  @IsOptional() @IsInt() reps?: number | null;
  @IsOptional() @IsInt() weightGrams?: number | null;
  @IsOptional() @IsInt() assistGrams?: number | null;
  @IsOptional() @IsInt() durationSeconds?: number | null;
  @IsOptional() @IsInt() distanceMeters?: number | null;
  @IsOptional() @IsNumber() rpe?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(3600) restSeconds?: number | null;
}

export class CreateSetDto extends UpdateSetDto {
  @IsUUID() requestId!: string;
}

export class UpdateTrainingProfileDto {
  @IsOptional() @IsIn(WEIGHT_UNITS) weightUnit?: (typeof WEIGHT_UNITS)[number];
  @IsOptional() @IsInt() @Min(0) @Max(900) defaultRestSeconds?: number;
  @IsOptional() @IsIn(RANK_STANDARDS) rankStandards?: (typeof RANK_STANDARDS)[number];
}

// ------------------------------------------------------------------ plans (spec 023)
// Shape and size only. Which fields a target may carry depends on its exercise's measure, so
// `validatePlan` checks that in the service, with the same rules the editor uses.

export class PlanTargetDto {
  @IsIn(PLAN_TARGET_TYPES) type!: (typeof PLAN_TARGET_TYPES)[number];
  @IsOptional() @IsInt() reps?: number;
  @IsOptional() @IsInt() repsMax?: number;
  @IsOptional() @IsInt() weightGrams?: number;
  @IsOptional() @IsInt() assistGrams?: number;
  @IsOptional() @IsInt() durationSeconds?: number;
  @IsOptional() @IsInt() distanceMeters?: number;
}

export class PlanExerciseDto {
  /** The id it was given; absent for a new exercise. */
  @IsOptional() @IsString() @MaxLength(100) id?: string;
  @IsMongoId() exerciseId!: string;
  @IsOptional() @IsInt() @Min(0) @Max(PLAN_LIMITS.restMax) restSeconds?: number;
  @IsOptional() @IsString() @MaxLength(PLAN_LIMITS.note) note?: string;
  @IsOptional() @Matches(SUPERSET_KEY) @MaxLength(PLAN_LIMITS.superset) superset?: string;
  @IsArray() @ArrayMinSize(PLAN_LIMITS.targetsMin) @ArrayMaxSize(PLAN_LIMITS.targetsMax)
  @ValidateNested({ each: true }) @Type(() => PlanTargetDto)
  targets!: PlanTargetDto[];
}

export class PlanWorkoutDto {
  @IsOptional() @IsString() @MaxLength(100) id?: string;
  /** Issue #15: the day's revision as loaded, so a stale save answers 409 instead of undoing an edit. */
  @IsOptional() @IsInt() @Min(0) revision?: number;
  @IsString() @MaxLength(PLAN_LIMITS.name) name!: string;
  @IsArray() @ArrayMaxSize(PLAN_LIMITS.exercises)
  @ValidateNested({ each: true }) @Type(() => PlanExerciseDto)
  exercises!: PlanExerciseDto[];
}

export class ReplacePlanDto {
  @IsString() @MaxLength(PLAN_LIMITS.name) name!: string;
  @IsOptional() @IsString() @MaxLength(PLAN_LIMITS.description) description?: string;
  @IsArray() @ArrayMaxSize(PLAN_LIMITS.workouts)
  @ValidateNested({ each: true }) @Type(() => PlanWorkoutDto)
  workouts!: PlanWorkoutDto[];
}

export class CreatePlanDto extends ReplacePlanDto {
  @IsUUID() requestId!: string;
}

export class CopyPlanDto {
  @IsUUID() requestId!: string;
}

/** Issue #15: apply a finished workout's changes to its plan day, at the revision reviewed. */
export class PlanDayUpdateDto {
  @IsUUID() requestId!: string;
  @IsInt() @Min(0) revision!: number;
}
