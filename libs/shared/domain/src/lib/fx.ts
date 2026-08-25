/**
 * Currency conversion (constitution principle V — pure, with the day always explicit).
 *
 * The rule this file exists to enforce: **a converted amount is never stored, and it is
 * always converted at the rate in force on its own day.** Converting at "today's rate"
 * would silently rewrite history every time the lari moved — a payment that filled one
 * budget line yesterday would fill a different one tomorrow. So the archive of published
 * rates is kept (a rate is an observation, not a derived value) and every conversion looks
 * up the day it belongs to.
 */
import type {
  Cents,
  Currency,
  FxContext,
  FxRate,
  FxRateHistory,
  FxRatePoint,
  Money,
} from '@life-portal/shared-types';
import { toDay } from './dates';
import { convertCents, sumCents } from './money';

/**
 * The rates in force on `day`: the most recent point published on or before it.
 *
 * Deliberately does **not** extrapolate backwards. A transaction older than the first
 * published rate stays unconverted rather than being valued at a rate that did not exist
 * yet, because the alternative is a figure that changes as the archive grows.
 */
export function ratePointFor(
  history: FxRateHistory | null | undefined,
  day: string,
): FxRatePoint | undefined {
  if (!history?.points?.length) return undefined;
  const target = toDay(day);
  let best: FxRatePoint | undefined;
  for (const point of history.points) {
    if (
      toDay(point.date) <= target &&
      (!best || toDay(point.date) > toDay(best.date))
    )
      best = point;
  }
  return best;
}

/**
 * Expands one day's base-quoted rates into the flat `FROM_TO` table `convertCents` reads,
 * cross rates included.
 *
 * With base `GEL` and `{ USD: 2.6121, EUR: 3.0465 }` this yields all six ordered pairs, so
 * `USD_EUR` is present and no caller has to derive it by chaining two conversions and
 * rounding twice.
 */
export function rateTable(
  base: Currency,
  rates: Record<string, FxRate>,
): Record<string, FxRate> {
  /** Value of one unit of each currency, expressed in the base. */
  const inBase: Record<string, FxRate> = { [base]: 1 };
  for (const [code, rate] of Object.entries(rates)) {
    if (rate > 0) inBase[code] = rate;
  }

  const table: Record<string, FxRate> = {};
  for (const from of Object.keys(inBase)) {
    for (const to of Object.keys(inBase)) {
      if (from !== to) table[`${from}_${to}`] = inBase[from] / inBase[to];
    }
  }
  return table;
}

/** Resolves the archive down to the one thing render code needs: a table plus a label. */
export function fxContext(
  history: FxRateHistory | null | undefined,
  day: string,
  displayCurrency: Currency,
): FxContext {
  const point = ratePointFor(history, day);
  if (!point || !history) return { displayCurrency, rates: {} };
  return {
    displayCurrency,
    rates: rateTable(history.base, point.rates),
    rateDate: toDay(point.date),
  };
}

/** True when `fx` can actually turn `from` into the display currency. */
export function canConvert(from: Currency, fx: FxContext): boolean {
  return (
    from === fx.displayCurrency ||
    fx.rates[`${from}_${fx.displayCurrency}`] != null
  );
}

/**
 * Converts one amount into the display currency, reporting whether it happened.
 *
 * `converted: false` means the amount came back in its original currency — the caller must
 * show it as such rather than implying it is comparable (principle VI).
 */
export function toDisplayCents(
  cents: Cents,
  from: Currency,
  fx: FxContext,
): { cents: Cents; currency: Currency; converted: boolean } {
  if (from === fx.displayCurrency)
    return { cents, currency: from, converted: false };
  if (!canConvert(from, fx)) return { cents, currency: from, converted: false };
  return {
    cents: convertCents(cents, from, fx.displayCurrency, fx.rates),
    currency: fx.displayCurrency,
    converted: true,
  };
}

/**
 * Sums mixed-currency amounts into the display currency.
 *
 * Anything that could not be converted is still added — dropping it would understate a
 * total, which is the more dangerous error — but its currency is reported in `unconverted`
 * so the UI can mark the figure as approximate.
 */
export function sumInDisplay(
  amounts: (Money | undefined | null)[],
  fx: FxContext,
): { cents: Cents; unconverted: Currency[] } {
  const unconverted = new Set<Currency>();
  const converted = amounts.map((amount) => {
    if (!amount) return 0;
    const result = toDisplayCents(amount.amountCents, amount.currency, fx);
    if (!result.converted && amount.currency !== fx.displayCurrency)
      unconverted.add(amount.currency);
    return result.cents;
  });
  return { cents: sumCents(converted), unconverted: [...unconverted].sort() };
}

/** The `basis` string for a converted figure (principle VI). */
export function fxBasis(fx: FxContext, unconverted: Currency[] = []): string {
  if (unconverted.length) {
    return `Converted to ${fx.displayCurrency}; ${unconverted.join(', ')} left unconverted for want of a rate`;
  }
  if (!fx.rateDate)
    return `Shown in ${fx.displayCurrency}; no exchange rate available`;
  return `Converted to ${fx.displayCurrency} at the National Bank of Georgia rate for ${fx.rateDate}`;
}
