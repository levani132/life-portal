import { ApiError, request, tokens } from '../api';
import { mayReplayAs } from './device-meta';
import { sendPostDraft } from './post-draft-send';
import { POST_DRAFT_KIND } from './post-drafts';
import type { OutboxItem } from './types';

/**
 * Sends one queued write as `userId`, with its id as `Idempotency-Key`. Spec 034: never under
 * another identity — if the token in hand was issued for another account (someone signed in as B
 * while A's writes were still open here), the write is answered like a 401 and waits in `auth`
 * until A signs in again. Each write also says how long it waited (`X-Queued-Age`). Its own module so the integration tests (issue #22) drive exactly this.
 */
export const sendAs = (userId: string, now: () => number = Date.now) => (item: OutboxItem, save: (body: unknown) => Promise<void>) => {
  if (!mayReplayAs(userId, tokens.access ?? tokens.refresh))
    return Promise.reject(new ApiError('Signed in as another account.', 401));
  return item.kind === POST_DRAFT_KIND
    ? sendPostDraft(item, save)
    : request(item.path, { method: item.method, body: item.body, headers: { 'Idempotency-Key': item.id, 'X-Queued-Age': queuedAge(item, now()) } });
};

/**
 * Issue #22: whole seconds the write has waited on this device. The server only buckets it for
 * the developer's sync-health counts (under a minute, an hour, a day, a week, 30 days, older).
 */
export function queuedAge(item: Pick<OutboxItem, 'createdAt'>, nowMs: number): string {
  return String(Math.max(0, Math.floor((nowMs - item.createdAt) / 1000)));
}
