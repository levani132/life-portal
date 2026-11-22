'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { USAGE_RANGES, type PortalState, type UsageDay, type UsageRange, type UsageReport } from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { AppShell, PageHeader } from '../../../components/app-shell';
import { ErrorNote, Spinner } from '../../../components/ui';
import { useApi } from '../../../lib/hooks';
import { todayLocal } from '../../../lib/local-day';

export default function NumbersPage() {
  return (
    <AppShell>
      <Numbers />
    </AppShell>
  );
}

const percent = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

/**
 * Numbers, developer only: how many people use the app and what for. Totals computed from the
 * records the app already keeps; nothing here names a person.
 */
function Numbers() {
  const portal = useApi<PortalState>('/portal');
  const allowed = portal.data?.cohort === 'developer';
  const [range, setRange] = useState<UsageRange>(30);
  const report = useApi<UsageReport>(allowed ? `/usage?range=${range}&today=${todayLocal(0)}` : null, { revalidateOnFocus: true });
  if (!portal.data) return <Spinner />;
  if (!allowed) return <ErrorNote message="Numbers are for the developer." />;
  const data = report.data;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Numbers" subtitle="How many people use the app, and what for. Totals only; no person is shown." />
      <div className="mb-4 flex gap-2" role="group" aria-label="Range">
        {USAGE_RANGES.map((days) => (
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
      ) : !data ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Accounts" value={data.totalAccounts} />
            <Figure label={`New, ${range} days`} value={data.newAccounts} />
            <Figure label="Active today" value={data.activeToday} />
            <Figure label="Active, 7 days" value={data.active7} />
            <Figure label="Active, 30 days" value={data.active30} />
            <Figure
              label="New who did anything"
              value={percent(data.newAccountsActivated, data.newAccounts)}
              note={`${data.newAccountsActivated} of ${data.newAccounts}`}
            />
          </div>

          <section className="card p-5">
            <h2 className="text-sm font-semibold">Who comes back</h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              Of accounts created in the last 90 days: how many did something a day, a week or a month after joining, or later.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              {data.retention.map((step) => (
                <Figure
                  key={step.afterDays}
                  label={step.afterDays === 1 ? 'After 1 day' : `After ${step.afterDays} days`}
                  value={percent(step.returned, step.eligible)}
                  note={`${step.returned} of ${step.eligible}`}
                  plain
                />
              ))}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold">What people did, {range} days</h2>
            <p className="mt-0.5 text-xs text-ink-faint">People who did each thing at least once.</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-5">
              <Count label="Logged food" value={data.people.food} />
              <Count label="Trained" value={data.people.training} />
              <Count label="Weighed in" value={data.people.weight} />
              <Count label="Posted" value={data.people.post} />
              <Count label="Liked, commented or messaged" value={data.people.social} />
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold">Day by day</h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              Active means the person logged, trained, posted, liked, commented or sent a message. Opening the app without doing anything is not recorded, so it is not counted.
            </p>
            <DayTable days={data.days} />
          </section>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, note, plain }: { label: string; value: number | string; note?: string; plain?: boolean }) {
  return (
    <div className={plain ? undefined : 'card p-4'}>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {note && <p className="text-xs text-ink-faint">{note}</p>}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** Newest first, with a bar for the day's active people against the busiest day shown. */
function DayTable({ days }: { days: UsageDay[] }) {
  const busiest = Math.max(1, ...days.map((day) => day.active));
  return (
    <div className="mt-4 overflow-x-auto" data-no-tab-swipe>
      <table className="w-full min-w-[26rem] text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-ink-faint">
            <th className="pb-2 font-medium">Day</th>
            <th className="pb-2 font-medium">Active</th>
            <th className="pb-2 text-right font-medium">New</th>
            <th className="pb-2 text-right font-medium">Food</th>
            <th className="pb-2 text-right font-medium">Trained</th>
            <th className="pb-2 text-right font-medium">Posted</th>
          </tr>
        </thead>
        <tbody>
          {[...days].reverse().map((day) => (
            <tr key={day.day} className="border-t border-border">
              <td className="whitespace-nowrap py-1.5 pr-3 text-ink-muted">{formatDay(day.day)}</td>
              <td className="w-1/3 py-1.5 pr-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 shrink-0">{day.active}</span>
                  <span className="h-2 flex-1 rounded-full bg-surface-raised">
                    <span className="block h-2 rounded-full bg-accent-solid" style={{ width: `${(day.active / busiest) * 100}%` }} />
                  </span>
                </div>
              </td>
              <td className="py-1.5 text-right">{day.newAccounts || ''}</td>
              <td className="py-1.5 text-right">{day.food || ''}</td>
              <td className="py-1.5 text-right">{day.training || ''}</td>
              <td className="py-1.5 text-right">{day.posted || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
