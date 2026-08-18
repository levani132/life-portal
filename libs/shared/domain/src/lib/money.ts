/**
 * Integer-cent money helpers (constitution principle II).
 *
 * Nothing here returns a fractional cent. Every operation that could produce one rounds
 * explicitly, so rounding is a decision made at one place rather than an accident.
 */

export type Cents = number;

export function toCents(amount: number): Cents {
  return Math.round(amount * 100);
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

/** Multiplies cents by a ratio, rounding half-up to the nearest cent. */
export function scaleCents(cents: Cents, ratio: number): Cents {
  return Math.round(cents * ratio);
}

export function sumCents(values: (Cents | undefined | null)[]): Cents {
  return values.reduce<Cents>((total, v) => total + (v ?? 0), 0);
}

/** Never returns below zero — used for remaining balances that must not go negative. */
export function clampPositive(cents: Cents): Cents {
  return cents > 0 ? cents : 0;
}

/** Ratio of `part` to `whole`, clamped to [0, 1]. Returns 1 when `whole` is zero. */
export function ratio(part: Cents, whole: Cents): number {
  if (whole <= 0) return 1;
  return Math.min(1, Math.max(0, part / whole));
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GEL: '₾',
};

/**
 * Formats cents for display. Whole amounts drop the decimals, because a dashboard reads
 * better as `$10,500` than `$10,500.00`; anything with cents keeps them.
 */
export function formatCents(cents: Cents, currency = 'USD', options?: { forceDecimals?: boolean }): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const hasCents = abs % 100 !== 0;
  const digits = options?.forceDecimals || hasCents ? 2 : 0;
  const body = (abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${negative ? '-' : ''}${symbol}${body}`;
}

/** Compact form for tight card layouts: `$10.5k`, `$1.2M`. */
export function formatCentsCompact(cents: Cents, currency = 'USD'): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const negative = cents < 0;
  const units = Math.abs(cents) / 100;
  const sign = negative ? '-' : '';
  if (units >= 1_000_000) return `${sign}${symbol}${(units / 1_000_000).toFixed(1)}M`;
  if (units >= 10_000) return `${sign}${symbol}${Math.round(units / 1000)}k`;
  if (units >= 1_000) return `${sign}${symbol}${(units / 1000).toFixed(1)}k`;
  return `${sign}${symbol}${Math.round(units)}`;
}

export function formatPct(value: number, digits = 1): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

/**
 * Converts between currencies using a static rate table keyed `FROM_TO` (e.g. `USD_GEL`).
 * Returns the input untouched when no rate is known — a wrong number is worse than an
 * unconverted one, and the caller surfaces mixed currencies in the UI.
 */
export function convertCents(
  cents: Cents,
  from: string,
  to: string,
  rates: Record<string, number>,
): Cents {
  if (from === to) return cents;
  const direct = rates[`${from}_${to}`];
  if (direct) return scaleCents(cents, direct);
  const inverse = rates[`${to}_${from}`];
  if (inverse) return scaleCents(cents, 1 / inverse);
  return cents;
}
