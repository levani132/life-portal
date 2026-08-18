/**
 * Cross-cutting primitives. Per constitution principle II, every monetary value in this
 * codebase is an integer number of cents and every field holding one is named `*Cents`.
 */

/** Mongo ObjectId serialised as a hex string. */
export type Id = string;

/** ISO-8601 date or date-time string. Dates without a time component are `YYYY-MM-DD`. */
export type IsoDate = string;

export const SUPPORTED_CURRENCIES = ['USD', 'GEL', 'EUR'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** An integer count of minor currency units (cents / tetri). */
export type Cents = number;

export interface Timestamped {
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Owned {
  userId: Id;
}

/**
 * Provenance for any number the system derived rather than recorded
 * (constitution principle VI). Rendered in the UI next to the estimate.
 */
export interface Estimate<T = number> {
  value: T;
  /** Short human-readable explanation of how `value` was produced. */
  basis: string;
  /** Named inputs that fed the calculation, for a "show the maths" panel. */
  assumptions?: Record<string, number | string | boolean | null>;
  confidence?: 'low' | 'medium' | 'high';
}

export interface Paginated<T> {
  items: T[];
  total: number;
}
