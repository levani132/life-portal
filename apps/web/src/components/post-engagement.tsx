'use client';
import { Avatar } from './avatar';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Heart, MessageCircle, Send, Trash2 } from 'lucide-react';
import type {
  PortalState,
  FoodPost,
  PostComment,
  PostCommentsPage,
  PostEngagement as Engagement,
} from '@life-portal/shared-types';
import { canRepost } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { PostRelativeTime } from './post-header-controls';
import { ErrorNote } from './ui';
import { requestNotificationOffer } from './notifications';
import { messagingAvailable } from './messages';
import { PostShareSheet } from './post-share-sheet';
import { usePostMetrics } from '../lib/feed-metrics';

export function PostEngagement({
  post,
  onSaveFoods,
}: {
  post: FoodPost;
  /** Opens the card's import dialog; absent for your own posts and posts without food. */
  onSaveFoods?: () => void;
}) {
  const stats = useApi<Engagement>(`/posts/${post.id}/engagement`, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });
  const [optimistic, setOptimistic] = useState<Engagement | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const feedStale = useRef(false);
  const portal = useApi<PortalState>('/portal');
  const canSend = messagingAvailable(portal.data?.access);
  const recordMetric = usePostMetrics();
  const value = optimistic ?? stats.data;
  async function like() {
    if (!value || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const liked = !value.liked;
    setOptimistic({
      ...value,
      liked,
      likeCount: Math.max(0, value.likeCount + (liked ? 1 : -1)),
    });
    try {
      const result = liked
        ? await api.put<Engagement>(`/posts/${post.id}/like`, {})
        : await api.delete<Engagement>(`/posts/${post.id}/like`);
      if (liked) recordMetric?.('like');
      await stats.mutate(result, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your like.');
    } finally {
      setOptimistic(null);
      locked.current = false;
      setBusy(false);
    }
  }
  async function toggleRepost() {
    if (!value || locked.current) return;
    locked.current = true;
    setError('');
    const reposted = !value.reposted;
    setOptimistic({
      ...value,
      reposted,
      repostCount: Math.max(0, value.repostCount + (reposted ? 1 : -1)),
    });
    try {
      const result = reposted
        ? await api.put<Engagement>(`/posts/${post.id}/repost`, {})
        : await api.delete<Engagement>(`/posts/${post.id}/repost`);
      if (reposted) recordMetric?.('repost');
      await stats.mutate(result, false);
      // The feed is refreshed when the sheet closes: a repost card replaces this one (it is keyed
      // by the repost), which would unmount the open sheet under the finger.
      feedStale.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your repost.');
    } finally {
      setOptimistic(null);
      locked.current = false;
    }
  }
  return (
    <div
      className={`mt-3 ${commentsOpen || error || stats.error ? '' : '-mb-4 sm:-mb-5'}`}
    >
      {value?.likeCount || value?.commentCount ? (
        <div
          className="mb-2 flex items-center justify-between text-xs text-ink-muted"
          aria-live="polite"
        >
          <span>
            {value.likeCount
              ? `${value.likeCount.toLocaleString()} ${value.likeCount === 1 ? 'like' : 'likes'}`
              : ''}
          </span>
          {value.commentCount > 0 && (
            <button
              type="button"
              className="hover:underline"
              onClick={() => setCommentsOpen((open) => !open)}
            >
              {value.commentCount.toLocaleString()}{' '}
              {value.commentCount === 1 ? 'comment' : 'comments'}
            </button>
          )}
        </div>
      ) : null}
      <div
        className={`grid grid-cols-3 border-t border-border py-1 ${commentsOpen ? 'border-b' : ''}`}
      >
        <button
          type="button"
          aria-pressed={value?.liked ?? false}
          disabled={busy || !value}
          onClick={() => void like()}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm transition hover:bg-violet-500/10 active:scale-95 disabled:opacity-50 ${value?.liked ? 'text-rose-400' : 'text-ink-muted'}`}
        >
          <Heart size={18} className={value?.liked ? 'fill-current' : ''} />
          Like
        </button>
        <button
          type="button"
          aria-expanded={commentsOpen}
          aria-controls={`post-comments-${post.id}`}
          onClick={() => setCommentsOpen((open) => !open)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm text-ink-muted transition hover:bg-violet-500/10 active:scale-95"
        >
          <MessageCircle size={18} />
          Comment
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setShareOpen(true)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm text-ink-muted transition hover:bg-violet-500/10 active:scale-95"
        >
          <Send size={18} className="-rotate-12" />
          Share
        </button>
      </div>
      {(error || stats.error) && (
        <ErrorNote message={error || (stats.error as Error).message} />
      )}
      {commentsOpen && (
        <PostComments
          postId={post.id}
          onChanged={() => {
            void stats.mutate().catch(() => undefined);
          }}
        />
      )}
      {shareOpen && (
        <PostShareSheet
          post={post}
          canMessage={canSend}
          onSaveFoods={onSaveFoods}
          repost={
            canRepost({ own: post.isOwner, audience: post.audience })
              ? {
                  reposted: value?.reposted ?? false,
                  count: value?.repostCount ?? 0,
                  disabled: !value,
                  onToggle: () => void toggleRepost(),
                }
              : undefined
          }
          onClose={() => {
            setShareOpen(false);
            if (feedStale.current) {
              feedStale.current = false;
              void revalidate('/posts?');
            }
          }}
        />
      )}
    </div>
  );
}

function PostComments({
  postId,
  onChanged,
}: {
  postId: string;
  onChanged: () => void;
}) {
  const result = useApi<PostCommentsPage>(`/posts/${postId}/comments`, {
    refreshInterval: 15000,
    revalidateOnFocus: true,
  });
  const [older, setOlder] = useState<PostComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = '40px';
    field.style.height = `${Math.min(118, Math.max(40, field.scrollHeight + 2))}px`;
  }, [text]);
  const requestId = useRef<string | null>(null);
  const locked = useRef(false);
  const recordMetric = usePostMetrics();
  const comments = [
    ...new Map(
      [...older, ...(result.data?.comments ?? [])].map((row) => [row.id, row]),
    ).values(),
  ]
    .filter((row) => !deleted.includes(row.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const next = cursor === null ? result.data?.nextCursor : cursor || undefined;
  async function submit() {
    if (!text.trim() || locked.current) return;
    locked.current = true;
    setPending(true);
    setError('');
    requestId.current ??= crypto.randomUUID();
    try {
      const created = await api.post<PostComment>(`/posts/${postId}/comments`, {
        text: text.trim(),
        requestId: requestId.current,
      });
      setOlder((rows) => [
        ...rows.filter((row) => row.id !== created.id),
        created,
      ]);
      setText('');
      requestId.current = null;
      recordMetric?.('comment');
      await result.mutate().catch(() => undefined);
      onChanged();
      requestNotificationOffer('comment');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post your comment.');
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  return (
    <section
      id={`post-comments-${postId}`}
      aria-label="Comments"
      className="mt-3 space-y-3"
    >
      {next && (
        <button
          type="button"
          disabled={loadingOlder}
          className="text-xs text-accent hover:underline"
          onClick={async () => {
            setLoadingOlder(true);
            setError('');
            try {
              const page = await api.get<PostCommentsPage>(
                `/posts/${postId}/comments?before=${encodeURIComponent(next)}`,
              );
              setOlder((rows) => [...rows, ...page.comments]);
              setCursor(page.nextCursor ?? '');
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : 'Could not load earlier comments.',
              );
            } finally {
              setLoadingOlder(false);
            }
          }}
        >
          {loadingOlder ? 'Loading…' : 'Load earlier comments'}
        </button>
      )}
      {result.isLoading ? (
        <p className="text-xs text-ink-muted">Loading comments…</p>
      ) : (
        !comments.length &&
        !result.error && (
          <p className="text-xs text-ink-muted">Start the conversation.</p>
        )
      )}
      <ul className="space-y-3">
        {comments.map((comment) => (
          <li key={comment.id} className="flex items-start gap-2">
            <Avatar
              name={comment.author.displayName}
              url={comment.author.avatarUrl}
              size={28}
              className="mt-1"
            />
            <div className="min-w-0 flex-1 rounded-xl bg-violet-500/5 px-3 py-2">
              {comment.author.userId ? (
                <Link
                  href={`/people/${comment.author.userId}`}
                  className="text-xs font-semibold hover:underline"
                >
                  {comment.author.displayName}
                </Link>
              ) : (
                <span className="text-xs font-semibold">
                  {comment.author.displayName}
                </span>
              )}
              <p className="whitespace-pre-wrap break-words text-sm">
                {comment.text}
              </p>
              <span className="mt-1 block text-[10px] text-ink-faint">
                <PostRelativeTime date={comment.createdAt} />
              </span>
            </div>
            {comment.canDelete && (
              <button
                type="button"
                aria-label="Delete comment"
                disabled={deleting === comment.id}
                className="rounded p-2 text-ink-faint hover:bg-rose-500/10 hover:text-rose-400"
                onClick={async () => {
                  setDeleting(comment.id);
                  setError('');
                  try {
                    await api.delete(`/posts/${postId}/comments/${comment.id}`);
                    setDeleted((ids) => [...ids, comment.id]);
                    await result.mutate().catch(() => undefined);
                    onChanged();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : 'Could not delete comment.',
                    );
                  } finally {
                    setDeleting(null);
                  }
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {(error || result.error) && (
        <ErrorNote message={error || (result.error as Error).message} />
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="Write a comment"
          placeholder="Write a comment…"
          ref={input}
          rows={1}
          style={{ minHeight: 40, maxHeight: 118, lineHeight: '20px' }}
          maxLength={1000}
          value={text}
          disabled={pending}
          className="field min-w-0 flex-1 resize-none overflow-y-auto text-sm leading-5"
          onChange={(event) => {
            setText(event.target.value);
            requestId.current = null;
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button
          type="submit"
          aria-label="Post comment"
          title="Post comment"
          disabled={pending || !text.trim()}
          className="btn-primary h-10 px-3"
        >
          <Send size={17} />
        </button>
      </form>
    </section>
  );
}
