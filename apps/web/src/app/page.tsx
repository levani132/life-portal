'use client';
import { AppShell } from '../components/app-shell';
import { Dashboard } from '../components/home-dashboard';

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
