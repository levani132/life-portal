'use client';
import { REPORT_REASON_LABELS, type ModerationItem, type ModerationQueue, type PortalState } from '@life-portal/shared-types';
import Link from 'next/link';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { PostMediaCarousel } from '../../../components/post-media';
import { Chip, ErrorNote, Spinner } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useAction, useApi } from '../../../lib/hooks';

export default function ReportsPage() {
  return (
    <AppShell>
      <Review />
    </AppShell>
  );
}

const HELD: Record<NonNullable<ModerationItem['held']>, string> = {
  check: 'Hidden: the photo check flagged it',
  reports: 'Hidden: reported',
  checking: 'Hidden: the photo check has not finished',
};
const AUDIENCE: Record<ModerationItem['audience'], string> = { public: 'Public', friends: 'Friends', private: 'Private' };

/** The review queue (spec 039): what the automatic check or people flagged, with the post itself. */
function Review() {
  const portal = useApi<PortalState>('/portal');
  const allowed =
    portal.data?.cohort === 'developer' &&
    portal.data.access.foodPosts &&
    portal.data.access.social &&
    portal.data.access.nutrition;
  const queue = useApi<ModerationQueue>(allowed ? '/posts/moderation' : null);
  const action = useAction();
  if (!portal.data) return <Spinner />;
  if (!allowed) return <ErrorNote message="The review queue is available to the developer." />;

  const act = (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    void action.run(
      async () => {
        await fn();
        await queue.mutate();
      },
      { revalidate: false },
    );
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Review queue"
        subtitle="Posts people reported or the photo check flagged. A hidden post is seen only by its author until you decide."
      />
      {queue.data && !queue.data.imageCheck && (
        <p className="card mb-4 p-4 text-sm text-warning">
          Photos are not being checked automatically on this server: the check has no key yet. Reports still work.
        </p>
      )}
      {action.error && <ErrorNote message={action.error} />}
      {queue.error ? (
        <ErrorNote message={(queue.error as Error).message} />
      ) : !queue.data ? (
        <Spinner />
      ) : queue.data.items.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing is waiting.</p>
      ) : (
        <div className="space-y-4">
          {queue.data.items.map((item) => (
            <article className="card p-4" key={item.postId}>
              <div className="flex flex-wrap items-center gap-2">
                {item.held && <Chip tone="bad">{HELD[item.held]}</Chip>}
                {item.reportCount > 0 && (
                  <Chip tone="warn">
                    {item.reportCount} {item.reportCount === 1 ? 'report' : 'reports'}
                  </Chip>
                )}
                <Chip>{item.linkOnly ? 'Link only' : AUDIENCE[item.audience]}</Chip>
              </div>
              <p className="mt-3 text-sm">
                <Link href={`/people/${item.author.id}`} className="font-semibold hover:text-accent-hover">
                  {item.author.displayName}
                </Link>
                {item.author.username && <span className="text-ink-faint"> @{item.author.username}</span>}
                <span className="text-ink-faint"> · {new Date(item.createdAt).toLocaleString()}</span>
                {item.author.suspended && <span className="ml-2 text-danger">Suspended</span>}
              </p>
              {item.title && <h2 className="mt-2 break-words font-semibold">{item.title}</h2>}
              {item.caption && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-muted">{item.caption}</p>}
              {item.attachment && <p className="mt-1 text-xs text-ink-faint">Attached: {item.attachment}</p>}
              {item.media.length > 0 && (
                <div className="mt-3">
                  <PostMediaCarousel media={item.media} />
                </div>
              )}
              {(item.reports.length > 0 || item.checkCategories) && (
                <ul className="mt-3 space-y-0.5 text-xs text-ink-muted">
                  {item.checkCategories && <li>Photo check: {item.checkCategories.join(', ')}</li>}
                  {item.reports.map((report) => (
                    <li key={report.reason}>
                      {REPORT_REASON_LABELS[report.reason]}
                      {report.count > 1 ? ` × ${report.count}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="btn-ghost"
                  disabled={action.pending}
                  onClick={() => act(() => api.post(`/posts/moderation/${item.postId}/keep`))}
                >
                  Keep the post
                </button>
                <button
                  className="btn-danger"
                  disabled={action.pending}
                  onClick={() => act(() => api.delete(`/posts/moderation/${item.postId}`), 'Remove this post for good? Its text and photos are erased.')}
                >
                  Remove the post
                </button>
                {item.author.suspended ? (
                  <button
                    className="btn-ghost"
                    disabled={action.pending}
                    onClick={() => act(() => api.post(`/auth/accounts/${item.author.id}/unsuspend`))}
                  >
                    Restore the account
                  </button>
                ) : (
                  <button
                    className="btn-ghost text-danger"
                    disabled={action.pending}
                    onClick={() =>
                      act(
                        () => api.post(`/auth/accounts/${item.author.id}/suspend`, { reason: `Post ${item.postId}` }),
                        `Suspend ${item.author.displayName}? They are signed out everywhere, cannot sign in, and nothing they posted is shown.`,
                      )
                    }
                  >
                    Suspend the account
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
