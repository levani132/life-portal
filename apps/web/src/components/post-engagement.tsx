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
import { api, NetworkError } from '../lib/api';
import { revalidate, useApi } from '../lib/hooks';
import { PostRelativeTime } from './post-header-controls';
import { ErrorNote } from './ui';
import { requestNotificationOffer } from './notifications';
import { messagingAvailable } from './messages';
import { PostShareSheet } from './post-share-sheet';
import { usePostMetrics } from '../lib/feed-metrics';
import { useAuth } from '../lib/auth-context';
import { overlayComments, overlayEngagement, type ShownComment } from '../lib/offline/social-overlay';
import { socialWrites, useOffline, useSocialWrites } from '../lib/social-offline';

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
  const [busy, setBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const feedStale = useRef(false);
  const portal = useApi<PortalState>('/portal');
  const canSend = messagingAvailable(portal.data?.access);
  const recordMetric = usePostMetrics();
  // Spec 031: likes, reposts and comments are kept on the device and sent when there is a
  // connection; the figures shown include them, marked as not sent until the server has them.
  const writes = useSocialWrites();
  const offline = useOffline();
  // Spec 033: with no connection (a kept own post, say) the counts are just absent, not an error.
  const statsFailed = !!stats.error && !stats.data && !(stats.error instanceof NetworkError);
  const value = stats.data ? overlayEngagement(stats.data, post.id, writes) : undefined;
  async function toggle(op: 'like' | 'repost') {
    if (!value || busy) return;
    setBusy(true);
    setError('');
    const on = op === 'like' ? !value.liked : !value.reposted;
    try {
      await socialWrites.toggle(op, post.id, on, post.title);
      // No For You measurement offline (owner's rule, #20).
      if (on && !offline) recordMetric?.(op);
      // The feed is refreshed when the sheet closes: a repost card replaces this one (it is keyed
      // by the repost), which would unmount the open sheet under the finger.
      if (op === 'repost') feedStale.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not update your ${op}.`);
    } finally {
      setBusy(false);
    }
  }
  const like = () => toggle('like');
  const toggleRepost = () => toggle('repost');
  return (
    <div
      className={`mt-3 ${commentsOpen || error || statsFailed ? '' : '-mb-4 sm:-mb-5'}`}
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
            {value.unsent && <span className="ml-2 text-amber-300">Not sent yet</span>}
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
      {value?.unsent && !(value.likeCount || value.commentCount) && (
        <p className="mb-1 text-xs text-amber-300">Not sent yet</p>
      )}
      {(error || statsFailed) && (
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
  const locked = useRef(false);
  const recordMetric = usePostMetrics();
  const writes = useSocialWrites();
  const offline = useOffline();
  const { user } = useAuth();
  const me = { userId: user?.id ?? '', displayName: 'You', username: '' };
  const comments: ShownComment[] = overlayComments(
    [...new Map([...older, ...(result.data?.comments ?? [])].map((row) => [row.id, row])).values()],
    postId,
    writes,
    me,
  )
    .filter((row) => !deleted.includes(row.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const next = cursor === null ? result.data?.nextCursor : cursor || undefined;
  async function submit() {
    if (!text.trim() || locked.current) return;
    locked.current = true;
    setPending(true);
    setError('');
    try {
      // Spec 031: kept on the device with its own id and shown at once, marked as not sent.
      await socialWrites.comment(postId, text.trim());
      setText('');
      if (!offline) recordMetric?.('comment');
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
                {comment.unsent ? (
                  <span className="text-amber-300">Not sent yet</span>
                ) : (
                  <PostRelativeTime date={comment.createdAt} />
                )}
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
                    // A comment not sent yet is withdrawn; a saved one is deleted once online.
                    await socialWrites.removeComment(postId, comment.id);
                    setDeleted((ids) => [...ids, comment.id]);
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
      {result.error instanceof NetworkError && !error ? (
        // Not a failure the person can act on: their own comments still post when it's back.
        <p className="text-xs text-ink-muted">Other comments load when you’re back online.</p>
      ) : (
        (error || result.error) && <ErrorNote message={error || (result.error as Error).message} />
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
          onChange={(event) => setText(event.target.value)}
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
