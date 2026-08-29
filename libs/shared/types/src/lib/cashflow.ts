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
  /**
   * Whether the spending ladder may charge card payments against this line. `manual` lines are
   * settled by hand — a loan repayment, a direct debit — and are skipped by the cascade while
   * still counting towards their tier's budget.
   */
  settlement?: 'auto' | 'manual';
  /** A dismissed budget proposal, kept so the same figure is not proposed again immediately. */
  suggestionDismissedAt?: IsoDate;
  suggestionDismissedCents?: Cents;
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

/**
 * Cash that arrived from selling something — an item or a share lot. Never stored: derived on
 * read from the `sold*` fields of the row that was sold, which owns the amount (constitution
 * principle IV). Cashflow's job is only to say when the cash landed.
 */
export interface RealisedSale {
  /** The id of the sold item or lot. */
  id: Id;
  label: string;
  /** Cash actually reaching the account: `grossCents` minus anything earmarked for a debt. */
  amountCents: Cents;
  /** Full proceeds, before the earmark. */
  grossCents: Cents;
  /** The currency the sale was priced in, which need not be the display currency. */
  currency: Currency;
  date: IsoDate;
  source: 'item' | 'stock';
  /**
   * Set when some or all of the proceeds are earmarked for a debt. That share is the loan
   * widget's money, so it is excluded from `amountCents` rather than counted twice.
   */
  allocatedToLoanId?: Id;
}

/** One materialised occurrence of an income source, expense or sale on a specific day. */
export interface CashEvent {
  date: IsoDate;
  label: string;
  amountCents: Cents;
  /** Positive for inflows, negative for outflows. */
  direction: 'in' | 'out';
  sourceKind: 'income' | 'expense' | 'sale';
  sourceId: Id;
  category?: ExpenseCategory;
  linkedLoanId?: Id;
  /**
   * How the expense behind this event is settled, copied from the row so the projection can
   * tell which outflows captured card payments replace. A `manual` line — a transfer, a direct
   * debit — is invisible to SMS capture, so actual payments must never displace it.
   */
  settlement?: 'auto' | 'manual';
  /** `one_off` events are recorded facts, not repeating budget — actuals never displace them. */
  expenseKind?: 'recurring' | 'one_off';
  /**
   * Set only when `amountCents` was converted. Carries what was actually recorded, so the UI
   * can show "₾26.12 (from $10.00)" and mark the figure as derived (principle VI).
   */
  originalAmountCents?: Cents;
  originalCurrency?: Currency;
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
  /**
   * Next salary date strictly after `date`, if any income source is active. Income *sources*
   * only — a one-off sale is cash, but it is not a payday, so it must not close the window.
   */
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
  /**
   * First date **on or after today** the projected balance goes below zero, if it ever does.
   * Days between the last reconciliation and today are already history: forecasting a
   * shortfall into the past says nothing useful and hides whether one is still coming.
   */
  firstShortfallDate?: IsoDate;
  /**
   * Currencies present in the underlying rows that no rate was available for. Their amounts
   * are still counted — understating a balance is the more dangerous error — so a non-empty
   * list means every figure here is approximate and must be labelled as such.
   */
  unconvertedCurrencies?: Currency[];
  monthlyRecurringInCents: Cents;
  monthlyRecurringOutCents: Cents;
  /** `monthlyRecurringInCents - monthlyRecurringOutCents`. */
  monthlyNetCents: Cents;
}

export interface CashflowSummary {
  /**
   * Cash on hand **today**: the last reconciliation rolled forward through every income,
   * expense and sale since (constitution principle III). Equal to `reconciledBalanceCents`
   * only when the reconciliation is today's.
   */
  currentBalanceCents: Cents;
  /** The figure the user last confirmed by hand, as of `balanceAsOf`. */
  reconciledBalanceCents: Cents;
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
