import type { Cents, Currency, Id, IsoDate, Timestamped } from './common';

/**
 * Widget 8 — "Personal life".
 *
 * Activities, dates, trips and travel history. When a plan has both an estimated cost and a
 * target date, the API can mint a linked one-off cash-flow expense so the money shows up in
 * the salary projection automatically (`autoExpense`).
 */

export const PLAN_TYPES = ['activity', 'date_night', 'trip', 'goal', 'purchase'] as const;
export type PersonalPlanType = (typeof PLAN_TYPES)[number];

export const PLAN_COMPANY = ['alone', 'girlfriend', 'friends', 'family', 'other'] as const;
export type PlanCompany = (typeof PLAN_COMPANY)[number];

export const PERSONAL_PLAN_STATUSES = [
  /** On the wishlist, no date. */
  'idea',
  /** Has a date, not paid for. */
  'planned',
  /** Paid for / reserved. */
  'booked',
  'done',
  'cancelled',
] as const;
export type PersonalPlanStatus = (typeof PERSONAL_PLAN_STATUSES)[number];

export interface PersonalPlan extends Timestamped {
  id: Id;
  userId: Id;
  title: string;
  type: PersonalPlanType;
  company: PlanCompany;
  status: PersonalPlanStatus;
  description?: string;
  /** Single-day plans use this; trips use `startDate`/`endDate`. */
  targetDate?: IsoDate;
  startDate?: IsoDate;
  endDate?: IsoDate;
  city?: string;
  country?: string;
  estimatedCostCents?: Cents;
  actualCostCents?: Cents;
  currency: Currency;
  /** 1 = really want to do this. Drives the wishlist order. */
  priority: number;
  /**
   * When true and an estimated cost and date exist, the API keeps a one-off cash-flow
   * expense in sync with this plan (constitution principle IV — the plan owns the amount).
   */
  autoExpense: boolean;
  linkedExpenseId?: Id;
  /** True for trips already taken — powers the "places I have been" list. */
  visited: boolean;
  photoUrl?: string;
  notes?: string;
  tags: string[];
}

export interface PersonalSummary {
  currency: Currency;
  ideaCount: number;
  plannedCount: number;
  doneCount: number;
  /** Next plan with a date in the future. */
  next?: {
    id: Id;
    title: string;
    date: IsoDate;
    daysUntil: number;
    company: PlanCompany;
    estimatedCostCents?: Cents;
  };
  /** Sum of estimated costs for planned/booked items with a future date. */
  upcomingCommittedCents: Cents;
  spentThisYearCents: Cents;
  countriesVisited: string[];
  countriesWishlist: string[];
  tripsPlanned: number;
}
