'use client';
import { AppShell, PageHeader } from '../../components/app-shell';
import { Inbox } from '../../components/messages';

export default function MessagesPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Messages" subtitle="Private conversations with your friends." />
        <Inbox />
      </div>
    </AppShell>
  );
}
