'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth-context';
import { useApi } from '../lib/hooks';
import { PortalLoader } from './portal-loader';
import { PullToRefresh } from './pull-to-refresh';
import type { Board } from '@life-portal/shared-types';

const CORE_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/loans', label: 'Debts' },
  { href: '/cashflow', label: 'Free money' },
  { href: '/items', label: 'Items' },
  { href: '/stocks', label: 'Stocks' },
  { href: '/personal', label: 'Personal' },
  { href: '/nutrition', label: 'Food' },
  { href: '/settings', label: 'Settings' },
];

/**
 * Wraps every authenticated page: redirects to login when there is no session, and renders
 * the nav. Board links come from the API rather than a constant, so adding a board in the app
 * adds its nav entry without a deploy (constitution principle I).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // The header is sticky; the shadow appearing once content passes under it is what makes that
  // read as "pinned" rather than "hasn't moved yet".
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // A menu left open across a navigation covers the page you just asked for.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const { data } = useApi<{ boards: Board[] }>(user ? '/boards' : null);

  if (loading) return <PortalLoader label="Loading your portal…" />;
  if (!user) return null;

  const boardLinks = (data?.boards ?? []).map((board) => ({
    href: `/boards/${board.key}`,
    label: board.name,
  }));

  const links = [...CORE_LINKS, ...boardLinks];

  return (
    <div className="min-h-screen">
      <header
        className={clsx(
          'sticky top-0 z-40 border-b border-border bg-surface/90 pt-[env(safe-area-inset-top)] backdrop-blur transition-shadow',
          scrolled && 'shadow-lg shadow-black/30',
        )}
      >
        <div className="mx-auto max-w-7xl px-4 py-2.5 lg:flex lg:items-center lg:gap-x-6 lg:py-3">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight"
              onClick={() => setMenuOpen(false)}
            >
              <Logo />
              Life<span className="-ml-1.5 text-sky-400">Portal</span>
            </Link>

            {/*
             * Eleven links do not fit on a phone in any arrangement worth having: wrapped they ate
             * four rows and pushed the content off the fold, and a horizontal scroller hid half of
             * them behind a gesture nobody discovers. So: a menu below lg, the full row above it.
             */}
            <div className="flex items-center gap-3 lg:hidden">
              <span className="text-xs text-ink-faint">{user.name}</span>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-controls="widget-menu"
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                className="-mr-1 flex h-9 w-9 items-center justify-center rounded-lg border border-border text-ink-muted transition active:scale-95"
              >
                <MenuIcon open={menuOpen} />
              </button>
            </div>
          </div>

          <nav
            id="widget-menu"
            aria-label="Widgets"
            className={clsx(
              'gap-1 text-sm',
              // Below lg the menu is a two-column grid, so every widget is one tap away.
              menuOpen ? 'mt-2 grid grid-cols-2 border-t border-border pt-2' : 'hidden',
              'lg:mt-0 lg:flex lg:flex-1 lg:flex-wrap lg:items-center lg:border-0 lg:pt-0',
            )}
          >
            {links.map((link) => {
              const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={clsx(
                    'truncate rounded-lg px-2.5 py-2 transition lg:py-1.5',
                    active ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg px-2.5 py-2 text-left text-ink-faint transition hover:text-ink lg:hidden"
            >
              Sign out
            </button>
          </nav>

          <div className="hidden items-center gap-3 text-xs text-ink-faint lg:flex">
            <span>{user.name}</span>
            <button type="button" onClick={() => void logout()} className="hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <PullToRefresh>
        <main className="mx-auto max-w-7xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          {children}
        </main>
      </PullToRefresh>
    </div>
  );
}

/**
 * Menu / close icon.
 *
 * Drawn as an SVG with `width`/`height` **attributes** rather than three hairline `<span>`s sized
 * by `h-0.5`: the first version rendered 16×0 and became invisible whenever the stylesheet was
 * missing those utilities. An SVG carries its own geometry and needs no CSS to have a size.
 */
function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
      focusable="false"
    >
      {open ? (
        <>
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </>
      ) : (
        <>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </>
      )}
    </svg>
  );
}

/** The app mark, so the header matches the installed icon. */
function Logo() {
  return (
    <svg viewBox="0 0 512 512" width="20" height="20" aria-hidden focusable="false">
      <circle cx="256" cy="256" r="150" fill="none" stroke="rgb(40 45 58)" strokeWidth="52" />
      <circle
        cx="256"
        cy="256"
        r="150"
        fill="none"
        stroke="rgb(56 189 248)"
        strokeWidth="52"
        strokeLinecap="round"
        strokeDasharray="707 943"
        transform="rotate(-215 256 256)"
      />
      <g fill="rgb(52 211 153)">
        <rect x="188" y="286" width="34" height="62" rx="14" />
        <rect x="239" y="248" width="34" height="100" rx="14" />
        <rect x="290" y="200" width="34" height="148" rx="14" />
      </g>
    </svg>
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
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
