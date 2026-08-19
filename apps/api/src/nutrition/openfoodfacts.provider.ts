import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FoodLookupResult, FoodUnit } from '@life-portal/shared-types';
import { CONFIG, type AppConfig } from '../config/configuration';

/**
 * Open Food Facts lookup: search by name, or fetch by barcode.
 *
 * Modelled on `FinnhubProvider`, and for the same reason — the constitution requires the app to
 * stay fully usable when an external service is unavailable. Every method here returns an empty
 * result and a human-readable reason instead of throwing, and manual food entry is always open.
 *
 * What the API actually requires, verified against its documentation:
 *
 * - **No key** for reads, but a **custom `User-Agent` is required** (`AppName/Version (contact)`).
 *   A generic agent risks being treated as a bot. See `AppConfig.offUserAgent`.
 * - **Rate limits are tight**: 10 requests/minute/IP for search, 15 for product reads, enforced
 *   by IP ban. Hence the in-process cache below and the 400 ms debounce on the web side.
 * - **Full-text search does not exist in API v2/v3.** The documented route is Search-a-licious on
 *   its own host; the legacy `cgi/search.pl` endpoint is kept as a fallback because it is still
 *   the only thing that answers when the newer service is down.
 * - Data is **ODbL**, so anything imported carries an attribution string.
 */
const PRODUCT_BASE = 'https://world.openfoodfacts.org';
const SEARCH_BASE = 'https://search.openfoodfacts.org';
const TIMEOUT_MS = 8000;
const MAX_RESULTS = 20;
/** Cached long enough to survive a burst of typing, short enough to never look stale. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;

const ATTRIBUTION =
  'Source: Open Food Facts, licensed under the Open Database License (ODbL). Check the numbers ' +
  'against the packet — this is crowd-sourced data.';

/** The fields worth asking for. Fetching the whole product document is wasteful. */
const FIELDS = [
  'code',
  'product_name',
  'brands',
  'serving_quantity',
  'serving_quantity_unit',
  'product_quantity_unit',
  'quantity',
  'image_front_small_url',
  'nutriments',
].join(',');

interface OffNutriments {
  [key: string]: number | string | undefined;
}

interface OffProduct {
  code?: string | number;
  _id?: string;
  product_name?: string;
  /**
   * A string of comma-separated brands from the legacy endpoint, an **array** from
   * Search-a-licious. Assuming the string form crashed a live search — crowd-sourced data from
   * two endpoints is exactly the input that has to be treated as untrusted.
   */
  brands?: string | string[];
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  product_quantity_unit?: string;
  quantity?: string;
  image_front_small_url?: string;
  nutriments?: OffNutriments;
}

interface CacheEntry {
  at: number;
  results: FoodLookupResult[];
}

@Injectable()
export class OpenFoodFactsProvider {
  private readonly logger = new Logger(OpenFoodFactsProvider.name);
  private readonly cache = new Map<string, CacheEntry>();
  /** Set when the service refuses us, so the UI can explain itself without another attempt. */
  private lastFailure?: { at: number; reason: string };

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /**
   * Whether the lookup is worth offering. There is no key to check, so this reports the last
   * known state: a recent refusal (rate limit, outage) is surfaced rather than hidden behind a
   * search box that silently returns nothing.
   */
  get status(): { available: boolean; reason?: string } {
    if (this.lastFailure && Date.now() - this.lastFailure.at < CACHE_TTL_MS) {
      return { available: false, reason: this.lastFailure.reason };
    }
    return { available: true };
  }

  async search(query: string): Promise<{ available: boolean; reason?: string; results: FoodLookupResult[] }> {
    const normalised = query.trim().toLowerCase();
    if (normalised.length < 3) {
      return { available: true, results: [] };
    }

    const cached = this.cache.get(normalised);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { available: true, results: cached.results };
    }

    const products = (await this.searchAlicious(normalised)) ?? (await this.legacySearch(normalised));
    if (products == null) {
      return { available: false, reason: this.lastFailure?.reason ?? this.genericReason, results: [] };
    }

