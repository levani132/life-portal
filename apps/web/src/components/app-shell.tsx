'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Home, Menu, Search, Users, Newspaper } from 'lucide-react';
import type { PortalState } from '@life-portal/shared-types';
import { moduleForPath } from '@life-portal/shared-domain';
import { useAuth } from '../lib/auth-context';
import { useApi } from '../lib/hooks';
import { PortalLoader } from './portal-loader';
import { PullToRefresh } from './pull-to-refresh';
import { ErrorNote } from './ui';

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const portal = useApi<PortalState>(user ? '/portal' : null, {
    revalidateOnFocus: true,
    refreshInterval: 30000,
  });
  const requests = useApi<{ count: number; more: boolean }>(
    portal.data?.access.social ? '/social/requests/count' : null,
    { revalidateOnFocus: true, refreshInterval: 30000 },
  );
  const needsSetup =
    portal.data?.cohort === 'production' &&
    !portal.data.setupCompleted &&
    !portal.data.setupDismissed;
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    else if (needsSetup && pathname !== '/setup') router.replace('/setup');
  }, [loading, user, needsSetup, pathname, router]);
  if (loading || !user || portal.isLoading)
    return <PortalLoader label="Opening your portal…" />;
  if (portal.error)
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorNote message={(portal.error as Error).message} />
        <button className="btn mt-4" onClick={() => void portal.mutate()}>
          Try again
        </button>
        <button className="btn ml-3 mt-4" onClick={() => void logout()}>
          Sign out
        </button>
      </div>
    );
  if (!portal.data || (needsSetup && pathname !== '/setup'))
    return <PortalLoader label="Preparing your setup…" />;
  const module = moduleForPath(pathname);
  const canPost =
    portal.data.access.foodPosts &&
    portal.data.access.social &&
    portal.data.access.nutrition;
  const allowed =
    (!module || portal.data.access[module]) &&
    (!(pathname.startsWith('/posts') || pathname.startsWith('/wall')) ||
      canPost);
  const inMenu =
    pathname === '/menu' ||
    pathname.startsWith('/settings') ||
    pathname === '/setup' ||
    pathname === '/profile';
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link href="/" className="font-semibold tracking-tight">
            Life<span className="text-sky-400">Portal</span>
          </Link>
          <Link href="/menu" className="text-sm text-ink-muted">
            {user.name}
          </Link>
        </div>
      </header>
      <PullToRefresh>
        <main className="mx-auto max-w-7xl px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))]">
          {allowed ? (
            children
          ) : (
            <div className="card mx-auto max-w-lg p-6">
              <h1 className="text-xl font-semibold">
                This module isn’t available yet
              </h1>
              <p className="mt-2 text-sm text-ink-muted">
                You can manage your available modules in Menu.
              </p>
              <Link className="btn mt-4" href="/">
                Go Home
              </Link>
            </div>
          )}
        </main>
      </PullToRefresh>
      <nav
        aria-label="Main navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <div className="mx-auto flex max-w-xl">
          {[
            {
              href: '/',
              label: 'Home',
              icon: Home,
              active:
                !inMenu &&
                !pathname.startsWith('/search') &&
                !pathname.startsWith('/friends') &&
                !pathname.startsWith('/people') &&
                !pathname.startsWith('/wall') &&
                !pathname.startsWith('/posts'),
            },
            ...(portal.data.access.social
              ? [
                  {
                    href: '/search',
                    label: 'Search',
                    icon: Search,
                    active: pathname === '/search',
                  },
                  {
                    href: '/friends',
                    label: 'Friends',
                    icon: Users,
                    active:
                      pathname === '/friends' ||
                      pathname.startsWith('/people/'),
                  },
                ]
              : []),
            ...(canPost
              ? [
                  {
                    href: '/wall',
                    label: 'Wall',
                    icon: Newspaper,
                    active:
                      pathname.startsWith('/wall') ||
                      pathname.startsWith('/posts'),
                  },
                ]
              : []),
            { href: '/menu', label: 'Menu', icon: Menu, active: inMenu },
          ].map(({ href, label, icon: Icon, active }) => (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs',
                active ? 'text-sky-300' : 'text-ink-muted',
              )}
            >
              <Icon size={21} aria-hidden />
              <span>
                {label}
                {label === 'Friends' && !!requests.data?.count && (
                  <span
                    className="ml-1 rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] text-white"
                    aria-label={`${requests.data.count} pending friend requests`}
                  >
                    {requests.data.count}
                    {requests.data.more ? '+' : ''}
                  </span>
                )}
              </span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

/** Page heading with an optional action area, used by every detail page. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
