'use client';
import { AppShell } from '../../components/app-shell';
import { ActivityList } from '../../components/notifications';

export default function ActivityPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <ActivityList />
      </div>
    </AppShell>
  );
}
