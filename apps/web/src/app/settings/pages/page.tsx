'use client';

import Link from 'next/link';
import type { AssistantOverview, AssistantPageStatus, PortalState } from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { Avatar } from '../../../components/avatar';
import { OfficialMark } from '../../../components/follow';
import { ErrorNote, Spinner } from '../../../components/ui';
import { api } from '../../../lib/api';
import { revalidate, useAction, useApi } from '../../../lib/hooks';

export default function PagesOverviewPage() {
  return (
    <AppShell>
      <PagesOverview />
    </AppShell>
  );
}

/** What needs a look comes first: failures, then pages the assistant cannot use, then the rest. */
const rank = (page: AssistantPageStatus) => (page.failed ? 0 : page.suspended || page.disabled || !page.runWithAi ? 1 : 2);

/**
 * Spec 041: every page you manage on one screen, with what the assistant published today, what
 * is waiting and what failed in the last day. Counts and reasons only.
 */
function PagesOverview() {
  const portal = useApi<PortalState>('/portal');
  const overview = useApi<AssistantOverview>('/page-assistant/overview', { refreshInterval: 60_000, revalidateOnFocus: true });
  const action = useAction();
  if (overview.error) return <ErrorNote message={(overview.error as Error).message} />;
  if (!overview.data) return <Spinner />;
  const pages = [...overview.data.pages].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const total = (pick: (page: AssistantPageStatus) => number) => pages.reduce((sum, page) => sum + pick(page), 0);
  const unmarked = pages.filter((page) => !page.official).length;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Your pages" subtitle="What the assistant did today as each page, what is waiting, and what failed." />
      {!overview.data.allowed && (
        <p className="card mb-4 p-4 text-sm text-warning">
          An assistant is not allowed to manage your pages. Turn it on in Menu → AI assistant connections.
        </p>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Pages" value={pages.length} />
        <Figure label="Posts today" value={total((page) => page.postsToday)} />
        <Figure label="Waiting" value={total((page) => page.queued)} />
        <Figure label="Failed, last day" value={total((page) => page.failed)} bad={total((page) => page.failed) > 0} />
      </div>
      {portal.data?.cohort === 'developer' && unmarked > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
          <span>
            {unmarked} of your pages {unmarked === 1 ? 'is' : 'are'} not marked official.
          </span>
          <button
            type="button"
            className="btn-ghost"
            disabled={action.pending}
            onClick={() =>
              void action.run(
                async () => {
                  await api.put('/page-assistant/official', {});
                  await Promise.all([revalidate('/page-assistant'), revalidate('/pages')]);
                },
                { revalidate: false },
              )
            }
          >
            Mark all official
          </button>
        </div>
      )}
      {action.error && <ErrorNote message={action.error} />}
      {pages.length === 0 ? (
        <p className="text-sm text-ink-muted">You have no pages yet.</p>
      ) : (
        <ul className="card divide-y divide-border">
          {pages.map((page) => (
            <li key={page.id} className="flex items-start gap-3 px-4 py-3 text-sm">
              <Avatar name={page.name} url={page.avatarUrl} size={36} />
              <div className="flex-1">
                <p className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/people/${page.id}`} className="font-medium hover:text-accent-hover">
                    {page.name}
                  </Link>
                  {page.official && <OfficialMark />}
                  {page.suspended && <span className="text-xs font-semibold text-danger">Suspended</span>}
                  {page.disabled && <span className="text-xs font-semibold text-warning">Switched off</span>}
                  {!page.runWithAi && <span className="text-xs text-ink-faint">not run with AI</span>}
                </p>
                <p className="text-xs text-ink-faint">
                  @{page.username} · {page.postsToday} posted today · {page.queued} waiting
                  {page.lastActionAt ? ` · last active ${new Date(page.lastActionAt).toLocaleString()}` : ' · never used by the assistant'}
                </p>
                {page.failed > 0 && (
                  <p className="mt-1 text-xs text-danger">
                    {page.failed} failed in the last day{page.lastError ? `. Latest: ${page.lastError}` : ''}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Figure({ label, value, bad = false }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className={`text-xl font-semibold ${bad ? 'text-danger' : 'text-ink'}`}>{value.toLocaleString()}</p>
    </div>
  );
}
