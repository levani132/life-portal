/**
 * Foreign-exchange contracts.
 *
 * An exchange rate is the one number in this codebase that is **not** an integer count of
 * cents (principle II). A rate is a *ratio*, not a monetary amount, and rounding it to two
 * decimals would put visible error into every converted figure. Money stays in cents; the
 * ratio it is multiplied by is a float. See `docs/DECISIONS.md`.
 */
import type { Currency, IsoDate } from './common';

/** How many units of the base currency one unit of the quoted currency buys. */
export type FxRate = number;

/** One day's published rates, all quoted against a single base currency. */
export interface FxRatePoint {
  /** `YYYY-MM-DD`. The day the rates are valid *from*, not the day they were published. */
  date: IsoDate;
  /** Keyed by currency code. `{ USD: 2.6121 }` means 1 USD buys 2.6121 base units. */
  rates: Record<string, FxRate>;
}

/**
 * The published-rate archive, one document per base currency. Grown by appending a point per
 * day, exactly like `stock_price_history`, because a converted figure has to stay the same
 * forever once it has been shown.
 */
export interface FxRateHistory {
  base: Currency;
  points: FxRatePoint[];
  fetchedAt: IsoDate;
}

/**
 * Everything needed to render mixed-currency rows in one currency, resolved for one day.
 *
 * `rates` is the flat `FROM_TO` table `convertCents` reads, cross rates included. It is empty
 * when no rates are known for the day, and every conversion helper then returns amounts
 * untouched — an unconverted number is recoverable, a wrongly converted one is not.
 */
export interface FxContext {
  displayCurrency: Currency;
  rates: Record<string, FxRate>;
  /** The day the rates were published for. Feeds the `basis` on converted figures. */
  rateDate?: IsoDate;
}

/** A single monetary value that knows its own currency. */
export interface Money {
  amountCents: number;
  currency: Currency;
}
