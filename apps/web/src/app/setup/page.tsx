'use client';
import { AppShell } from '../../components/app-shell';
import { PortalPreferencesPanel } from '../../components/portal-preferences';
export default function SetupPage() {
  return (
    <AppShell>
      <PortalPreferencesPanel mode="setup" />
    </AppShell>
  );
}
