'use client';

import clsx from 'clsx';
import type { EntryTotals, NutritionTargets } from '@life-portal/shared-types';
import { figureValue } from '@life-portal/shared-domain';
import { MACRO_COLORS, MACRO_TEXT } from '../lib/macro-colors';

const OVER = 'rgb(244 63 94)';

interface Metric {
  key: keyof typeof MACRO_COLORS;
  label: string;
  unit: string;
  before: number;
  added: number;
  target?: number;
}

/**
 * What the day will look like once this meal is recorded: one ring per figure, solid for what is
 * already eaten and a faded, pulsing extension for this meal. The added part turns rose when it
 * takes the day past its target, the same colour the Food page uses for "over".
 *
 * `eaten` is the day as it stands, minus the entry being corrected when there is one, so the
 * ring never counts the same meal twice.
 */
export function MealImpact({
  eaten,
  added,
  targets,
  loading,
}: {
  eaten?: EntryTotals;
  added?: EntryTotals;
  targets?: NutritionTargets;
  loading?: boolean;
}) {
  const metrics: Metric[] = [
    {
      key: 'kcal',
      label: 'Calories',
      unit: 'kcal',
      before: eaten?.energyKcal ?? 0,
      added: added?.energyKcal ?? 0,
      target: figureValue(targets?.energyKcal),
    },
    {
      key: 'protein',
      label: 'Protein',
      unit: 'g',
      before: (eaten?.proteinMg ?? 0) / 1000,
      added: (added?.proteinMg ?? 0) / 1000,
      target: figureValue(targets?.proteinG),
    },
    {
      key: 'carbs',
      label: 'Carbs',
      unit: 'g',
      before: (eaten?.carbMg ?? 0) / 1000,
      added: (added?.carbMg ?? 0) / 1000,
      target: figureValue(targets?.carbG),
    },
    {
      key: 'fat',
      label: 'Fat',
      unit: 'g',
      before: (eaten?.fatMg ?? 0) / 1000,
      added: (added?.fatMg ?? 0) / 1000,
      target: figureValue(targets?.fatG),
    },
  ];

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-violet-500/10 to-sky-500/5 p-3">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="label">{added ? 'Your day after this' : 'Your day so far'}</p>
        <p className="flex shrink-0 items-center gap-2 text-[10px] text-ink-faint">
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded-full bg-ink-muted" /> eaten
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-1.5 w-3 rounded-full bg-ink-muted/35" /> this meal
          </span>
        </p>
      </div>
      <div className={clsx('grid grid-cols-4 gap-2', loading && 'opacity-50')} aria-busy={loading}>
        {metrics.map((metric) => (
          <ImpactRing key={metric.key} metric={metric} />
        ))}
      </div>
      {!added && (
        <p className="mt-2 text-center text-xs text-ink-faint">
          Enter servings or an amount to see what this meal adds.
        </p>
      )}
    </div>
  );
}

function ImpactRing({ metric }: { metric: Metric }) {
  const { key, label, unit, before, added, target } = metric;
  const after = before + added;
  const color = MACRO_COLORS[key];
  const ratio = (value: number) =>
    target !== undefined && target > 0
      ? Math.min(1, Math.max(0, value / target))
      : target === 0 && value > 0
        ? 1
        : 0;
  const beforeRatio = ratio(before);
  const afterRatio = ratio(after);
  const over = target !== undefined && after > target;
  const crossesTarget = over && target !== undefined && before <= target;
  const remaining = target !== undefined ? round(target - after) : undefined;

  return (
    <div className="min-w-0 text-center">
      <div
        className="relative mx-auto aspect-square w-full max-w-[80px]"
        role="img"
        aria-label={`${label}: ${round(before)} ${unit} eaten, this meal adds ${round(added)} ${unit}, ${round(after)} ${unit} after.${
          remaining === undefined
            ? ''
            : ` ${Math.abs(remaining)} ${unit} ${remaining < 0 ? 'over' : 'left'}.`
        }`}
      >
        <svg viewBox="0 0 80 80" className="h-full w-full" aria-hidden>
          <circle cx="40" cy="40" r="34" fill="none" stroke="rgb(var(--border))" strokeWidth="7" />
          {afterRatio > 0 && added > 0 && (
            <circle
              className="meal-impact-ghost"
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke={over ? OVER : color}
              strokeWidth="7"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray={`${afterRatio * 100} 100`}
              transform="rotate(-90 40 40)"
            />
          )}
          {beforeRatio > 0 && (
            <circle
              className="meal-impact-arc"
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke={over && !crossesTarget ? OVER : color}
              strokeWidth="7"
              strokeLinecap="round"
              pathLength="100"
              strokeDasharray={`${beforeRatio * 100} 100`}
              transform="rotate(-90 40 40)"
            />
          )}
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center leading-tight tabular">
          <strong className="text-[13px] font-semibold sm:text-base">{round(after).toLocaleString()}</strong>
          <span className="text-[9px] text-ink-faint sm:text-[10px]">
            {target !== undefined ? `of ${Math.round(target).toLocaleString()}` : unit}
          </span>
        </span>
      </div>
      <p className="mt-1 truncate text-[10px] font-medium sm:text-xs">{label}</p>
      {added > 0 && (
        <p className={clsx('tabular text-[11px] font-semibold sm:text-xs', MACRO_TEXT[key])}>
          +{round(added).toLocaleString()}
          <span className="ml-0.5 font-normal">{unit}</span>
        </p>
      )}
      <p
        className={clsx(
          'truncate text-[10px] leading-tight sm:text-[11px]',
          over ? 'text-rose-400' : 'text-ink-muted',
        )}
      >
        {remaining === undefined
          ? 'No goal set'
          : `${Math.abs(remaining).toLocaleString()} ${remaining < 0 ? 'over' : 'left'}`}
      </p>
    </div>
  );
}

/** Whole units, like every other nutrition figure in the app. Rounded only for display. */
function round(value: number) {
  return Math.round(value);
}
