'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BadgeCheck } from 'lucide-react';
import type { SocialProfile, SuggestedPage } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { revalidate, useAction, useApi } from '../lib/hooks';
import { Avatar } from './avatar';
import { ErrorNote } from './ui';

/** Beside a page's name: this one is the app's own (spec 040). */
export function OfficialMark({ className = '' }: { className?: string }) {
  return (
    <span title="Official LifePortal page" className={`inline-flex shrink-0 align-middle text-accent ${className}`}>
      <BadgeCheck size={15} aria-label="Official LifePortal page" />
    </span>
  );
}

const followers = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'follower' : 'followers'}`;

function useFollow(pageId: string) {
  const action = useAction();
  const set = (follow: boolean) =>
    action.run(
      async () => {
        await (follow ? api.put(`/follows/${pageId}`, {}) : api.delete(`/follows/${pageId}`));
        await Promise.all([revalidate('/social'), revalidate('/follows'), revalidate('/posts')]);
      },
      { revalidate: false },
    );
  return { ...action, set };
}

/** On a page's profile: how many follow it, and the button to follow or stop. */
export function PageFollow({ page, own, canMarkOfficial, canMessage }: { page: SocialProfile; own: boolean; canMarkOfficial: boolean; canMessage: boolean }) {
  const follow = useFollow(page.userId);
  const official = useAction();
  const message = useAction();
  const router = useRouter();
  return (
    <div className="mt-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        {!own && (
          <button
            type="button"
            className={page.following ? 'btn-ghost' : 'btn-primary'}
            disabled={follow.pending}
            aria-pressed={!!page.following}
            onClick={() => void follow.set(!page.following)}
          >
            {page.following ? 'Following' : 'Follow'}
          </button>
        )}
        {!own && canMessage && (
          <button
            type="button"
            className="btn-ghost"
            disabled={message.pending}
            onClick={() =>
              void message.run(
                async () => {
                  const { id } = await api.post<{ id: string }>('/messages/conversations', { userId: page.userId });
                  router.push(`/messages/${id}`);
                },
                { revalidate: false },
              )
            }
          >
            Message
          </button>
        )}
        {page.followerCount !== undefined && <span className="text-sm text-ink-muted">{followers(page.followerCount)}</span>}
      </div>
      {canMarkOfficial && (
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={!!page.official}
            disabled={official.pending}
            onChange={(event) =>
              void official.run(
                async () => {
                  await api.put(`/pages/${page.userId}/official`, { official: event.target.checked });
                  await Promise.all([revalidate('/social'), revalidate('/follows'), revalidate('/pages')]);
                },
                { revalidate: false },
              )
            }
          />
          Official LifePortal page (only you see this switch)
        </label>
      )}
      {(follow.error ?? official.error ?? message.error) && <ErrorNote message={(follow.error ?? official.error ?? message.error) as string} />}
    </div>
  );
}

function SuggestedRow({ page }: { page: SuggestedPage }) {
  const follow = useFollow(page.userId);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Link href={`/people/${page.userId}`} className="flex flex-1 items-center gap-3">
        <Avatar name={page.displayName} url={page.avatarUrl} size={40} />
        <span className="flex-1">
          <span className="flex items-center gap-1">
            <span className="truncate font-medium text-ink">{page.displayName}</span>
            {page.official && <OfficialMark />}
          </span>
          <span className="block truncate text-xs text-ink-faint">
            {page.bio || `@${page.username}`} · {followers(page.followerCount)}
          </span>
        </span>
      </Link>
      <button type="button" className="btn-primary shrink-0" disabled={follow.pending} onClick={() => void follow.set(true)}>
        Follow
      </button>
    </li>
  );
}

/** Pages worth following, for a Following feed with nothing in it yet. Nothing when there are none. */
export function SuggestedPages({ title = 'Pages to follow' }: { title?: string }) {
  const pages = useApi<SuggestedPage[]>('/follows/suggested');
  if (!pages.data?.length) return null;
  return (
    <section className="card p-4" aria-label={title}>
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      <ul className="mt-1 divide-y divide-border">
        {pages.data.map((page) => (
          <SuggestedRow key={page.userId} page={page} />
        ))}
      </ul>
    </section>
  );
}
