'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import {
  FEED_METRICS_RANGES,
  type FeedMetricCounts,
  type FeedMetricsRange,
  type FeedMetricsReport,
  type PerMille,
  type PortalState,
} from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { ErrorNote, Spinner } from '../../../components/ui';
import { useApi } from '../../../lib/hooks';

export default function ForYouMetricsPage() {
  return (
    <AppShell>
      <ForYouMetrics />
    </AppShell>
  );
}

/** A rate per thousand as a percentage, or why there is none. */
function rateText(rate: PerMille) {
  return rate === null ? 'too few' : `${(rate / 10).toFixed(1)}%`;
}

const COLUMNS: [keyof FeedMetricCounts, string][] = [
  ['impression', 'Seen'],
  ['like', 'Likes'],
  ['comment', 'Comments'],
  ['repost', 'Reposts'],
  ['notInterested', 'Not interested'],
  ['videoStart', 'Video starts'],
  ['video100', 'Finished'],
  ['quickSkip', 'Quick skips'],
];

/**
 * For You measurement (#11), developer only: daily aggregate counts. Nothing here is per account;
 * a rate is only shown over at least `minDenominator` impressions, starts or visitors.
 */
function ForYouMetrics() {
  const portal = useApi<PortalState>('/portal');
  const [range, setRange] = useState<FeedMetricsRange>(7);
  const allowed = portal.data?.cohort === 'developer';
  const report = useApi<FeedMetricsReport>(allowed ? `/posts/for-you/metrics/report?range=${range}` : null);
  if (!portal.data) return <Spinner />;
  if (!allowed) return <ErrorNote message="For You measurement is available to the developer." />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="For You measurement"
        subtitle={
          portal.data.access.forYouMetrics
            ? 'Collecting for accounts where it is turned on and not opted out.'
            : 'Not collecting for your account. Turn on “For You measurement” in Feature access to start.'
        }
      />
      <div className="mb-4 flex gap-2" role="group" aria-label="Range">
        {FEED_METRICS_RANGES.map((days) => (
          <button
            key={days}
            type="button"
            aria-pressed={range === days}
            onClick={() => setRange(days)}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-sm font-medium',
              range === days ? 'border-transparent bg-accent-solid text-on-accent' : 'border-border text-ink-muted',
            )}
          >
            {days} days
          </button>
        ))}
      </div>
      {report.error ? (
        <ErrorNote message={(report.error as Error).message} />
      ) : !report.data ? (
        <Spinner />
      ) : (
        <Report report={report.data} />
      )}
    </div>
  );
}

function Report({ report }: { report: FeedMetricsReport }) {
  const { totals } = report;
  return (
    <div className="space-y-5">
      <section className="card p-4">
        <h2 className="text-sm font-semibold">
          {formatDay(report.from)} – {formatDay(report.to)}
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {COLUMNS.map(([key, label]) => (
            <div key={key}>
              <dt className="text-xs text-ink-faint">{label}</dt>
              <dd className="font-semibold tabular-nums">{totals.counts[key] ?? 0}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-muted">
          Engagement {rateText(totals.engagementRate)} · finished {rateText(totals.completionRate)} ·
          quick skips {rateText(totals.quickSkipRate)}. Rates need at least {report.minDenominator}{' '}
          seen posts or video starts.
        </p>
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="text-sm font-semibold">By day</h2>
        {report.days.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nothing counted in this range.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-ink-faint">
              <tr>
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 font-medium">Seen</th>
                <th className="py-1 font-medium">Visitors</th>
                <th className="py-1 font-medium">Returning</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {report.days.map((day) => (
                <tr key={day.day} className="border-t border-border/60">
                  <td className="py-1.5">{formatDay(day.day)}</td>
                  <td>{day.counts.impression ?? 0}</td>
                  <td>{day.visitors}</td>
                  <td>
                    {day.returningVisitors} ({rateText(day.returningRate)})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="text-sm font-semibold">Most seen posts</h2>
        <p className="mt-1 text-xs text-ink-muted">Counts per post across everyone, never per viewer.</p>
        {report.posts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No posts yet.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs text-ink-faint">
              <tr>
                <th className="py-1 font-medium">Post</th>
                <th className="py-1 font-medium">Seen</th>
                <th className="py-1 font-medium">Engagement</th>
                <th className="py-1 font-medium">Finished</th>
                <th className="py-1 font-medium">Quick skips</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {report.posts.map((post) => (
                <tr key={post.postId} className="border-t border-border/60">
                  <td className="py-1.5">
                    <Link href={`/posts/${post.postId}`} className="text-accent">
                      Open
                    </Link>
                  </td>
                  <td>{post.counts.impression ?? 0}</td>
                  <td>{rateText(post.engagementRate)}</td>
                  <td>{rateText(post.completionRate)}</td>
                  <td>{rateText(post.quickSkipRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
