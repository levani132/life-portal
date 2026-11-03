'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, BellOff, MessageCircle, MoreHorizontal, Send } from 'lucide-react';
import {
  MAX_MESSAGE_LENGTH,
  type ChatMessage,
  type ConversationView,
  type InboxEntry,
  type MessagesPage,
  type PortalState,
  type SharedPostCard,
  type SocialPerson,
  type SyncResult,
} from '@life-portal/shared-types';
import { seenLabel, timeSeparators } from '@life-portal/shared-domain';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/hooks';
import { postTimeLabel } from '../lib/post-time';
import { useSocialApi } from '../lib/social-hooks';
import { EmptyState, ErrorNote, Modal, Spinner } from './ui';

/** While a conversation is on screen and the app is visible (research R1). */
const SYNC_MS = 3000;
const INBOX_MS = 15000;
const UNREAD_KEY = '/messages/unread';

export function messagingAvailable(access: PortalState['access'] | undefined): boolean {
  return !!access?.messages && !!access.social;
}

/** Opens (or finds) the one conversation with a friend and returns its id. */
export async function openConversation(userId: string): Promise<string> {
  return (await api.post<{ id: string }>('/messages/conversations', { userId })).id;
}

function errorText(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

/** Header icon with the number of conversations that have unread messages. */
export function MessagesIcon({ access }: { access: PortalState['access'] }) {
  const unread = useApi<{ count: number }>(messagingAvailable(access) ? UNREAD_KEY : null, {
    revalidateOnFocus: true,
    refreshInterval: INBOX_MS,
  });
  if (!messagingAvailable(access)) return null;
  const count = unread.data?.count ?? 0;
  return (
    <Link
      href="/messages"
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:text-ink"
      aria-label={count ? `Messages, ${count} unread` : 'Messages'}
    >
      <MessageCircle size={20} aria-hidden />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-sky-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-sky-500/15 font-semibold text-sky-300"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

// ------------------------------------------------------------------ Inbox

export function Inbox() {
  const inbox = useApi<InboxEntry[]>('/messages/conversations', {
    revalidateOnFocus: true,
    refreshInterval: INBOX_MS,
  });
  if (inbox.isLoading) return <Spinner />;
  if (inbox.error) return <ErrorNote message="Your messages could not be loaded." />;
  if (!inbox.data?.length)
    return (
      <EmptyState
        message="No messages yet. Open a friend’s profile and tap Message."
        action={
          <Link href="/friends" className="btn">
            Your friends
          </Link>
        }
      />
    );
  return (
    <ul className="card divide-y divide-border">
      {inbox.data.map((entry) => (
        <li key={entry.id}>
          <Link
            href={`/messages/${entry.id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-surface-raised"
          >
            <Avatar name={entry.other.displayName} />
            <span className="min-w-0 flex-1">
              <span className={clsx('block truncate', entry.unread ? 'font-semibold' : 'font-medium')}>
                {entry.other.displayName}
              </span>
              <span
                className={clsx(
                  'block truncate text-sm',
                  entry.unread ? 'text-ink' : 'text-ink-muted',
                )}
              >
                {entry.preview} · {postTimeLabel(entry.lastMessageAt)}
              </span>
            </span>
            {entry.unread > 0 && (
              <span
                className="min-w-[22px] rounded-full bg-sky-500 px-1.5 text-center text-xs font-semibold leading-[22px] text-white"
                aria-label={`${entry.unread} unread`}
              >
                {entry.unread >= 99 ? '99+' : entry.unread}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Conversation

/** A message being sent from this device, before the server has it. */
interface Pending {
  requestId: string;
  body: { text: string } | { postId: string };
  status: 'sending' | 'failed';
  error?: string;
  createdAt: string;
}

function separatorLabel(at: string): string {
  const date = new Date(at);
  const today = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return time;
  const sameYear = date.getFullYear() === today.getFullYear();
  return `${date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })}, ${time}`;
}

function nearBottom(): boolean {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 120;
}
function toBottom() {
  window.scrollTo({ top: document.documentElement.scrollHeight });
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function Conversation({ id }: { id: string }) {
  const view = useApi<ConversationView>(`/messages/conversations/${id}`);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [pending, setPending] = useState<Pending[]>([]);
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | undefined>();
  const [canSend, setCanSend] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsendId, setUnsendId] = useState<string | null>(null);
  const since = useRef<string | undefined>(undefined);
  const latest = useRef<string | undefined>(undefined);
  const stickToBottom = useRef(true);
  const unread = useApi<{ count: number }>(UNREAD_KEY);
  // Held in a ref so the polling callback (and its timer) is not rebuilt on every render.
  const synced = useRef(false);
  const refreshUnread = useRef(unread.mutate);
  refreshUnread.current = unread.mutate;

  useEffect(() => {
    if (view.data) {
      setOtherLastReadAt(view.data.otherLastReadAt);
      setCanSend(view.data.canSend);
    }
  }, [view.data]);

  // First page, newest 30.
  useEffect(() => {
    let cancelled = false;
    api
      .get<MessagesPage>(`/messages/conversations/${id}/messages`)
      .then((page) => {
        if (cancelled) return;
        setMessages(page.messages);
        setNextBefore(page.nextBefore);
      })
      .catch((caught) => !cancelled && setError(errorText(caught, 'Messages could not be loaded.')));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    latest.current = messages?.[messages.length - 1]?.id ?? latest.current;
  }, [messages]);

  const sync = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const result = await api.post<SyncResult>(`/messages/conversations/${id}/sync`, {
        ...(latest.current ? { after: latest.current } : {}),
        ...(since.current ? { since: since.current } : {}),
      });
      since.current = result.serverTime;
      stickToBottom.current = nearBottom();
      setOtherLastReadAt(result.otherLastReadAt);
      setCanSend(result.canSend);
      if (result.messages.length || result.unsentIds.length)
        setMessages((current) => {
          const merged = mergeMessages(current ?? [], result.messages);
          const unsent = new Set(result.unsentIds);
          return merged.map((m) =>
            unsent.has(m.id) ? { id: m.id, mine: m.mine, kind: 'unsent', createdAt: m.createdAt } : m,
          );
        });
      if (result.messages.some((m) => m.requestId))
        setPending((list) =>
          list.filter((p) => !result.messages.some((m) => m.requestId === p.requestId)),
        );
      // The header count changes only on the first sync (it marks the chat read) or when
      // something arrives, so it isn't refetched on every tick.
      if (!synced.current || result.messages.length) void refreshUnread.current();
      synced.current = true;
    } catch {
      // Polling failures are silent; the next tick tries again.
    }
  }, [id]);

  // Poll only while visible; catch up at once on return (iOS freezes background timers).
  useEffect(() => {
    if (!messages) return;
    void sync();
    const timer = window.setInterval(() => void sync(), SYNC_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // Starts once, when the first page is in.
  }, [messages === null, sync]);

  useLayoutEffect(() => {
    if (stickToBottom.current) toBottom();
  }, [messages, pending]);

  const send = useCallback(
    async (item: Pending) => {
      stickToBottom.current = true;
      setPending((list) => [
        ...list.filter((p) => p.requestId !== item.requestId),
        { ...item, status: 'sending', error: undefined },
      ]);
      try {
        const stored = await api.post<ChatMessage>(`/messages/conversations/${id}/messages`, {
          requestId: item.requestId,
          ...item.body,
        });
        setMessages((current) => mergeMessages(current ?? [], [stored]));
        setPending((list) => list.filter((p) => p.requestId !== item.requestId));
      } catch (caught) {
        setPending((list) =>
          list.map((p) =>
            p.requestId === item.requestId
              ? { ...p, status: 'failed', error: errorText(caught, 'Not sent. Tap to retry.') }
              : p,
          ),
        );
      }
    },
    [id],
  );

  async function loadOlder() {
    if (!nextBefore) return;
    const before = document.documentElement.scrollHeight;
    try {
      const page = await api.get<MessagesPage>(
        `/messages/conversations/${id}/messages?before=${nextBefore}`,
      );
      stickToBottom.current = false;
      setMessages((current) => mergeMessages(current ?? [], page.messages));
      setNextBefore(page.nextBefore);
      // Keep the message the member was reading where it was.
      requestAnimationFrame(() =>
        window.scrollBy({ top: document.documentElement.scrollHeight - before }),
      );
    } catch (caught) {
      setError(errorText(caught, 'Older messages could not be loaded.'));
    }
  }

  async function toggleMute() {
    if (!view.data) return;
    try {
      await api.put(`/messages/conversations/${id}/mute`, { muted: !view.data.muted });
      await view.mutate();
    } catch (caught) {
      setError(errorText(caught, 'Could not change notifications.'));
    }
  }

  if (view.error)
    return <ErrorNote message={errorText(view.error, 'This conversation isn’t available.')} />;
  if (!view.data || !messages) return error ? <ErrorNote message={error} /> : <Spinner />;

  const other = view.data.other;
  const stored = new Set(messages.map((m) => m.requestId).filter(Boolean));
  const shownPending = pending.filter((p) => !stored.has(p.requestId));
  const separators = new Set(timeSeparators(messages.map((m) => m.createdAt)));
  const lastMine = [...messages].reverse().find((m) => m.mine);
  const lastIsMine = messages[messages.length - 1]?.mine && !shownPending.length;
  const seen = lastIsMine ? seenLabel(lastMine?.createdAt, otherLastReadAt) : null;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-2xl flex-col">
      <div className="sticky top-[calc(env(safe-area-inset-top)+4.25rem)] z-30 -mx-4 mb-2 flex items-center gap-3 border-b border-border bg-surface/95 px-4 py-2 backdrop-blur">
        <Link href="/messages" className="btn-ghost -ml-2 px-2" aria-label="Back to messages">
          <ArrowLeft size={20} />
        </Link>
        <Avatar name={other.displayName} size={36} />
        <Link
          href={other.userId ? `/people/${other.userId}` : '/messages'}
          className="min-w-0 flex-1 truncate font-semibold"
        >
          {other.displayName}
        </Link>
        <button
          type="button"
          className="btn-ghost px-2"
          onClick={() => void toggleMute()}
          aria-label={view.data.muted ? 'Unmute notifications' : 'Mute notifications'}
          aria-pressed={view.data.muted}
        >
          {view.data.muted ? <BellOff size={18} /> : <Bell size={18} />}
        </button>
      </div>

      <div className="flex-1 space-y-1 pb-3">
        {nextBefore && (
          <div className="flex justify-center py-2">
            <button type="button" className="btn-ghost text-sm" onClick={() => void loadOlder()}>
              Load earlier messages
            </button>
          </div>
        )}
        {!messages.length && !shownPending.length && (
          <p className="py-10 text-center text-sm text-ink-faint">
            Say hi to {other.displayName}. Messages are only between the two of you.
          </p>
        )}
        {messages.map((message, index) => (
          <div key={message.id}>
            {separators.has(index) && (
              <p className="py-3 text-center text-xs text-ink-faint">
                {separatorLabel(message.createdAt)}
              </p>
            )}
            <Bubble
              message={message}
              onUnsend={message.mine && message.kind !== 'unsent' ? () => setUnsendId(message.id) : undefined}
            />
          </div>
        ))}
        {shownPending.map((item) => (
          <div key={item.requestId} className="flex justify-end">
            <button
              type="button"
              disabled={item.status === 'sending'}
              onClick={() => void send(item)}
              className={clsx(
                'max-w-[78%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-3.5 py-2 text-left text-[15px]',
                item.status === 'failed'
                  ? 'border border-rose-500/50 bg-rose-500/10 text-rose-200'
                  : 'bg-sky-500/60 text-white',
              )}
            >
              {'text' in item.body ? item.body.text : 'Sharing a post…'}
              <span className="mt-0.5 block text-[11px] opacity-80">
                {item.status === 'failed' ? item.error : 'Sending…'}
              </span>
            </button>
          </div>
        ))}
        {seen && <p className="pr-1 text-right text-[11px] text-ink-faint">{seen}</p>}
      </div>

      {error && <ErrorNote message={error} />}
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-surface/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {canSend ? (
          <Composer
            onSend={(text) =>
              void send({
                requestId: crypto.randomUUID(),
                body: { text },
                status: 'sending',
                createdAt: new Date().toISOString(),
              })
            }
          />
        ) : (
          <p className="py-2 text-center text-sm text-ink-muted">
            You can’t reply to this conversation.
          </p>
        )}
      </div>

      <Modal
        open={!!unsendId}
        title="Unsend message?"
        onClose={() => setUnsendId(null)}
        submitLabel="Unsend"
        onSubmit={() => {
          const target = unsendId;
          setUnsendId(null);
          if (!target) return;
          api
            .delete(`/messages/conversations/${id}/messages/${target}`)
            .then(() =>
              setMessages((current) =>
                (current ?? []).map((m) =>
                  m.id === target ? { id: m.id, mine: true, kind: 'unsent', createdAt: m.createdAt } : m,
                ),
              ),
            )
            .catch((caught) => setError(errorText(caught, 'Could not unsend.')));
        }}
      >
        <p className="text-sm text-ink-muted">
          It will be removed for both of you. This can’t be undone.
        </p>
      </Modal>
    </div>
  );
}

function PostCard({ post, mine }: { post: SharedPostCard; mine: boolean }) {
  if ('unavailable' in post)
    return (
      <span className="block rounded-2xl border border-border px-3.5 py-2.5 text-sm italic text-ink-faint">
        Post unavailable
      </span>
    );
  return (
    <Link
      href={`/posts/${post.id}`}
      className={clsx(
        'block w-64 max-w-full rounded-2xl border px-3.5 py-3',
        mine ? 'border-sky-500/40 bg-sky-500/10' : 'border-border bg-surface-raised',
      )}
    >
      <span className="block text-xs text-ink-faint">{post.authorName} · Food post</span>
      <span className="mt-1 block font-medium">{post.title}</span>
      {post.totalKcal !== undefined && (
        <span className="mt-1 block text-sm text-ink-muted">
          {post.totalKcal.toLocaleString()} kcal
        </span>
      )}
    </Link>
  );
}

function Bubble({ message, onUnsend }: { message: ChatMessage; onUnsend?: () => void }) {
  const [menu, setMenu] = useState(false);
  const mine = message.mine;
  return (
    <div className={clsx('group flex items-center gap-1', mine ? 'justify-end' : 'justify-start')}>
      {onUnsend && (
        <span className="relative">
          <button
            type="button"
            className="rounded-full p-1 text-ink-faint opacity-60 hover:opacity-100"
            aria-label="Message options"
            aria-expanded={menu}
            onClick={() => setMenu((open) => !open)}
          >
            <MoreHorizontal size={16} />
          </button>
          {menu && (
            <button
              type="button"
              className="absolute right-0 top-7 z-10 whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-2 text-sm text-rose-300 shadow-lg"
              onClick={() => {
                setMenu(false);
                onUnsend();
              }}
            >
              Unsend
            </button>
          )}
        </span>
      )}
      {message.kind === 'unsent' ? (
        <span className="rounded-2xl border border-border px-3.5 py-2 text-sm italic text-ink-faint">
          Message unsent
        </span>
      ) : message.kind === 'post' && message.post ? (
        <PostCard post={message.post} mine={mine} />
      ) : (
        <span
          className={clsx(
            'max-w-[78%] whitespace-pre-wrap break-words px-3.5 py-2 text-[15px]',
            mine
              ? 'rounded-2xl rounded-br-md bg-sky-500 text-white'
              : 'rounded-2xl rounded-bl-md bg-surface-raised text-ink',
          )}
          title={new Date(message.createdAt).toLocaleString()}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}

function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();
  const submit = () => {
    if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return;
    onSend(trimmed);
    setText('');
    area.current?.focus();
  };
  // Grows with its content up to about five lines.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={area}
        rows={1}
        className="field max-h-36 min-h-11 flex-1 resize-none py-2.5"
        placeholder="Message…"
        aria-label="Message"
        maxLength={MAX_MESSAGE_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Enter sends on a keyboard; Shift+Enter (and phones' return key) adds a line.
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="submit"
        className="btn-primary h-11 w-11 shrink-0 justify-center p-0"
        disabled={!trimmed}
        aria-label="Send"
      >
        <Send size={18} />
      </button>
    </form>
  );
}

// ------------------------------------------------------------------ Send a post

/** Friend picker for a post's Send button (spec US4). */
export function SendPostDialog({ postId, onClose }: { postId: string; onClose: () => void }) {
  const router = useRouter();
  const friends = useSocialApi<{ people: SocialPerson[] }>('/social/connections?kind=friends&skip=0');
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<{ name: string; conversationId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sendTo(person: SocialPerson) {
    setSending(person.userId);
    setError(null);
    try {
      const conversationId = await openConversation(person.userId);
      await api.post(`/messages/conversations/${conversationId}/messages`, {
        requestId: crypto.randomUUID(),
        postId,
      });
      setSent({ name: person.displayName, conversationId });
    } catch (caught) {
      setError(errorText(caught, 'Could not send the post.'));
    } finally {
      setSending(null);
    }
  }

  return (
    <Modal open title="Send to a friend" onClose={onClose}>
      {error && <ErrorNote message={error} />}
      {sent ? (
        <div className="space-y-3 text-sm">
          <p>Sent to {sent.name}. They’ll see it only if the post’s audience includes them.</p>
          <button
            type="button"
            className="btn-primary w-full justify-center"
            onClick={() => router.push(`/messages/${sent.conversationId}`)}
          >
            Open conversation
          </button>
        </div>
      ) : friends.isLoading || !friends.data ? (
        <Spinner />
      ) : !friends.data.people.length ? (
        <p className="text-sm text-ink-muted">Add friends to send them posts.</p>
      ) : (
        <ul className="-mx-2 max-h-80 divide-y divide-border overflow-y-auto">
          {friends.data.people.map((person) => (
            <li key={person.userId} className="flex items-center gap-3 px-2 py-2.5">
              <Avatar name={person.displayName} size={36} />
              <span className="min-w-0 flex-1 truncate">{person.displayName}</span>
              <button
                type="button"
                className="btn shrink-0"
                disabled={!!sending}
                onClick={() => void sendTo(person)}
              >
                {sending === person.userId ? 'Sending…' : 'Send'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
