import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SET_TYPES, WEIGHT_UNITS } from '@life-portal/shared-types';

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
}

export class UpdateSessionExerciseDto {
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
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
