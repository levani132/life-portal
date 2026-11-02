'use client';
import { useId, useState } from 'react';
import type { ActivityAdjustment } from '@life-portal/shared-types';

export function HealthActivityChart({
  activity,
}: {
  activity: ActivityAdjustment;
}) {
  const [metric, setMetric] = useState<'activeKcal' | 'steps'>('activeKcal');
  const titleId = useId();
  const rows = activity.timeline ?? [];
  const present = (row: (typeof rows)[number]) =>
    metric === 'steps' ? row.hasSteps : row.hasActiveEnergy;
  const maximum = Math.max(1, ...rows.map((row) => row[metric]));
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
          className="flex rounded-lg bg-violet-500/10 p-1"
          role="group"
          aria-label="Activity chart metric"
        >
          {(['activeKcal', 'steps'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={metric === value}
              onClick={() => setMetric(value)}
              className={`rounded-md px-2 py-1 text-xs ${metric === value ? 'bg-violet-500/20 text-ink' : 'text-ink-muted'}`}
            >
              {value === 'steps' ? 'Steps' : 'Active kcal'}
            </button>
          ))}
        </div>
      </div>
      {hasData ? (
        <svg
          viewBox="0 0 480 120"
          className="mt-3 w-full"
          role="img"
          aria-label={`${metric === 'steps' ? 'Steps' : 'Active energy'} by local hour; gaps indicate no imported samples`}
        >
          {rows.map((row, index) => {
            const height = present(row)
              ? Math.max(2, (row[metric] / maximum) * 84)
              : 2;
            return (
              <g key={row.hour}>
                <title>{`${String(row.hour).padStart(2, '0')}:00 — ${present(row) ? `${Math.round(row[metric]).toLocaleString()} ${unit}` : 'No imported samples'}`}</title>
                <rect
                  x={index * 20 + 3}
                  y={92 - height}
                  width={14}
                  height={height}
                  rx={3}
                  className={
                    present(row)
                      ? 'fill-violet-400'
                      : 'fill-current text-ink-muted opacity-20'
                  }
                />
                {index % 4 === 0 && (
                  <text
                    x={index * 20 + 10}
                    y={113}
                    textAnchor="middle"
                    fontSize={11}
                    className="fill-current text-ink-muted"
                  >
                    {String(row.hour).padStart(2, '0')}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="py-6 text-center text-xs text-ink-muted">
          No {metric === 'steps' ? 'steps' : 'active energy'} imported for this
          day yet.
        </p>
      )}
      <p className="mt-1 text-[11px] text-ink-muted">
        Local hours · Gaps mean missing data, not inactivity.
      </p>
    </section>
  );
}
