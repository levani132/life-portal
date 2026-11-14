'use client';
import clsx from 'clsx';
import { useState } from 'react';
import {
  SYNC_AGE_BUCKETS,
  SYNC_HEALTH_RANGES,
  type PortalState,
  type SyncAgeBucket,
  type SyncHealthRange,
  type SyncHealthReport,
} from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { ErrorNote, Spinner } from '../../../components/ui';
import { useApi } from '../../../lib/hooks';

export default function SyncHealthPage() {
  return (
    <AppShell>
      <SyncHealth />
    </AppShell>
  );
}

const AGE_LABELS: Record<SyncAgeBucket, string> = {
  under1m: '< 1 min',
  under1h: '< 1 hour',
  under1d: '< 1 day',
  under7d: '< 7 days',
  under30d: '< 30 days',
  older: '30 days +',
};

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

/**
 * Sync health (issue #22), developer only: what offline writes met at the server, as daily
 * counts. Nothing here is per account; see docs/runbooks/offline-sync.md for what each code means.
 */
function SyncHealth() {
  const portal = useApi<PortalState>('/portal');
  const [range, setRange] = useState<SyncHealthRange>(7);
  const allowed = portal.data?.cohort === 'developer';
  const report = useApi<SyncHealthReport>(allowed ? `/sync-health?range=${range}` : null);
  if (!portal.data) return <Spinner />;
  if (!allowed) return <ErrorNote message="Sync health is available to the developer." />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Sync health" subtitle="Writes sent from the offline queue, counted per day. No accounts, content or values." />
      <div className="mb-4 flex gap-2" role="group" aria-label="Range">
        {SYNC_HEALTH_RANGES.map((days) => (
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

function Report({ report }: { report: SyncHealthReport }) {
  const { totals } = report;
  const refused = Object.values(totals.refusals).reduce((sum, count) => sum + count, 0);
  const codes = Object.entries(totals.refusals).sort(([, a], [, b]) => b - a);
  const aged = SYNC_AGE_BUCKETS.reduce((sum, bucket) => sum + (totals.ages[bucket] ?? 0), 0);
  return (
    <div className="space-y-5">
      <section className="card p-4">
        <h2 className="text-sm font-semibold">
          {formatDay(report.from)} – {formatDay(report.to)}
        </h2>
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-ink-faint">Writes</dt>
            <dd className="font-semibold tabular-nums">{totals.writes}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Replayed</dt>
            <dd className="font-semibold tabular-nums">
              {totals.replays} <span className="text-xs font-normal text-ink-muted">({percent(totals.replays, totals.writes)})</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Refused</dt>
            <dd className="font-semibold tabular-nums">
              {refused} <span className="text-xs font-normal text-ink-muted">({percent(refused, totals.writes)})</span>
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-ink-muted">
          With only a few accounts, a day’s counts can still mirror one person’s activity. Kept 90 days.
        </p>
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-semibold">Refusals by code</h2>
        {codes.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">None in this range.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <tbody className="tabular-nums">
              {codes.map(([code, count]) => (
                <tr key={code} className="border-t border-border/60 first:border-t-0">
                  <td className="py-1.5 font-mono text-xs">{code}</td>
                  <td className="text-right">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-4">
        <h2 className="text-sm font-semibold">How long writes waited on the device</h2>
        {aged === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nothing counted in this range.</p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm">
            {SYNC_AGE_BUCKETS.map((bucket) => {
              const count = totals.ages[bucket] ?? 0;
              return (
                <li key={bucket} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-xs text-ink-muted">{AGE_LABELS[bucket]}</span>
                  <span className="h-2 flex-1 rounded-full bg-surface-raised">
                    <span className="block h-2 rounded-full bg-accent-solid" style={{ width: `${(count / aged) * 100}%` }} />
                  </span>
                  <span className="w-10 shrink-0 text-right tabular-nums">{count}</span>
                </li>
              );
            })}
          </ul>
        )}
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
                <th className="py-1 font-medium">Writes</th>
                <th className="py-1 font-medium">Replayed</th>
                <th className="py-1 font-medium">Refused</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {report.days.map((day) => (
                <tr key={day.day} className="border-t border-border/60">
                  <td className="py-1.5">{formatDay(day.day)}</td>
                  <td>{day.writes}</td>
                  <td>{day.replays}</td>
                  <td>{Object.values(day.refusals).reduce((sum, count) => sum + count, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
