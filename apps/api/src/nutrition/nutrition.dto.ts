import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ACTIVITY_LEVELS,
  FOOD_ENTRY_MODES,
  FOOD_UNITS,
  MEAL_SLOTS,
  NUTRITION_GOALS,
  SEXES,
} from '@life-portal/shared-types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = { message: 'Must be a calendar date in YYYY-MM-DD form' };

/** Ceilings that catch a typo without arguing with a real meal. */
const MAX_AMOUNT = 20_000;
const MAX_NUTRIENT_MG = 100_000;

export class CreateFoodDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(120) brand?: string;
  @IsOptional() @IsIn(FOOD_UNITS) unit?: string;
  @IsInt() @Min(1) @Max(5000) servingSize!: number;
  @IsOptional() @IsString() @MaxLength(60) servingLabel?: string;
  /** Which way the numbers below are stated. The service normalises to per-100 on write. */
  @IsOptional() @IsIn(FOOD_ENTRY_MODES) entryMode?: string;
  @IsInt() @Min(0) @Max(9000) energyKcal!: number;
  @IsInt() @Min(0) @Max(MAX_NUTRIENT_MG * 20) proteinMg!: number;
  @IsInt() @Min(0) @Max(MAX_NUTRIENT_MG * 20) fatMg!: number;
  @IsInt() @Min(0) @Max(MAX_NUTRIENT_MG * 20) carbMg!: number;
  @IsOptional() @IsInt() @Min(0) fibreMg?: number;
  @IsOptional() @IsInt() @Min(0) sugarMg?: number;
  @IsOptional() @IsInt() @Min(0) satFatMg?: number;
  @IsOptional() @IsInt() @Min(0) sodiumMg?: number;
  @IsOptional() @IsBoolean() favourite?: boolean;
  @IsOptional() @IsString() @MaxLength(32) barcode?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/** PATCH variant: every field optional. */
export class UpdateFoodDto extends CreateFoodDto {
  @IsOptional() @IsString() @MaxLength(160) override name!: string;
  @IsOptional() @IsInt() @Min(1) @Max(5000) override servingSize!: number;
  @IsOptional() @IsInt() @Min(0) @Max(9000) override energyKcal!: number;
  @IsOptional() @IsInt() @Min(0) override proteinMg!: number;
  @IsOptional() @IsInt() @Min(0) override fatMg!: number;
  @IsOptional() @IsInt() @Min(0) override carbMg!: number;
}

export class ImportFoodDto {
  @IsString() @MaxLength(64) code!: string;
}

/**
 * An amount is given either in base units or in servings — never both, never neither. The
 * service converts servings with the food's serving size and stores base units, so the stored
 * row does not depend on a serving size that may later be edited.
 */
export class CreateEntryDto {
  @Matches(DAY, DAY_MESSAGE) day!: string;
  @IsIn(MEAL_SLOTS) slot!: string;
  @IsMongoId() foodId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_AMOUNT) amount?: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) servings?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class UpdateEntryDto {
  @IsOptional() @Matches(DAY, DAY_MESSAGE) day?: string;
  @IsOptional() @IsIn(MEAL_SLOTS) slot?: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_AMOUNT) amount?: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) servings?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class RepeatMealDto {
  @Matches(DAY, DAY_MESSAGE) sourceDay!: string;
  @IsOptional() @IsIn(MEAL_SLOTS) sourceSlot?: string;
  @IsOptional() @IsArray() @IsMongoId({ each: true }) entryIds?: string[];
  @Matches(DAY, DAY_MESSAGE) day!: string;
  @IsOptional() @IsIn(MEAL_SLOTS) slot?: string;
}

export class SavedMealComponentDto {
  @IsMongoId() foodId!: string;
  @IsInt() @Min(1) @Max(MAX_AMOUNT) amount!: number;
}

export class CreateSavedMealDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsIn(MEAL_SLOTS) defaultSlot?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SavedMealComponentDto)
  components!: SavedMealComponentDto[];
}

export class UpdateSavedMealDto extends CreateSavedMealDto {
  @IsOptional() @IsString() @MaxLength(120) override name!: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SavedMealComponentDto)
  override components!: SavedMealComponentDto[];
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class SaveSlotAsMealDto {
  @IsString() @MaxLength(120) name!: string;
  @Matches(DAY, DAY_MESSAGE) day!: string;
  @IsIn(MEAL_SLOTS) slot!: string;
}

export class LogSavedMealDto {
  @Matches(DAY, DAY_MESSAGE) day!: string;
  @IsOptional() @IsIn(MEAL_SLOTS) slot?: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsIn(SEXES) sex?: string;
  @IsOptional() @IsInt() @Min(100) @Max(250) heightCm?: number;
  @IsOptional() @Matches(DAY, DAY_MESSAGE) birthDate?: string;
  @IsOptional() @IsIn(ACTIVITY_LEVELS) activityLevel?: string;
  @IsOptional() @IsIn(NUTRITION_GOALS) goal?: string;
  @IsOptional() @IsInt() @Min(800) @Max(5000) basalRateKcal?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  cheatDays?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(12) dayStartHour?: number;
  @IsOptional() @IsInt() @Min(800) @Max(8000) energyOverrideKcal?: number;
  @IsOptional() @IsInt() @Min(0) @Max(500) proteinOverrideG?: number;
  @IsOptional() @IsInt() @Min(0) @Max(500) fatOverrideG?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) carbOverrideG?: number;
}

export class UpsertWeighInDto {
  @IsOptional() @Matches(DAY, DAY_MESSAGE) day?: string;
  @IsInt() @Min(20_000) @Max(400_000) weightGrams!: number;
  @IsOptional() @IsNumber() @Min(0.03) @Max(0.6) bodyFatPct?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class CreateCheatMealDto {
  @IsMongoId() foodId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_AMOUNT) amount?: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) servings?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class UpdateCheatMealDto {
  @IsOptional() @IsInt() @Min(1) @Max(MAX_AMOUNT) amount?: number;
  @IsOptional() @IsNumber() @Min(0.01) @Max(100) servings?: number;
  @IsOptional() @IsBoolean() eaten?: boolean;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ReorderCheatDto {
  @IsArray() @IsMongoId({ each: true }) order!: string[];
}
