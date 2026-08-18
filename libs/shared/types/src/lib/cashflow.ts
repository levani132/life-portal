import type { Cents, Currency, Estimate, Id, IsoDate, Timestamped } from './common';

/**
 * Widget 2 — "Salary / free money".
 *
 * The user's cash on hand is a single manually-reconciled figure (`CashBalance`) plus a
 * ledger of expected inflows (`IncomeSource`) and outflows (`Expense`). Everything else on
 * this screen — balance on a date, committed spend, free money — is projected on read
 * (constitution principle III).
 */

/** A point-in-time reconciliation of actual cash on hand. Latest `asOf` wins. */
export interface CashBalance extends Timestamped {
  id: Id;
  userId: Id;
  amountCents: Cents;
  currency: Currency;
  asOf: IsoDate;
  note?: string;
}

export const CASHFLOW_CADENCES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Cadence = (typeof CASHFLOW_CADENCES)[number];

/** A recurring schedule. `interval` of 2 with cadence `weekly` means every other week. */
export interface Recurrence {
  cadence: Cadence;
  /** Repeat every N cadence units. Defaults to 1. */
  interval: number;
  /** 1-31, for `monthly`/`yearly`. Clamped to the last day of short months. */
  dayOfMonth?: number;
  /** 0 = Sunday .. 6 = Saturday, for `weekly`. */
  weekday?: number;
  /** 1-12, for `yearly`. */
  month?: number;
  startDate: IsoDate;
  /** Inclusive last day. Omitted means "indefinitely". */
  endDate?: IsoDate;
}

export interface IncomeSource extends Timestamped {
  id: Id;
  userId: Id;
  label: string;
  /** Net amount actually landing in the account. */
  amountCents: Cents;
  currency: Currency;
  recurrence: Recurrence;
  active: boolean;
  note?: string;
}

export const EXPENSE_CATEGORIES = [
  'loan',
  'housing',
  'food',
  'transport',
  'utilities',
  'subscriptions',
  'health',
  'personal',
  'travel',
  'family',
  'savings',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense extends Timestamped {
  id: Id;
  userId: Id;
  label: string;
  amountCents: Cents;
  currency: Currency;
  category: ExpenseCategory;
  kind: 'recurring' | 'one_off';
  /** Present when `kind === 'recurring'`. */
  recurrence?: Recurrence;
  /** Present when `kind === 'one_off'`. */
  date?: IsoDate;
  active: boolean;
  /**
   * Set when this expense funds a loan repayment. The loan's `RepaymentPlan` points back
   * here via `linkedExpenseId`; this row is the single source of truth for the amount
   * (constitution principle IV), so editing it from either screen is safe.
   */
  linkedLoanId?: Id;
  /** Set when this expense was generated from a personal-life plan. */
  linkedPersonalPlanId?: Id;
  note?: string;
}

/** One materialised occurrence of an income source or expense on a specific day. */
export interface CashEvent {
  date: IsoDate;
  label: string;
  amountCents: Cents;
  /** Positive for inflows, negative for outflows. */
  direction: 'in' | 'out';
  sourceKind: 'income' | 'expense';
  sourceId: Id;
  category?: ExpenseCategory;
  linkedLoanId?: Id;
}

export interface CashProjectionDay {
  date: IsoDate;
  openingCents: Cents;
  inCents: Cents;
  outCents: Cents;
  closingCents: Cents;
  events: CashEvent[];
}

/**
 * The answer to "on date X, what will I have, what is already spoken for before my next
 * salary, and what is genuinely mine to spend?".
 */
export interface CashSnapshot {
  date: IsoDate;
  projectedBalanceCents: Cents;
  /** Next salary date strictly after `date`, if any income source is active. */
  nextIncomeDate?: IsoDate;
  nextIncomeAmountCents?: Cents;
  /** Sum of expense occurrences in (`date`, `nextIncomeDate`]. */
  committedBeforeNextIncomeCents: Cents;
  /** `projectedBalanceCents - committedBeforeNextIncomeCents`. May be negative. */
  freeCents: Cents;
  /** Lowest closing balance between today and `date` — catches mid-period dips. */
  lowestBalanceCents: Cents;
  lowestBalanceDate: IsoDate;
}

export interface CashProjection {
  from: IsoDate;
  to: IsoDate;
  openingCents: Cents;
  currency: Currency;
  days: CashProjectionDay[];
  snapshot: CashSnapshot;
  /** First date the projected balance goes below zero, if it ever does. */
  firstShortfallDate?: IsoDate;
  monthlyRecurringInCents: Cents;
  monthlyRecurringOutCents: Cents;
  /** `monthlyRecurringInCents - monthlyRecurringOutCents`. */
  monthlyNetCents: Cents;
}

export interface CashflowSummary {
  currentBalanceCents: Cents;
  balanceAsOf: IsoDate;
  currency: Currency;
  nextIncomeDate?: IsoDate;
  nextIncomeAmountCents?: Cents;
  monthlyNetCents: Cents;
  /** Free money right now, per `CashSnapshot.freeCents` evaluated at today. */
  freeTodayCents: Cents;
  /** Free money the day after the next salary lands. */
  freeAfterNextIncomeCents: Cents;
  runway?: Estimate<number>;
}
