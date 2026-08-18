import {
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
} from 'class-validator';
import {
  LOAN_STATUSES,
  PAYMENT_SOURCES,
  PLAN_KINDS,
  SUPPORTED_CURRENCIES,
} from '@life-portal/shared-types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = { message: 'Must be a calendar date in YYYY-MM-DD form' };

export class CreateLoanDto {
  @IsString() @MaxLength(120) lender!: string;
  @IsOptional() @IsString() @MaxLength(160) label?: string;
  @IsInt({ message: 'Amounts are integer cents' }) @Min(0) principalCents!: number;
  @IsOptional() @IsIn(SUPPORTED_CURRENCIES) currency?: string;
  @Matches(DAY, DAY_MESSAGE) startDate!: string;
  @IsOptional() @Matches(DAY, DAY_MESSAGE) targetPayoffDate?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) interestRate?: number;
  @IsOptional() @IsInt() @Min(1) priority?: number;
  @IsOptional() @IsIn(LOAN_STATUSES) status?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class UpdateLoanDto extends CreateLoanDto {
  @IsOptional() @IsString() @MaxLength(120) override lender!: string;
  @IsOptional() @IsInt() @Min(0) override principalCents!: number;
  @IsOptional() @Matches(DAY, DAY_MESSAGE) override startDate!: string;
}

export class CreatePaymentDto {
  @IsInt() @Min(1) amountCents!: number;
  @IsOptional() @IsIn(SUPPORTED_CURRENCIES) currency?: string;
  @IsOptional() @Matches(DAY, DAY_MESSAGE) date?: string;
  @IsOptional() @IsIn(PAYMENT_SOURCES) source?: string;
  @IsOptional() @IsString() @MaxLength(60) sourceRefId?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdatePaymentDto extends CreatePaymentDto {
  @IsOptional() @IsInt() @Min(1) override amountCents!: number;
}

export class CreatePlanDto {
  @IsIn(PLAN_KINDS) kind!: string;
  @IsString() @MaxLength(160) label!: string;
  @IsOptional() @IsInt() @Min(0) amountCents?: number;
  @IsOptional() @IsIn(SUPPORTED_CURRENCIES) currency?: string;
  @IsOptional() @IsIn(['monthly', 'yearly']) cadence?: string;
  @IsOptional() @IsInt() @Min(1) @Max(31) dayOfMonth?: number;
  @IsOptional() @Matches(DAY, DAY_MESSAGE) startDate?: string;
  @IsOptional() @Matches(DAY, DAY_MESSAGE) endDate?: string;
  @IsOptional() @Matches(DAY, DAY_MESSAGE) date?: string;
  @IsOptional() @IsMongoId() linkedExpenseId?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(1) allocationRatio?: number;
  @IsOptional() @IsBoolean() guaranteed?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;

  /**
   * When true on a recurring plan, the API also creates the matching cash-flow expense and
   * links the two, so the repayment shows up in the salary planner automatically.
   */
  @IsOptional() @IsBoolean() createLinkedExpense?: boolean;
}

export class UpdatePlanDto extends CreatePlanDto {
  @IsOptional() @IsIn(PLAN_KINDS) override kind!: string;
  @IsOptional() @IsString() @MaxLength(160) override label!: string;
}
