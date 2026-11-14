import type { CacheEntry, CacheStore, OfflineDb, OutboxItem, OutboxStore } from './types';

const copy = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

/** An in-memory `OfflineDb`, for tests and for browsers without IndexedDB (nothing survives a reload). */
export function memoryDb(): OfflineDb & { outboxRows: Map<string, OutboxItem>; cacheRows: Map<string, CacheEntry> } {
  const outboxRows = new Map<string, OutboxItem>();
  const cacheRows = new Map<string, CacheEntry>();
  const outbox: OutboxStore = {
    all: async () => [...outboxRows.values()].map(copy).sort((a, b) => a.seq - b.seq),
    put: async (item) => void outboxRows.set(item.id, copy(item)),
    remove: async (id) => void outboxRows.delete(id),
  };
  const cache: CacheStore = {
    get: async (key) => copy(cacheRows.get(key)),
    put: async (entry) => void cacheRows.set(entry.key, copy(entry)),
    remove: async (key) => void cacheRows.delete(key),
    prune: async (before) => {
      let removed = 0;
      for (const [key, entry] of cacheRows) {
        if (entry.touchedAt < before) {
          cacheRows.delete(key);
          removed++;
        }
      }
      return removed;
    },
    count: async () => cacheRows.size,
  };
  return { outbox, cache, close: () => undefined, outboxRows, cacheRows };
}
