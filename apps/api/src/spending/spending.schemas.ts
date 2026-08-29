import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  SPEND_BANKS,
  SPEND_SOURCES,
  SPEND_STATUSES,
  SUPPORTED_CURRENCIES,
} from '@life-portal/shared-types';
import {
  baseSchemaOptions,
  centsField,
  dayField,
  requiredCentsField,
  requiredDayField,
} from '../common/mongoose';

/**
 * One part of a confirmation: an amount, the line it lands on, and the day or days whose
 * allowance it consumes.
 *
 * `forDay`/`throughDay` are why a payment has **two** notions of when. `day` on the payment is
 * when the money left the account; this is which day's allowance paid for it. They coincide
 * unless the owner says tonight's shopping is for tomorrow, or that one carton of milk covers
 * four breakfasts.
 */
@Schema({ _id: false })
export class ConfirmedAllocationSub {
  @Prop({ required: true }) expenseId!: string;

  @Prop(requiredCentsField) amountCents!: number;

  @Prop(dayField) forDay?: string;

  @Prop(dayField) throughDay?: string;
}

const ConfirmedAllocationSchema = SchemaFactory.createForClass(ConfirmedAllocationSub);

/**
 * The owner's answer to "what was this for". Absent for most payments, which is the normal state.
 *
 * `kind` rather than two nullable fields, so a row cannot be both confirmed and custom.
 */
@Schema({ _id: false })
export class DecisionSub {
  @Prop({ required: true, enum: ['confirmed', 'custom'] }) kind!: string;

  @Prop({ type: [ConfirmedAllocationSchema], default: undefined })
  allocations?: ConfirmedAllocationSub[];

  @Prop({ trim: true, maxlength: 120 }) purpose?: string;

  @Prop({ required: true }) decidedAt!: string;

  @Prop() promotedToExpenseId?: string;
}

const DecisionSchema = SchemaFactory.createForClass(DecisionSub);

/**
 * A payment, as recorded. It holds **what happened and never what it was for** — the
 * decomposition against the budget is derived on every read (principle III).
 */
@Schema({ ...baseSchemaOptions, collection: 'spend_payments' })
export class SpendPayment {
  @Prop({ required: true, index: true }) userId!: string;

  @Prop(requiredCentsField) amountCents!: number;

  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'GEL' }) currency!: string;

  /** Shown so a payment is recognisable. Deliberately never interpreted — the same shop sells
   * dinner one visit and a vase the next, so a merchant does not predict a purpose. */
  @Prop({ trim: true, maxlength: 200 }) merchant?: string;

  @Prop({ match: [/^\d{4}$/, 'Card last four must be four digits'] }) cardLast4?: string;

  /** Full timestamp with offset, as the phone reported it. Orders the cascade. */
  @Prop({ required: true }) at!: string;

  /**
   * Written once at ingest, never recomputed.
   *
   * The server derives it with `localDay(at, dayStartHour)` — and `dayStartHour` is a setting the
   * owner can change, so recomputing this later would silently move payments between days and
   * alter what past periods spent. Freezing it keeps the answer that was true at the time.
   */
  @Prop({ ...requiredDayField, index: true }) day!: string;

  @Prop({ required: true, enum: ['out', 'in'], default: 'out' }) direction!: string;

  @Prop({ required: true, enum: SPEND_SOURCES, default: 'manual' }) source!: string;

  @Prop({ enum: SPEND_BANKS }) bank?: string;

  /** Kept for every submission, recognised or not, so nothing is ever lost to a parser change. */
  @Prop() raw?: string;

  /** When the submission arrived. Drives duplicate detection — see the service. */
  @Prop() rawReceivedAt?: string;

  @Prop({ required: true, enum: SPEND_STATUSES, default: 'recorded' }) status!: string;

  /**
   * The account balance a message reported.
   *
   * Feeds the completeness check and **nothing else**. It covers one account of several across
   * two banks, so as *the* balance it would be wrong; as one card's own running total it is
   * exact, which is the only job it does.
   */
  @Prop(centsField) reportedBalanceCents?: number;

  /** Cashback, which accrues to a loyalty pot rather than the account. Recorded, then ignored. */
  @Prop(centsField) cashbackCents?: number;

  /** Paid back, or refunded. Counts as neither spending nor consumption. */
  @Prop(centsField) notReallySpentCents?: number;

  @Prop({ type: DecisionSchema }) decision?: DecisionSub;
}

export const SpendPaymentSchema = SchemaFactory.createForClass(SpendPayment);

// The window reads that drive every figure, and the per-card chain the completeness check walks.
SpendPaymentSchema.index({ userId: 1, day: 1 });
SpendPaymentSchema.index({ userId: 1, cardLast4: 1, at: 1 });

/**
 * A credential letting a phone automation submit on the owner's behalf.
 *
 * Presented as `lp_<tokenId>_<secret>`: embedding the row id means exactly one bcrypt comparison
 * per request however many tokens exist, rather than one per stored token.
 */
@Schema({ ...baseSchemaOptions, collection: 'ingest_tokens' })
export class IngestToken {
  @Prop({ required: true, index: true }) userId!: string;

  @Prop({ required: true, trim: true, maxlength: 60 }) label!: string;

  /** bcrypt, as `auth.service.ts` already hashes refresh tokens. Never recoverable. */
  @Prop({ required: true }) secretHash!: string;

  /** Required: no non-expiring credential for a route that writes financial records. */
  @Prop(requiredDayField) expiresAt!: string;

  /** What tells the owner the automation is still running. */
  @Prop() lastUsedAt?: string;

  /** Set rather than deleted, so a revoked credential stays auditable. */
  @Prop() revokedAt?: string;
}

export const IngestTokenSchema = SchemaFactory.createForClass(IngestToken);
