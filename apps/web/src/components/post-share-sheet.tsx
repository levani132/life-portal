'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Download,
  Link2,
  Loader2,
  MessageCircle,
  Music2,
  Phone,
  Repeat2,
  Share,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import type { FoodPost, InboxEntry, SocialPerson } from '@life-portal/shared-types';
import { canShareImage, shareTargetUrl, type ShareTarget } from '@life-portal/shared-domain';
import { renderShareImage, shareImageFile } from '../lib/share-image';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useSocialApi } from '../lib/social-hooks';
import { Avatar, errorText, FRIENDS_KEY, openConversation } from './messages';
import { ErrorNote } from './ui';

interface Head {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  /** Known when there is already a conversation. */
  conversationId?: string;
}

/** Recent conversations first, then friends you have not talked to yet. */
export function shareHeads(inbox: InboxEntry[] = [], friends: SocialPerson[] = []): Head[] {
  const heads: Head[] = inbox.map((entry) => ({
    userId: entry.other.userId,
    displayName: entry.other.displayName,
    ...(entry.other.avatarUrl ? { avatarUrl: entry.other.avatarUrl } : {}),
    conversationId: entry.id,
  }));
  const seen = new Set(heads.map((head) => head.userId));
  for (const friend of friends) {
    if (!seen.has(friend.userId))
      heads.push({
        userId: friend.userId,
        displayName: friend.displayName,
        ...(friend.avatarUrl ? { avatarUrl: friend.avatarUrl } : {}),
      });
  }
  return heads;
}

/**
 * The one Share button's sheet: send the post to a chat, copy its link, or hand it to the
 * phone's own share menu. Every route keeps the post's audience: a link or a chat card opens only
 * for people the post is shared with.
 */
export function PostShareSheet({
  post,
  canMessage,
  repost,
  onSaveFoods,
  onClose,
}: {
  post: FoodPost;
  canMessage: boolean;
  /** Absent when this post cannot be reposted (your own, or private). */
  repost?: { reposted: boolean; count: number; disabled: boolean; onToggle: () => void };
  /** Opens the import dialog. Absent for your own posts and posts without food. */
  onSaveFoods?: () => void;
  onClose: () => void;
}) {
  const postId = post.id;
  const title = post.title || post.contentLabel || 'Life Portal post';
  const imageAllowed = canShareImage({ own: post.isOwner, audience: post.audience });
  // Drawn as soon as the sheet opens, so the share call runs inside the tap: iOS refuses a share
  // sheet that opens after slow work.
  const [image, setImage] = useState<File | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    if (!imageAllowed) return;
    let cancelled = false;
    void renderShareImage(post)
      .then((file) => !cancelled && setImage(file))
      .catch(() => !cancelled && setImageFailed(true));
    return () => {
      cancelled = true;
    };
    // The post is fixed while the sheet is open.
  }, [imageAllowed]);
  const touch =
    typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
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

  async function shareImage(app?: string) {
    if (!image) return;
    setError('');
    const result = await shareImageFile(image, title);
    if (result === 'saved')
      setNotice(
        app ? `Image saved. Open ${app} and add it to your Story or a post.` : 'Image saved.',
      );
    if (result === 'shared') onClose();
  }
  function openTarget(target: ShareTarget) {
    window.open(shareTargetUrl(target, url(), title), '_blank', 'noopener,noreferrer');
  }

  const sentTo = Object.entries(sent);
  const imageState = { disabled: !image, busy: !image && !imageFailed };
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
                          <Avatar name={head.displayName} url={head.avatarUrl} size={56} />
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
          {onSaveFoods && (
            <SheetAction
              label="Save foods"
              onClick={() => {
                onClose();
                onSaveFoods();
              }}
            >
              <UtensilsCrossed size={20} />
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

        <p className="px-4 pt-4 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Share to
        </p>
        <div className="flex gap-4 overflow-x-auto px-4 pt-2 [scrollbar-width:none]">
          {imageAllowed && !imageFailed && (
            <>
              <AppAction
                label="Instagram"
                className="bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600"
                {...imageState}
                onClick={() => void shareImage('Instagram')}
              >
                <Camera size={22} />
              </AppAction>
              <AppAction
                label="TikTok"
                className="bg-black ring-1 ring-white/20"
                {...imageState}
                onClick={() => void shareImage('TikTok')}
              >
                <Music2 size={21} />
              </AppAction>
            </>
          )}
          <AppAction label="WhatsApp" className="bg-[#25D366]" onClick={() => openTarget('whatsapp')}>
            <Phone size={20} />
          </AppAction>
          {touch && (
            <AppAction
              label="Messenger"
              className="bg-gradient-to-tr from-sky-500 via-violet-500 to-pink-500"
              onClick={() => openTarget('messenger')}
            >
              <MessageCircle size={21} />
            </AppAction>
          )}
          <AppAction label="Facebook" className="bg-[#1877F2]" onClick={() => openTarget('facebook')}>
            <span className="text-2xl font-bold leading-none">f</span>
          </AppAction>
          <AppAction label="X" className="bg-black ring-1 ring-white/20" onClick={() => openTarget('x')}>
            <span className="text-xl font-bold leading-none">𝕏</span>
          </AppAction>
          {imageAllowed && !imageFailed && (
            <AppAction
              label="Save image"
              className="bg-ink/10 !text-ink"
              {...imageState}
              onClick={() => void shareImage()}
            >
              <Download size={20} />
            </AppAction>
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
            Links open only for people this post is shared with.
            {imageAllowed
              ? ' An image can be shared anywhere.'
              : ' Images are for your own and public posts, so this one stays with its audience.'}
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

function AppAction({
  label,
  className,
  onClick,
  disabled,
  busy,
  children,
}: {
  label: string;
  className: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={busy ? `${label} (preparing image)` : label}
      className="flex w-16 shrink-0 flex-col items-center gap-1.5 disabled:opacity-60"
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white ${className}`}
      >
        {busy ? <Loader2 size={20} className="animate-spin" /> : children}
      </span>
      <span className="text-[11px]">{label}</span>
    </button>
  );
}
