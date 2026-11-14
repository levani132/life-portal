import { ApiError, NetworkError } from '../api';
import { offlineModuleOf, type OutboxItem, type OutboxState, type OutboxStore, type WriteMethod } from './types';

/**
 * The durable outbox (spec 027, issue #16). Every offline-capable write goes here first, is kept
 * in IndexedDB until the server acknowledges it, and is sent with its id as `Idempotency-Key`,
 * so a write that is retried after a lost response, a reload or a crash happens once.
 *
 * Rules, each with a test in `outbox.spec.ts`:
 * - Items are sent in enqueue order. A transient failure (no connection, 5xx, 408, 429, or the
 *   server still running the first attempt) stops the run and retries later with jittered
 *   exponential backoff, so later writes never overtake an earlier one that is waiting.
 * - A refusal (other 4xx) marks the item `error` and a 409 marks it `conflict`. Neither is ever
 *   dropped: the person retries or discards it. Later items carry on unless they depend on it.
 * - A 401 (the session is over) marks it `auth` and pauses everything until the same account
 *   signs in again (`resumeAuth`). Items are never sent under another account: each account has
 *   its own store.
 * - "Saved" means acknowledged: an item leaves the store only after a 2xx.
 *
 * Pure apart from what it is given (store, send, clock, timers), so it runs in tests unchanged.
 */

export type Failure = 'transient' | 'auth' | 'conflict' | 'error';

/** How a failed send is treated. A thrown non-`ApiError` means no answer at all. */
export function classify(error: unknown): Failure {
  if (!(error instanceof ApiError)) return 'transient';
  if (error.status === 401) return 'auth';
  if (error.status === 409) return error.code === 'IDEMPOTENCY_IN_PROGRESS' ? 'transient' : 'conflict';
  if (error.status === 408 || error.status === 429 || error.status >= 500) return 'transient';
  return 'error';
}

/** The refusal's code and its simple string fields, kept with the item for whoever resolves it. */
function errorExtras(error: unknown): Pick<OutboxItem, 'lastErrorCode' | 'lastErrorData' | 'lastErrorCurrent'> {
  if (!(error instanceof ApiError)) return {};
  const current = (error.body as { current?: unknown } | undefined)?.current;
  const data = Object.fromEntries(
    Object.entries(error.body ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && !['message', 'error', 'code'].includes(entry[0]),
    ),
  );
  return {
    ...(error.code ? { lastErrorCode: error.code } : {}),
    ...(Object.keys(data).length ? { lastErrorData: data } : {}),
    ...(current && typeof current === 'object' ? { lastErrorCurrent: current as Record<string, unknown> } : {}),
  };
}

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

/** 1 s, 2 s, 4 s … capped at a minute, each scaled by a random 50–100 % so devices spread out. */
export function backoff(attempts: number, random: number): number {
  const raw = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(raw * (0.5 + random / 2));
}

export interface EnqueueInput<M = unknown> {
  id: string;
  kind: string;
  method: WriteMethod;
  path: string;
  body?: unknown;
  meta?: M;
  dependsOn?: string[];
  label?: string;
}

export interface OutboxSnapshot {
  items: OutboxItem[];
  /** A run is in progress. */
  syncing: boolean;
  /** The last attempt got no answer. */
  offline: boolean;
  /** Epoch ms of the last acknowledged write. */
  lastSyncedAt?: number;
}

export interface OutboxOptions {
  store: OutboxStore;
  /**
   * Sends one item. `save` keeps a new body for it under the same id while it is being sent
   * (spec 032: a post draft records each photo once uploaded, so a retry does not upload it again).
   */
  send: (item: OutboxItem, save: (body: unknown) => Promise<void>) => Promise<unknown>;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Runs `fn` exclusively across tabs (Web Locks), so two tabs never send the same item at once. */
  lock?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Tells other tabs the store changed (BroadcastChannel). */
  announce?: () => void;
  onDone?: (item: OutboxItem, result: unknown) => void;
}

export class Outbox {
  private items: OutboxItem[] = [];
  private snapshot: OutboxSnapshot = { items: [], syncing: false, offline: false };
  private listeners = new Set<() => void>();
  private draining: Promise<void> | null = null;
  private timer: unknown;
  private offline = false;
  private lastSyncedAt?: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly lock: <T>(fn: () => Promise<T>) => Promise<T>;

  constructor(private readonly options: OutboxOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.lock = options.lock ?? ((fn) => fn());
  }

  /** Reads the store again (after a reload, or when another tab changed it). */
  async load(): Promise<void> {
    this.items = await this.options.store.all();
    this.publish();
  }

  async enqueue<M>(input: EnqueueInput<M>): Promise<void> {
    if (!offlineModuleOf(input.kind)) throw new Error(`"${input.kind}" may not be stored on this device.`);
    await this.load();
    if (this.items.some((item) => item.id === input.id)) return;
    const seq = Math.max(this.now(), (this.items[this.items.length - 1]?.seq ?? 0) + 1);
    const item: OutboxItem = {
      ...input,
      seq,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: this.now(),
    };
    await this.options.store.put(item);
    this.items = [...this.items, item];
    this.options.announce?.();
    this.publish();
    void this.drain();
  }

  /** Sends what can be sent now. Concurrent calls share one run. */
  drain(): Promise<void> {
    this.draining ??= this.lock(() => this.run()).finally(() => {
      this.draining = null;
      this.publish();
    });
    this.publish();
    return this.draining;
  }

