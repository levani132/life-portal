'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Globe, Lock, MoreHorizontal, Users } from 'lucide-react';
import type { Audience } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { revalidate } from '../lib/hooks';
import { postTimeLabel } from '../lib/post-time';

export function PostRelativeTime({ date }: { date: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time dateTime={date} title={new Date(date).toLocaleString()}>
      {postTimeLabel(date, now)}
    </time>
  );
}
export function PostDateLink({ id, date }: { id: string; date: string }) {
  return (
    <Link
      href={`/posts/${id}`}
      className="hover:underline focus-visible:underline"
    >
      <PostRelativeTime date={date} />
    </Link>
  );
}
const audiences = {
  private: { label: 'Only me', icon: Lock },
  friends: { label: 'Friends', icon: Users },
  public: { label: 'Everyone in Life Portal', icon: Globe },
};
export function PostAudienceControl({
  id,
  audience,
  isOwner,
}: {
  id: string;
  audience: Audience;
  isOwner: boolean;
}) {
  const [value, setValue] = useState(audience);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setValue(audience);
  }, [audience]);
  const Icon = audiences[value].icon;
  if (!isOwner)
    return (
      <span title={audiences[value].label} aria-label={audiences[value].label}>
        <Icon size={13} aria-hidden="true" />
      </span>
    );
  return (
    <span className="relative inline-flex items-center">
      <span
        className="group relative inline-flex h-7 items-center gap-1 rounded-md px-1.5 transition hover:bg-violet-500/10 focus-within:bg-violet-500/10 focus-within:ring-2 focus-within:ring-accent"
        title={`Audience: ${audiences[value].label}`}
      >
        <Icon size={13} aria-hidden="true" />
        <ChevronDown
          size={10}
          aria-hidden="true"
          className="md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
        />
        <select
          aria-label="Change post audience"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={value}
          disabled={busy}
          onChange={async (event) => {
            const next = event.target.value as Audience;
            const previous = value;
            setBusy(true);
            setError('');
            setValue(next);
            try {
              await api.patch(`/posts/${id}/audience`, { audience: next });
              await Promise.resolve(revalidate('/posts')).catch(
                () => undefined,
              );
            } catch (e) {
              setValue(previous);
              setError(
                e instanceof Error ? e.message : 'Could not change audience.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {Object.entries(audiences).map(([key, option]) => (
            <option key={key} value={key}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
      {error && (
        <span
          role="alert"
          className="absolute left-0 top-full z-20 w-56 rounded-lg border border-border bg-surface p-2 text-xs text-rose-400"
        >
          {error}
        </span>
      )}
    </span>
  );
}
export function PostOptions({
  owner,
  busy,
  onEdit,
  onDelete,
  onImport,
  onReport,
  onNotInterested,
  onHideAuthor,
}: {
  owner: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  /** Absent for a post without food: there is nothing to import. */
  onImport?: () => void;
  onReport: () => void;
  /** For You only. */
  onNotInterested?: () => void;
  /** For You only. */
  onHideAuthor?: { label: string; run: () => void };
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node))
        ref.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  const choose = (action: () => void) => {
    ref.current?.removeAttribute('open');
    action();
  };
  return (
    <details
      ref={ref}
      className="relative ml-auto shrink-0"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          ref.current?.removeAttribute('open');
          ref.current?.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label="Post options"
        className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full text-ink-muted hover:bg-violet-500/10 [&::-webkit-details-marker]:hidden"
      >
        <MoreHorizontal size={20} />
      </summary>
      <div className="absolute right-0 top-10 z-30 w-56 rounded-xl border border-border bg-surface p-1 shadow-xl">
        {owner ? (
          <>
            <button
              type="button"
              className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-violet-500/10"
              onClick={() => choose(onEdit)}
            >
              Edit post
            </button>
            <button
              type="button"
              disabled={busy}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-400 hover:bg-rose-500/10"
              onClick={() => choose(onDelete)}
            >
              Delete post
            </button>
          </>
        ) : (
          <>
            {onImport && (
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-violet-500/10"
                onClick={() => choose(onImport)}
              >
                Import foods
              </button>
            )}
            {onNotInterested && (
              <button
                type="button"
                disabled={busy}
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-violet-500/10"
                onClick={() => choose(onNotInterested)}
              >
                Not interested
              </button>
            )}
            {onHideAuthor && (
              <button
                type="button"
                disabled={busy}
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-violet-500/10"
                onClick={() => choose(onHideAuthor.run)}
              >
                {onHideAuthor.label}
              </button>
            )}
            <button
              type="button"
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-400 hover:bg-rose-500/10"
              onClick={() => choose(onReport)}
            >
              Report / hide
            </button>
          </>
        )}
      </div>
    </details>
  );
}
