/**
 * The offline layer's shapes (spec 027, issue #16). See `docs/modules/offline.md`.
 */

export type WriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * - `pending`: waiting to be sent, or between retries (`nextAttemptAt`).
 * - `error`: the server refused it (a 4xx other than a conflict). Needs the person: retry or discard.
 * - `conflict`: the server answered 409; the thing changed elsewhere. Needs the person.
 * - `auth`: the session ended. Waits, under this account only, until the same account signs in.
 */
export type OutboxState = 'pending' | 'error' | 'conflict' | 'auth';

/** One write, kept on the device until the server acknowledges it. */
export interface OutboxItem<M = unknown> {
  /** Unique, sent as `Idempotency-Key`; a second enqueue with the same id is ignored. */
  id: string;
  /** Enqueue order. Items are sent in this order. */
  seq: number;
  /** `<module>.<what>`, e.g. `training.set`. The module must be one allowed offline. */
  kind: string;
  method: WriteMethod;
  path: string;
  body?: unknown;
  /** What the UI needs to draw it while it waits (serialisable). */
  meta?: M;
  /** Items that must be acknowledged first, e.g. a set needs its workout. */
  dependsOn?: string[];
  /** A short line for the sync sheet, e.g. "Bench press · 8 reps". */
  label?: string;
  state: OutboxState;
  attempts: number;
  /** Epoch ms; a pending item is not sent before this. */
  nextAttemptAt: number;
  lastError?: string;
  createdAt: number;
}

export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface CacheEntry<V = unknown> {
  key: string;
  value: V;
  /** Epoch ms of the last read or write; unused entries expire. */
  touchedAt: number;
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  put(entry: CacheEntry): Promise<void>;
  remove(key: string): Promise<void>;
  /** Removes entries untouched since `before`; returns how many. */
  prune(before: number): Promise<number>;
  count(): Promise<number>;
}

/** One account's offline data on this device. */
export interface OfflineDb {
  outbox: OutboxStore;
  cache: CacheStore;
  close(): void;
}

/**
 * The modules allowed to keep data on the device (decision 2026-11-14, issue #16). Money,
 * banking, investments and work are online-only and are deliberately not in this list.
 */
export const OFFLINE_MODULES = ['training', 'nutrition', 'social'] as const;
export type OfflineModule = (typeof OFFLINE_MODULES)[number];

/**
 * Cache keys allowed outside those modules, each one exact. `shell:portal` is the portal state
 * (which modules are on, widget order, setup progress): no records, and without it the app
 * cannot draw its shell offline at all.
 */
export const CACHE_SHELL_KEYS = ['shell:portal'] as const;

/** `training.set` → `training`, if that module may keep data on the device. */
export function offlineModuleOf(kindOrKey: string): OfflineModule | undefined {
  const module = kindOrKey.split(/[.:/]/)[0];
  return (OFFLINE_MODULES as readonly string[]).includes(module) ? (module as OfflineModule) : undefined;
}
