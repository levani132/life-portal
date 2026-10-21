'use client';
import { FoodSharingControls } from '../../../components/food-sharing-controls';
import { AppShell } from '../../../components/app-shell';
import { PortalPreferencesPanel } from '../../../components/portal-preferences';
export default function PrivacyPage() {
  return (
    <AppShell>
      <PortalPreferencesPanel mode="privacy" />
      <div className="mx-auto max-w-2xl">
        <FoodSharingControls />
      </div>
    </AppShell>
  );
}
