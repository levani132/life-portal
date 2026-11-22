'use client';

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
    </AppShell>
  );
}
