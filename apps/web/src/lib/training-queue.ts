'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { enqueueWrite, onWriteDone, outbox, useOutbox } from './offline/runtime';
import type { OutboxItem, WriteMethod } from './offline/types';
import { revalidateTraining } from './training';

/**
 * The gym has bad signal (spec 020, research R7). Sets are logged through the durable outbox
 * (spec 027, issue #16): each write is kept on the device until the server acknowledges it,
 * shown at once as a pending row, sent in order, retried when the connection comes back, and
 * sent with its `requestId` as `Idempotency-Key`, so a retry after a lost response, a reload or
 * a crash never creates a duplicate. Closing the app no longer loses unsent sets.
 */
export interface QueuedJob<M = unknown> {
  /** The request's `requestId`. A second job with the same id is ignored. */
  id: string;
  /** What the UI needs to draw the pending row. Serialisable: it is stored on the device. */
  meta: M;
  method: WriteMethod;
  path: string;
  body?: unknown;
  /** A line for the sync sheet, e.g. "Set · Bench press". */
  label?: string;
}

/** Acknowledged but not yet refetched: still drawn as pending, so the saved row replaces it without a gap. */
let settling: OutboxItem[] = [];
const settleListeners = new Set<() => void>();
const publishSettling = () => settleListeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  onWriteDone((item) => {
    if (!item.kind.startsWith('training.')) return;
    settling = [...settling, item];
    publishSettling();
    void revalidateTraining()
      .catch(() => undefined)
      .finally(() => {
        settling = settling.filter((other) => other.id !== item.id);
        publishSettling();
      });
  });
}

export function enqueue<M>(job: QueuedJob<M>): void {
  void enqueueWrite({ ...job, kind: 'training.set' });
}

/** Gives up the training writes the server refused. Explicit: the person pressed Discard. */
export function clearQueueError(): void {
  for (const id of refusedIds) void outbox.discard(id);
}
let refusedIds: string[] = [];

const subscribeSettling = (listener: () => void) => {
  settleListeners.add(listener);
  return () => settleListeners.delete(listener);
};

export function useTrainingQueue(): { jobs: { id: string; meta: unknown }[]; offline: boolean; error: string | null } {
  const snapshot = useOutbox();
  const settled = useSyncExternalStore(subscribeSettling, () => settling, () => settling);
  return useMemo(() => {
    // Stored data outlives the code that wrote it: an item without the meta the UI draws from is
    // still sent and shown in the sync sheet, but never handed to the workout screens.
    const training = snapshot.items.filter(
      (item) => item.kind.startsWith('training.') && typeof item.meta === 'object' && item.meta !== null,
    );
    const waiting = training.filter((item) => item.state === 'pending' || item.state === 'auth');
    const refused = training.filter((item) => item.state === 'error' || item.state === 'conflict');
    refusedIds = refused.map((item) => item.id);
    const ids = new Set(waiting.map((item) => item.id));
    return {
      jobs: [...waiting, ...settled.filter((item) => !ids.has(item.id))].map((item) => ({ id: item.id, meta: item.meta })),
      offline: snapshot.offline && waiting.length > 0,
      error: refused.length ? (refused[refused.length - 1].lastError ?? 'Could not save.') : null,
    };
  }, [snapshot, settled]);
}
