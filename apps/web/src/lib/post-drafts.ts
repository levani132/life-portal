'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { Audience, PostSelection } from '@life-portal/shared-types';
import { revalidate } from './hooks';
import type { PreparedMedia } from './media';
import {
  draftProblem,
  mealWritesBefore,
  POST_DRAFT_KIND,
  type PostDraftBody,
  type PostDraftMeta,
} from './offline/post-drafts';
import { enqueueWrite, onWriteDone, outboxItems, useOutbox } from './offline/runtime';
import type { OutboxItem } from './offline/types';

/**
 * Posts written with no connection (spec 032, issue #20 S2). The composer keeps one here; it is
 * shown at the top of the feed as a draft, then as being published, then as posted. Nothing is
 * shown to anyone else until the server has it. See `offline/post-drafts.ts`.
 */

export interface DraftInput {
  requestId: string;
  title: string;
  caption: string;
  audience: Audience;
  source?: PostSelection;
  /** `mediaId` for a photo already uploaded before the connection went. */
  photos: (PreparedMedia & { mediaId?: string })[];
}

const short = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Keeps the post on this device; it is published once there is a connection. */
export async function keepPostDraft(input: DraftInput): Promise<void> {
  const problem = draftProblem(input.photos.map((photo) => ({ kind: photo.kind, bytes: photo.blob.size })));
  if (problem) throw new Error(problem);
  const body: PostDraftBody = {
    requestId: input.requestId,
    title: input.title,
    caption: input.caption,
    audience: input.audience,
    ...(input.source ? { source: input.source } : {}),
    photos: input.photos.map(({ blob, width, height, mediaId }) => ({ blob, width, height, ...(mediaId ? { mediaId } : {}) })),
  };
  const meta: PostDraftMeta = {
    op: 'post',
    title: input.title.trim(),
    caption: input.caption.trim(),
    audience: input.audience,
    photoCount: input.photos.length,
    hasFood: !!input.source,
  };
  const dependsOn = mealWritesBefore(input.source, outboxItems());
  const text = meta.title || meta.caption || (meta.photoCount ? 'photo' : 'food');
  await enqueueWrite({
    id: crypto.randomUUID(),
    kind: POST_DRAFT_KIND,
    method: 'POST',
    path: '/posts',
    body,
    meta,
    label: `Post · ${short(text)}`,
    ...(dependsOn.length ? { dependsOn } : {}),
  });
}

// --------------------------------------------------------------------------- posted, recently

export interface PostedDraft {
  draftId: string;
  postId: string;
  meta: PostDraftMeta;
}

let posted: PostedDraft[] = [];
const postedListeners = new Set<() => void>();
const setPosted = (next: PostedDraft[]) => {
  posted = next;
  postedListeners.forEach((listener) => listener());
};

if (typeof window !== 'undefined') {
  onWriteDone((item, result) => {
    if (item.kind !== POST_DRAFT_KIND) return;
    const postId = (result as { id?: string } | undefined)?.id;
    void revalidate('/posts');
    if (postId) setPosted([...posted, { draftId: item.id, postId, meta: item.meta as PostDraftMeta }]);
  });
}

/** Drafts published while the app was open, until the person dismisses the note. */
export function useRecentlyPosted(): PostedDraft[] {
  return useSyncExternalStore(
    (listener) => {
      postedListeners.add(listener);
      return () => postedListeners.delete(listener);
    },
    () => posted,
    () => [],
  );
}

export function dismissPosted(draftId: string): void {
  setPosted(posted.filter((item) => item.draftId !== draftId));
}

/** This device's post drafts still waiting (any state), oldest first. */
export function usePostDrafts(): OutboxItem<PostDraftMeta>[] {
  const snapshot = useOutbox();
  return useMemo(
    () => snapshot.items.filter((item) => item.kind === POST_DRAFT_KIND) as OutboxItem<PostDraftMeta>[],
    [snapshot],
  );
}
