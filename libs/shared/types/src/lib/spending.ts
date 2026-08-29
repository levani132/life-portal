/**
 * Spending waterfall contracts.
 *
 * The rule the whole module turns on: **a payment records what happened, never what it was
 * for.** What it was for is proposed by walking the ladder of budgeted expenses and is
 * recomputed on every read (principle III). The owner may leave that proposal, confirm it in
 * whole or in part, or replace it with what the payment really was.
 *
 * See `specs/002-spending-waterfall/` and `docs/modules/spending.md`.
 */
import type { Cadence } from './cashflow';
import type { Cents, Currency, Estimate, Id, IsoDate, Timestamped } from './common';

/** How a payment reached the app. */
export const SPEND_SOURCES = ['sms', 'manual'] as const;
export type SpendSource = (typeof SPEND_SOURCES)[number];

/** Banks whose message format is understood. A third bank is a new parser, not a new design. */
export const SPEND_BANKS = ['bog', 'tbc'] as const;
export type SpendBank = (typeof SPEND_BANKS)[number];

/**
 * `unparsed` rows carry their raw text and little else. They queue for the owner to complete and
 * count towards no figure until they do — a message is never discarded and never half-recorded.
 */
export const SPEND_STATUSES = ['recorded', 'unparsed'] as const;
export type SpendStatus = (typeof SPEND_STATUSES)[number];

/** Money in is recorded but is never spending and never reaches the ladder. */
export type SpendDirection = 'out' | 'in';

/**
 * Whether a budgeted line is paid by card or settled by hand.
 *
 * A `manual` line — a loan repayment, a utility direct debit — still counts towards its tier's
 * budget but is skipped by the cascade, so one expensive evening cannot be charged against the
 * loan.
 */
export const SPEND_SETTLEMENTS = ['auto', 'manual'] as const;
export type SpendSettlement = (typeof SPEND_SETTLEMENTS)[number];

/**
 * One part of a confirmation: an amount, the line it lands on, and the day or days whose
 * allowance it consumes.
 *
 * A span exists because one payment can cover several days — milk bought for four breakfasts is
 * spread evenly across them, and the parts always sum back to `amountCents`.
 */
export interface ConfirmedAllocation {
  expenseId: Id;
  amountCents: Cents;
  /** First day whose allowance this consumes. Defaults to the payment's own day. */
  forDay?: IsoDate;
  /** Last day of the span. Defaults to `forDay`. */
  throughDay?: IsoDate;
}

/**
 * The owner's answer to "what was this for". Absent for most payments, which is the normal state.
 *
 * `confirmed` may cover only part of the payment; the remainder rejoins the cascade. A confirmed
 * line is closed to *projections* for the period it names, but stays open to further
 * confirmations — a coffee and a dessert bought separately are one meal in two payments.
 */
export interface SpendDecision {
  kind: 'confirmed' | 'custom';
  /** `confirmed` only. */
  allocations?: ConfirmedAllocation[];
  /** `custom` only. Free text; consumes no planned allowance. */
  purpose?: string;
  decidedAt: IsoDate;
  /** Set once a custom purpose has been turned into a budgeted line. */
  promotedToExpenseId?: Id;
}

/** A payment, as stored. It never carries which budget line it fell on. */
export interface SpendPayment extends Timestamped {
  id: Id;
  userId: Id;
  amountCents: Cents;
  currency: Currency;
  /** Shown so a payment is recognisable. **Never interpreted** — see the module doc. */
  merchant?: string;
  cardLast4?: string;
  /** Full timestamp with offset, as the phone reported it. Orders the cascade. */
  at: IsoDate;
  /** `YYYY-MM-DD`. Written once at ingest from `localDay(at, dayStartHour)`, never recomputed. */
  day: IsoDate;
  direction: SpendDirection;
  source: SpendSource;
  bank?: SpendBank;
  /** The original message, kept for every submission, recognised or not. */
  raw?: string;
  /** When the submission arrived. Drives duplicate detection. */
  rawReceivedAt?: IsoDate;
  status: SpendStatus;
  /**
   * The account balance a message reported. Feeds the completeness check **only**: it covers one
   * account of several across two banks, so it is never the owner's balance.
   */
  reportedBalanceCents?: Cents;
  /** Cashback, which accrues to a loyalty pot rather than the account. Recorded, then ignored. */
  cashbackCents?: Cents;
  /** Paid back, or refunded. Counts as neither spending nor consumption. */
  notReallySpentCents?: Cents;
  decision?: SpendDecision;
}

