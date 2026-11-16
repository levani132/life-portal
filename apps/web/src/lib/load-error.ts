import { ApiError, NetworkError } from './api';

/**
 * Issue #34: what a failed read means, in words that do not call every failure "No connection".
 *
 * - `offline`: the request never left the device (spec 031's `notSent`), or the device says it is
 *   offline.
 * - `unreachable`: it left, and no answer came back. On an installed iPhone app this is often the
 *   moment of resuming, before the network is back, so it is retried.
 * - `server`: the server answered, with a 5xx. Retried too.
 * - `session`: the session has ended; the auth context sends the person to sign in.
 * - `other`: any other answer from the server (a 4xx). Never retried: it would answer the same.
 */
export type LoadErrorKind = 'offline' | 'unreachable' | 'server' | 'session' | 'other';

export function loadErrorKind(error: unknown, online = typeof navigator === 'undefined' || navigator.onLine !== false): LoadErrorKind {
  if (error instanceof NetworkError) return error.notSent || !online ? 'offline' : 'unreachable';
  if (error instanceof ApiError) {
    if (error.status === 401) return 'session';
    return error.status >= 500 ? 'server' : 'other';
  }
  return 'other';
}

export function loadErrorMessage(kind: LoadErrorKind, error: unknown): string {
  switch (kind) {
    case 'offline':
      return 'You’re offline.';
    case 'unreachable':
      return 'Can’t reach Life Portal right now.';
    case 'server':
      return 'Life Portal is having trouble right now.';
    case 'session':
      return 'Your session has ended. Please sign in again.';
    default:
      return error instanceof Error && error.message ? error.message : 'Something went wrong.';
  }
}

/** Retried on its own: a failure the next attempt may not repeat. */
export const retriesOnItsOwn = (kind: LoadErrorKind) => kind === 'unreachable' || kind === 'server';

/** Seconds before retry `attempt` (1-based); `undefined` when it should stop. 2, 4, 8, 16, 30. */
export function retryDelayMs(attempt: number): number | undefined {
  if (attempt < 1 || attempt > 5) return undefined;
  return Math.min(30, 2 ** attempt) * 1000;
}

/**
 * Whether checking the stored session on start proved it over. Only a refusal does (401, 403):
 * a 5xx or a 429 is the server having trouble, not a verdict, and signing the person out for it
 * turned an API outage into a trip to the sign-in page (issue #34).
 */
export const endsSession = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 403);

