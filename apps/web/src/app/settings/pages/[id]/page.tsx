'use client';

import { useParams } from 'next/navigation';
import type { MyPages, NotificationPreferences } from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../../../components/app-shell';
import { ErrorNote, Spinner } from '../../../../components/ui';
import { api } from '../../../../lib/api';
import { revalidate, useAction, useApi } from '../../../../lib/hooks';

export default function ManagePageScreen() {
  return (
    <AppShell>
      <ManagePage />
    </AppShell>
  );
}

/**
 * Spec 045: one page, for its managers: how its notifications reach you (and, in later slices,
 * its insights, pinned post and managers).
 */
function ManagePage() {
  const { id } = useParams<{ id: string }>();
  const mine = useApi<MyPages>('/pages');
  if (mine.error) return <ErrorNote message={(mine.error as Error).message} />;
  if (!mine.data) return <Spinner />;
  const page = mine.data.pages.find((row) => row.id === id);
  if (!page) return <ErrorNote message="You do not manage this page." />;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={page.name} subtitle={`@${page.username}`} />
      <PageNotifications pageId={page.id} name={page.name} />
    </div>
  );
}

function PageNotifications({ pageId, name }: { pageId: string; name: string }) {
  const prefs = useApi<NotificationPreferences>('/notifications/preferences');
  const action = useAction();
  if (!prefs.data) return null;
  const quiet = prefs.data.pagesWhileActing.includes(pageId);
  const set = (onlyWhileActing: boolean) =>
    void action.run(
      async () => {
        await api.put(`/notifications/pages/${pageId}`, { onlyWhileActing });
        await revalidate('/notifications/preferences');
      },
      { revalidate: false },
    );
  const option = (value: boolean, label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input type="radio" name="page-notifications" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--accent))]" checked={quiet === value} disabled={action.pending} onChange={() => set(value)} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">Notifications</h2>
      <div className="mt-1 divide-y divide-border">
        {option(false, 'Always', `Comments, messages and follows on ${name} reach this phone whoever you are using the app as.`)}
        {option(true, `Only while using the app as ${name}`, 'Quiet while you use the app as yourself or another page. Your own notifications always arrive.')}
      </div>
      {action.error && <ErrorNote message={action.error} />}
    </section>
  );
}
