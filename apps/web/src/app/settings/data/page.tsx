'use client';

import Link from 'next/link';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { DeleteAccountPanel, ExportPanel } from '../../../components/account-data';

export default function DataPage() {
  return (
    <AppShell>
      <PageHeader title="Your data and account" subtitle="Take a copy of everything, or leave for good." />
      <div className="grid gap-4 lg:grid-cols-2">
        <ExportPanel />
        <DeleteAccountPanel />
      </div>
      <p className="mt-6 text-center text-xs text-ink-faint">
        <Link href="/terms" className="text-accent hover:underline">Terms</Link>
        {' · '}
        <Link href="/privacy" className="text-accent hover:underline">Privacy policy</Link>
        {' · '}
        <Link href="/rules" className="text-accent hover:underline">Community rules</Link>
      </p>
    </AppShell>
  );
}
