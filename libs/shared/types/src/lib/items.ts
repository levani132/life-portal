import type { Cents, Currency, Id, IsoDate, Timestamped } from './common';

/**
 * Widget 3 — "Items to sell".
 *
 * Feeds the loan widget: the sum of `expectedPriceCents` for still-sellable items is the
 * best-case proceeds available for repayment.
 */

export const ITEM_STATUSES = [
  /** Owned, intend to sell, not listed anywhere yet. */
  'draft',
  /** Publicly listed on at least one marketplace. */
  'listed',
  /** Someone has enquired or made an offer. */
  'has_interest',
  /** Agreed with a buyer, awaiting handover/payment. */
  'reserved',
  'sold',
  /** Decided to keep it, or it is unsellable. Excluded from all totals. */
  'abandoned',
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Statuses that still represent future money. */
export const OPEN_ITEM_STATUSES: readonly ItemStatus[] = [
  'draft',
  'listed',
  'has_interest',
  'reserved',
];

export interface ItemListing {
  platform: string;
  url?: string;
  listedAt: IsoDate;
  /** Price the item is advertised at on this platform, if it differs from `askingPrice`. */
  priceCents?: Cents;
}

export interface BuyerInterest {
  name: string;
  contact?: string;
  offeredPriceCents?: Cents;
  at: IsoDate;
  note?: string;
  status: 'open' | 'negotiating' | 'lost' | 'won';
}

export interface SellableItem extends Timestamped {
  id: Id;
  userId: Id;
  name: string;
  description?: string;
  category?: string;
  currency: Currency;
  /** What it is advertised for. */
  askingPriceCents: Cents;
  /** Realistic expectation after haggling — this is what projections use. */
  expectedPriceCents: Cents;
  /** Walk-away price; used for the pessimistic proceeds figure. */
  minPriceCents?: Cents;
  status: ItemStatus;
  condition?: 'new' | 'like_new' | 'good' | 'fair' | 'poor';
  listings: ItemListing[];
  interests: BuyerInterest[];
  soldPriceCents?: Cents;
  soldAt?: IsoDate;
  /** Which loan the proceeds are earmarked for. */
  allocateToLoanId?: Id;
  /** Fraction of proceeds going to that loan. 1 = all. */
  allocationRatio: number;
  /** Rough expectation of when it will sell, used to date the inflow in scenarios. */
  expectedSaleDate?: IsoDate;
  photoUrl?: string;
  notes?: string;
}

export interface ItemsSummary {
  currency: Currency;
  openCount: number;
  soldCount: number;
  /** Sum of `expectedPriceCents` across open items. */
  expectedProceedsCents: Cents;
  /** Sum of `minPriceCents ?? expectedPriceCents` across open items. */
  pessimisticProceedsCents: Cents;
  /** Sum of `askingPriceCents` across open items. */
  optimisticProceedsCents: Cents;
  realisedProceedsCents: Cents;
  /** Portion of expected proceeds earmarked for loans, keyed by loan id. */
  earmarkedByLoan: Record<Id, Cents>;
  /** Items sitting in `has_interest` or `reserved` — closest to cash. */
  nearlySoldCount: number;
}
