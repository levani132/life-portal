import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CASHFLOW_CADENCES, EXPENSE_CATEGORIES, SPEND_SETTLEMENTS, SUPPORTED_CURRENCIES } from '@life-portal/shared-types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = { message: 'Must be a calendar date in YYYY-MM-DD form' };

export class RecurrenceDto {
  @IsIn(CASHFLOW_CADENCES)
  cadence!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  interval?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dayOfMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  weekday?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  month?: number;

  @Matches(DAY, DAY_MESSAGE)
  startDate!: string;

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  endDate?: string;
}

export class SetBalanceDto {
  @IsInt({ message: 'Amounts are integer cents' })
  amountCents!: number;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  asOf?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** One occurrence that landed on a different day than scheduled. Replaces it, never adds. */
export class IncomeArrivalOverrideDto {
  @Matches(DAY, DAY_MESSAGE)
  scheduledDay!: string;

  @Matches(DAY, DAY_MESSAGE)
  actualDay!: string;
}

export class UpsertIncomeDto {
  @IsString()
  @MaxLength(120)
  label!: string;

  @IsInt()
  @Min(0)
  amountCents!: number;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence!: RecurrenceDto;

  /** The whole list each time: sending `[]` clears every override. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(36)
  @ValidateNested({ each: true })
  @Type(() => IncomeArrivalOverrideDto)
  arrivalOverrides?: IncomeArrivalOverrideDto[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpsertExpenseDto {
  @IsString()
  @MaxLength(120)
  label!: string;

  @IsInt()
  @Min(0)
  amountCents!: number;

  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  currency?: string;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES)
  category?: string;

  @IsIn(['recurring', 'one_off'])
  kind!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceDto)
  recurrence?: RecurrenceDto;

  @IsOptional()
  @Matches(DAY, DAY_MESSAGE)
  date?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(SPEND_SETTLEMENTS)
  settlement?: string;

  @IsOptional()
  @IsMongoId()
  linkedLoanId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** PATCH variant: every field optional. */
export class UpdateExpenseDto extends UpsertExpenseDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  override label!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  override amountCents!: number;

  @IsOptional()
  @IsIn(['recurring', 'one_off'])
  override kind!: string;
}

export class UpdateIncomeDto extends UpsertIncomeDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  override label!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  override amountCents!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceDto)
  override recurrence!: RecurrenceDto;
}
