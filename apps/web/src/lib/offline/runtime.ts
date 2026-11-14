'use client';

import { useSyncExternalStore } from 'react';
import { clearMeta, lostWrites, otherAccountsPending, readMeta, writeMeta } from './device-meta';
import { OfflineCache } from './cache';
import { deleteIdb, idbAvailable, openIdb } from './idb-store';
import { memoryDb } from './memory-store';
import { Outbox, type EnqueueInput, type OutboxSnapshot } from './outbox';
import { sendAs } from './send';
import type { OfflineDb, OutboxItem } from './types';

/**
 * The offline layer for the signed-in account (spec 027). `AuthProvider` calls `startOffline`
 * when it knows who is signed in and `endOffline` on logout. Everything else goes through
 * `enqueueWrite`, `useOutbox` and `onWriteDone`.
 *
 * Syncing happens only while the app is open: on enqueue, on regaining the connection, on
 * returning to the app, and on a timer while something waits. There is no reliance on the
 * Background Sync API, which iOS does not have.
 */

interface Session {
  userId: string;
  db: OfflineDb;
  outbox: Outbox;
  cache: OfflineCache;
  durable: boolean;
  channel?: BroadcastChannel;
  stopTriggers: () => void;
}

let session: Session | null = null;
let starting: Promise<Session> | null = null;
let startingFor: string | null = null;
const EMPTY: OutboxSnapshot = { items: [], syncing: false, offline: false };
const listeners = new Set<() => void>();
const doneListeners = new Set<(item: OutboxItem, result: unknown) => void>();
let unsubscribe: (() => void) | undefined;

function notify() {
  listeners.forEach((listener) => listener());
}

// ------------------------------------------------------------- notices (spec 034)

export interface OfflineNotices {
  /** Writes this account had on the device that the browser deleted before they were sent. */
  lost: number;
  /** Writes other accounts left on this device: a count only. */
  otherAccounts: number;
}
const NO_NOTICES: OfflineNotices = { lost: 0, otherAccounts: 0 };
let notices = NO_NOTICES;
const setNotices = (next: Partial<OfflineNotices>) => {
  notices = { ...notices, ...next };
  notify();
};
const localStore = () => (typeof window !== 'undefined' ? window.localStorage : undefined);

export function useOfflineNotices(): OfflineNotices {
  return useSyncExternalStore(subscribeOutbox, () => notices, () => NO_NOTICES);
}

/** The person read the eviction warning. */
export function dismissLostWrites(): void {
  setNotices({ lost: 0 });
}

function crossTabLock(userId: string) {
  return <T,>(fn: () => Promise<T>): Promise<T> => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? (locks.request(`lp-outbox:${userId}`, fn) as Promise<T>) : fn();
  };
}

async function open(userId: string): Promise<Session> {
  const durable = idbAvailable();
  const db = durable ? await openIdb(userId).catch(() => memoryDb()) : memoryDb();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(`lp-outbox:${userId}`) : undefined;
  const storage = localStore();
  // Spec 034: only a real database can be compared with what this device remembered.
  const remembered = durable && storage ? readMeta(userId, storage) : undefined;
  let tracked = -1;
  const outbox = new Outbox({
    store: db.outbox,
    send: sendAs(userId),
    track: (count) => {
      if (!durable || !storage || count === tracked) return;
      tracked = count;
      writeMeta(userId, count, Date.now(), storage);
    },
    lock: crossTabLock(userId),
    announce: () => channel?.postMessage('changed'),
    onDone: (item, result) => doneListeners.forEach((listener) => listener(item, result)),
  });
  const cache = new OfflineCache(db.cache);
  if (channel) channel.onmessage = () => void outbox.load();

  const wake = () => void outbox.drain();
  const visible = () => {
    if (document.visibilityState === 'visible') wake();
  };
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', visible);
  // While something waits and the app is visible, look again every 30 s (backoff decides when
  // an item is actually due).
  const interval = window.setInterval(() => {
    if (document.visibilityState === 'visible' && outbox.count(['pending']) > 0) wake();
  }, 30_000);
  const stopTriggers = () => {
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wake);
    document.removeEventListener('visibilitychange', visible);
    window.clearInterval(interval);
  };

  const others = () => setNotices({ otherAccounts: storage ? otherAccountsPending(userId, storage) : 0 });
  window.addEventListener('storage', others);
  const stopNotices = () => window.removeEventListener('storage', others);

  await outbox.load();
  const lost = lostWrites(remembered, outbox.count());
  setNotices({ lost, otherAccounts: storage ? otherAccountsPending(userId, storage) : 0 });
  await cache.prune().catch(() => 0);
  return {
    userId,
    db,
    outbox,
    cache,
    durable,
    channel,
    stopTriggers: () => {
      stopTriggers();
      stopNotices();
    },
  };
}

