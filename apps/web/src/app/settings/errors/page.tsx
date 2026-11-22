'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ERROR_RANGES, type ErrorGroup, type ErrorRange, type ErrorReport, type PortalState } from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { EmptyState, ErrorNote, Spinner } from '../../../components/ui';
import { useApi } from '../../../lib/hooks';

export default function ErrorsPage() {
  return (
    <AppShell>
      <Errors />
    </AppShell>
  );
}

const RANGE_LABEL: Record<ErrorRange, string> = { 1: 'Today', 7: '7 days', 30: '30 days' };

/**
 * The error log, developer only: what broke in production, on the server and on people's
 * pages, grouped by kind and counted. No accounts and no addresses with ids: see
 * docs/modules/errors.md.
 */
function Errors() {
  const portal = useApi<PortalState>('/portal');
  const allowed = portal.data?.cohort === 'developer';
  const [range, setRange] = useState<ErrorRange>(7);
  const report = useApi<ErrorReport>(allowed ? `/errors?range=${range}` : null, { revalidateOnFocus: true });
  if (!portal.data) return <Spinner />;
  if (!allowed) return <ErrorNote message="The error log is for the developer." />;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Errors" subtitle="What broke on the server and on people’s pages. Counted by kind; no accounts or personal details." />
      <div className="mb-4 flex gap-2" role="group" aria-label="Range">
        {ERROR_RANGES.map((days) => (
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
            {RANGE_LABEL[days]}
          </button>
        ))}
      </div>
      {report.error ? (
        <ErrorNote message={(report.error as Error).message} />
      ) : !report.data ? (
        <Spinner />
      ) : report.data.groups.length === 0 ? (
        <div className="card p-6">
          <EmptyState message="No errors recorded in this period." />
        </div>
      ) : (
        <>
          <p className="mb-2 px-1 text-xs text-ink-muted">
            <span className="font-semibold tabular text-ink">{report.data.total.toLocaleString()}</span> errors of{' '}
            <span className="font-semibold tabular text-ink">{report.data.groups.length}</span> kinds
          </p>
          <ul className="space-y-2">
            {report.data.groups.map((group) => (
              <Group key={group.fingerprint} group={group} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Group({ group }: { group: ErrorGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card overflow-hidden">
      <button type="button" className="flex w-full items-start gap-3 p-3.5 text-left" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="mt-0.5 min-w-[2.5rem] shrink-0 rounded-lg bg-danger-solid/10 px-2 py-1 text-center text-sm font-bold tabular text-danger">
          {group.count.toLocaleString()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-bold">{group.name}</span>
            <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-semibold', group.source === 'api' ? 'bg-info-solid/15 text-info' : 'bg-special-solid/15 text-special')}>
              {group.source === 'api' ? 'Server' : 'Page'}
            </span>
            {group.status && <span className="text-[11px] tabular text-ink-faint">{group.status}</span>}
          </span>
          <span className="mt-1 block break-words text-[13px] leading-snug">{group.message}</span>
          <span className="mt-1 block truncate font-mono text-[11px] text-ink-muted">{group.where}</span>
          <span className="mt-1 block text-[11px] text-ink-faint">
            {group.firstDay === group.lastDay ? formatDay(group.lastDay) : `${formatDay(group.firstDay)} to ${formatDay(group.lastDay)}`}
          </span>
        </span>
        {group.stack && <ChevronDown className={clsx('mt-1 h-4 w-4 shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} aria-hidden />}
      </button>
      {open && group.stack && (
        <pre className="max-h-72 overflow-auto border-t border-border bg-surface px-3.5 py-3 text-[11px] leading-relaxed text-ink-muted" data-no-tab-swipe>
          {group.stack}
        </pre>
      )}
    </li>
  );
}
