'use client';
import { HealthSyncBridge } from './apple-health';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Home,
  Menu,
  MessageCircle,
  Search,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { PortalState } from '@life-portal/shared-types';
import { moduleForPath } from '@life-portal/shared-domain';
import { useAuth } from '../lib/auth-context';
import { useApi } from '../lib/hooks';
import { Friends } from './friends-list';
import { Dashboard } from './home-dashboard';
import { MenuContent } from './menu-content';
import { Inbox, messagingAvailable, useUnreadMessages } from './messages';
import { ActivityBell, NotificationsBridge } from './notifications';
import { PeopleSearch } from './people-search';
import { PortalLoader } from './portal-loader';
import { PullToRefresh } from './pull-to-refresh';
import { TabPager, type PagerTab } from './tab-pager';
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
    !!portal.data && !portal.data.setupCompleted && !portal.data.setupDismissed;
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    else if (needsSetup && pathname !== '/setup') router.replace('/setup');
  }, [loading, user, needsSetup, pathname, router]);
  const [chromeHidden, revealChrome] = useScrollHidden(pathname === '/');
  const unreadMessages = useUnreadMessages(portal.data?.access ?? NO_ACCESS);
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
  // A conversation owns the whole screen: no tabs, and no pull-to-refresh fighting its scroll.
  const inChat = /^\/messages\/[^/]+/.test(pathname);
  const inMenu =
    pathname === '/menu' ||
    pathname.startsWith('/settings') ||
    pathname === '/setup' ||
    pathname === '/profile';
  const tabs = tabsFor(portal.data.access, pathname, inMenu);
  const current = tabs.findIndex((tab) => tab.href === pathname);
  const page = (
    <main className={mainClassFor(pathname)}>
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
  );
  return (
    <div className="min-h-screen">
      <ScrollHeader hidden={chromeHidden} onReveal={revealChrome}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <Link href="/" className="font-semibold tracking-tight">
            Life<span className="text-accent">Portal</span>
          </Link>
          <div className="flex items-center gap-2">
            <ActivityBell access={portal.data.access} />
            <Link href="/menu" className="text-sm text-ink-muted">
              {user.name}
            </Link>
          </div>
        </div>
      </ScrollHeader>
      <HealthSyncBridge key={user.id} enabled={portal.data.access.nutrition} />
      <NotificationsBridge
        key={`push-${user.id}`}
        access={portal.data.access}
      />
      {inChat ? (
        page
      ) : (
        <PullToRefresh>
          {current >= 0 && allowed ? (
            <TabPager
              prev={tabs[current - 1]}
              next={tabs[current + 1]}
              onSwipeStart={revealChrome}
            >
              {page}
            </TabPager>
          ) : (
            page
          )}
        </PullToRefresh>
      )}
      <nav
        hidden={inChat}
        aria-label="Main navigation"
        onFocusCapture={revealChrome}
        className={clsx(
          'portal-tabbar fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur transition-transform duration-200',
          chromeHidden && 'translate-y-full',
        )}
      >
        <div className="mx-auto flex max-w-xl">
          {tabs.map(({ href, label, icon: Icon, active }) => (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs',
                active ? 'text-accent' : 'text-ink-muted',
              )}
            >
              <Icon size={21} aria-hidden />
              <span>
                {label}
                {label === 'Messages' && unreadMessages > 0 && (
                  <span
                    className="ml-1 rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] text-white"
                    aria-label={`${unreadMessages} unread conversations`}
                  >
                    {unreadMessages > 99 ? '99+' : unreadMessages}
                  </span>
                )}
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

/**
 * On the feed, the header and the bottom tabs both get out of the way while scrolling down
 * and come back on any scroll up, the way Safari's toolbars do. Elsewhere they stay put.
 */
function useScrollHidden(enabled: boolean) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    let anchor = Math.max(0, window.scrollY);
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      const bottom =
        y + window.innerHeight >= document.documentElement.scrollHeight - 4;
      if (y < 60) {
        setHidden(false);
        anchor = y;
      } else if (bottom) {
        // Reaching the end brings the tabs back, so there is always a way out of the feed.
        setHidden(false);
        anchor = y;
      } else if (Math.abs(y - anchor) > 8) {
        setHidden(y > anchor);
        anchor = y;
      }
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', scroll);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return [hidden, () => setHidden(false)] as const;
}

function ScrollHeader({
  children,
  hidden,
  onReveal,
}: {
  children: ReactNode;
  hidden: boolean;
  onReveal: () => void;
}) {
  return (
    <header
      onFocusCapture={onReveal}
      className={clsx(
        'portal-header sticky top-0 z-40 bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur transition-transform duration-200',
        hidden && '-translate-y-full',
      )}
    >
      {children}
    </header>
  );
}

const NO_ACCESS = {} as PortalState['access'];

/** The page padding for a route. The tab pager's previews use it too, so they line up exactly. */
function mainClassFor(pathname: string): string {
  const chat = /^\/messages\/[^/]+/.test(pathname);
  return clsx(
    'mx-auto max-w-7xl px-4',
    chat ? 'pb-0' : 'pb-[calc(6rem+env(safe-area-inset-bottom))]',
    pathname === '/' ? 'pt-2' : chat ? 'pt-0' : 'pt-6',
  );
}

interface Tab extends PagerTab {
  label: string;
  icon: LucideIcon;
  active: boolean;
}

/** The bottom tabs, in order. Swiping moves between neighbours in this same order. */
function tabsFor(
  access: PortalState['access'],
  pathname: string,
  inMenu: boolean,
): Tab[] {
  const tab = (
    href: string,
    label: string,
    icon: LucideIcon,
    Content: Tab['Content'],
    active: boolean,
  ): Tab => ({
    href,
    label,
    icon,
    Content,
    active,
    mainClass: mainClassFor(href),
  });
  const elsewhere = [
    '/search',
    '/friends',
    '/people',
    '/wall',
    '/posts',
    '/messages',
  ];
  return [
    tab(
      '/',
      'Home',
      Home,
      Dashboard,
      !inMenu && !elsewhere.some((p) => pathname.startsWith(p)),
    ),
    ...(messagingAvailable(access)
      ? [
          tab(
            '/messages',
            'Messages',
            MessageCircle,
            Inbox,
            pathname.startsWith('/messages'),
          ),
        ]
      : []),
    ...(access.social
      ? [
          tab(
            '/search',
            'Search',
            Search,
            PeopleSearch,
            pathname === '/search',
          ),
          tab(
            '/friends',
            'Friends',
            Users,
            Friends,
            pathname === '/friends' || pathname.startsWith('/people/'),
          ),
        ]
      : []),
    tab('/menu', 'Menu', Menu, MenuContent, inMenu),
  ];
}

export { PageHeader } from './page-header';
