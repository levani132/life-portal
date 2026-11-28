'use client';
import { Wordmark } from './wordmark';
import { ActAsLinks, IdentitySwitcher, switchToOtherIdentity } from './identity-switcher';
import { FolderSheet } from './folder-sheet';
import { Avatar } from './avatar';
import { useSocialApi } from '../lib/social-hooks';
import type { SocialProfile } from '@life-portal/shared-types';
import { PageLibrary } from './page-library';
import { HealthSyncBridge } from './apple-health';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  ChevronLeft,
  Home,
  Menu,
  MessageCircle,
  Plus,
  Search,
  UserRound,
  Users,
  LibraryBig,
  type LucideIcon,
} from 'lucide-react';
import type { PortalState } from '@life-portal/shared-types';
import { moduleForPath } from '@life-portal/shared-domain';
import { useAuth } from '../lib/auth-context';
import { RECOVERS, useApi } from '../lib/hooks';
import { Dashboard } from './home-dashboard';
import { MenuContent } from './menu-content';
import { Inbox, messagingAvailable, useUnreadMessages } from './messages';
import { useViewportDrift } from '../lib/viewport-drift';
import { ActivityBell, NotificationsBridge } from './notifications';
import { PeopleSearch } from './people-search';
import { PortalLoader } from './portal-loader';
import { PullToRefresh } from './pull-to-refresh';
import { useOfflineCopy } from '../lib/offline/use-offline-copy';
import { SyncStatus } from './sync-status';
import { ProfileView } from './social';
import { useBadgeCheckOnStart } from '../lib/badges';
import { TabHost, type HostTab } from './tab-host';
import { WorkoutBar } from './training/workout-bar';
import { LoadProblem } from './load-problem';

/** Routes that render without the portal: signing in and creating an account. */
const PUBLIC_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/auth/google', '/terms', '/privacy', '/rules'];

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
  const { user, loading } = useAuth();
  if (PUBLIC_PATHS.includes(pathname)) return <>{children}</>;
  // Spec 046: a portal's address opens for someone without an account, outside the app.
  // The address is rewritten, so the path the browser reports is still `/@username`.
  if ((pathname.startsWith('/u/') || pathname.startsWith('/@')) && !loading && !user) return <>{children}</>;
  return <Portal>{children}</Portal>;
}

