'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { Bookmark, Eye, Heart, MessageCircle, Repeat2 } from 'lucide-react';
import type { MyPages, NotificationPreferences, PageInsights, PageManagers } from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../../../components/app-shell';
import { Avatar } from '../../../../components/avatar';
import { ErrorNote, Input, Spinner } from '../../../../components/ui';
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
      <Insights pageId={page.id} />
      <Managers pageId={page.id} name={page.name} />
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

const n = (value: number) => value.toLocaleString('en-GB');

/** Spec 045: followers and what the page's posts did, counts only. */
function Insights({ pageId }: { pageId: string }) {
  const data = useApi<PageInsights>(`/page-insights/${pageId}`);
  if (data.error) return <ErrorNote message={(data.error as Error).message} />;
  if (!data.data) return <Spinner />;
  const { followers, totals, newFollowersByDay, posts, days } = data.data;
  const most = Math.max(1, ...newFollowersByDay.map((row) => row.count));
  const tile = (label: string, value: number, note?: string) => (
    <div className="rounded-xl bg-surface px-3 py-2">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="text-lg font-semibold tabular">{n(value)}</p>
      {note && <p className="text-[11px] text-ink-faint">{note}</p>}
    </div>
  );
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">Insights</h2>
      <p className="text-xs text-ink-muted">The last {days} days. A view is one person seeing a post, once a day.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tile('Followers', followers, totals.newFollowers ? `+${n(totals.newFollowers)} new` : undefined)}
        {tile('Views', totals.views)}
        {tile('Likes', totals.likes)}
        {tile('Comments', totals.comments)}
        {tile('Reposts', totals.reposts)}
      </div>
      <p className="mt-4 text-xs text-ink-muted">New followers per day</p>
      <div className="mt-1 flex h-12 items-end gap-0.5" aria-label={`New followers per day, the last ${days} days`}>
        {newFollowersByDay.map((row) => (
          <span
            key={row.day}
            title={`${row.day}: ${row.count}`}
            className={`flex-1 rounded-sm ${row.count ? 'bg-accent-solid' : 'bg-border'}`}
            style={{ height: row.count ? `${Math.max(12, (row.count / most) * 100)}%` : '4px' }}
          />
        ))}
      </div>
      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-ink-faint">Posts</h3>
      {posts.length === 0 ? (
        <p className="mt-1 text-sm text-ink-muted">No posts yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {posts.map((post) => (
            <li key={post.id} className="py-2.5">
              <Link href={`/posts/${post.id}`} className="block truncate text-sm font-medium hover:text-accent-hover">
                {post.label}
              </Link>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>{new Date(post.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                <span className="flex items-center gap-1" title="Views"><Eye size={12} aria-hidden="true" />{n(post.views)}</span>
                <span className="flex items-center gap-1" title="Likes"><Heart size={12} aria-hidden="true" />{n(post.likes)}</span>
                <span className="flex items-center gap-1" title="Comments"><MessageCircle size={12} aria-hidden="true" />{n(post.comments)}</span>
                <span className="flex items-center gap-1" title="Reposts"><Repeat2 size={12} aria-hidden="true" />{n(post.reposts)}</span>
                <span className="flex items-center gap-1" title="Saved by"><Bookmark size={12} aria-hidden="true" />{n(post.saves)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Spec 045: who runs the page with you, invitations, and leaving. */
function Managers({ pageId, name }: { pageId: string; name: string }) {
  const key = `/pages/${pageId}/managers`;
  const data = useApi<PageManagers>(key);
  const action = useAction();
  const router = useRouter();
  const [username, setUsername] = useState('');
  if (!data.data) return data.error ? <ErrorNote message={(data.error as Error).message} /> : null;
  const youOwn = data.data.managers.some((manager) => manager.you && manager.owner);
  const run = (work: () => Promise<unknown>, after?: () => void) =>
    void action
      .run(
        async () => {
          await work();
          await Promise.all([revalidate(key), revalidate('/pages')]);
        },
        { revalidate: false },
      )
      .then((ok) => ok && after?.());
  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">Managers</h2>
      <p className="text-xs text-ink-muted">
        Everyone here can post, answer and invite as {name}. The owner can also remove managers, delete the page and make someone else the owner.
      </p>
      <ul className="mt-2 divide-y divide-border">
        {data.data.managers.map((manager) => (
          <li key={manager.userId} className="flex items-center gap-3 py-2.5">
            <Avatar name={manager.name} url={manager.avatarUrl} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {manager.name}
                {manager.you && <span className="ml-1 text-ink-faint">(you)</span>}
              </span>
              <span className="block truncate text-xs text-ink-faint">{manager.owner ? 'Owner' : manager.username ? `@${manager.username}` : 'Manager'}</span>
            </span>
            {youOwn && !manager.you && (
              <button
                type="button"
                className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
                disabled={action.pending}
                onClick={() => {
                  if (!window.confirm(`Make ${manager.name} the owner of ${name}? You stay a manager, but only they can then remove managers, delete the page or hand it on.`)) return;
                  run(() => api.put(`/pages/${pageId}/owner`, { personId: manager.userId }));
                }}
              >
                Make owner
              </button>
            )}
            {manager.mayRemove && (
              <button
                type="button"
                className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted hover:text-danger"
                disabled={action.pending}
                onClick={() => {
                  if (!window.confirm(manager.you ? `Leave ${name}? You will no longer be able to use the app as it.` : `Remove ${manager.name} from ${name}?`)) return;
                  run(() => api.delete(`${key.replace('/managers', '')}/managers/${manager.userId}`), manager.you ? () => router.replace('/menu') : undefined);
                }}
              >
                {manager.you ? 'Leave' : 'Remove'}
              </button>
            )}
          </li>
        ))}
        {data.data.invites.map((invite) => (
          <li key={invite.id} className="flex items-center gap-3 py-2.5">
            <Avatar name={invite.name} url={invite.avatarUrl} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{invite.name}</span>
              <span className="block truncate text-xs text-ink-faint">Invited, waiting for an answer</span>
            </span>
            <button
              type="button"
              className="shrink-0 rounded-full border border-border px-2.5 py-1 text-xs text-ink-muted hover:text-danger"
              disabled={action.pending}
              onClick={() => run(() => api.delete(`/pages/${pageId}/invites/${invite.id}`))}
            >
              Cancel
            </button>
          </li>
        ))}
      </ul>
      {youOwn && data.data.managers.length > 1 && <p className="mt-1 text-xs text-ink-faint">To leave, make another manager the owner first.</p>}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = username.trim().replace(/^@/, '');
          if (value) run(() => api.post(key, { username: value }), () => setUsername(''));
        }}
      >
        <Input aria-label="Username to invite" placeholder="Invite by username" value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none" autoCorrect="off" />
        <button type="submit" className="btn-primary shrink-0" disabled={action.pending || !username.trim()}>
          Invite
        </button>
      </form>
      {action.error && <ErrorNote message={action.error} />}
    </section>
  );
}
