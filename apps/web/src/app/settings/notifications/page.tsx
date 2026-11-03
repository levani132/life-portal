'use client';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { NotificationSettings } from '../../../components/notifications';

export default function NotificationsSettingsPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title="Notifications"
          subtitle="Choose what reaches your devices. Notifications never show food, weight or money."
        />
        <NotificationSettings />
      </div>
    </AppShell>
  );
}
