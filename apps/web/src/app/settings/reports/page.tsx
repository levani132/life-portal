'use client';
import { type PortalState, type PostReport } from '@life-portal/shared-types';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { ErrorNote, Spinner } from '../../../components/ui';
import { api } from '../../../lib/api';
import { useAction, useApi } from '../../../lib/hooks';
export default function ReportsPage() {
  return (
    <AppShell>
      <Reports />
    </AppShell>
  );
}
function Reports() {
  const portal = useApi<PortalState>('/portal');
  const allowed =
    portal.data?.cohort === 'developer' &&
    portal.data.access.foodPosts &&
    portal.data.access.social &&
    portal.data.access.nutrition;
  const reports = useApi<PostReport[]>(allowed ? '/posts/reports' : null);
  const action = useAction();
  if (!portal.data) return <Spinner />;
  if (!allowed)
    return <ErrorNote message="Post reports are available to the developer." />;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Post reports"
        subtitle="Latest 100 reports. Removal erases the published food snapshot."
      />
      {action.error && <ErrorNote message={action.error} />}{' '}
      {reports.error ? (
        <ErrorNote message={(reports.error as Error).message} />
      ) : !reports.data ? (
        <Spinner />
      ) : reports.data.length === 0 ? (
        <p className="text-sm text-ink-muted">No reports.</p>
      ) : (
        <div className="space-y-3">
          {reports.data.map((report) => (
            <div className="card p-4" key={report.id}>
              <p className="font-medium">{report.reason}</p>
              <p className="mt-1 break-all text-xs text-ink-faint">
                Post {report.postId} ·{' '}
                {new Date(report.createdAt).toLocaleDateString()}
              </p>
              <button
                className="btn-ghost mt-3 text-rose-300"
                disabled={action.pending}
                onClick={() =>
                  void action.run(
                    async () => {
                      await api.delete(`/posts/reports/${report.id}/post`);
                      await reports.mutate();
                    },
                    { revalidate: false },
                  )
                }
              >
                Remove reported post
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
