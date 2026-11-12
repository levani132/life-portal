import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
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
} from 'class-validator';
import {
  EQUIPMENT_TYPES,
  MEASURES,
  MUSCLES,
  SET_TYPES,
  WEIGHT_UNITS,
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

export class StartSessionDto {
  @IsUUID() requestId!: string;
  @Matches(DAY, { message: 'day must be a calendar date in YYYY-MM-DD form' }) day!: string;
}

export class UpdateSessionDto {
  @IsOptional() @Matches(DAY, { message: 'day must be a calendar date in YYYY-MM-DD form' })
  day?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class FinishSessionDto {
  @IsOptional() @IsIn(['now', 'lastSet']) at?: 'now' | 'lastSet';
}

export class AddSessionExerciseDto {
  @IsUUID() requestId!: string;
  @IsMongoId() exerciseId!: string;
  @IsOptional() @IsMongoId() machineId?: string;
}

export class UpdateSessionExerciseDto {
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** `null` clears the machine. */
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsMongoId() machineId?: string | null;
}

// ------------------------------------------------------------------ own exercises and machines
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

export class CreateMachineDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(80) brand?: string;
  @IsIn(EQUIPMENT_TYPES) equipmentType!: EquipmentType;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsMongoId({ each: true }) exerciseIds?: string[];
  @IsOptional() @IsMongoId() imageMediaId?: string;
}

export class UpdateMachineDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(80) brand?: string;
  @IsOptional() @IsIn(EQUIPMENT_TYPES) equipmentType?: EquipmentType;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsMongoId({ each: true }) exerciseIds?: string[];
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
}
