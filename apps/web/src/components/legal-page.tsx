import Link from 'next/link';
import type { ReactNode } from 'react';
import { LEGAL_VERSION } from '@life-portal/shared-types';
import { Wordmark } from './wordmark';

const PAGES = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/rules', label: 'Community rules' },
];

/** The frame of the three public documents: readable signed in or not, and by a search engine. */
export function LegalPage({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-5 pb-16 pt-[max(1.5rem,var(--top-chrome))]">
      <header className="mb-8">
        <Link href="/" className="text-lg" aria-label="Back to the app">
          <Wordmark />
        </Link>
        <nav aria-label="Documents" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {PAGES.map((page) => (
            <Link key={page.href} href={page.href} className="text-accent hover:underline">
              {page.label}
            </Link>
          ))}
        </nav>
        <h1 className="mt-6 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-xs text-ink-faint">In force from {LEGAL_VERSION}</p>
        <p className="mt-4 text-sm leading-relaxed text-ink-muted">{lead}</p>
      </header>
      <div className="space-y-8">{children}</div>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-ink-muted [&_a]:text-accent [&_a:hover]:underline [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}

/** The one-line agreement shown wherever an account can be created. */
export function LegalAgreement({ action }: { action: string }) {
  return (
    <p className="text-center text-xs leading-relaxed text-ink-faint">
      By {action} you agree to the{' '}
      <Link href="/terms" className="text-accent hover:underline">Terms</Link>, the{' '}
      <Link href="/privacy" className="text-accent hover:underline">Privacy Policy</Link> and the{' '}
      <Link href="/rules" className="text-accent hover:underline">Community Rules</Link>, and confirm you are 16 or older.
    </p>
  );
}