  private async run(): Promise<void> {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
    // Under the lock, the store is the truth: another tab may have sent or added items.
    this.items = await this.options.store.all();
    this.publish();
    for (;;) {
      const next = this.next();
      if (!next) break;
      let item = next;
      const save = async (body: unknown) => {
        await this.update(item, { body });
        item = { ...item, body };
      };
      try {
        const result = await this.options.send(item, save);
        await this.options.store.remove(item.id);
        this.items = this.items.filter((other) => other.id !== item.id);
        this.offline = false;
        this.lastSyncedAt = this.now();
        this.options.announce?.();
        this.publish();
        try {
          this.options.onDone?.(item, result);
        } catch {
          // A listener never undoes an acknowledged write.
        }
      } catch (error) {
        const failure = classify(error);
        const message = error instanceof Error ? error.message : 'Could not save.';
        if (failure === 'transient') {
          this.offline = !(error instanceof ApiError);
          await this.update(item, {
            attempts: item.attempts + 1,
            nextAttemptAt: this.now() + backoff(item.attempts + 1, this.random()),
            lastError: message,
            ...(error instanceof NetworkError && error.notSent ? {} : { maybeSent: true }),
          });
          break;
        }
        this.offline = false;
        await this.update(item, { state: failure, lastError: message, ...errorExtras(error) });
        if (failure === 'auth') break;
      }
    }
    this.schedule();
  }

  /**
   * The first pending item whose dependencies are all acknowledged, if it is due. An earlier
   * item still waiting for its retry holds back everything after it: order is kept. Items the
   * person must look at (`error`, `conflict`) and items held by them are passed over.
   */
  private next(): OutboxItem | undefined {
    if (this.items.some((item) => item.state === 'auth')) return undefined;
    const ids = new Set(this.items.map((item) => item.id));
    const first = this.items.find(
      (item) => item.state === 'pending' && !(item.dependsOn ?? []).some((id) => ids.has(id)),
    );
    return first && first.nextAttemptAt <= this.now() ? first : undefined;
  }

  /** A wake-up for the earliest retry still waiting. */
  private schedule() {
    if (this.items.some((item) => item.state === 'auth')) return;
    const waiting = this.items.filter((item) => item.state === 'pending' && item.nextAttemptAt > this.now());
    if (!waiting.length) return;
    const at = Math.min(...waiting.map((item) => item.nextAttemptAt));
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      void this.drain();
    }, Math.max(0, at - this.now()));
  }

  private async update(item: OutboxItem, patch: Partial<OutboxItem>) {
    const next = { ...item, ...patch };
    await this.options.store.put(next);
    this.items = this.items.map((other) => (other.id === item.id ? next : other));
    this.options.announce?.();
    this.publish();
  }

  /** An `error` or `conflict` item, or any waiting one, tried again now. */
  async retry(id: string): Promise<void> {
    await this.load();
    const item = this.items.find((other) => other.id === id);
    if (!item) return;
    await this.update(item, { state: 'pending', nextAttemptAt: 0 });
    void this.drain();
  }

  /**
   * Spec 030: the person resolved a refused write by changing it ("keep mine" against the row as
   * it is now, or a combined note). The changed write gets a new id, because an idempotency key
   * belongs to one request body, and keeps its place in the order; writes that waited for the old
   * one wait for the new one. The refusal's details go with the old one.
   */
  async replace(id: string, input: Pick<EnqueueInput, 'body' | 'meta' | 'label'> & { id: string }): Promise<void> {
    await this.load();
    const item = this.items.find((other) => other.id === id);
    if (!item || this.items.some((other) => other.id === input.id)) return;
    const { lastError: _error, lastErrorCode: _code, lastErrorData: _data, lastErrorCurrent: _current, ...rest } = item;
    const next: OutboxItem = {
      ...rest,
      ...input,
      state: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
    };
    await this.options.store.put(next);
    await this.options.store.remove(id);
    const rewired: OutboxItem[] = [];
    for (const other of this.items) {
      if (other.id === id) continue;
      if (other.dependsOn?.includes(id)) {
        const moved = { ...other, dependsOn: other.dependsOn.map((dep) => (dep === id ? input.id : dep)) };
        await this.options.store.put(moved);
        rewired.push(moved);
      } else rewired.push(other);
    }
    this.items = [...rewired, next].sort((a, b) => a.seq - b.seq);
    this.options.announce?.();
    this.publish();
    void this.drain();
  }

  /** Every waiting item now: the "Sync now" button. */
  async retryAll(): Promise<void> {
    await this.load();
    for (const item of this.items) {
      if (item.state === 'pending' || item.state === 'auth') await this.update(item, { state: 'pending', nextAttemptAt: 0 });
    }
    return this.drain();
  }

  /** After the same account signs in again: `auth` items go back to pending. */
  resumeAuth(): Promise<void> {
    return this.retryAll();
  }

  /** Drops an item the person chose to give up. Items depending on it are dropped too. */
  async discard(id: string): Promise<void> {
    await this.load();
    const doomed = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const item of this.items) {
        if (!doomed.has(item.id) && (item.dependsOn ?? []).some((dep) => doomed.has(dep))) {
          doomed.add(item.id);
          grew = true;
        }
      }
    }
    for (const doomedId of doomed) await this.options.store.remove(doomedId);
    this.items = this.items.filter((item) => !doomed.has(item.id));
    this.options.announce?.();
    this.publish();
  }

  stop() {
    if (this.timer !== undefined) this.clearTimer(this.timer);
    this.timer = undefined;
  }

  count(states: OutboxState[] = ['pending', 'error', 'conflict', 'auth']): number {
    return this.items.filter((item) => states.includes(item.state)).length;
  }

  getSnapshot = (): OutboxSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish() {
    this.snapshot = {
      items: this.items,
      syncing: this.draining !== null,
      offline: this.offline,
      ...(this.lastSyncedAt ? { lastSyncedAt: this.lastSyncedAt } : {}),
    };
    this.listeners.forEach((listener) => listener());
  }
}