/** Opens (or keeps) the store for this account. Another account's store is closed first. */
export async function startOffline(userId: string): Promise<void> {
  if (session?.userId === userId) return;
  if (starting && startingFor === userId) {
    await starting;
    return;
  }
  await endOffline();
  startingFor = userId;
  starting = open(userId);
  try {
    session = await starting;
  } finally {
    starting = null;
    startingFor = null;
  }
  unsubscribe = session.outbox.subscribe(notify);
  notify();
  void session.outbox.drain();
}

/** Closes the store without deleting it (the session expired; pending writes wait). */
export async function endOffline(): Promise<void> {
  if (starting) await starting.catch(() => undefined);
  if (!session) return;
  unsubscribe?.();
  session.outbox.stop();
  session.stopTriggers();
  session.channel?.close();
  session.db.close();
  session = null;
  notices = NO_NOTICES;
  notify();
}

/** Deletes this account's offline data on this device: the outbox and every cached read. */
export async function deleteOfflineData(userId: string): Promise<void> {
  if (session?.userId === userId) await endOffline();
  await deleteIdb(userId);
  const storage = localStore();
  if (storage) clearMeta(userId, storage);
}

async function ready(): Promise<Session> {
  if (session) return session;
  if (starting) return starting;
  throw new Error('Not signed in.');
}

let persistAsked = false;

/**
 * Asks the browser to keep this site's storage (spec 027). Browsers may still say no, and iOS
 * may clear it after weeks without use; the settings page says so.
 */
async function askToPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not offered: storage stays best-effort.
  }
}

/** Keeps a write on the device and sends it as soon as it can. Resolves once it is stored. */
export async function enqueueWrite<M>(input: EnqueueInput<M>): Promise<void> {
  const current = await ready();
  void askToPersist();
  await current.outbox.enqueue(input);
}

export const outbox = {
  drain: async () => (await ready()).outbox.drain(),
  retry: async (id: string) => (await ready()).outbox.retry(id),
  retryAll: async () => (await ready()).outbox.retryAll(),
  resumeAuth: async () => (await ready()).outbox.resumeAuth(),
  discard: async (id: string) => (await ready()).outbox.discard(id),
  /** Spec 034: sends a write held because it was queued more than 30 days ago. */
  confirm: async (id: string) => (await ready()).outbox.confirm(id),
  /** Spec 030: a refused write changed by the person's choice, sent again in its place. */
  replace: async (id: string, input: Parameters<Outbox['replace']>[1]) => (await ready()).outbox.replace(id, input),
  /** Writes still on this device and not acknowledged, in any state. */
  count: () => session?.outbox.count() ?? 0,
};

/**
 * The cache once the signed-in account's store is open. Reads fire as the app boots, often
 * before `startOffline` has finished; this waits for it (briefly) instead of missing the cache.
 */
export async function waitForOfflineCache(timeoutMs = 3000): Promise<OfflineCache | undefined> {
  if (session) return session.cache;
  const deadline = Date.now() + timeoutMs;
  while (!session && Date.now() < deadline) {
    if (starting) {
      await Promise.race([starting.catch(() => undefined), new Promise((r) => setTimeout(r, deadline - Date.now()))]);
    } else {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  // Read through a call: TypeScript would keep `session` narrowed to null from the check above.
  return offlineCache();
}

/** Every item in the signed-in account's outbox, in order (empty before sign-in). */
export function outboxItems(): OutboxItem[] {
  return session?.outbox.getSnapshot().items ?? [];
}

/** Whether the outbox is sending right now (spec 031: a write being sent cannot be withdrawn). */
export function outboxSyncing(): boolean {
  return session?.outbox.getSnapshot().syncing ?? false;
}

/** The signed-in account's offline cache, or undefined before sign-in. */
export function offlineCache(): OfflineCache | undefined {
  return session?.cache;
}

export function offlineDurable(): boolean {
  return session?.durable ?? false;
}

/** Called after each acknowledged write; modules refetch what it changed. */
export function onWriteDone(listener: (item: OutboxItem, result: unknown) => void): () => void {
  doneListeners.add(listener);
  return () => doneListeners.delete(listener);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => session?.outbox.getSnapshot() ?? EMPTY;

export function useOutbox(): OutboxSnapshot {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

const sessionKey = () => session?.userId ?? null;

/** Re-renders when the signed-in account's offline store opens or closes. */
export function useOfflineAccount(): string | null {
  return useSyncExternalStore(subscribe, sessionKey, () => null);
}

/** Called whenever the signed-in account's outbox changes (outside React). */
export function subscribeOutbox(listener: () => void): () => void {
  return subscribe(listener);
}