function Portal({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const portalLive = useApi<PortalState>(user ? '/portal' : null, {
    ...RECOVERS,
    refreshInterval: 30000,
  });
  // Spec 027: without a connection the shell opens from the last portal state this account saw.
  const portalCopy = useOfflineCopy('shell:portal', portalLive);
  const portal = {
    ...portalLive,
    data: portalCopy.data,
    error: portalCopy.data ? undefined : portalLive.error,
    isLoading: portalLive.isLoading || portalCopy.looking,
  };
  const requests = useApi<{ count: number; more: boolean }>(
    portal.data?.access.social ? '/social/requests/count' : null,
    { revalidateOnFocus: true, refreshInterval: 30000 },
  );
  // Spec 040: a page has no badges, workouts or health data, so nothing asks for them.
  const isPage = !!portal.data?.page;
  // The same read as the profile screen, so the tab's photo costs no extra request.
  const me = useSocialApi<SocialProfile>(user && portal.data?.access.social ? '/social/me?preview=normal' : null);
  useBadgeCheckOnStart(!!portal.data && !isPage, !!portal.data?.access.nutrition);
  const needsSetup =
    !!portal.data && !portal.data.setupCompleted && !portal.data.setupDismissed;
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
    else if (needsSetup && pathname !== '/setup') router.replace('/setup');
  }, [loading, user, needsSetup, pathname, router]);
  const [scrolledDown, revealChrome] = useScrolledDown(pathname);
  // Long-pressing the profile tab opens "Using the app as" here.
  // The tab's place on screen: the chooser grows out of it, like a portal widget's folder.
  const [choosingIdentity, setChoosingIdentity] = useState<DOMRect | null>(null);
  // Only the feed's header gets out of the way; the tab bar shrinks on every page instead.
  const chromeHidden = scrolledDown && pathname === '/';
  // iOS can leave the screen shifted after the keyboard: the bar and header follow it.
  useViewportDrift();
  const unreadMessages = useUnreadMessages(portal.data?.access ?? NO_ACCESS);
  if (loading || !user || portal.isLoading)
    return <PortalLoader label="Opening your portal…" />;
  if (portal.error)
    return (
      <div className="mx-auto max-w-lg p-6">
        <LoadProblem error={portal.error} onRetry={() => void portal.mutate()} />
        <button className="btn mt-4" onClick={() => void logout()}>
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
  // Pages reached from your profile (its menu, settings, your friends) keep the last tab lit.
  // `/people/<you>` redirects to `/profile`; someone else's profile lights no tab.
  const inMenu =
    pathname === '/menu' ||
    pathname.startsWith('/settings') ||
    pathname === '/setup' ||
    pathname === '/profile' ||
    pathname === '/friends' ||
    pathname === `/people/${user.id}`;
  const tabs = tabsFor(portal.data.access, pathname, inMenu, isPage);
  const current = tabs.findIndex((tab) => tab.href === pathname);
  // The bar's cells (the tabs, with New post in the middle) and which one the pill sits under.
  const bar = withNewPost(tabs, canPost);
  const barIndex = bar.findIndex((tab) => tab !== NEW_POST && tab.active);
  return (
    <div className="min-h-screen">
      {/* A conversation has its own header (back, the person, mute), and only that. */}
      {!inChat && (
        <ScrollHeader hidden={chromeHidden} onReveal={revealChrome}>
          {/* Name in the middle, Activity on the right. New posts start from the tab bar. */}
          <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-2 py-2">
            {/* Spec 027: the sync state, when there is one. Empty and the same size otherwise. */}
            {/* Off the tabs, the way back: screens carry no title bar of their own (see CLAUDE.md). */}
            <div className="flex h-10 items-center gap-1 pl-1">
              {current < 0 && (
                <button
                  type="button"
                  aria-label="Back"
                  onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))}
                  className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-ink/5 hover:text-ink"
                >
                  <ChevronLeft size={22} />
                </button>
              )}
              <SyncStatus />
            </div>
            <Link href="/" aria-label="Home">
              <Wordmark />
            </Link>
            <div className="flex items-center justify-end gap-1 pr-2">
              {isPage && portal.data.access.social && (
                <Link href="/search" aria-label="Search" className="flex h-10 w-10 items-center justify-center rounded-full text-ink-muted hover:bg-ink/5 hover:text-ink">
                  <Search size={20} />
                </Link>
              )}
              <ActivityBell access={portal.data.access} />
            </div>
          </div>
          {/* Spec 025: while a workout is open. Inside the header, so it counts in --header-offset. */}
          <WorkoutBar enabled={!!portal.data.access.training && !isPage} push={!!portal.data.access.push} />
          <ActAsLinks />
        </ScrollHeader>
      )}
      <HealthSyncBridge key={user.id} enabled={portal.data.access.nutrition && !isPage} />
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
      {/* A floating glass capsule, in the manner of iOS's tab bars: the page scrolls under it,
          and a pill slides to the open tab. Only the capsule takes touches; the band beside
          it lets them through to the page. */}
      <nav
        hidden={inChat}
        aria-label="Main navigation"
        onFocusCapture={revealChrome}
        className={clsx(
          'portal-tabbar pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]',
        )}
        // Scrolling down makes the bar smaller (icons only, narrower); it never leaves the screen.
        data-compact={scrolledDown || undefined}
        style={{ translate: '0 var(--vv-bottom-shift, 0px)' }}
      >
        <div className="glass-bar pointer-events-auto relative mx-auto flex max-w-md rounded-full border p-1.5">
          <BarPill
            cells={bar.length}
            index={barIndex}
            next={swipeCells(bar, barIndex, 1)}
            prev={swipeCells(bar, barIndex, -1)}
          />
          {bar.map((tab) =>
            tab === NEW_POST ? (
              <Link
                key="new"
                href="/new"
                scroll={false}
                aria-label="New post"
                className="tab-cell relative z-10 flex min-h-[3.25rem] flex-1 items-center justify-center"
              >
                <span className="tab-new flex h-10 w-10 items-center justify-center rounded-full bg-ink text-surface shadow-sm transition-transform duration-150 active:scale-90">
                  <Plus size={22} strokeWidth={2.5} aria-hidden />
                </span>
              </Link>
            ) : (
            <TabLink
              key={tab.href}
              tab={tab}
              pathname={pathname}
              // The tab a swipe is heading for: its name appears as the open one's fades.
              swipe={swipeTarget(bar, barIndex, 1) === tab ? 'next' : swipeTarget(bar, barIndex, -1) === tab ? 'prev' : undefined}
              {...(tab.href === LAST_TAB_HREF.profile
                ? {
                    // The identity in use is the photo on this tab; two quick taps switch to the other one.
                    picture: <Avatar name={me.data?.displayName ?? user.name} url={me.data?.avatarUrl} size={24} />,
                    onDoubleTap: () =>
                      void switchToOtherIdentity(user.id).then((problem) => {
                        if (problem) window.alert(problem);
                      }),
                    // A long press opens "Using the app as": yourself and every page you manage.
                    onLongPress: (from) => setChoosingIdentity(from),
                  }
                : {})}
            >
                {tab.label === 'Messages' && unreadMessages > 0 && (
                  <span
                    className="absolute left-1/2 top-1 ml-1.5 rounded-full bg-info-solid px-1.5 py-0.5 text-[10px] leading-none text-white"
                    aria-label={`${unreadMessages} unread conversations`}
                  >
                    {unreadMessages > 99 ? '99+' : unreadMessages}
                  </span>
                )}
                {tab.href === LAST_TAB_HREF.profile && !!requests.data?.count && (
                  <span
                    className="absolute left-1/2 top-1 ml-1.5 rounded-full bg-info-solid px-1.5 py-0.5 text-[10px] leading-none text-white"
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
      {/* Always in the tree (the shell's tree never changes shape); open only after a long press. */}
      <IdentityFolder from={choosingIdentity} onClose={() => setChoosingIdentity(null)} />
    </div>
  );
}

/**
 * Whether the person is scrolling down the page (true) or has scrolled up, is near the top or
 * has reached the end (false). The tab bar shrinks while it is true, on every page; on the feed
 * the header also gets out of the way, the way Safari's toolbars do. Each tab keeps its own
 * scroll position, so a change of page starts from "not scrolling down".
 */
function useScrolledDown(pathname: string) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
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
        // Reaching the end brings the header and the full bar back.
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
  }, [pathname]);
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
  // Where the visible header ends, for content that sticks under it (the workout's rest timer).
  // `--header-offset` is the header's height while it shows and 0 once it hides; `--header-band`
  // is the safe-area band such content must then fill itself, on a solid background, because
  // the iOS status bar shows through hollow over anything pinned at the very top.
  useEffect(() => {
    const root = document.documentElement;
    const node = ref.current;
    const apply = () => {
      // Issue #32: the real (fractional) height. `offsetHeight` rounds, and rounding down left a
      // hairline above the stuck timer that content showed through.
      const height = !hidden && node ? node.getBoundingClientRect().height : 0;
      root.style.setProperty('--header-offset', `${height}px`);
      root.style.setProperty('--header-band', height ? '0px' : 'var(--top-chrome)');
    };
    apply();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    if (node) observer?.observe(node);
    return () => observer?.disconnect();
  }, [hidden]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--header-offset');
      document.documentElement.style.removeProperty('--header-band');
    },
    [],
  );
  return (
    <header
      ref={ref}
      onFocusCapture={onReveal}
      // Follows a shifted screen (see `lib/viewport-drift.ts`), on top of its own hide transform.
      style={{ translate: '0 var(--vv-top-shift, 0px)' }}
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

/**
 * The last tab is your profile when social is on (its menu button opens Menu), and Menu itself
 * otherwise, so an account without social still reaches settings in one tap.
 */
const LAST_TAB_HREF = { profile: '/profile', menu: '/menu' } as const;

function OwnProfile() {
  return <ProfileView />;
}

/**
 * The drop of glass behind the open tab. The outer element is where it is (CSS, from these
 * variables and the swipe's progress); the inner one is what it looks like, and is remounted when
 * the tab changes so its squash-and-settle plays once per move, never on the first render.
 */
function BarPill({ cells, index, next, prev }: { cells: number; index: number; next: number; prev: number }) {
  const first = useRef(index);
  if (index !== first.current) first.current = -2;
  return (
    <span
      aria-hidden
      className="glass-bar-pill"
      style={{ '--n': cells, '--i': Math.max(0, index), '--next': next, '--prev': prev, opacity: index < 0 ? 0 : 1 } as CSSProperties}
    >
      <span key={index} className={clsx('glass-bar-drop', first.current === -2 && 'glass-bar-drop-move')} />
    </span>
  );
}

/**
 * How many cells the pill travels to the tab a swipe in `direction` leads to: usually one, two
 * when New post sits between them, none at either end.
 */
function swipeCells(bar: (Tab | typeof NEW_POST)[], from: number, direction: 1 | -1): number {
  for (let index = from + direction; from >= 0 && index >= 0 && index < bar.length; index += direction) {
    if (bar[index] !== NEW_POST) return Math.abs(index - from);
  }
  return 0;
}

/** The tab a swipe in `direction` leads to from the open one, if any. */
function swipeTarget(bar: (Tab | typeof NEW_POST)[], from: number, direction: 1 | -1): Tab | undefined {
  const cells = swipeCells(bar, from, direction);
  const target = cells ? bar[from + direction * cells] : undefined;
  return target && target !== NEW_POST ? target : undefined;
}

/** The tabs with the New post button in the middle. It is a link, not a tab: swiping skips it. */
function withNewPost(tabs: Tab[], canPost: boolean): (Tab | typeof NEW_POST)[] {
  if (!canPost) return tabs;
  const middle = Math.ceil(tabs.length / 2);
  return [...tabs.slice(0, middle), NEW_POST, ...tabs.slice(middle)];
}

/** How close two taps on the profile tab must be to count as a double tap. */
const DOUBLE_TAP_MS = 350;
/** How long the profile tab is held to open "Using the app as". */
const LONG_PRESS_MS = 500;

function TabLink({
  tab: { href, label, icon: Icon, active },
  pathname,
  children,
  picture,
  onDoubleTap,
  onLongPress,
  swipe,
}: {
  tab: Tab;
  pathname: string;
  children?: ReactNode;
  /** This tab is where a swipe forwards (`next`) or back (`prev`) would land. */
  swipe?: 'next' | 'prev';
  /** Shown in place of the icon: the profile tab carries the photo of the identity in use. */
  picture?: ReactNode;
  /** Two taps within a moment. The first tap has already opened the tab. */
  onDoubleTap?: () => void;
  /** Held for half a second, with where the tab is. The tab is not opened. */
  onLongPress?: (from: DOMRect) => void;
}) {
  const lastTap = useRef(0);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  return (
    <Link
      href={href}
      // Each tab keeps its own scroll position; tapping the open tab goes to its top.
      scroll={false}
      {...(onLongPress
        ? {
            onPointerDown: (event: ReactPointerEvent<HTMLAnchorElement>) => {
              pressed.current = false;
              cancelPress();
              const tab = event.currentTarget;
              pressTimer.current = setTimeout(() => {
                pressed.current = true;
                navigator.vibrate?.(10);
                onLongPress(tab.getBoundingClientRect());
              }, LONG_PRESS_MS);
            },
            onPointerUp: cancelPress,
            onPointerLeave: cancelPress,
            onPointerCancel: cancelPress,
            // No system menu for the link under a held finger.
            onContextMenu: (event: ReactMouseEvent) => event.preventDefault(),
            style: { WebkitTouchCallout: 'none' } as CSSProperties,
          }
        : {})}
      onClick={(event) => {
        // The click that ends a long press opens nothing.
        if (pressed.current) {
          pressed.current = false;
          event.preventDefault();
          return;
        }
        const now = Date.now();
        if (onDoubleTap && now - lastTap.current < DOUBLE_TAP_MS) {
          lastTap.current = 0;
          event.preventDefault();
          onDoubleTap();
          return;
        }
        lastTap.current = now;
        if (href === pathname) window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      aria-current={active ? 'page' : undefined}
      data-swipe={swipe}
      className={clsx(
        'tab-cell group relative z-10 flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors duration-200',
        active ? 'text-ink' : 'text-ink-muted',
      )}
    >
      {/* The icon dips under the finger and springs back, as a native tab does. */}
      {picture ? (
        <span
          className={clsx(
            'flex rounded-full transition-transform duration-200 ease-[cubic-bezier(0.3,1.6,0.5,1)] group-active:scale-[0.82]',
            active && 'ring-2 ring-ink ring-offset-1 ring-offset-surface',
          )}
        >
          {picture}
        </span>
      ) : (
        <Icon
          size={21}
          strokeWidth={active ? 2.4 : 2}
          aria-hidden
          className="transition-transform duration-200 ease-[cubic-bezier(0.3,1.6,0.5,1)] group-active:scale-[0.82]"
        />
      )}
      <span className="tab-label">{label}</span>
      {children}
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
  isPage = false,
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
    '/library',
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
    // Spec 041: a page has a Library tab, so its Search sits in the header instead.
    ...(access.social && !isPage
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
    // Spec 041: a page's library, where a person has Food and Training on Home.
    ...(isPage ? [tab('/library', 'Library', LibraryBig, PageLibrary, pathname.startsWith('/library'))] : []),
    access.social
      ? tab(LAST_TAB_HREF.profile, 'Portal', UserRound, OwnProfile, inMenu)
      : tab(LAST_TAB_HREF.menu, 'Menu', Menu, MenuContent, inMenu),
  ];
}

export { PageHeader } from './page-header';

/**
 * "Using the app as", after a long press on the Portal tab: it grows out of the tab the way a
 * portal widget opens. Always in the shell's tree (rendering nothing while closed), so opening it
 * never changes the tree's shape.
 */
function IdentityFolder({ from, onClose }: { from: DOMRect | null; onClose: () => void }) {
  if (!from) return null;
  return (
    <FolderSheet
      from={from}
      label="Using the app as"
      onClose={onClose}
      icon={
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-solid/15 text-accent">
          <Users size={18} aria-hidden />
        </span>
      }
    >
      <IdentitySwitcher inSheet />
    </FolderSheet>
  );
}
