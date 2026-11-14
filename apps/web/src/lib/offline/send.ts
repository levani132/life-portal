import { ApiError, request, tokens } from '../api';
import { mayReplayAs } from './device-meta';
import { sendPostDraft } from './post-draft-send';
import { POST_DRAFT_KIND } from './post-drafts';
import type { OutboxItem } from './types';

/**
 * Sends one queued write as `userId`, with its id as `Idempotency-Key`. Spec 034: never under
 * another identity — if the token in hand was issued for another account (someone signed in as B
 * while A's writes were still open here), the write is answered like a 401 and waits in `auth`
 * until A signs in again. Its own module so the integration tests (issue #22) drive exactly this.
 */
export const sendAs = (userId: string) => (item: OutboxItem, save: (body: unknown) => Promise<void>) => {
  if (!mayReplayAs(userId, tokens.access ?? tokens.refresh))
    return Promise.reject(new ApiError('Signed in as another account.', 401));
  return item.kind === POST_DRAFT_KIND
    ? sendPostDraft(item, save)
    : request(item.path, { method: item.method, body: item.body, headers: { 'Idempotency-Key': item.id } });
};
