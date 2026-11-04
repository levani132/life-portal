'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check, Link2, Loader2, Repeat2, Share, X } from 'lucide-react';
import type { InboxEntry, SocialPerson } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useSocialApi } from '../lib/social-hooks';
import { Avatar, errorText, FRIENDS_KEY, openConversation } from './messages';
import { ErrorNote } from './ui';

interface Head {
  userId: string;
  displayName: string;
  /** Known when there is already a conversation. */
  conversationId?: string;
}

/** Recent conversations first, then friends you have not talked to yet. */
export function shareHeads(inbox: InboxEntry[] = [], friends: SocialPerson[] = []): Head[] {
  const heads: Head[] = inbox.map((entry) => ({
    userId: entry.other.userId,
    displayName: entry.other.displayName,
    conversationId: entry.id,
  }));
  const seen = new Set(heads.map((head) => head.userId));
  for (const friend of friends) {
    if (!seen.has(friend.userId))
      heads.push({ userId: friend.userId, displayName: friend.displayName });
  }
  return heads;
}

/**
 * The one Share button's sheet: send the post to a chat, copy its link, or hand it to the
 * phone's own share menu. Every route keeps the post's audience: a link or a chat card opens only
 * for people the post is shared with.
 */
export function PostShareSheet({
  postId,
  title,
  canMessage,
  repost,
  onClose,
}: {
  postId: string;
  title: string;
  canMessage: boolean;
  /** Absent when this post cannot be reposted (your own, or private). */
  repost?: { reposted: boolean; count: number; disabled: boolean; onToggle: () => void };
  onClose: () => void;
}) {
  const inbox = useApi<InboxEntry[]>(canMessage ? '/messages/conversations' : null);
  const friends = useSocialApi<{ people: SocialPerson[] }>(canMessage ? FRIENDS_KEY : null);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showLink, setShowLink] = useState(false);
  const linkInput = useRef<HTMLInputElement>(null);
  const url = () => new URL(`/posts/${postId}`, window.location.origin).href;
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;
  const heads = canMessage ? shareHeads(inbox.data, friends.data?.people) : [];
  const loadingHeads = canMessage && (inbox.isLoading || friends.isLoading) && !heads.length;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function sendTo(head: Head) {
    if (sending || sent[head.userId]) return;
    setSending(head.userId);
    setError('');
    try {
      const conversationId = head.conversationId ?? (await openConversation(head.userId));
      await api.post(`/messages/conversations/${conversationId}/messages`, {
        requestId: crypto.randomUUID(),
        postId,
      });
      setSent((all) => ({ ...all, [head.userId]: conversationId }));
    } catch (caught) {
      setError(errorText(caught, 'Could not send the post.'));
    } finally {
      setSending(null);
    }
  }

  async function copyLink() {
    setError('');
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(url());
      setNotice('Link copied. The post’s audience still applies.');
    } catch {
      setShowLink(true);
      setNotice('Select the link to copy it.');
      requestAnimationFrame(() => linkInput.current?.select());
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title, url: url() });
      onClose();
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') void copyLink();
    }
  }

  const sentTo = Object.entries(sent);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" data-no-tab-swipe>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share post"
        className="relative w-full max-w-md rounded-t-3xl border border-b-0 border-border bg-surface-raised pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-2xl"
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink/20" aria-hidden />
        <div className="flex items-center justify-between px-4 pb-2">
          <h3 className="text-sm font-semibold">Share</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-ink/5"
          >
            <X size={17} />
          </button>
        </div>

        {canMessage && (
          <div className="border-b border-border pb-3">
            {loadingHeads ? (
              <p className="px-4 py-6 text-center text-xs text-ink-muted">Loading chats…</p>
            ) : !heads.length ? (
              <p className="px-4 py-4 text-center text-xs text-ink-muted">
                Add friends to send them posts.
              </p>
            ) : (
              <ul className="flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
                {heads.map((head) => {
                  const done = !!sent[head.userId];
                  return (
                    <li key={head.userId} className="w-16 shrink-0">
                      <button
                        type="button"
                        aria-label={done ? `Sent to ${head.displayName}` : `Send to ${head.displayName}`}
                        disabled={!!sending && sending !== head.userId}
                        onClick={() => void sendTo(head)}
                        className="flex w-full flex-col items-center gap-1.5 disabled:opacity-50"
                      >
                        <span className="relative">
                          <Avatar name={head.displayName} size={56} />
                          {(done || sending === head.userId) && (
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-raised bg-accent text-white">
                              {done ? (
                                <Check size={13} strokeWidth={3} />
                              ) : (
                                <Loader2 size={13} className="animate-spin" />
                              )}
                            </span>
                          )}
                        </span>
                        <span className="w-full truncate text-center text-[11px] leading-tight">
                          {done ? 'Sent' : head.displayName.split(' ')[0]}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-6 px-4 pt-3">
          {repost && (
            <SheetAction
              label={repost.reposted ? 'Reposted' : 'Repost'}
              pressed={repost.reposted}
              disabled={repost.disabled}
              onClick={repost.onToggle}
            >
              <Repeat2 size={21} />
            </SheetAction>
          )}
          <SheetAction label="Copy link" onClick={() => void copyLink()}>
            <Link2 size={21} />
          </SheetAction>
          {canNativeShare && (
            <SheetAction label="More…" onClick={() => void nativeShare()}>
              <Share size={20} />
            </SheetAction>
          )}
        </div>

        <div className="space-y-2 px-4 pt-3">
          {showLink && (
            <input
              ref={linkInput}
              className="field"
              aria-label="Post link"
              readOnly
              value={url()}
              onFocus={(event) => event.target.select()}
            />
          )}
          {error && <ErrorNote message={error} />}
          {notice && (
            <p role="status" className="text-xs text-ink-muted">
              {notice}
            </p>
          )}
          {repost?.reposted && (
            <p role="status" className="text-xs text-ink-muted">
              On your wall
              {repost.count > 1 ? ` · reposted by ${repost.count.toLocaleString()} people` : ''}.
            </p>
          )}
          {sentTo.length === 1 && (
            <Link href={`/messages/${sentTo[0][1]}`} className="block text-xs text-accent hover:underline">
              Open the conversation
            </Link>
          )}
          <p className="text-[11px] text-ink-faint">
            Only people this post is shared with can open it.
          </p>
        </div>
      </div>
    </div>
  );
}

function SheetAction({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      className="flex w-16 flex-col items-center gap-1.5 disabled:opacity-50"
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-full ${pressed ? 'bg-emerald-500/15 text-emerald-400' : 'bg-ink/5 text-ink'}`}
      >
        {children}
      </span>
      <span className="text-[11px]">{label}</span>
    </button>
  );
}