    const results = products
      .map((product) => {
        // One malformed product must not take the whole search down with it.
        try {
          return this.toResult(product);
        } catch (error) {
          this.logger.warn(
            `Skipped an Open Food Facts product that could not be mapped: ${error instanceof Error ? error.message : String(error)}`,
          );
          return undefined;
        }
      })
      .filter((result): result is FoodLookupResult => result != null);
    this.remember(normalised, results);
    return { available: true, results };
  }

  async byBarcode(code: string): Promise<{ available: boolean; reason?: string; result?: FoodLookupResult }> {
    const clean = code.replace(/\D/g, '');
    if (!clean) return { available: true };

    const data = await this.get<{ product?: OffProduct; status?: number }>(
      `${PRODUCT_BASE}/api/v2/product/${clean}.json?fields=${FIELDS}`,
    );
    if (data == null) {
      return { available: false, reason: this.lastFailure?.reason ?? this.genericReason };
    }
    const result = data.product ? this.toResult(data.product) : undefined;
    return result ? { available: true, result } : { available: true };
  }

  // ---------------------------------------------------------------- internals

  private get genericReason(): string {
    return 'Open Food Facts is not answering right now. Add the food by hand — nothing else is affected.';
  }

  private remember(key: string, results: FoodLookupResult[]): void {
    // Bounded, process-local, and holds public catalogue data only — not a stored cache of the
    // owner's data, so principle III is untouched.
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest != null) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), results });
  }

  /** The documented full-text search. Returns `null` when the service could not answer. */
  private async searchAlicious(query: string): Promise<OffProduct[] | null> {
    const url = `${SEARCH_BASE}/search?q=${encodeURIComponent(query)}&page_size=${MAX_RESULTS}&fields=${FIELDS}`;
    const data = await this.get<{ hits?: OffProduct[] }>(url);
    return data?.hits ?? null;
  }

  /** Legacy endpoint, kept because it sometimes answers when the newer service does not. */
  private async legacySearch(query: string): Promise<OffProduct[] | null> {
    const url =
      `${PRODUCT_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}` +
      `&search_simple=1&action=process&json=1&page_size=${MAX_RESULTS}&fields=${FIELDS}`;
    const data = await this.get<{ products?: OffProduct[] }>(url);
    return data?.products ?? null;
  }

  private async get<T>(url: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': this.config.offUserAgent, Accept: 'application/json' },
      });
      if (!response.ok) {
        // 429 is the documented rate limit and an expected operating condition, not an incident.
        const reason =
          response.status === 429
            ? 'Open Food Facts is rate-limiting us (it allows about 10 searches a minute). Try again shortly, or add the food by hand.'
            : `Open Food Facts responded ${response.status}. Add the food by hand — nothing else is affected.`;
        this.lastFailure = { at: Date.now(), reason };
        this.logger.warn(`Open Food Facts responded ${response.status} for ${url}`);
        return null;
      }
      this.lastFailure = undefined;
      return (await response.json()) as T;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.lastFailure = { at: Date.now(), reason: this.genericReason };
      this.logger.warn(`Open Food Facts request failed: ${detail}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Maps a product to this app's shape.
   *
   * A missing nutriment stays **absent**: importing it as zero would state a fact the source
   * does not have, and zero protein is a claim, not a gap.
   */
  private toResult(product: OffProduct): FoodLookupResult | undefined {
    const code = product.code ?? product._id;
    const name = typeof product.product_name === 'string' ? product.product_name.trim() : '';
    if (code == null || code === '' || !name) return undefined;

    const nutriments = product.nutriments ?? {};
    const num = (key: string): number | undefined => {
      const value = nutriments[key];
      const parsed = typeof value === 'string' ? Number(value) : value;
      return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    };
    const mg = (key: string): number | undefined => {
      const grams = num(key);
      return grams == null ? undefined : Math.round(grams * 1000);
    };

    const rawUnitHint = product.serving_quantity_unit ?? product.product_quantity_unit ?? '';
    const unitHint = (typeof rawUnitHint === 'string' ? rawUnitHint : '').toLowerCase().trim();
    const unit: FoodUnit = unitHint === 'ml' || unitHint === 'l' ? 'ml' : 'g';

    const rawServing =
      typeof product.serving_quantity === 'string'
        ? Number(product.serving_quantity)
        : product.serving_quantity;
    const servingSize =
      typeof rawServing === 'number' && Number.isFinite(rawServing) && rawServing >= 1
        ? Math.round(rawServing)
        : undefined;

    const energy = num('energy-kcal_100g') ?? (num('energy_100g') != null ? Math.round((num('energy_100g') as number) / 4.184) : undefined);

    const result: FoodLookupResult = {
      code: String(code),
      name,
      unit,
      attribution: `${ATTRIBUTION} ${PRODUCT_BASE}/product/${code}`,
    };
    const brand = Array.isArray(product.brands)
      ? product.brands.find((entry) => typeof entry === 'string' && entry.trim())?.trim()
      : typeof product.brands === 'string'
        ? product.brands.split(',')[0]?.trim()
        : undefined;
    if (brand) result.brand = brand;
    if (servingSize != null) result.servingSize = servingSize;
    if (energy != null) result.energyKcalPer100 = Math.round(energy);
    const protein = mg('proteins_100g');
    if (protein != null) result.proteinMgPer100 = protein;
    const fat = mg('fat_100g');
    if (fat != null) result.fatMgPer100 = fat;
    const carb = mg('carbohydrates_100g');
    if (carb != null) result.carbMgPer100 = carb;
    const fibre = mg('fiber_100g');
    if (fibre != null) result.fibreMgPer100 = fibre;
    const sugar = mg('sugars_100g');
    if (sugar != null) result.sugarMgPer100 = sugar;
    const satFat = mg('saturated-fat_100g');
    if (satFat != null) result.satFatMgPer100 = satFat;
    // Sodium is reported in grams; salt is 2.5× sodium, so it is only a fallback.
    const sodium = mg('sodium_100g') ?? (mg('salt_100g') != null ? Math.round((mg('salt_100g') as number) / 2.5) : undefined);
    if (sodium != null) result.sodiumMgPer100 = sodium;
    if (product.image_front_small_url) result.imageUrl = product.image_front_small_url;
    return result;
  }
}
