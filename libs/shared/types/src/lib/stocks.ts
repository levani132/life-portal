import type { Cents, Currency, Estimate, Id, IsoDate, Timestamped } from './common';

/**
 * Widget 4 — "Stocks".
 *
 * Holdings are recorded as immutable **lots**, so the same symbol bought on three dates is
 * three rows with three cost bases. Position-level figures (average cost, unrealised P&L,
 * liquidation value) are folded on read.
 */

export const LOT_SOURCES = [
  /** Bought on the open market with own money. */
  'purchase',
  /** EPAM employee share purchase plan, bought at a discount. */
  'espp',
  /** Granted, zero cost basis. */
  'rsu',
  /** Modelled future lot produced by the ESPP projector; never persisted. */
  'projected_espp',
] as const;
export type LotSource = (typeof LOT_SOURCES)[number];

export interface StockLot extends Timestamped {
  id: Id;
  userId: Id;
  symbol: string;
  /** Fractional shares are real, so this is a float. */
  quantity: number;
  /** Cost basis per share, after any discount. */
  pricePerShareCents: Cents;
  currency: Currency;
  purchaseDate: IsoDate;
  source: LotSource;
  /** For ESPP lots: the discount received, as a decimal (0.15 = 15%). */
  discountPct?: number;
  /** For ESPP lots: undiscounted market reference price used to compute the buy price. */
  marketPriceAtPurchaseCents?: Cents;
  feesCents?: Cents;
  /** Set when the lot has been liquidated. */
  soldQuantity?: number;
  soldPricePerShareCents?: Cents;
  soldAt?: IsoDate;
  /** Which loan the sale proceeds are earmarked for. */
  allocateToLoanId?: Id;
  allocationRatio: number;
  notes?: string;
}

/** Latest known price for a symbol. The only permitted cache (constitution principle III). */
export interface StockQuote extends Timestamped {
  id: Id;
  symbol: string;
  pricePerShareCents: Cents;
  currency: Currency;
  previousClosePerShareCents?: Cents;
  dayChangePct?: number;
  fiftyTwoWeekHighCents?: Cents;
  fiftyTwoWeekLowCents?: Cents;
  fetchedAt: IsoDate;
  /** `finnhub` when live, `manual` when the user typed it. */
  provider: 'finnhub' | 'manual';
  /** True when the provider failed and this is the last good value. */
  stale?: boolean;
}

export interface StockPricePoint {
  date: IsoDate;
  closeCents: Cents;
}

/** Daily closes used for the comparison chart and the drift term of the target heuristic. */
export interface StockPriceHistory extends Timestamped {
  id: Id;
  symbol: string;
  points: StockPricePoint[];
  fetchedAt: IsoDate;
}

/** Fundamentals used by the suggested-target heuristic. All optional; it degrades. */
export interface StockFundamentals {
  symbol: string;
  epsTtm?: number;
  peTtm?: number;
  /** Peer/sector median P/E, used as the reversion anchor. */
  peerPe?: number;
  epsGrowthPct?: number;
  beta?: number;
  fetchedAt: IsoDate;
}

export interface StockTarget extends Timestamped {
  id: Id;
  userId: Id;
  symbol: string;
  /** The user's own target. This is what loan scenarios use when present. */
  targetPriceCents?: Cents;
  /** Horizon the target is expected to be reached within, in months. */
  horizonMonths: number;
  rationale?: string;
  /** Price at which the user wants to be alerted to cut losses. */
  stopPriceCents?: Cents;
}

/** One weighted term of the suggested target price, exposed so the UI can show the maths. */
export interface TargetPriceComponent {
  key: 'fifty_two_week_high' | 'drift' | 'pe_reversion' | 'analyst' | 'cost_basis_hurdle';
  label: string;
  valueCents: Cents;
  weight: number;
  /** Why this term produced this number. */
  basis: string;
}

export interface SuggestedTarget extends Estimate<Cents> {
  symbol: string;
  horizonMonths: number;
  components: TargetPriceComponent[];
  /** Implied gain over the current price, as a decimal. */
  upsidePct: number;
  /** Bounds applied to keep the blend sane. */
  floorCents: Cents;
  capCents: Cents;
}

/** All lots for one symbol, folded. */
export interface StockPosition {
  symbol: string;
  currency: Currency;
  lots: StockLot[];
  /** Unsold shares only. */
  quantity: number;
  totalCostCents: Cents;
  averageCostPerShareCents: Cents;
  currentPricePerShareCents?: Cents;
  quoteFetchedAt?: IsoDate;
  quoteStale?: boolean;
  marketValueCents?: Cents;
  unrealisedPnlCents?: Cents;
  unrealisedPnlPct?: number;
  realisedPnlCents: Cents;
  target?: StockTarget;
  suggestedTarget?: SuggestedTarget;
  /** `quantity * effectiveTargetPrice`. Uses the user target, else the suggestion. */
  valueAtTargetCents?: Cents;
  /** The target actually used in projections. */
  effectiveTargetPerShareCents?: Cents;
  effectiveTargetIsSuggested: boolean;
}

/**
 * EPAM employee share purchase plan.
 *
 * Every six months a fixed contribution buys shares at a discount to the **lower** of the
 * prices on the two period boundary dates (1 May and 1 November).
 */
export interface EsppPlan extends Timestamped {
  id: Id;
  userId: Id;
  symbol: string;
  /** Money contributed per six-month period. */
  contributionPerPeriodCents: Cents;
  currency: Currency;
  /** Decimal, e.g. 0.15 for 15% off. */
  discountPct: number;
  /**
   * The two boundary dates as `{ month, day }`. Purchases happen on each boundary and the
   * reference price is `min(close at period start, close at period end)`.
   */
  periodBoundaries: { month: number; day: number }[];
  active: boolean;
  notes?: string;
}

/** A modelled future ESPP purchase. */
export interface ProjectedEsppGrant {
  purchaseDate: IsoDate;
  periodStart: IsoDate;
  periodEnd: IsoDate;
  contributionCents: Cents;
  /** `min(startPrice, endPrice)` — actual where known, modelled where not. */
  referencePriceCents: Cents;
  /** `referencePriceCents * (1 - discountPct)`. */
  purchasePriceCents: Cents;
  estimatedShares: number;
  /** Immediate paper gain from the discount. */
  discountValueCents: Cents;
  basis: string;
  /** False once both boundary prices are real closes rather than the current price. */
  modelled: boolean;
}

export interface EsppProjection {
  symbol: string;
  through: IsoDate;
  grants: ProjectedEsppGrant[];
  totalEstimatedShares: number;
  totalContributionCents: Cents;
  /** Value of the projected shares at the effective target price. */
  valueAtTargetCents: Cents;
  assumptions: string[];
}

export interface StocksSummary {
  currency: Currency;
  positionCount: number;
  totalCostCents: Cents;
  /** At live prices. Undefined when no quotes are available at all. */
  totalMarketValueCents?: Cents;
  totalUnrealisedPnlCents?: Cents;
  totalUnrealisedPnlPct?: number;
  /** At effective target prices — the headline "if everything hits target" number. */
  totalValueAtTargetCents: Cents;
  /**
   * What could actually be handed to a lender today: market value less modelled capital
   * gains tax, times each lot's allocation ratio.
   */
  liquidationNowCents?: Cents;
  /** Same, at target prices. */
  liquidationAtTargetCents: Cents;
  earmarkedByLoan: Record<Id, Cents>;
  nextEsppDate?: IsoDate;
  nextEsppEstimatedShares?: number;
  quotesStale: boolean;
  quotesFetchedAt?: IsoDate;
}
