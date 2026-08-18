import type { Cents, Currency, Id, IsoDate, Timestamped } from './common';

/**
 * Widget 1 — "Debts I owe".
 *
 * Supports many loans with an explicit repayment `priority` (1 = pay off first). A loan
 * never stores its remaining balance: it stores the original principal and its payments,
 * and the balance is folded on read (constitution principle III).
 */

export const LOAN_STATUSES = ['active', 'paid', 'archived'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export interface Loan extends Timestamped {
  id: Id;
  userId: Id;
  /** Who the money is owed to, e.g. "Giorgi". */
  lender: string;
  label?: string;
  principalCents: Cents;
  currency: Currency;
  startDate: IsoDate;
  /** Soft deadline for social debts; drives the "behind schedule" badge. */
  targetPayoffDate?: IsoDate;
  /** Annual interest as a decimal, e.g. 0.05. Zero for informal loans. */
  interestRate: number;
  /** 1 = highest. Surplus money is allocated to the lowest number first. */
  priority: number;
  status: LoanStatus;
  notes?: string;
}

export const PAYMENT_SOURCES = [
  'salary',
  'item_sale',
  'stock_sale',
  'bonus',
  'other',
] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

/** A payment that actually happened. Immutable in spirit; edit only to fix mistakes. */
export interface LoanPayment extends Timestamped {
  id: Id;
  userId: Id;
  loanId: Id;
  amountCents: Cents;
  currency: Currency;
  date: IsoDate;
  source: PaymentSource;
  /** Id of the sellable item or stock sale this payment came from, when applicable. */
  sourceRefId?: Id;
  note?: string;
}

export const PLAN_KINDS = [
  /** A fixed amount on a schedule, normally funded by salary. */
  'recurring',
  /** A single expected payment on a date, e.g. an annual bonus. */
  'one_off',
  /** Proceeds from the items-to-sell widget. Amount is derived, not stored. */
  'items',
  /** Proceeds from the stocks widget at target price. Amount is derived, not stored. */
  'stocks',
] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/**
 * An *intention* to repay, as opposed to a `LoanPayment` which is history. Plans feed the
 * best/worst-case scenario engine.
 */
export interface RepaymentPlan extends Timestamped {
  id: Id;
  userId: Id;
  loanId: Id;
  kind: PlanKind;
  label: string;
  /** For `recurring` and `one_off`. Null for derived kinds. */
  amountCents?: Cents;
  currency: Currency;
  /** For `recurring`: schedule. Salary repayment is monthly on the 7th. */
  cadence?: 'monthly' | 'yearly';
  dayOfMonth?: number;
  startDate?: IsoDate;
  endDate?: IsoDate;
  /** For `one_off`. */
  date?: IsoDate;
  /**
   * For `recurring` plans funded by salary. The linked cash-flow expense owns the amount
   * (constitution principle IV) — `amountCents` is ignored when this is set.
   */
  linkedExpenseId?: Id;
  /**
   * For `items`/`stocks`: what fraction of the derived proceeds goes to *this* loan.
   * 1 = all of it.
   */
  allocationRatio?: number;
  /** Counted in the worst case as well as the best case. Salary is; asset sales are not. */
  guaranteed: boolean;
  enabled: boolean;
  note?: string;
}

/** A plan resolved against live data into a concrete, dated, amount. */
export interface ResolvedInflow {
  planId?: Id;
  label: string;
  amountCents: Cents;
  /** Undefined for asset sales with no known date — the engine schedules them. */
  date?: IsoDate;
  kind: PlanKind;
  guaranteed: boolean;
}

export interface LoanScenarioStep {
  date: IsoDate;
  paidCents: Cents;
  remainingCents: Cents;
  contributions: { label: string; amountCents: Cents }[];
}

export interface LoanScenario {
  key: 'best' | 'worst' | 'expected';
  label: string;
  /** Undefined when the loan is never repaid within the modelling horizon. */
  payoffDate?: IsoDate;
  monthsToPayoff?: number;
  steps: LoanScenarioStep[];
  /** Plain-language list of what this scenario assumed, for the UI. */
  assumptions: string[];
  /** Total the scenario expects to pay, capped at the outstanding balance. */
  totalPaidCents: Cents;
}

export interface LoanDetail {
  loan: Loan;
  payments: LoanPayment[];
  plans: RepaymentPlan[];
  paidCents: Cents;
  /** Recorded payments only — `principalCents − Σ payments`. The authoritative figure. */
  remainingCents: Cents;
  /**
   * Scheduled repayments that have already fallen due with no recorded payment to account for
   * them, and what the balance would be if they all went out as planned. An estimate: the
   * cash-flow projection has already spent that money, so a gap here means the two widgets
   * disagree and a payment probably needs recording.
   */
  unrecordedScheduledCents: Cents;
  unrecordedScheduledCount: number;
  unrecordedScheduledFromDate?: IsoDate;
  expectedRemainingCents: Cents;
  progressRatio: number;
  /** Plans resolved against live item/stock/expense data. */
  inflows: ResolvedInflow[];
  scenarios: LoanScenario[];
  /** True when the worst-case payoff date is after `targetPayoffDate`. */
  behindSchedule: boolean;
}

export interface LoansSummary {
  totalPrincipalCents: Cents;
  totalPaidCents: Cents;
  totalRemainingCents: Cents;
  currency: Currency;
  activeCount: number;
  /** The highest-priority active loan, for the dashboard card headline. */
  focus?: {
    loanId: Id;
    lender: string;
    remainingCents: Cents;
    progressRatio: number;
    bestCasePayoffDate?: IsoDate;
    worstCasePayoffDate?: IsoDate;
  };
}
