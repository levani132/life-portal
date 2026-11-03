'use client';
import { AppShell, PageHeader } from '../../components/app-shell';
import { ActivityList } from '../../components/notifications';

export default function ActivityPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Activity" subtitle="Friend requests, comments and likes from the last 30 days." />
        <ActivityList />
      </div>
    </AppShell>
  );
}
