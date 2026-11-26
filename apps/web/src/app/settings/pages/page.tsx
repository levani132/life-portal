'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AssistantOverview, AssistantPageStatus, AssistantUpcoming, AssistantUpcomingItem, PortalState } from '@life-portal/shared-types';
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
      <ComingUp />
      <h2 className="mb-2 text-sm font-semibold">Pages</h2>
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

/** What each waiting action will do, in words. */
const DOES: Record<string, string> = {
  create_page_post: 'Post',
  publish_page_draft: 'Publish a draft',
  comment_on_post: 'Comment',
  reply_in_conversation: 'Message reply',
  like_post: 'Like a post',
  like_comment: 'Like a comment',
  repost_post: 'Repost',
  follow_page: 'Follow a page',
};

const dayLabel = (at: Date, now: Date) => {
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((day(at) - day(now)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return at.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
};
const clock = (at: Date) => at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Everything the assistant has queued across your pages, by day and time, with the first words
 * of each post or comment; then what failed in the last day. Anything waiting can be called off.
 */
function ComingUp() {
  const upcoming = useApi<AssistantUpcoming>('/page-assistant/upcoming', { refreshInterval: 60_000, revalidateOnFocus: true });
  const action = useAction();
  const [showAll, setShowAll] = useState(false);
  if (!upcoming.data) return upcoming.error ? <ErrorNote message={(upcoming.error as Error).message} /> : null;
  const waiting = upcoming.data.items.filter((item) => item.status !== 'failed');
  const failed = upcoming.data.items.filter((item) => item.status === 'failed');
  const now = new Date();
  const shown = showAll ? waiting : waiting.slice(0, 30);
  const days: { label: string; items: AssistantUpcomingItem[] }[] = [];
  for (const item of shown) {
    const label = dayLabel(new Date(item.at), now);
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1)?.items.push(item);
  }
  const cancel = (item: AssistantUpcomingItem) =>
    void action.run(
      async () => {
        await api.delete(`/page-assistant/scheduled/${item.id}`);
        await Promise.all([revalidate('/page-assistant/upcoming'), revalidate('/page-assistant/overview')]);
      },
      { revalidate: false },
    );
  return (
    <section className="mb-4">
      <h2 className="mb-2 text-sm font-semibold">Coming up</h2>
      {waiting.length === 0 ? (
        <p className="card p-4 text-sm text-ink-muted">Nothing is waiting. Posts the assistant schedules appear here with their time.</p>
      ) : (
        <div className="card divide-y divide-border">
          {days.map((day) => (
            <div key={day.label} className="px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{day.label}</p>
              <ul className="space-y-3">
                {day.items.map((item) => (
                  <UpcomingRow key={item.id} item={item} onCancel={item.status === 'pending' ? () => cancel(item) : undefined} pending={action.pending} />
                ))}
              </ul>
            </div>
          ))}
          {waiting.length > shown.length && (
            <button type="button" className="btn-ghost w-full justify-center py-2 text-sm" onClick={() => setShowAll(true)}>
              Show all {waiting.length}
            </button>
          )}
        </div>
      )}
      {action.error && <ErrorNote message={action.error} />}
      {failed.length > 0 && (
        <>
          <h2 className="mb-2 mt-4 text-sm font-semibold text-danger">Failed in the last day</h2>
          <ul className="card space-y-3 px-4 py-3">
            {failed.map((item) => (
              <UpcomingRow key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function UpcomingRow({ item, onCancel, pending = false }: { item: AssistantUpcomingItem; onCancel?: () => void; pending?: boolean }) {
  const at = new Date(item.at);
  const extras = [...(item.photos ? [`${item.photos} ${item.photos === 1 ? 'photo' : 'photos'}`] : []), ...(item.attaches ?? [])];
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className="w-16 shrink-0 whitespace-nowrap pt-0.5 text-xs font-semibold tabular text-ink-muted">{clock(at)}</span>
      <Avatar name={item.pageName} url={item.avatarUrl} size={28} />
      <div className="flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink-faint">
          <Link href={`/people/${item.pageId}`} className="font-medium text-ink hover:text-accent-hover">
            {item.pageName}
          </Link>
          <span>· {DOES[item.tool] ?? item.tool.replace(/_/g, ' ')}</span>
          {item.status === 'running' && <span className="text-accent">· happening now</span>}
          {item.status === 'failed' && <span>· was due {at.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</span>}
        </p>
        {item.preview && <p className="mt-0.5 line-clamp-2">{item.preview}</p>}
        {extras.length > 0 && <p className="mt-0.5 text-xs text-ink-muted">With {extras.join(', ')}</p>}
        {item.error && <p className="mt-0.5 text-xs text-danger">{item.error}</p>}
      </div>
      {onCancel && (
        <button type="button" className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted hover:text-danger" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      )}
    </li>
  );
}
