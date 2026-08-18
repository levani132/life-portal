'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '../lib/auth-context';
import { useApi } from '../lib/hooks';
import { Spinner } from './ui';
import type { Board } from '@life-portal/shared-types';

const CORE_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/loans', label: 'Debts' },
  { href: '/cashflow', label: 'Free money' },
  { href: '/items', label: 'Items' },
  { href: '/stocks', label: 'Stocks' },
  { href: '/personal', label: 'Personal' },
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

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  const { data } = useApi<{ boards: Board[] }>(user ? '/boards' : null);

  if (loading) return <Spinner label="Loading your portal…" />;
  if (!user) return null;

  const boardLinks = (data?.boards ?? []).map((board) => ({
    href: `/boards/${board.key}`,
    label: board.name,
  }));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Life<span className="text-sky-400">Portal</span>
          </Link>

          <nav className="flex flex-1 flex-wrap items-center gap-1 text-sm">
            {[...CORE_LINKS, ...boardLinks].map((link) => {
              const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={clsx(
                    'rounded-lg px-2.5 py-1.5 transition',
                    active ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3 text-xs text-ink-faint">
            <span className="hidden sm:inline">{user.name}</span>
            <button type="button" onClick={() => void logout()} className="hover:text-ink">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
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
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
