import { Injectable, Logger } from '@nestjs/common';
import { SUPPORTED_CURRENCIES } from '@life-portal/shared-types';
import type { FxRatePoint } from '@life-portal/shared-types';

/**
 * National Bank of Georgia exchange-rate client.
 *
 * Chosen over a commercial FX API for three reasons: it is the *official* rate for the lari,
 * it needs no key (so nothing else has to be configured before the app works), and it
 * publishes one authoritative figure per day, which is exactly the granularity a daily
 * archive wants.
 *
 * Like `FinnhubProvider`, this returns `null` instead of throwing. A rate outage must leave
 * the app showing unconverted amounts, never break a page.
 */
const RATES_URL =
  'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/';
const TIMEOUT_MS = 8000;

/** NBG quotes every currency against the lari, so the archive's base is fixed. */
export const FX_BASE_CURRENCY = 'GEL';

interface NbgCurrency {
  code?: string;
  /** Some currencies are quoted per 100 or per 1000 units (JPY is per 100). */
  quantity?: number;
  rate?: number;
  validFromDate?: string;
}

interface NbgResponse {
  date?: string;
  currencies?: NbgCurrency[];
}

@Injectable()
export class NbgProvider {
  private readonly logger = new Logger(NbgProvider.name);

  /**
   * The rates for one day, quoted against GEL and keyed by currency code.
   *
   * `day` matters more than it looks: NBG publishes in the evening marked valid from the
   * *following* day, so an unparameterised call made at 01:00 answers with tomorrow's rate and
   * the archive ends up holding nothing usable for today. Always ask for the day you want.
   *
   * Only the currencies this app supports are kept — storing all 42 would bloat every
   * document in the archive for no gain.
   */
  async fetchRates(day?: string): Promise<FxRatePoint | null> {
    const payload = await this.get(day);
    const entry = payload?.[0];
    if (!entry?.currencies?.length) {
      this.logger.warn('NBG returned no currencies');
      return null;
    }

    const wanted = new Set<string>(
      SUPPORTED_CURRENCIES.filter((c) => c !== FX_BASE_CURRENCY),
    );
    const rates: Record<string, number> = {};
    for (const currency of entry.currencies) {
      const code = currency.code?.toUpperCase();
      if (!code || !wanted.has(code)) continue;
      // Per-unit rate. Dividing by `quantity` matters for the currencies NBG quotes in
      // hundreds; USD and EUR are quoted per 1, but relying on that would be a latent bug.
      const quantity =
        currency.quantity && currency.quantity > 0 ? currency.quantity : 1;
      const rate = currency.rate;
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
        continue;
      rates[code] = rate / quantity;
    }

    if (!Object.keys(rates).length) {
      this.logger.warn(
        'NBG returned no usable rates for the supported currencies',
      );
      return null;
    }

    // `validFromDate` is the day the rate applies to; `date` is when it was published, which
    // is the evening before. Getting these the wrong way round would file every rate a day early.
    const validFrom =
      entry.currencies.find((c) => c.validFromDate)?.validFromDate ??
      entry.date;
    const date = (validFrom ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      this.logger.warn(`NBG returned an unusable date: ${String(validFrom)}`);
      return null;
    }

    return { date, rates };
  }

  private async get(day?: string): Promise<NbgResponse[] | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const url = day ? `${RATES_URL}?date=${day}` : RATES_URL;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        this.logger.warn(`NBG responded ${response.status}`);
        return null;
      }
      return (await response.json()) as NbgResponse[];
    } catch (error) {
      this.logger.warn(
        `NBG request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
