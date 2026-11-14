import { CACHE_SHELL_KEYS, offlineModuleOf, type CacheStore } from './types';

/** Unused cached reads are dropped after this (decision 2026-11-14): the refresh-token lifetime. */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Cached reads for offline use (spec 027). Keys are `<module>:<what>`, and only the modules in
 * `OFFLINE_MODULES` may write: money, banking, investments and work are online-only, and a key
 * for them throws rather than being stored. Reading or writing an entry refreshes it; anything
 * untouched for 30 days is pruned when the account's store opens.
 */
export class OfflineCache {
  constructor(
    private readonly store: CacheStore,
    private readonly now: () => number = Date.now,
  ) {}

  private check(key: string) {
    if (!offlineModuleOf(key) && !(CACHE_SHELL_KEYS as readonly string[]).includes(key)) throw new Error(`"${key}" may not be stored on this device.`);
  }

  async get<V>(key: string): Promise<V | undefined> {
    this.check(key);
    const entry = await this.store.get(key);
    if (!entry) return undefined;
    if (entry.touchedAt < this.now() - CACHE_TTL_MS) {
      await this.store.remove(key);
      return undefined;
    }
    await this.store.put({ ...entry, touchedAt: this.now() });
    return entry.value as V;
  }

  async put<V>(key: string, value: V): Promise<void> {
    this.check(key);
    await this.store.put({ key, value, touchedAt: this.now() });
  }

  remove(key: string): Promise<void> {
    this.check(key);
    return this.store.remove(key);
  }

  prune(): Promise<number> {
    return this.store.prune(this.now() - CACHE_TTL_MS);
  }

  count(): Promise<number> {
    return this.store.count();
  }
}
