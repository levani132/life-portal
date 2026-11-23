'use client';
import { Avatar } from './avatar';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Heart, MessageCircle, Send, Trash2 } from 'lucide-react';
import {
  COMMENTS_FIRST,
  COMMENTS_MORE,
  REPLIES_MORE,
  type PortalState,
  type FoodPost,
  type PostComment,
  type PostCommentsPage,
  type PostEngagement as Engagement,
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
  openShare = false,
  focusCommentId,
}: {
  post: FoodPost;
  /** Open the comments and bring this comment or reply into view. */
  focusCommentId?: string;
  /** Opens the card's import dialog; absent for your own posts and posts without food. */
  onSaveFoods?: () => void;
  /** Start with the share sheet open. */
  openShare?: boolean;
}) {
  const stats = useApi<Engagement>(`/posts/${post.id}/engagement`, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });
  const [busy, setBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(!!focusCommentId);
  // A second notification for a post already open points at another comment.
  useEffect(() => {
    if (focusCommentId) setCommentsOpen(true);
  }, [focusCommentId]);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(openShare);
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
            {value.unsent && <span className="ml-2 text-warning">Not sent yet</span>}
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
          className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm transition hover:bg-special-solid/10 active:scale-95 disabled:opacity-50 ${value?.liked ? 'text-danger' : 'text-ink-muted'}`}
        >
          <Heart size={18} className={value?.liked ? 'fill-current' : ''} />
          Like
        </button>
        <button
          type="button"
          aria-expanded={commentsOpen}
          aria-controls={`post-comments-${post.id}`}
          onClick={() => setCommentsOpen((open) => !open)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm text-ink-muted transition hover:bg-special-solid/10 active:scale-95"
        >
          <MessageCircle size={18} />
          Comment
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setShareOpen(true)}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm text-ink-muted transition hover:bg-special-solid/10 active:scale-95"
        >
          <Send size={18} className="-rotate-12" />
          Share
        </button>
      </div>
      {value?.unsent && !(value.likeCount || value.commentCount) && (
        <p className="mb-1 text-xs text-warning">Not sent yet</p>
      )}
      {(error || statsFailed) && (
        <ErrorNote message={error || (stats.error as Error).message} />
      )}
      {commentsOpen && (
        <PostComments
          postId={post.id}
          focusId={focusCommentId}
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

/** A comment or reply box: grows with its text, sends on Enter, keeps its own draft. */
function CommentBox({
  label,
  placeholder,
  autoFocus = false,
  onSend,
}: {
  label: string;
  placeholder: string;
  autoFocus?: boolean;
  /** Resolves true when the text was taken, so the box clears. */
  onSend: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const locked = useRef(false);
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = '40px';
    field.style.height = `${Math.min(118, Math.max(40, field.scrollHeight + 2))}px`;
  }, [text]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  async function submit() {
    if (!text.trim() || locked.current) return;
    locked.current = true;
    setPending(true);
    try {
      if (await onSend(text.trim())) setText('');
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label={label}
        placeholder={placeholder}
        ref={input}
        rows={1}
        style={{ minHeight: 40, maxHeight: 118, lineHeight: '20px' }}
        maxLength={1000}
        value={text}
        disabled={pending}
        className="field min-w-0 flex-1 resize-none overflow-y-auto text-sm leading-5"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <button type="submit" aria-label={`Post ${label.toLowerCase().includes('reply') ? 'reply' : 'comment'}`} title="Send" disabled={pending || !text.trim()} className="btn-primary h-10 px-3">
        <Send size={17} />
      </button>
    </form>
  );
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

/**
 * A post's comments as threads: the latest few comments, each with its latest reply, and "show
 * earlier" for both. Replies are one level deep; the box for a reply opens under the last reply
 * of the thread being answered.
 */
function PostComments({
  postId,
  onChanged,
  focusId,
}: {
  postId: string;
  onChanged: () => void;
  /** A comment or reply to load, scroll to and point out: where a notification's link leads. */
  focusId?: string;
}) {
  const result = useApi<PostCommentsPage>(`/posts/${postId}/comments?limit=${COMMENTS_FIRST}`, {
    refreshInterval: 15000,
    revalidateOnFocus: true,
  });
  /** Earlier comments, loaded on request. */
  const [older, setOlder] = useState<PostComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  /** Earlier replies, loaded on request, by the comment they answer. */
  const [olderReplies, setOlderReplies] = useState<Record<string, PostComment[]>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string[]>([]);
  /** The comment being answered. A reply to a reply goes under the same top-level comment. */
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const recordMetric = usePostMetrics();
  const writes = useSocialWrites();
  const offline = useOffline();
  const { user } = useAuth();
  const me = { userId: user?.id ?? '', displayName: 'You', username: '' };

  // The first page is only the newest few. What it showed before stays on screen when newer
  // comments or replies push it out of that page, so nothing disappears while reading.
  const latest = result.data?.comments;
  useEffect(() => {
    if (!latest?.length) return;
    setOlder((rows) => {
      const known = new Set(rows.map((item) => item.id));
      const added = latest.filter((item) => !known.has(item.id));
      return added.length ? [...rows, ...added] : rows;
    });
    setOlderReplies((all) => {
      let changed = false;
      const merged = { ...all };
      for (const top of latest) {
        const known = new Set((merged[top.id] ?? []).map((item) => item.id));
        const added = (top.replies ?? []).filter((item) => !known.has(item.id));
        if (added.length) {
          merged[top.id] = [...(merged[top.id] ?? []), ...added];
          changed = true;
        }
      }
      return changed ? merged : all;
    });
  }, [latest]);

  // A link to one comment: fetch its thread (it may be on an earlier page), then bring it into
  // view and bounce it once so it is clear which comment the notification was about.
  const [focused, setFocused] = useState<string | null>(null);
  const focusDone = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || focusDone.current === focusId) return;
    focusDone.current = focusId;
    let cancelled = false;
    void api
      .get<PostComment>(`/posts/${postId}/comments/${focusId}`)
      .then((thread) => {
        if (cancelled) return;
        setOlder((rows) => (rows.some((item) => item.id === thread.id) ? rows : [...rows, { ...thread, replies: [] }]));
        setOlderReplies((all) => {
          const known = new Set((all[thread.id] ?? []).map((item) => item.id));
          const added = (thread.replies ?? []).filter((item) => !known.has(item.id));
          return added.length ? { ...all, [thread.id]: [...(all[thread.id] ?? []), ...added] } : all;
        });
        setFocused(focusId);
      })
      .catch(() => {
        if (!cancelled) setError('That comment is no longer there.');
      });
    return () => {
      cancelled = true;
    };
  }, [focusId, postId]);
  useEffect(() => {
    if (!focused) return;
    const node = document.getElementById(`comment-${focused}`);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const timer = window.setTimeout(() => setFocused(null), 2400);
    return () => window.clearTimeout(timer);
  }, [focused]);

  // Everything known, flat: comments and replies from the server, plus this device's waiting ones.
  // The first page's copy of a comment wins: its reply count is the fresher one.
  const tops = [...new Map([...older, ...(result.data?.comments ?? [])].map((row) => [row.id, row])).values()];
  const serverReplies = (top: PostComment) => [...new Map([...(olderReplies[top.id] ?? []), ...(top.replies ?? [])].map((row) => [row.id, row])).values()];
  const flat = tops.flatMap((top) => [top, ...serverReplies(top)]);
  const shown: ShownComment[] = overlayComments(flat, postId, writes, me).filter((row) => !deleted.includes(row.id));
  const ids = new Set(shown.map((row) => row.id));
  const threads = shown
    .filter((row) => !row.parentId || !ids.has(row.parentId))
    .sort(byId)
    .map((top) => ({ top, replies: shown.filter((row) => row.parentId === top.id).sort(byId) }));
  const next = cursor === null ? result.data?.nextCursor : cursor || undefined;

  async function send(text: string, parentId?: string): Promise<boolean> {
    setError('');
    try {
      // Spec 031: kept on the device with its own id and shown at once, marked as not sent.
      await socialWrites.comment(postId, text, parentId);
      if (!offline) recordMetric?.('comment');
      onChanged();
      requestNotificationOffer('comment');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post your comment.');
      return false;
    }
  }

  async function load(key: string, work: () => Promise<void>, failure: string) {
    setLoading(key);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
    } finally {
      setLoading(null);
    }
  }

  const row = (comment: ShownComment, topId: string) => (
    <div id={`comment-${comment.id}`} className={`flex items-start gap-2 ${focused === comment.id ? 'comment-focus' : ''}`}>
      <Avatar name={comment.author.displayName} url={comment.author.avatarUrl} size={28} className="mt-1" />
      <div className="min-w-0 flex-1 rounded-xl bg-special-solid/5 px-3 py-2">
        {comment.author.userId ? (
          <Link href={`/people/${comment.author.userId}`} className="text-xs font-semibold hover:underline">
            {comment.author.displayName}
          </Link>
        ) : (
          <span className="text-xs font-semibold">{comment.author.displayName}</span>
        )}
        <p className="whitespace-pre-wrap break-words text-sm">{comment.text}</p>
        <span className="mt-1 flex items-center gap-3 text-[10px] text-ink-faint">
          {comment.unsent ? <span className="text-warning">Not sent yet</span> : <PostRelativeTime date={comment.createdAt} />}
          {!comment.unsent && (
            <button type="button" className="font-semibold text-ink-muted hover:text-ink" onClick={() => setReplyTo({ id: topId, name: comment.author.displayName })}>
              Reply
            </button>
          )}
        </span>
      </div>
      {comment.canDelete && (
        <button
          type="button"
          aria-label="Delete comment"
          disabled={deleting === comment.id}
          className="rounded p-2 text-ink-faint hover:bg-danger-solid/10 hover:text-danger"
          onClick={async () => {
            setDeleting(comment.id);
            setError('');
            try {
              // A comment not sent yet is withdrawn; a saved one is deleted once online.
              await socialWrites.removeComment(postId, comment.id);
              setDeleted((gone) => [...gone, comment.id]);
              onChanged();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not delete comment.');
            } finally {
              setDeleting(null);
            }
          }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );

  return (
    <section id={`post-comments-${postId}`} aria-label="Comments" className="mt-3 space-y-3">
      {next && (
        <button
          type="button"
          disabled={loading === 'comments'}
          className="text-xs text-accent hover:underline"
          onClick={() =>
            void load(
              'comments',
              async () => {
                const page = await api.get<PostCommentsPage>(`/posts/${postId}/comments?before=${encodeURIComponent(next)}&limit=${COMMENTS_MORE}`);
                setOlder((rows) => [...rows, ...page.comments]);
                setCursor(page.nextCursor ?? '');
              },
              'Could not load earlier comments.',
            )
          }
        >
          {loading === 'comments' ? 'Loading…' : 'Show earlier comments'}
        </button>
      )}
      {result.isLoading ? (
        <p className="text-xs text-ink-muted">Loading comments…</p>
      ) : (
        !threads.length && !result.error && <p className="text-xs text-ink-muted">Start the conversation.</p>
      )}
      <ul className="space-y-3">
        {threads.map(({ top, replies }) => {
          // Replies the server has that are not on screen yet.
          const known = serverReplies(top).length;
          const hidden = Math.max(0, (top.replyCount ?? 0) - known);
          const oldest = serverReplies(top).sort(byId)[0]?.id;
          return (
            <li key={top.id} className="space-y-2">
              {row(top, top.id)}
              {(hidden > 0 || replies.length > 0 || replyTo?.id === top.id) && (
                <div className="ml-9 space-y-2">
                  {hidden > 0 && (
                    <button
                      type="button"
                      disabled={loading === top.id}
                      className="text-xs text-accent hover:underline"
                      onClick={() =>
                        void load(
                          top.id,
                          async () => {
                            const page = await api.get<PostCommentsPage>(
                              `/posts/${postId}/comments/${top.id}/replies?limit=${REPLIES_MORE}${oldest ? `&before=${oldest}` : ''}`,
                            );
                            setOlderReplies((all) => ({ ...all, [top.id]: [...(all[top.id] ?? []), ...page.comments] }));
                          },
                          'Could not load earlier replies.',
                        )
                      }
                    >
                      {loading === top.id ? 'Loading…' : `Show ${Math.min(hidden, REPLIES_MORE)} earlier ${Math.min(hidden, REPLIES_MORE) === 1 ? 'reply' : 'replies'}`}
                    </button>
                  )}
                  {replies.map((reply) => (
                    <div key={reply.id}>{row(reply, top.id)}</div>
                  ))}
                  {replyTo?.id === top.id && (
                    <div className="space-y-1">
                      <p className="flex items-center gap-2 text-xs text-ink-muted">
                        Replying to <span className="font-semibold text-ink">{replyTo.name}</span>
                        <button type="button" className="underline" onClick={() => setReplyTo(null)}>
                          Cancel
                        </button>
                      </p>
                      <CommentBox
                        label="Write a reply"
                        placeholder="Write a reply…"
                        autoFocus
                        onSend={async (text) => {
                          const sent = await send(text, top.id);
                          if (sent) setReplyTo(null);
                          return sent;
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {result.error instanceof NetworkError && !error ? (
        // Not a failure the person can act on: their own comments still post when it's back.
        <p className="text-xs text-ink-muted">Other comments load when you’re back online.</p>
      ) : (
        (error || result.error) && <ErrorNote message={error || (result.error as Error).message} />
      )}
      <CommentBox label="Write a comment" placeholder="Write a comment…" onSend={(text) => send(text, undefined)} />
    </section>
  );
}