/** Where one part of a payment landed. `extra` is spending past the last tier. */
export type SpendAllocationTarget = 'expense' | 'extra';

/**
 * One part of a decomposed payment.
 *
 * `projected` is what the UI reads to decide whether it is showing a guess or a fact
 * (principle VI). `forDay` is the day whose *allowance* this consumes, which is not always the
 * day the money left.
 */
export interface SpendAllocation {
  target: SpendAllocationTarget;
  expenseId?: Id;
  label: string;
  amountCents: Cents;
  forDay: IsoDate;
  projected: boolean;
}

/** One budgeted line, as it stands on a given date. */
export interface LadderRung {
  expenseId: Id;
  label: string;
  budgetCents: Cents;
  consumedCents: Cents;
  /** Never negative. A rung past its budget has nothing left, not a debt. */
  remainingCents: Cents;
  settlement: SpendSettlement;
  /**
   * True once anything has been confirmed against this rung for this period. A confirmed rung is
   * closed to the cascade, and its remainder is a saving rather than capacity.
   */
  confirmed: boolean;
}

/** One cadence's worth of rungs. `savingCents` is signed: negative means overspent. */
export interface LadderTier {
  cadence: Cadence;
  rungs: LadderRung[];
  budgetCents: Cents;
  consumedCents: Cents;
  savingCents: Cents;
}

export interface SpendLadder {
  date: IsoDate;
  tiers: LadderTier[];
  /** Spending that exhausted every tier, plus every custom purpose, for the month. */
  extraCents: Cents;
  /** Currencies present that no rate was available for, so every figure here is approximate. */
  unconvertedCurrencies?: Currency[];
}

/**
 * What a period budgeted, really spent, and therefore saved.
 *
 * `savingCents` is signed. `extraCents` is spending outside the allowances entirely, and
 * `netCents` is what the period actually gained or lost once both are counted.
 */
export interface PeriodSaving {
  cadence: Cadence;
  from: IsoDate;
  to: IsoDate;
  budgetCents: Cents;
  spentCents: Cents;
  savingCents: Cents;
  extraCents: Cents;
  netCents: Cents;
}

/**
 * Savings across all time, split by which allowance they came from.
 *
 * `daily + weekly + monthly` equals `totalCents` exactly, and the total does not depend on how
 * the payments in the window were decided — confirming moves attribution, never arithmetic.
 */
export interface SavingsBreakdown {
  totalCents: Cents;
  daily: Cents;
  weekly: Cents;
  monthly: Cents;
  extraCents: Cents;
}

/**
 * A discrepancy between the balances a card reported and the payments captured between them.
 *
 * Only one bank prints a balance, so only that card self-checks; the absence of a gap elsewhere
 * is not evidence of completeness.
 */
export interface CompletenessGap {
  cardLast4: string;
  from: IsoDate;
  to: IsoDate;
  missingCents: Cents;
}

/** A proposed budget, carrying the evidence behind it (principle VI). */
export interface BudgetProposal extends Estimate<Cents> {
  expenseId: Id;
  label: string;
  cadence: Cadence;
  currentCents: Cents;
  suggestedCents: Cents;
}

/** A token as the UI sees it. The secret exists in exactly one response, at creation. */
export interface IngestTokenSummary extends Timestamped {
  id: Id;
  label: string;
  expiresAt: IsoDate;
  lastUsedAt?: IsoDate;
  revokedAt?: IsoDate;
}

/** The one response that carries a plain token value, returned once and never again. */
export interface IngestTokenCreated extends IngestTokenSummary {
  token: string;
}
