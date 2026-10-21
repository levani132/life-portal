'use client';
import { AppShell } from '../../../components/app-shell';
import { PortalPreferencesPanel } from '../../../components/portal-preferences';
export default function ModulesPage() {
  return (
    <AppShell>
      <PortalPreferencesPanel mode="modules" />
    </AppShell>
  );
}
