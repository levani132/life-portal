'use client';
import { HealthSyncBridge } from './apple-health';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Home,
  Menu,
  MessageCircle,
  Plus,
  Search,
  type LucideIcon,
} from 'lucide-react';
import type { PortalState } from '@life-portal/shared-types';
import { moduleForPath } from '@life-portal/shared-domain';
import { useAuth } from '../lib/auth-context';
import { useApi } from '../lib/hooks';
import { Dashboard } from './home-dashboard';
import { MenuContent } from './menu-content';
import { Inbox, messagingAvailable, useUnreadMessages } from './messages';
import { ActivityBell, NotificationsBridge } from './notifications';
import { PeopleSearch } from './people-search';
import { PortalLoader } from './portal-loader';
import { PullToRefresh } from './pull-to-refresh';
import { TabHost, type HostTab } from './tab-host';
import { ErrorNote } from './ui';

/** Routes that render without the portal: signing in and creating an account. */
const PUBLIC_PATHS = ['/login', '/register'];

/**
 * Pages still wrap themselves in `AppShell`, but the shell itself is mounted once, by the root
 * layout (`PortalShell`), and survives every navigation. That is what keeps the tabs alive:
 * leaving Home and coming back finds it exactly where it was.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (PUBLIC_PATHS.includes(pathname)) return <>{children}</>;
  return <Portal>{children}</Portal>;
}

function Portal({ children }: { children: ReactNode }) {
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
    (!(
      pathname.startsWith('/posts') ||
      pathname.startsWith('/wall') ||
      pathname === '/new'
    ) ||
      canPost);
  // A conversation and the new post page own the whole screen: no header, no tabs, and no
  // pull-to-refresh fighting their own gestures.
  const inChat = /^\/messages\/[^/]+/.test(pathname) || pathname === '/new';
  const inMenu =
    pathname === '/menu' ||
    pathname.startsWith('/settings') ||
    pathname === '/setup' ||
    pathname === '/profile' ||
    pathname === '/friends' ||
    pathname.startsWith('/people/');
  const tabs = tabsFor(portal.data.access, pathname, inMenu);
  const current = tabs.findIndex((tab) => tab.href === pathname);
  return (
    <div className="min-h-screen">
      {/* A conversation has its own header (back, the person, mute), and only that. */}
      {!inChat && (
        <ScrollHeader hidden={chromeHidden} onReveal={revealChrome}>
          {/* Name in the middle, Activity on the right. New posts start from the tab bar. */}
          <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-2 py-2">
            <span className="h-10" />
            <Link href="/" className="font-semibold tracking-tight">
              Life<span className="text-accent">Portal</span>
            </Link>
            <div className="flex justify-end pr-2">
              <ActivityBell access={portal.data.access} />
            </div>
          </div>
        </ScrollHeader>
      )}
      <HealthSyncBridge key={user.id} enabled={portal.data.access.nutrition} />
      <NotificationsBridge
        key={`push-${user.id}`}
        access={portal.data.access}
      />
      {/* One stable tree for every route, so moving between pages never remounts the tabs. A
          conversation owns its scroll, so pull-to-refresh is off there. */}
      <PullToRefresh enabled={!inChat}>
        <main>
          <TabHost
            key={user.id}
            tabs={tabs}
            active={current >= 0 ? tabs[current].href : null}
            onSwipeStart={revealChrome}
          />
          {current < 0 && (
            <div className={mainClassFor(pathname)}>
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
            </div>
          )}
        </main>
      </PullToRefresh>
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
          {withNewPost(tabs, canPost).map((tab) =>
            tab === NEW_POST ? (
              <Link
                key="new"
                href="/new"
                scroll={false}
                aria-label="New post"
                className="flex min-h-16 flex-1 items-center justify-center"
              >
                <span className="flex h-11 w-16 items-center justify-center rounded-2xl bg-ink text-surface shadow-sm active:scale-95">
                  <Plus size={24} strokeWidth={2.5} aria-hidden />
                </span>
              </Link>
            ) : (
            <TabLink key={tab.href} tab={tab} pathname={pathname}>
                {tab.label === 'Messages' && unreadMessages > 0 && (
                  <span
                    className="ml-1 rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] text-white"
                    aria-label={`${unreadMessages} unread conversations`}
                  >
                    {unreadMessages > 99 ? '99+' : unreadMessages}
                  </span>
                )}
                {tab.label === 'Menu' && !!requests.data?.count && (
                  <span
                    className="ml-1 rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] text-white"
                    aria-label={`${requests.data.count} pending friend requests`}
                  >
                    {requests.data.count}
                    {requests.data.more ? '+' : ''}
                  </span>
                )}
              </TabLink>
            ),
          )}
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
  const ref = useRef<HTMLElement>(null);
  // `--header-offset` is where the visible header ends, so sticky content (Home's feed tabs) can
  // sit right under it and follow it as it hides. The same transition timing keeps them together.
  useEffect(() => {
    const root = document.documentElement;
    const node = ref.current;
    const apply = () =>
      root.style.setProperty(
        '--header-offset',
        hidden || !node ? 'var(--top-chrome)' : `${node.offsetHeight}px`,
      );
    apply();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    if (node) observer?.observe(node);
    return () => observer?.disconnect();
  }, [hidden]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--header-offset');
    },
    [],
  );
  return (
    <header
      ref={ref}
      onFocusCapture={onReveal}
      className={clsx(
        'portal-header sticky top-0 z-40 bg-surface/95 pt-[var(--top-chrome)] backdrop-blur transition-transform duration-200',
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
  const chat = /^\/messages\/[^/]+/.test(pathname) || pathname === '/new';
  return clsx(
    'mx-auto max-w-7xl px-4',
    chat ? 'pb-0' : 'pb-[calc(6rem+env(safe-area-inset-bottom))]',
    pathname === '/' ? 'pt-2' : chat ? 'pt-0' : 'pt-6',
  );
}

const NEW_POST = 'new-post' as const;

/** The tabs with the New post button in the middle. It is a link, not a tab: swiping skips it. */
function withNewPost(tabs: Tab[], canPost: boolean): (Tab | typeof NEW_POST)[] {
  if (!canPost) return tabs;
  const middle = Math.ceil(tabs.length / 2);
  return [...tabs.slice(0, middle), NEW_POST, ...tabs.slice(middle)];
}

function TabLink({
  tab: { href, label, icon: Icon, active },
  pathname,
  children,
}: {
  tab: Tab;
  pathname: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      // Each tab keeps its own scroll position; tapping the open tab goes to its top.
      scroll={false}
      onClick={() => {
        if (href === pathname) window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs',
        active ? 'text-accent' : 'text-ink-muted',
      )}
    >
      <Icon size={21} aria-hidden />
      <span>
        {label}
        {children}
      </span>
    </Link>
  );
}

interface Tab extends HostTab {
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
    '/new',
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
        ]
      : []),
    tab('/menu', 'Menu', Menu, MenuContent, inMenu),
  ];
}

export { PageHeader } from './page-header';
