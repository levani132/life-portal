'use client';

import { useSyncExternalStore } from 'react';
import type { PostPreview } from '@life-portal/shared-types';
import { request } from '../api';
import { uploadMedia } from '../media';
import { publishDraft, type PostDraftBody } from './post-drafts';
import type { OutboxItem } from './types';

/**
 * How the outbox sends a post draft (spec 032): several requests instead of one. Kept apart from
 * `post-drafts.ts` so that file stays pure, and from `lib/post-drafts.ts` so the runtime can import
 * it without a cycle. Also says which draft is being published right now, and how far along.
 */

export interface Publishing {
  id: string;
  fraction: number;
}

let publishing: Publishing | null = null;
const listeners = new Set<() => void>();
const set = (next: Publishing | null) => {
  publishing = next;
  listeners.forEach((listener) => listener());
};

export function sendPostDraft(item: OutboxItem, save: (body: unknown) => Promise<void>): Promise<unknown> {
  set({ id: item.id, fraction: 0 });
  return publishDraft(item.body as PostDraftBody, save, {
    upload: (photo, onProgress) =>
      uploadMedia(
        { kind: 'image', blob: photo.blob, width: photo.width, height: photo.height, previewUrl: '' },
        onProgress,
        new AbortController().signal,
      ),
    preview: async (source) =>
      (await request<PostPreview>('/posts/preview', { method: 'POST', body: { source } })).previewHash,
    // No Idempotency-Key: the draft's `requestId` already makes a repeat return the same post.
    create: (body) => request<{ id: string }>('/posts', { method: 'POST', body }),
    onProgress: (fraction) => set({ id: item.id, fraction }),
  }).finally(() => set(null));
}

export function usePublishing(): Publishing | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => publishing,
    () => null,
  );
}
