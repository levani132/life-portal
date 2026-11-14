'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { usePublishing } from '../lib/offline/post-draft-send';
import type { PostDraftBody, PostDraftMeta } from '../lib/offline/post-drafts';
import { outbox, useOutbox } from '../lib/offline/runtime';
import type { OutboxItem } from '../lib/offline/types';
import { dismissPosted, usePostDrafts, useRecentlyPosted } from '../lib/post-drafts';

/**
 * Posts written with no connection (spec 032), above the feed: each one says plainly where it
 * stands — a draft on this device, being published, not accepted, or posted — and never looks
 * like a post anyone else can see until the server has it.
 */
export function PostDrafts() {
  const drafts = usePostDrafts();
  const posted = useRecentlyPosted();
  if (!drafts.length && !posted.length) return null;
  return (
    <section aria-label="Your drafts" className="mt-5 space-y-2">
      {drafts.map((item) => (
        <DraftRow key={item.id} item={item} />
      ))}
      {posted.map((item) => (
        <div
          key={item.draftId}
          className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm"
        >
          <p className="flex-1 truncate">
            <span className="font-medium text-emerald-300">Posted</span>
            <span className="text-ink-muted"> · {summary(item.meta)}</span>
          </p>
          <Link href={`/posts/${item.postId}`} className="btn-ghost px-2 py-1 text-xs" onClick={() => dismissPosted(item.draftId)}>
            View
          </Link>
          <button
            type="button"
            aria-label="Dismiss"
            className="btn-ghost p-1"
            onClick={() => dismissPosted(item.draftId)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </section>
  );
}

function summary(meta: PostDraftMeta | undefined): string {
  if (!meta) return 'Post';
  const text = meta.title || meta.caption;
  if (text) return text;
  if (meta.photoCount) return meta.photoCount === 1 ? '1 photo' : `${meta.photoCount} photos`;
  return meta.hasFood ? 'A food' : 'Post';
}

function DraftRow({ item }: { item: OutboxItem<PostDraftMeta> }) {
  const snapshot = useOutbox();
  const publishing = usePublishing();
  const [confirm, setConfirm] = useState(false);
  const photo = (item.body as PostDraftBody | undefined)?.photos?.[0]?.blob;
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const live = publishing?.id === item.id;
  const waitingOn = (item.dependsOn ?? []).some((id) => snapshot.items.some((other) => other.id === id));
  const refused = item.state === 'error' || item.state === 'conflict';
  const status = live
    ? `Posting… ${Math.round(publishing.fraction * 100)}%`
    : refused
      ? `Not posted: ${item.lastError ?? 'the server refused it.'}`
      : item.state === 'auth'
        ? 'Sign in again to post it'
        : waitingOn
          ? 'Draft · posts after your meal is saved'
          : snapshot.offline || (typeof navigator !== 'undefined' && navigator.onLine === false)
            ? 'Draft · posts when you’re back online'
            : 'Draft · waiting to post';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-surface-raised px-3 py-2 text-sm">
      {thumb ? (
        // A local blob: next/image cannot optimise it, and it never leaves the device.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" />
      ) : null}
      <div className="flex-1">
        <p className="truncate">{summary(item.meta)}</p>
        <p className={refused ? 'text-xs text-rose-300' : 'text-xs text-amber-300'}>{status}</p>
      </div>
      {refused && (
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => void outbox.retry(item.id)}>
          Retry
        </button>
      )}
      {!live &&
        (confirm ? (
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs text-rose-300"
            onClick={() => void outbox.discard(item.id)}
          >
            Delete draft
          </button>
        ) : (
          <button type="button" className="btn-ghost px-2 py-1 text-xs text-rose-300" onClick={() => setConfirm(true)}>
            Discard
          </button>
        ))}
    </div>
  );
}
