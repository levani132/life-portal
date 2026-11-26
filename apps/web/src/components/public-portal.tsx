'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { PublicPortal } from '@life-portal/shared-types';
import { useApi } from '../lib/hooks';
import { Avatar } from './avatar';
import { OfficialMark } from './follow';
import { PageMark } from './identity-switcher';
import { PortalGrid } from './portal-grid';
import { Spinner } from './ui';
import { Wordmark } from './wordmark';

/** How far a visitor may scroll before the invitation covers the portal. */
const OPEN_SCROLL_PX = 480;

const localDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/**
 * Spec 046: a portal for someone without an account. The server sends only the public side (the
 * modules shared with everyone and two newest public posts); this page shows it, and covers it
 * with an invitation to join once the visitor scrolls on or opens another tab. The cover is a
 * nudge: nothing more was sent to hide.
 */
export function PublicPortalView({ username }: { username: string }) {
  const portal = useApi<PublicPortal>(`/public/portals/${encodeURIComponent(username)}?today=${localDay()}`);
  const [gate, setGate] = useState(false);
  const fired = useRef(false);
  useEffect(() => {
    const onScroll = () => {
      if (!fired.current && window.scrollY > OPEN_SCROLL_PX) {
        fired.current = true;
        setGate(true);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const next = `/@${username}`;

  return (
    <div className="min-h-screen bg-surface pb-24">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 bg-surface/95 px-4 pb-2 pt-[calc(var(--top-chrome,env(safe-area-inset-top))+0.5rem)] backdrop-blur">
        <Link href="/login" aria-label="LifePortal">
          <Wordmark />
        </Link>
        <span className="flex gap-2">
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn-ghost">
            Sign in
          </Link>
          <Link href={`/register?next=${encodeURIComponent(next)}`} className="btn-primary">
            Join
          </Link>
        </span>
      </header>
      <main className="mx-auto max-w-3xl px-4 pt-4">
        {portal.error ? (
          <section className="card p-6 text-center">
            <h1 className="text-lg font-semibold">This portal is private</h1>
            <p className="mt-2 text-sm text-ink-muted">Join LifePortal to ask to be friends, and see what they share with friends.</p>
            <Link href={`/register?next=${encodeURIComponent(next)}`} className="btn-primary mt-4 inline-flex">
              Join LifePortal
            </Link>
          </section>
        ) : !portal.data ? (
          <Spinner />
        ) : (
          <>
            <section className="card relative">
              <div aria-hidden className="h-24 rounded-t-xl bg-gradient-to-br from-accent/30 via-special-solid/15 to-success-solid/10" />
              <div className="px-5 pb-5">
                <div className="-mt-12">
                  <Avatar name={portal.data.displayName} url={portal.data.avatarUrl} size={96} className="ring-4 ring-surface-raised" />
                </div>
                <h1 className="mt-3 break-words text-2xl font-semibold leading-tight">
                  {portal.data.displayName}
                  {portal.data.official && <OfficialMark className="ml-1.5" />}
                  {portal.data.isPage && <PageMark className="ml-2" ai={portal.data.aiManaged} />}
                </h1>
                <p className="text-sm text-ink-faint">@{portal.data.username}</p>
                {portal.data.bio && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{portal.data.bio}</p>}
              </div>
            </section>
            <div className="glass-tabs relative mt-5 inline-flex gap-1 rounded-full border p-1" role="tablist" aria-label="Portal sections">
              <button type="button" role="tab" aria-selected className="glass-tab-on rounded-full border border-transparent px-4 py-1.5 text-sm font-medium">
                {portal.data.isPage ? 'Posts' : 'Portal'}
              </button>
              {!portal.data.isPage && (
                <button type="button" role="tab" aria-selected={false} className="rounded-full border border-transparent px-4 py-1.5 text-sm text-ink-muted" onClick={() => setGate(true)}>
                  Posts
                </button>
              )}
              <button type="button" role="tab" aria-selected={false} className="rounded-full border border-transparent px-4 py-1.5 text-sm text-ink-muted" onClick={() => setGate(true)}>
                {portal.data.isPage ? 'Library' : 'Badges'}
              </button>
            </div>
            {portal.data.widgets.length > 0 && (
              <div className="mt-4">
                <PortalGrid widgets={portal.data.widgets} />
              </div>
            )}
            {portal.data.posts.length > 0 && (
              <ul className="mt-4 space-y-3">
                {portal.data.posts.map((post) => (
                  <li key={post.id} className="card overflow-hidden">
                    {post.photoUrl && (
                      // A signed, short-lived link; nothing to optimise.
                      <img src={post.photoUrl} alt="" className="max-h-80 w-full object-cover" />
                    )}
                    <div className="p-4">
                      {post.title && <h2 className="font-semibold">{post.title}</h2>}
                      {post.caption && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-muted">{post.caption}</p>}
                      {post.macros && (
                        <p className="mt-2 text-xs text-ink-faint">
                          {Math.round(post.macros.energyKcal)} kcal · P {Math.round(post.macros.proteinG)} g · C {Math.round(post.macros.carbG)} g · F {Math.round(post.macros.fatG)} g
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {portal.data.widgets.length === 0 && portal.data.posts.length === 0 && (
              <p className="card mt-4 p-6 text-sm text-ink-muted">Nothing here is public yet.</p>
            )}
            {/* Room to scroll into the invitation. */}
            <div className="h-[60vh]" aria-hidden />
          </>
        )}
      </main>
      {gate && portal.data && <JoinGate name={portal.data.displayName} next={next} onClose={() => { setGate(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
    </div>
  );
}

/** Covers the portal: what else there is needs an account. */
function JoinGate({ name, next, onClose }: { name: string; next: string; onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={`See more of ${name}`} className="fixed inset-0 z-50 flex items-end justify-center bg-surface/80 p-4 backdrop-blur-md sm:items-center">
      <div className="card w-full max-w-sm p-6 text-center shadow-xl">
        <Wordmark className="mx-auto" />
        <h2 className="mt-4 text-lg font-semibold">See more of {name}’s portal</h2>
        <p className="mt-2 text-sm text-ink-muted">Join LifePortal to see their posts, follow how they eat and train, and keep your own portal.</p>
        <Link href={`/register?next=${encodeURIComponent(next)}`} className="btn-primary mt-5 flex w-full justify-center">
          Join LifePortal
        </Link>
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn-ghost mt-2 flex w-full justify-center">
          I have an account
        </Link>
        <button type="button" className="mt-3 text-xs text-ink-faint underline" onClick={onClose}>
          Back to the top
        </button>
      </div>
    </div>
  );
}
