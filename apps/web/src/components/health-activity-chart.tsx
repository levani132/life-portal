'use client';
import { useId, useState } from 'react';
import { ScrubBars } from './scrub-bars';
import type { ActivityAdjustment } from '@life-portal/shared-types';

export function HealthActivityChart({
  activity,
}: {
  activity: ActivityAdjustment;
}) {
  const [metric, setMetric] = useState<'activeKcal' | 'steps'>('activeKcal');
  const titleId = useId();
  const rows = activity.timeline ?? [];
  // An hour with steps only (no Watch) shows its estimate from steps, fainter and labelled.
  const estimate = (row: (typeof rows)[number]) =>
    metric === 'activeKcal' && !row.hasActiveEnergy ? row.estimatedKcal : undefined;
  const present = (row: (typeof rows)[number]) =>
    metric === 'steps' ? row.hasSteps : row.hasActiveEnergy || row.estimatedKcal !== undefined;
  const amount = (row: (typeof rows)[number]) => estimate(row) ?? row[metric];
  const unit = metric === 'steps' ? 'steps' : 'kcal';
  const hasData = rows.some(present);
  return (
    <section
      className="rounded-xl border border-border p-3"
      aria-labelledby={titleId}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-sm font-medium">
          Recorded activity
        </h3>
        <div
          className="flex rounded-lg bg-special-solid/10 p-1"
          role="group"
          aria-label="Activity chart metric"
        >
          {(['activeKcal', 'steps'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={metric === value}
              onClick={() => setMetric(value)}
              className={`rounded-md px-2 py-1 text-xs ${metric === value ? 'bg-special-solid/20 text-ink' : 'text-ink-muted'}`}
            >
              {value === 'steps' ? 'Steps' : 'Active kcal'}
            </button>
          ))}
        </div>
      </div>
      {hasData ? (
        <ScrubBars
          className="mt-3 h-28"
          label={`${metric === 'steps' ? 'Steps' : 'Active energy'} by local hour; gaps indicate no imported samples`}
          barClass="bg-special-solid"
          bars={rows.map((row) => {
            const hour = `${String(row.hour).padStart(2, '0')}:00`;
            return {
              key: String(row.hour),
              value: present(row) ? amount(row) : 0,
              barClass: estimate(row) !== undefined ? 'bg-special-solid/40' : undefined,
              present: present(row),
              axis: row.hour % 4 === 0 ? String(row.hour).padStart(2, '0') : undefined,
              valueText: !present(row)
                ? 'No imported samples'
                : estimate(row) !== undefined
                  ? `≈${Math.round(amount(row)).toLocaleString()} kcal · est. from steps`
                  : `${Math.round(row[metric]).toLocaleString()} ${unit}`,
              when: `${hour}–${String((row.hour + 1) % 24).padStart(2, '0')}:00`,
            };
          })}
        />
      ) : (
        <p className="py-6 text-center text-xs text-ink-muted">
          No {metric === 'steps' ? 'steps' : 'active energy'} imported for this
          day yet.
        </p>
      )}
      <p className="mt-1 text-[11px] text-ink-muted">
        Local hours · Gaps mean missing data, not inactivity.{metric === 'activeKcal' && rows.some((row) => estimate(row) !== undefined) ? ' Fainter bars are estimated from steps.' : ''}
      </p>
    </section>
  );
}
