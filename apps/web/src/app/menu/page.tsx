'use client';
import Link from 'next/link';
import {
  ChevronRight,
  Layers,
  LockKeyhole,
  Settings,
  Sparkles,
  Plug,
  Flag,
  UserRound,
} from 'lucide-react';
import { MODULES, type PortalState } from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../components/app-shell';
import { useAuth } from '../../lib/auth-context';
import { useApi } from '../../lib/hooks';
export default function MenuPage() {
  return (
    <AppShell>
      <MenuContent />
    </AppShell>
  );
}
function MenuContent() {
  const { user, logout } = useAuth();
  const { data } = useApi<PortalState>('/portal');
  const links = [
    ...(data?.access.social
      ? [{ href: '/profile', label: 'My profile', icon: UserRound }]
      : []),
    { href: '/settings/modules', label: 'Manage modules', icon: Layers },
    {
      href: '/settings/privacy',
      label: 'Privacy and sharing',
      icon: LockKeyhole,
    },
    {
      href: '/setup',
      label: data?.setupCompleted ? 'Revisit setup' : 'Continue setup',
      icon: Sparkles,
    },
    { href: '/settings', label: 'Settings', icon: Settings },
    ...(data?.access.nutrition
      ? [
          {
            href: '/settings/mcp',
            label: 'AI assistant connections',
            icon: Plug,
          },
        ]
      : []),
    ...(data?.cohort === 'developer'
      ? [
          { href: '/settings/access', label: 'Feature access', icon: Flag },
          ...(data.access.foodPosts &&
          data.access.social &&
          data.access.nutrition
            ? [{ href: '/settings/reports', label: 'Post reports', icon: Flag }]
            : []),
        ]
      : []),
  ];
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Menu" subtitle={user?.name} />
      <div className="card divide-y divide-border">
        {links.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-16 items-center gap-3 px-5 py-4 hover:bg-surface-raised"
          >
            <Icon size={20} className="text-sky-300" />
            <span className="flex-1">{label}</span>
            <ChevronRight size={18} className="text-ink-faint" />
          </Link>
        ))}
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold">Your modules</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {MODULES.filter(
          (m) => data?.access[m.id] && data.selectedModules.includes(m.id),
        ).map((m) => (
          <Link
            key={m.id}
            href={m.href}
            className="card p-4 hover:border-sky-500/40"
          >
            {m.name}
            <p className="mt-1 text-xs text-ink-muted">{m.description}</p>
          </Link>
        ))}
      </div>
      <button type="button" className="btn mt-8" onClick={() => void logout()}>
        Sign out
      </button>
    </div>
  );
}
