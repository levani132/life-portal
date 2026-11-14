import type { CacheEntry, CacheStore, OfflineDb, OutboxItem, OutboxStore } from './types';

/**
 * IndexedDB, written by hand (spec 027): two object stores and a dozen lines of promise
 * plumbing do not justify a dependency (constitution, Governance). One database per account,
 * `lp-offline:<userId>`, so accounts on one device never share or see each other's data.
 *
 * Versions: 1 creates `outbox` (keyPath `id`) and `cache` (keyPath `key`, index `touchedAt`).
 * A later version adds its migration in `upgrade` below, keyed on `oldVersion`.
 */
const VERSION = 1;
export const dbName = (userId: string) => `lp-offline:${userId}`;

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

function upgrade(db: IDBDatabase, oldVersion: number) {
  if (oldVersion < 1) {
    db.createObjectStore('outbox', { keyPath: 'id' });
    db.createObjectStore('cache', { keyPath: 'key' }).createIndex('touchedAt', 'touchedAt');
  }
}

export function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function openIdb(userId: string): Promise<OfflineDb> {
  const open = indexedDB.open(dbName(userId), VERSION);
  open.onupgradeneeded = (event) => upgrade(open.result, event.oldVersion);
  const db = await done(open);
  // Another tab upgrading the schema: let it, and reopen on next use.
  db.onversionchange = () => db.close();

  const run = async <T>(store: 'outbox' | 'cache', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const tx = db.transaction(store, mode);
    const result = done(fn(tx.objectStore(store)));
    await finished(tx);
    return result;
  };

  const outbox: OutboxStore = {
    all: async () => ((await run('outbox', 'readonly', (s) => s.getAll())) as OutboxItem[]).sort((a, b) => a.seq - b.seq),
    put: async (item) => void (await run('outbox', 'readwrite', (s) => s.put(item))),
    remove: async (id) => void (await run('outbox', 'readwrite', (s) => s.delete(id))),
  };

  const cache: CacheStore = {
    get: async (key) => (await run('cache', 'readonly', (s) => s.get(key))) as CacheEntry | undefined,
    put: async (entry) => void (await run('cache', 'readwrite', (s) => s.put(entry))),
    remove: async (key) => void (await run('cache', 'readwrite', (s) => s.delete(key))),
    prune: async (before) => {
      const tx = db.transaction('cache', 'readwrite');
      const index = tx.objectStore('cache').index('touchedAt');
      let removed = 0;
      await new Promise<void>((resolve, reject) => {
        const cursor = index.openCursor(IDBKeyRange.upperBound(before, true));
        cursor.onsuccess = () => {
          const at = cursor.result;
          if (!at) return resolve();
          at.delete();
          removed++;
          at.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
      await finished(tx);
      return removed;
    },
    count: async () => run('cache', 'readonly', (s) => s.count()),
  };

  return { outbox, cache, close: () => db.close() };
}

/** Deletes an account's database. Resolves even when another tab still holds it open (it closes on `versionchange`). */
export function deleteIdb(userId: string): Promise<void> {
  if (!idbAvailable()) return Promise.resolve();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(dbName(userId));
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
