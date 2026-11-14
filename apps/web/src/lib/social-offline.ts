'use client';

import { useMemo } from 'react';
import { revalidate } from './hooks';
import { newObjectId } from './offline/planned-row-id';
import { enqueueWrite, outbox, outboxItems, outboxSyncing, subscribeOutbox, useOutbox } from './offline/runtime';
import { moduleWrites } from './offline/settling';
import { cancelledBy, socialMetaOf, type SocialWrite, type SocialWriteMeta } from './offline/social-overlay';
import type { OutboxItem, WriteMethod } from './offline/types';

/**
 * Likes, reposts and comments that work without a connection (spec 031, issue #20 S1), on the
 * outbox (spec 027). Each is kept on the device and sent once, in order, when the connection is
 * back. Liking and unliking with no connection cancel out and send nothing. A like or repost of a
 * post that is gone or no longer visible is dropped quietly; a comment on one stays in the sync
 * sheet with its text, so it can be copied, until it is discarded.
 *
 * Nothing here records For You measurement: views and likes made offline are not measured.
 */

const socialWrites$ = moduleWrites('social.', async (item) => {
  const meta = socialMetaOf(item.meta);
  if (!meta) return;
  await Promise.all([
    revalidate(`/posts/${meta.postId}/engagement`),
    revalidate(`/posts/${meta.postId}/comments`),
    ...(meta.op === 'repost' ? [revalidate('/posts?')] : []),
  ]);
});

const isSocial = (item: OutboxItem) => socialWrites$.owns(item);

if (typeof window !== 'undefined') {
  // A like or repost for a post that is gone, private or blocked now: nothing to tell the person.
  subscribeOutbox(() => {
    for (const item of outboxItems()) {
      const meta = isSocial(item) ? socialMetaOf(item.meta) : undefined;
      if (item.state !== 'error' || item.lastErrorCode !== 'POST_GONE') continue;
      if (meta?.op === 'like' || meta?.op === 'repost' || meta?.op === 'comment.remove') {
        void outbox.discard(item.id).then(() => revalidate(`/posts/${meta.postId}/engagement`));
      }
    }
  });
}

/** This device's social writes to show, in order (refused ones only in the sync sheet). */
export function useSocialWrites(): SocialWrite[] {
  const items = socialWrites$.useItems();
  const snapshot = useOutbox();
  return useMemo(() => {
    const live = new Set(snapshot.items.map((item) => item.id));
    return items.flatMap((item) => {
      const meta = socialMetaOf(item.meta);
      return meta ? [{ meta, settled: !live.has(item.id) }] : [];
    });
  }, [items, snapshot]);
}

/** Whether a write made now is unlikely to reach the server at once (for measurement only). */
export function useOffline(): boolean {
  const snapshot = useOutbox();
  return snapshot.offline || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

async function write(meta: SocialWriteMeta, request: { method: WriteMethod; path: string; body?: unknown }, label: string, id = crypto.randomUUID()) {
  await enqueueWrite({ id, kind: `social.${meta.op}`, ...request, meta, label });
}

const short = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const socialWrites = {
  /** Sets the like (or repost). A waiting opposite one is withdrawn instead: nothing is sent. */
  async toggle(op: 'like' | 'repost', postId: string, on: boolean, title: string): Promise<void> {
    const meta = { op, postId, on } as const;
    // A write being sent may already be on the server, so it is never withdrawn mid-send.
    const cancelled = cancelledBy(outboxItems(), meta);
    if (cancelled.length && !outboxSyncing()) {
      for (const id of cancelled) await outbox.discard(id);
      return;
    }
    const path = `/posts/${postId}/${op}`;
    await write(
      meta,
      on ? { method: 'PUT', path, body: {} } : { method: 'DELETE', path },
      `${op === 'like' ? (on ? 'Like' : 'Unlike') : on ? 'Repost' : 'Undo repost'} · ${short(title || 'post')}`,
    );
  },

  /** A comment with the id chosen here; shown at once as not sent. */
  async comment(postId: string, text: string): Promise<string> {
    const commentId = newObjectId();
    const requestId = crypto.randomUUID();
    await write(
      { op: 'comment', postId, commentId, text, createdAt: new Date().toISOString() },
      { method: 'POST', path: `/posts/${postId}/comments`, body: { text, requestId, id: commentId } },
      `Comment · ${short(text)}`,
      requestId,
    );
    return commentId;
  },

  /** A comment never sent is withdrawn; a saved one is removed once there is a connection. */
  async removeComment(postId: string, commentId: string): Promise<void> {
    const queued = outboxItems().filter((item) => {
      const meta = isSocial(item) ? socialMetaOf(item.meta) : undefined;
      return meta?.op === 'comment' && meta.commentId === commentId;
    });
    if (queued.length) {
      for (const item of queued) await outbox.discard(item.id);
      return;
    }
    await write(
      { op: 'comment.remove', postId, commentId },
      { method: 'DELETE', path: `/posts/${postId}/comments/${commentId}` },
      'Delete comment',
    );
  },
};

/** A comment the server refused (its post is gone): its text, for copying before discarding. */
export function refusedCommentText(item: OutboxItem): string | undefined {
  const meta = isSocial(item) ? socialMetaOf(item.meta) : undefined;
  return meta?.op === 'comment' && (item.state === 'error' || item.state === 'conflict') ? meta.text : undefined;
}
