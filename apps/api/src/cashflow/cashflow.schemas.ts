import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CASHFLOW_CADENCES, EXPENSE_CATEGORIES, SUPPORTED_CURRENCIES } from '@life-portal/shared-types';
import {
  baseSchemaOptions,
  centsField,
  dayField,
  requiredCentsField,
  requiredDayField,
} from '../common/mongoose';

@Schema({ _id: false })
export class RecurrenceSub {
  @Prop({ required: true, enum: CASHFLOW_CADENCES })
  cadence!: string;

  @Prop({ default: 1, min: 1 })
  interval!: number;

  @Prop({ min: 1, max: 31 })
  dayOfMonth?: number;

  @Prop({ min: 0, max: 6 })
  weekday?: number;

  @Prop({ min: 1, max: 12 })
  month?: number;

  @Prop(requiredDayField)
  startDate!: string;

  @Prop(dayField)
  endDate?: string;
}

export const RecurrenceSchema = SchemaFactory.createForClass(RecurrenceSub);

/**
 * A point-in-time reconciliation of actual cash on hand. Rows are kept rather than
 * overwritten so the history of "what I thought I had" survives, and the latest `asOf` is
 * the one projections start from.
 */
@Schema({ ...baseSchemaOptions, collection: 'cash_balances' })
export class CashBalance {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop(requiredCentsField)
  amountCents!: number;

  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' })
  currency!: string;

  @Prop({ ...requiredDayField, index: true })
  asOf!: string;

  @Prop()
  note?: string;
}

export const CashBalanceSchema = SchemaFactory.createForClass(CashBalance);
CashBalanceSchema.index({ userId: 1, asOf: -1 });

@Schema({ ...baseSchemaOptions, collection: 'income_sources' })
export class IncomeSource {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, trim: true })
  label!: string;

  @Prop(requiredCentsField)
  amountCents!: number;

  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' })
  currency!: string;

  @Prop({ type: RecurrenceSchema, required: true })
  recurrence!: RecurrenceSub;

  @Prop({ default: true })
  active!: boolean;

  @Prop()
  note?: string;
}

export const IncomeSourceSchema = SchemaFactory.createForClass(IncomeSource);

@Schema({ ...baseSchemaOptions, collection: 'expenses' })
export class Expense {
  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, trim: true })
  label!: string;

  @Prop(requiredCentsField)
  amountCents!: number;

  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' })
  currency!: string;

  @Prop({ required: true, enum: EXPENSE_CATEGORIES, default: 'other' })
  category!: string;

  @Prop({ required: true, enum: ['recurring', 'one_off'] })
  kind!: string;

  @Prop({ type: RecurrenceSchema })
  recurrence?: RecurrenceSub;

  @Prop(dayField)
  date?: string;

  @Prop({ default: true })
  active!: boolean;

  /**
   * Set when this expense funds a loan repayment. This row owns the amount; the loan's
   * repayment plan only references it (constitution principle IV).
   */
  @Prop({ index: true })
  linkedLoanId?: string;

  /** Set when the expense was generated from a personal-life plan. */
  @Prop({ index: true })
  linkedPersonalPlanId?: string;

  @Prop()
  note?: string;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);

/**
 * Guards the invariant the two `kind`s imply, which enums alone cannot express.
 * Throwing rather than calling `next(err)` keeps the hook synchronous and sidesteps
 * Mongoose 9's overloaded middleware signatures.
 */
ExpenseSchema.pre('validate', function () {
  const doc = this as unknown as Expense;
  if (doc.kind === 'recurring' && !doc.recurrence) {
    throw new Error('A recurring expense needs a recurrence schedule.');
  }
  if (doc.kind === 'one_off' && !doc.date) {
    throw new Error('A one-off expense needs a date.');
  }
});

export { centsField, dayField, requiredCentsField, requiredDayField };
