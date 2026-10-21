'use client';
import Link from 'next/link';
import { useState } from 'react';
import { LockKeyhole, UserRound } from 'lucide-react';
import type {
  ConnectionAction,
  SharedWidget,
  SocialPerson,
  SocialProfile,
} from '@life-portal/shared-types';
import { useSocialApi } from '../lib/social-hooks';
export { useSocialApi, SOCIAL_REFRESH } from '../lib/social-hooks';
import { DailyFoodDiary } from './shared-food-diary';
import { PostsList } from './posts';
import type { PortalState } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { ErrorNote, Input, Select, Spinner } from './ui';

export function SharedWidgets({
  widgets,
  compact = false,
  ownerId,
  preview,
}: {
  widgets: SharedWidget[];
  ownerId?: string;
  preview?: 'normal' | 'friend' | 'stranger';
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact ? 'mt-4 grid gap-3 sm:grid-cols-2' : 'grid gap-4 sm:grid-cols-2'
      }
    >
      {widgets.map((widget) => (
        <section
          key={widget.module}
          className={`rounded-xl border border-border bg-surface/50 p-4 ${widget.hasDiary && !compact ? 'sm:col-span-2' : ''}`}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">{widget.title}</h3>
            <span className="text-[10px] text-ink-faint">
              {widget.audience === 'friends' ? 'Friends' : 'Everyone'}
            </span>
          </div>
          <dl className="grid grid-cols-3 gap-3">
            {widget.stats.map((stat) => (
              <div key={stat.label}>
                <dd className="tabular break-words text-base font-semibold">
                  {stat.value}
                  {stat.estimated && (
                    <span className="ml-1 text-[10px] font-normal text-ink-faint">
                      est.
                    </span>
                  )}
                </dd>
                <dt className="mt-1 text-[11px] text-ink-muted">
                  {stat.label}
                </dt>
              </div>
            ))}
          </dl>
          {widget.hasDiary &&
            (compact ? (
              <p className="mt-3 text-xs text-sky-300">
                Daily food diary shared · open profile to view
              </p>
            ) : ownerId ? (
              <DailyFoodDiary
                key={`${ownerId}:${preview}`}
                userId={ownerId}
                preview={preview}
              />
            ) : null)}
        </section>
      ))}
    </div>
  );
}
export function ConnectionActions({
  person,
  onChanged,
  compact = false,
}: {
  person: SocialPerson;
  onChanged?: () => void;
  compact?: boolean;
}) {
  const action = useAction();
  async function act(value: ConnectionAction) {
    const success = await action.run(
      async () => {
        await api.put(`/social/connections/${person.userId}`, {
          action: value,
        });
        await revalidate('/social');
        await revalidate('/nutrition/foods/public');
      },
      { revalidate: false },
    );
    if (success) onChanged?.();
  }
  const relationship = person.relationship;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {relationship === 'none' && (
          <button
            type="button"
            className="btn-primary"
            disabled={action.pending}
            onClick={() => void act('request')}
          >
            Add friend
          </button>
        )}
        {relationship === 'incoming' && (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={action.pending}
              onClick={() => void act('accept')}
            >
              Accept request
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={action.pending}
              onClick={() => void act('decline')}
            >
              Decline
            </button>
          </>
        )}
        {relationship === 'outgoing' && (
          <button
            type="button"
            className="btn-ghost"
            disabled={action.pending}
            onClick={() => void act('cancel')}
          >
            Cancel request
          </button>
        )}
        {relationship === 'blocked' && (
          <button
            type="button"
            className="btn-ghost"
            disabled={action.pending}
            onClick={() => void act('unblock')}
          >
            Unblock
          </button>
        )}
        {relationship === 'friends' && (
          <>
            <span className="flex items-center px-1 text-sm text-emerald-400">
              Friends
            </span>
            <button
              type="button"
              className="btn-ghost"
              disabled={action.pending}
              onClick={() => void act('unfriend')}
            >
              Unfriend
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={action.pending}
              onClick={() => void act(person.muted ? 'unmute' : 'mute')}
            >
              {person.muted ? 'Unmute updates' : 'Mute updates'}
            </button>
          </>
        )}
        {!compact && relationship !== 'self' && relationship !== 'blocked' && (
          <button
            type="button"
            className="btn-ghost text-rose-300"
            title="Blocking removes this friendship and hides sharing in both directions"
            disabled={action.pending}
            onClick={() => void act('block')}
          >
            Block
          </button>
        )}
      </div>
      {action.pending && (
        <p role="status" className="mt-2 text-xs text-ink-muted">
          Updating connection…
        </p>
      )}
      {action.error && (
        <div className="mt-3" role="alert">
          <ErrorNote message={action.error} />
        </div>
      )}
    </div>
  );
}
export function PersonCard({
  person,
  showActions = true,
}: {
  person: SocialPerson;
  showActions?: boolean;
}) {
  return (
    <article className="card p-5">
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-300"
          aria-hidden
        >
          {person.displayName.slice(0, 1).toUpperCase() || (
            <UserRound size={20} />
          )}
        </div>
        <div className="flex-1">
          {person.relationship === 'blocked' ? (
            <h2 className="font-semibold">{person.displayName}</h2>
          ) : (
            <Link
              href={`/people/${person.userId}`}
              className="font-semibold hover:text-sky-300"
            >
              {person.displayName}
            </Link>
          )}
          <p className="text-xs text-ink-faint">@{person.username}</p>
          {person.bio && (
            <p className="mt-2 break-words text-sm text-ink-muted">
              {person.bio}
            </p>
          )}
        </div>
      </div>
      {person.widgets && <SharedWidgets widgets={person.widgets} compact />}
      {person.widgets?.length === 0 && (
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-faint">
          <LockKeyhole size={14} />
          No widgets shared with you.
        </p>
      )}
      {showActions && person.relationship !== 'friends' && (
        <ConnectionActions person={person} compact />
      )}
    </article>
  );
}
export function ProfileView({ userId }: { userId?: string }) {
  const [preview, setPreview] = useState('normal');
  const [tab, setTab] = useState<'posts' | 'about'>('posts');
  const portal = useApi<PortalState>('/portal');
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const path = userId
    ? `/social/profiles/${userId}`
    : `/social/me?preview=${preview}`;
  const profile = useSocialApi<SocialProfile>(path);
  if (profile.error)
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorNote message="This profile isn’t available. It may be private or the connection may have changed." />
        <Link href="/friends" className="btn-ghost mt-4">
          Back to friends
        </Link>
      </div>
    );
  if (profile.isLoading || !profile.data)
    return <Spinner label="Opening profile…" />;
  const person = profile.data;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="card p-6">
        <p className="mb-4 text-xs font-medium uppercase tracking-widest text-sky-300">
          {userId ? 'Life Portal profile' : 'Your profile'}
        </p>
        <h1 className="break-words text-2xl font-semibold">
          {person.displayName}
        </h1>
        <p className="mt-1 text-sm text-ink-faint">@{person.username}</p>
        {person.bio && (
          <p className="mt-4 whitespace-pre-wrap break-words text-ink-muted">
            {person.bio}
          </p>
        )}
        {!userId ? (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href="/settings/profile" className="btn-ghost">
              Edit profile
            </Link>
            <Link href="/settings/privacy" className="btn-ghost">
              Manage sharing
            </Link>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                const url = `${window.location.origin}/people/${person.userId}`;
                if (!navigator.clipboard) {
                  setShareUrl(url);
                  return;
                }
                void navigator.clipboard
                  .writeText(url)
                  .then(() => setCopied(true))
                  .catch(() => setShareUrl(url));
              }}
            >
              {copied ? 'Link copied' : 'Copy profile link'}
            </button>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <span className="shrink-0">View as</span>
              <Select
                className="w-auto"
                aria-label="Preview profile as"
                value={preview}
                onChange={(event) => setPreview(event.target.value)}
              >
                <option value="normal">My shared profile</option>
                <option value="friend">A friend</option>
                <option value="stranger">Someone else</option>
              </Select>
            </label>
          </div>
        ) : (
          <ConnectionActions person={person} />
        )}
      </div>
      {shareUrl && (
        <Input
          aria-label="Your profile link"
          readOnly
          value={shareUrl}
          onFocus={(event) => event.target.select()}
          className="mt-4"
        />
      )}
      {!userId && !person.discoverable && (
        <p className="my-4 flex items-center gap-2 text-sm text-ink-muted">
          <LockKeyhole size={16} />
          You’re hidden from search. People can still open your profile link.
        </p>
      )}
      {portal.data?.access.foodPosts &&
        portal.data.access.nutrition &&
        portal.data.access.social && (
          <div
            className="my-6 flex gap-2"
            role="tablist"
            aria-label="Profile sections"
          >
            {(['posts', 'about'] as const).map((value) => (
              <button
                type="button"
                key={value}
                role="tab"
                aria-selected={tab === value}
                className={tab === value ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setTab(value)}
              >
                {value === 'posts' ? 'Posts' : 'About'}
              </button>
            ))}
          </div>
        )}
      {tab === 'posts' &&
      portal.data?.access.foodPosts &&
      portal.data.access.nutrition &&
      portal.data.access.social ? (
        <PostsList
          authorId={person.userId}
          preview={
            !userId ? (preview as 'normal' | 'friend' | 'stranger') : 'normal'
          }
        />
      ) : (
        <>
          <div className="mb-4 mt-7 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">About</h2>
            <span className="text-xs text-ink-faint">Shared widgets</span>
          </div>
          {person.widgets.length ? (
            <SharedWidgets
              widgets={person.widgets}
              ownerId={person.userId}
              preview={
                !userId
                  ? (preview as 'normal' | 'friend' | 'stranger')
                  : 'normal'
              }
            />
          ) : (
            <div className="card p-6 text-sm text-ink-muted">
              {userId
                ? 'No widgets are shared with you.'
                : 'Nothing is shared in this view. Choose audiences in Privacy and sharing. Food also has separate meal, weight and target controls.'}
            </div>
          )}
          <p className="mt-4 text-xs text-ink-faint">
            Only widgets shared with this audience appear here.
          </p>
        </>
      )}
    </div>
  );
}
