'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WeighIn } from '@life-portal/shared-types';
import { diffDays, formatDay } from '@life-portal/shared-domain';
import { EmptyState, EstimateMark, Panel } from './ui';

/**
 * Weight over time, and the rate it is actually moving at.
 *
 * The measured rate is the honest counterweight to the projected one: if the projection says
 * −0.4 kg a week and the scale says −0.1, the activity multiplier is wrong, not the scale.
 */
export function WeightTrend({ weighIns }: { weighIns: WeighIn[] }) {
  const points = useMemo(
    () => weighIns.map((row) => ({ day: row.day, kg: Math.round(row.weightGrams / 100) / 10 })),
    [weighIns],
  );

  const rate = useMemo(() => {
    if (points.length < 2) return undefined;
    const first = points[0];
    const last = points[points.length - 1];
    const days = diffDays(first.day, last.day);
    if (days <= 0) return undefined;
    return Math.round(((last.kg - first.kg) / days) * 7 * 100) / 100;
  }, [points]);

  if (points.length === 0) {
    return (
      <Panel title="Weight trend">
        <EmptyState message="Record a weigh-in and the trend starts here." />
      </Panel>
    );
  }

  return (
    <Panel
      title="Weight trend"
      description={
        rate == null
          ? 'One weigh-in so far — two make a trend.'
          : `${rate > 0 ? '+' : ''}${rate} kg a week across ${points.length} weigh-ins`
      }
      actions={
        rate != null ? (
          <span className="text-xs text-ink-faint">
            measured, not projected
            <EstimateMark basis="Measured from your first and latest weigh-in. Compare it with the projected rate: if they disagree, the activity level is the figure to adjust." />
          </span>
        ) : undefined
      }
    >
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="rgb(40 45 58)" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fill: 'rgb(106 114 130)', fontSize: 11 }}
              tickFormatter={(value: string) => value.slice(5)}
              stroke="rgb(40 45 58)"
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: 'rgb(106 114 130)', fontSize: 11 }}
              stroke="rgb(40 45 58)"
              domain={['dataMin - 1', 'dataMax + 1']}
              // One decimal: whole kilograms made a single weigh-in render as 100, 100, 99, 99, 98.
              tickFormatter={(value: number) => value.toFixed(1)}
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: 'rgb(22 25 34)',
                border: '1px solid rgb(40 45 58)',
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(label) => (typeof label === 'string' ? formatDay(label) : '')}
              formatter={(value) => [`${Number(value).toFixed(1)} kg`, 'Weight'] as [string, string]}
            />
            <Line
              type="monotone"
              dataKey="kg"
              stroke="rgb(163 230 53)"
              strokeWidth={2}
              dot={{ r: 2, fill: 'rgb(163 230 53)' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
