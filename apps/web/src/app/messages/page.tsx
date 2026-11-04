'use client';
import { AppShell } from '../../components/app-shell';
import { Inbox } from '../../components/messages';

export default function MessagesPage() {
  return (
    <AppShell>
      <Inbox />
    </AppShell>
  );
}
