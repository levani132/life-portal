'use client';

import { useSyncExternalStore } from 'react';
import { ApiError } from './api';

/**
 * The gym has bad signal (spec 020, research R7). Sets are logged through this queue: each
 * write is keyed by its `requestId`, shown at once as a pending row, sent in order, and retried
 * when the connection comes back. The API answers a repeated `requestId` with the original row,
 * so a retry after a lost response never creates a duplicate.
 *
 * In memory only: closing the app with writes still pending loses those writes. Full offline
 * logging is out of scope for this phase.
 */
export interface QueuedJob<M = unknown> {
  /** The request's `requestId`. A second job with the same id is ignored. */
  id: string;
  /** What the UI needs to draw the pending row. */
  meta: M;
  run: () => Promise<unknown>;
  onDone?: () => unknown;
  onError?: (message: string) => void;
}

let jobs: QueuedJob[] = [];
let draining = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastError: string | null = null;
const listeners = new Set<() => void>();
let snapshot: { jobs: QueuedJob[]; offline: boolean; error: string | null } = {
  jobs: [],
  offline: false,
  error: null,
};
let offline = false;

function publish() {
  snapshot = { jobs: [...jobs], offline, error: lastError };
  listeners.forEach((listener) => listener());
}

/** A failure worth retrying: no response at all, a timeout, rate limiting or a server error. */
function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status >= 500 || error.status === 408 || error.status === 429;
}

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void drain();
  }, 5000);
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (jobs.length) {
      const job = jobs[0];
      try {
        await job.run();
        offline = false;
        // Refetch before dropping the pending row, so the saved row replaces it without a gap.
        // A failed refetch is not a failed write: the write is done.
        try {
          await job.onDone?.();
        } catch {
          // the next refresh shows it
        }
        jobs = jobs.slice(1);
        publish();
      } catch (error) {
        if (isTransient(error)) {
          offline = true;
          publish();
          scheduleRetry();
          return;
        }
        // The server refused it (validation, gone): retrying would fail the same way.
        jobs = jobs.slice(1);
        lastError = error instanceof ApiError ? error.message : 'Could not save.';
        job.onError?.(lastError);
        publish();
      }
    }
  } finally {
    draining = false;
  }
}

export function enqueue<M>(job: QueuedJob<M>) {
  if (jobs.some((queued) => queued.id === job.id)) return;
  jobs = [...jobs, job as QueuedJob];
  lastError = null;
  publish();
  void drain();
}

export function clearQueueError() {
  lastError = null;
  publish();
}

if (typeof window !== 'undefined') {
  const wake = () => void drain();
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useTrainingQueue() {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
