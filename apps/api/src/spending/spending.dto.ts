import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SPEND_BANKS, SUPPORTED_CURRENCIES } from '@life-portal/shared-types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = 'Must be a calendar date in YYYY-MM-DD form';

/** What a phone automation submits. `raw` is kept whether or not it parses. */
export class IngestDto {
  @IsOptional() @IsIn(['sms', 'manual']) source?: string;

  @IsOptional() @IsIn(SPEND_BANKS) bank?: string;

  @IsString() @MaxLength(2000) raw!: string;

  /**
   * When the phone says this happened. Ideally ISO with an offset, but deliberately **not**
   * validated as such: an iOS date variable left on its default format sends locale prose, and
   * rejecting the request over it would lose the message a Shortcut can never resend. Anything
   * unreadable falls back to the arrival time.
   */
  @IsOptional() @IsString() @MaxLength(80) at?: string;
}

export class CreatePaymentDto {
  @IsInt() @Min(0) amountCents!: number;

  @IsOptional() @IsIn(SUPPORTED_CURRENCIES) currency?: string;

  @IsOptional() @IsString() @MaxLength(200) merchant?: string;

  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'Card last four must be four digits' })
  cardLast4?: string;

  @IsOptional() @IsISO8601() at?: string;

  @IsOptional() @Matches(DAY, { message: DAY_MESSAGE }) day?: string;

  @IsOptional() @IsIn(['out', 'in']) direction?: string;

  @IsOptional() @IsInt() @Min(0) notReallySpentCents?: number;
}

/** PATCH variant. Also how an `unparsed` row is completed: supplying an amount records it. */
export class UpdatePaymentDto {
  @IsOptional() @IsInt() @Min(0) amountCents?: number;

  @IsOptional() @IsIn(SUPPORTED_CURRENCIES) currency?: string;

  @IsOptional() @IsString() @MaxLength(200) merchant?: string;

  /**
   * Editable after the fact, because the completeness chain follows a card by these digits: a
   * manual entry that named no card is invisible to the check until the owner adds them. An
   * empty string clears the field.
   */
  @IsOptional()
  @Matches(/^(\d{4})?$/, { message: 'Card last four must be four digits' })
  cardLast4?: string;

  @IsOptional() @IsISO8601() at?: string;

  @IsOptional() @Matches(DAY, { message: DAY_MESSAGE }) day?: string;

  @IsOptional() @IsIn(['out', 'in']) direction?: string;

  /**
   * Money paid back — a share of a dinner, or a refund.
   *
   * Never more than the payment: the service rejects that rather than letting a payment
   * contribute negative spending.
   */
  @IsOptional() @IsInt() @Min(0) notReallySpentCents?: number;
}

export class ConfirmedAllocationDto {
  @IsMongoId() expenseId!: string;

  @IsInt() @Min(1) amountCents!: number;

  /** Which day's allowance this consumes. Defaults to the payment's own day. */
  @IsOptional() @Matches(DAY, { message: DAY_MESSAGE }) forDay?: string;

  /** Last day of a span. The amount is spread evenly across `forDay`..`throughDay`. */
  @IsOptional() @Matches(DAY, { message: DAY_MESSAGE }) throughDay?: string;
}

/**
 * `confirmed` may cover only part of the payment — the remainder rejoins the cascade — but never
 * more than it, which the service checks against the spendable amount.
 */
export class SetDecisionDto {
  @IsIn(['confirmed', 'custom', 'none']) kind!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConfirmedAllocationDto)
  allocations?: ConfirmedAllocationDto[];

  @IsOptional() @IsString() @MaxLength(120) purpose?: string;
}

/** Turns a custom purpose into a budgeted line, created through `CashflowService`. */
export class PromotePurposeDto {
  @IsIn(['daily', 'weekly', 'monthly', 'yearly']) cadence!: string;

  @IsString() @MaxLength(120) label!: string;

  @IsInt() @Min(0) amountCents!: number;

  @IsOptional() @IsIn(SUPPORTED_CURRENCIES) currency?: string;
}

export class CreateIngestTokenDto {
  @IsString() @MaxLength(60) label!: string;

  @Matches(DAY, { message: DAY_MESSAGE }) expiresAt!: string;
}

export class SetSpendOrderDto {
  @IsArray() @IsMongoId({ each: true }) order!: string[];
}

export class DismissSuggestionDto {
  @IsOptional() @IsBoolean() dismissed?: boolean;
}
