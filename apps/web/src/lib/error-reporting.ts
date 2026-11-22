'use client';

import type { ClientErrorInput } from '@life-portal/shared-types';
import { ApiError, NetworkError, api } from './api';

/**
 * Tells the server that something broke on this page, so the developer finds out without being
 * told by a person. The server keeps a scrubbed message and the page's pattern, not who it was.
 *
 * Quiet by design: each kind of error is sent once per visit, at most ten per visit, never for
 * an answer the server gave on purpose or a dropped connection, and a failed report is ignored
 * (reporting must not become an error of its own).
 */
const sent = new Set<string>();
const MAX_PER_VISIT = 10;

export function reportError(error: unknown): void {
  try {
    // The server's own verdict, or no connection: expected, and already shown to the person.
    if (error instanceof ApiError || error instanceof NetworkError) return;
    const failure = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error');
    // Cancelled work is not a fault.
    if (failure.name === 'AbortError') return;
    const key = `${failure.name}:${failure.message}`.slice(0, 300);
    if (sent.has(key) || sent.size >= MAX_PER_VISIT) return;
    sent.add(key);
    const body: ClientErrorInput = {
      name: failure.name.slice(0, 120) || 'Error',
      message: failure.message.slice(0, 2000) || '(no message)',
      ...(failure.stack ? { stack: failure.stack.slice(0, 8000) } : {}),
      page: window.location.pathname.slice(0, 500),
    };
    void api.post('/errors/client', body).catch(() => undefined);
  } catch {
    /* Nothing to do: the page carries on. */
  }
}
