import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  LOAN_STATUSES,
  PAYMENT_SOURCES,
  PLAN_KINDS,
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
 * A debt owed. The remaining balance is deliberately **not** a field: it is folded from
 * `principalCents` less the payment rows on every read (constitution principle III), which
 * keeps back-dated payment edits correct for free.
 */
@Schema({ ...baseSchemaOptions, collection: 'loans' })
export class Loan {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, trim: true }) lender!: string;
  @Prop({ trim: true }) label?: string;
  @Prop(requiredCentsField) principalCents!: number;
  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' }) currency!: string;
  @Prop(requiredDayField) startDate!: string;
  @Prop(dayField) targetPayoffDate?: string;
  /** Annual rate as a decimal. Zero for informal loans between friends. */
  @Prop({ default: 0, min: 0, max: 1 }) interestRate!: number;
  /** 1 = pay this off first. Surplus money is allocated by ascending priority. */
  @Prop({ default: 1, min: 1 }) priority!: number;
  @Prop({ required: true, enum: LOAN_STATUSES, default: 'active', index: true }) status!: string;
  @Prop() notes?: string;
}

export const LoanSchema = SchemaFactory.createForClass(Loan);
LoanSchema.index({ userId: 1, status: 1, priority: 1 });

/** A payment that actually happened. */
@Schema({ ...baseSchemaOptions, collection: 'loan_payments' })
export class LoanPayment {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, index: true }) loanId!: string;
  @Prop(requiredCentsField) amountCents!: number;
  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' }) currency!: string;
  @Prop(requiredDayField) date!: string;
  @Prop({ required: true, enum: PAYMENT_SOURCES, default: 'other' }) source!: string;
  /** The item or lot the money came from, when applicable. */
  @Prop() sourceRefId?: string;
  @Prop() note?: string;
}

export const LoanPaymentSchema = SchemaFactory.createForClass(LoanPayment);
LoanPaymentSchema.index({ userId: 1, loanId: 1, date: -1 });

/**
 * An *intention* to repay, as opposed to a payment which is history. Plans drive the
 * best/realistic/worst scenarios.
 */
@Schema({ ...baseSchemaOptions, collection: 'repayment_plans' })
export class RepaymentPlan {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, index: true }) loanId!: string;
  @Prop({ required: true, enum: PLAN_KINDS }) kind!: string;
  @Prop({ required: true, trim: true }) label!: string;
  @Prop(centsField) amountCents?: number;
  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' }) currency!: string;
  @Prop({ enum: ['monthly', 'yearly'] }) cadence?: string;
  @Prop({ min: 1, max: 31 }) dayOfMonth?: number;
  @Prop(dayField) startDate?: string;
  @Prop(dayField) endDate?: string;
  @Prop(dayField) date?: string;
  /**
   * For salary-funded plans: the cash-flow expense that owns the amount. When set,
   * `amountCents` is only a fallback (constitution principle IV).
   */
  @Prop({ index: true }) linkedExpenseId?: string;
  @Prop({ default: 1, min: 0, max: 1 }) allocationRatio?: number;
  /** Counted in the worst case too. Salary is guaranteed; asset sales are not. */
  @Prop({ default: false }) guaranteed!: boolean;
  @Prop({ default: true }) enabled!: boolean;
  @Prop() note?: string;
}

export const RepaymentPlanSchema = SchemaFactory.createForClass(RepaymentPlan);
