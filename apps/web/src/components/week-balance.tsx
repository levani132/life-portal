'use client';

import clsx from 'clsx';
import type { WeekBalance as WeekBalanceData } from '@life-portal/shared-types';
import { formatDay } from '@life-portal/shared-domain';
import { Panel } from './ui';

/**
 * The week beside the day.
 *
 * A single heavy day means very little; a week of them means everything. The banked figure is
 * explicitly an *allowance*, and it counts only days that were actually logged — treating a
 * forgotten day as a full deficit would invent calories out of nothing.
 */
export function WeekBalancePanel({ week }: { week: WeekBalanceData }) {
  const peak = Math.max(1, ...week.days.map((day) => day.eatenKcal), week.targetKcal ? week.targetKcal / 7 : 0);
  const dayTarget = week.targetKcal != null ? week.targetKcal / 7 : undefined;
  const difference = week.differenceKcal;

  return (
    <Panel
      title="This week"
      description={`${formatDay(week.weekStart)} – ${formatDay(week.weekEnd)} · ${week.daysLogged} of 7 days logged`}
    >
      <div className="mb-4 grid grid-cols-3 gap-3 text-center">
        <Figure label="Eaten" value={`${week.eatenKcal.toLocaleString()}`} suffix="kcal" />
        <Figure
          label="Target so far"
          value={
            dayTarget != null ? `${Math.round(dayTarget * week.daysLogged).toLocaleString()}` : '—'
          }
          suffix={dayTarget != null ? 'kcal' : undefined}
        />
        <Figure
          label={difference != null && difference > 0 ? 'Over' : 'Under'}
          value={difference != null ? Math.abs(difference).toLocaleString() : '—'}
          suffix={difference != null ? 'kcal' : undefined}
          tone={difference == null ? 'neutral' : difference > 0 ? 'bad' : 'good'}
        />
      </div>

      <div className="flex h-28 items-end gap-1.5">
        {week.days.map((day) => {
          const height = Math.round((day.eatenKcal / peak) * 100);
          return (
            <div key={day.day} className="flex flex-1 flex-col items-center gap-1">
              <div className="relative flex h-full w-full items-end">
                {dayTarget != null && (
                  <span
                    className="absolute left-0 right-0 border-t border-dashed border-ink-faint/60"
                    style={{ bottom: `${Math.min(100, Math.round((dayTarget / peak) * 100))}%` }}
                    aria-hidden
                  />
                )}
                <div
                  className={clsx(
                    'w-full rounded-t',
                    !day.logged
                      ? 'bg-border'
                      : dayTarget != null && day.eatenKcal > dayTarget
                        ? 'bg-rose-500/70'
                        : 'bg-lime-500/70',
                    day.isToday && 'ring-1 ring-ink-faint',
                  )}
                  style={{ height: `${Math.max(day.logged ? 4 : 2, height)}%` }}
                  role="img"
                  aria-label={`${formatDay(day.day)}: ${day.logged ? `${day.eatenKcal} kcal` : 'nothing logged'}`}
                  title={`${formatDay(day.day)}: ${day.logged ? `${day.eatenKcal} kcal` : 'nothing logged'}`}
                />
              </div>
              <span className={clsx('text-[10px]', day.isToday ? 'text-ink' : 'text-ink-faint')}>
                {day.day.slice(8)}
              </span>
            </div>
          );
        })}
      </div>

      {week.bankedKcal > 0 && (
        <p className="mt-3 rounded-lg border border-lime-500/30 bg-lime-500/5 px-3 py-2 text-xs text-lime-200">
          <span className="tabular font-semibold">{week.bankedKcal.toLocaleString()} kcal</span>{' '}
          banked from the days you logged under target. An allowance for your cheat day, not a
          rule — and days you did not log are not counted.
        </p>
      )}
    </Panel>
  );
}

function Figure({
  label,
  value,
  suffix,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: 'neutral' | 'good' | 'bad';
}) {
  return (
    <div>
      <p
        className={clsx(
          'tabular text-lg font-semibold',
          tone === 'good' ? 'text-emerald-400' : tone === 'bad' ? 'text-rose-400' : 'text-ink',
        )}
      >
        {value}
        {suffix && <span className="ml-1 text-xs font-normal text-ink-faint">{suffix}</span>}
      </p>
      <p className="text-[11px] text-ink-faint">{label}</p>
    </div>
  );
}
