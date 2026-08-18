import { Inject, Injectable, Logger } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/configuration';

/**
 * Finnhub market-data client.
 *
 * Everything here returns `null` rather than throwing when the key is missing, the request
 * fails, or the free tier refuses an endpoint. The constitution requires the app stay fully
 * usable on manually entered prices, so a provider outage must degrade, never break.
 *
 * Free-tier notes, which shape the design:
 * - `/quote` and `/stock/metric` are available. Historical candles are **not**, which is why
 *   price history is grown by appending each day's quote instead of backfilled.
 * - The rate limit is 60 calls/minute, so peer fundamentals are fetched on demand rather
 *   than on every quote refresh.
 */
const BASE_URL = 'https://finnhub.io/api/v1';
const TIMEOUT_MS = 8000;
const MAX_PEERS = 5;

export interface ProviderQuote {
  pricePerShareCents: number;
  previousClosePerShareCents?: number;
  dayChangePct?: number;
}

export interface ProviderMetrics {
  fiftyTwoWeekHighCents?: number;
  fiftyTwoWeekLowCents?: number;
  epsTtm?: number;
  peTtm?: number;
  epsGrowthPct?: number;
  beta?: number;
}

interface FinnhubQuoteResponse {
  c?: number;
  d?: number;
  dp?: number;
  pc?: number;
}

interface FinnhubMetricResponse {
  metric?: Record<string, number | null | undefined>;
}

@Injectable()
export class FinnhubProvider {
  private readonly logger = new Logger(FinnhubProvider.name);

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  get isConfigured(): boolean {
    return Boolean(this.config.finnhubApiKey);
  }

  /** Human-readable reason the provider is unavailable, for the UI to show. */
  get unavailableReason(): string | undefined {
    return this.isConfigured
      ? undefined
      : 'FINNHUB_API_KEY is not set, so prices must be entered manually.';
  }

  async fetchQuote(symbol: string): Promise<ProviderQuote | null> {
    const data = await this.get<FinnhubQuoteResponse>('/quote', { symbol });
    // Finnhub answers 200 with `c: 0` for an unknown symbol rather than an error status.
    if (!data || !data.c || data.c <= 0) {
      if (data) this.logger.warn(`Finnhub returned no price for ${symbol}`);
      return null;
    }
    return {
      pricePerShareCents: Math.round(data.c * 100),
      previousClosePerShareCents: data.pc ? Math.round(data.pc * 100) : undefined,
      dayChangePct: typeof data.dp === 'number' ? data.dp / 100 : undefined,
    };
  }

  async fetchMetrics(symbol: string): Promise<ProviderMetrics | null> {
    const data = await this.get<FinnhubMetricResponse>('/stock/metric', { symbol, metric: 'all' });
    const metric = data?.metric;
    if (!metric) return null;

    const num = (key: string): number | undefined => {
      const value = metric[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    };
    const cents = (key: string): number | undefined => {
      const value = num(key);
      return value != null ? Math.round(value * 100) : undefined;
    };

    return {
      fiftyTwoWeekHighCents: cents('52WeekHigh'),
      fiftyTwoWeekLowCents: cents('52WeekLow'),
      epsTtm: num('epsBasicExclExtraItemsTTM') ?? num('epsTTM'),
      peTtm: num('peBasicExclExtraTTM') ?? num('peTTM'),
      epsGrowthPct: num('epsGrowthTTMYoy') ?? num('epsGrowth5Y'),
      beta: num('beta'),
    };
  }

  /**
   * Median trailing P/E across the symbol's peers.
   *
   * The peer median is the anchor the reversion term needs: using the symbol's *own* P/E
   * would make the term collapse back to the current price and contribute nothing.
   */
  async fetchPeerPe(symbol: string): Promise<number | null> {
    const peers = await this.get<string[]>('/stock/peers', { symbol });
    if (!Array.isArray(peers) || peers.length === 0) return null;

    const candidates = peers.filter((p) => p && p !== symbol).slice(0, MAX_PEERS);
    const ratios: number[] = [];
    for (const peer of candidates) {
      const metrics = await this.fetchMetrics(peer);
      // Negative or absurd P/Es say more about accounting than valuation, so they are dropped.
      if (metrics?.peTtm && metrics.peTtm > 0 && metrics.peTtm < 200) ratios.push(metrics.peTtm);
    }
    if (!ratios.length) return null;

    ratios.sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    return ratios.length % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T | null> {
    if (!this.config.finnhubApiKey) return null;

    const url = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set('token', this.config.finnhubApiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        // 403 is the free tier refusing a premium endpoint; 429 is the rate limit. Both are
        // expected operating conditions, not incidents.
        this.logger.warn(`Finnhub ${path} responded ${response.status} for ${params['symbol']}`);
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Finnhub ${path} failed for ${params['symbol']}: ${reason}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
