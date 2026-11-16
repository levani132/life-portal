'use client';

import clsx from 'clsx';
import { MACRO_COLORS } from '../lib/macro-colors';
import type { MouseEvent } from 'react';
import Link from 'next/link';
import {
  MoreHorizontal,
  Plus,
  GripVertical,
  TrendingUp,
  Wallet,
  ListTodo,
  CalendarDays,
  Package,
  Landmark,
  Utensils,
  Dumbbell,
  Play,
} from 'lucide-react';
import type { NutritionSummary, WidgetCard } from '@life-portal/shared-types';
import type { SortableState } from './sortable-grid';
import { EstimateMark, ProgressBar, TONE_TEXT } from './ui';

export interface NutritionMetric {
  label: string;
  value: number;
  target?: number;
  unit: string;
  color: string;
  basis?: string;
}

function remainingText({ value, target, unit }: NutritionMetric) {
  if (!Number.isFinite(value)) return 'Loading…';
  if (target === undefined) return 'No goal set';
  const remaining = Math.round((target - value) * 10) / 10;
  return `${Math.abs(remaining)} ${unit} ${remaining < 0 ? 'over' : 'left'}`;
}

export function NutritionRing({ metric }: { metric: NutritionMetric }) {
  const { value, target, unit, label } = metric;
  const ratio =
    target !== undefined && target > 0
      ? Math.min(1, Math.max(0, value / target))
      : target === 0 && value > 0
        ? 1
        : 0;
  const over = target !== undefined && value > target;
  return (
    <div className="min-w-0 text-center">
      <div
        className="nutrition-ring"
        role="img"
        aria-label={`${label}: ${value} ${unit} consumed. ${remainingText(metric)}.`}
      >
        <svg viewBox="0 0 80 80" aria-hidden="true">
          <circle
            cx="40"
            cy="40"
            r="35"
            fill="none"
            stroke="rgb(var(--border))"
            strokeWidth="5"
          />
          <circle
            cx="40"
            cy="40"
            r="35"
            fill="none"
            stroke={over ? 'rgb(244 63 94)' : metric.color}
            strokeWidth="5"
            strokeLinecap="round"
            pathLength="100"
            strokeDasharray={`${ratio * 100} 100`}
            transform="rotate(-90 40 40)"
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center tabular leading-tight">
          <strong className="nutrition-ring-value">
            {value?.toLocaleString() ?? '—'}
          </strong>
          <span className="text-[10px] text-ink-faint">{unit}</span>
        </span>
      </div>
      <p className="mt-1 truncate text-[10px] font-medium sm:text-xs">
        {label}
      </p>
      <p
        className={clsx(
          'text-[10px] leading-tight sm:text-[11px]',
          over ? 'text-rose-400' : 'text-ink-muted',
        )}
      >
        {remainingText(metric)}
        {metric.basis && <EstimateMark basis={metric.basis} />}
      </p>
    </div>
  );
}

const ICONS = {
  nutrition: Utensils,
  stocks: TrendingUp,
  cashflow: Wallet,
  spending: Wallet,
  projects: ListTodo,
  board: ListTodo,
  personal: CalendarDays,
  items: Package,
  loans: Landmark,
  training: Dumbbell,
};

/**
 * Each widget's own colour, for its icon tile and its quick action: identity only, never a
 * figure (green and red already mean good and bad on money, and the macros have their own
 * colours). These are the six theme-aware hues Training introduced (spec 024); the class names
 * are written out in full so Tailwind sees them.
 */
const HUES: Record<WidgetCard['key'], { tile: string; hover: string }> = {
  nutrition: {
    tile: 'bg-train-legs/10 text-train-legs',
    hover: 'hover:bg-train-legs/20',
  },
  training: {
    tile: 'bg-train-arms/10 text-train-arms',
    hover: 'hover:bg-train-arms/20',
  },
  cashflow: {
    tile: 'bg-train-pull/10 text-train-pull',
    hover: 'hover:bg-train-pull/20',
  },
  spending: {
    tile: 'bg-train-cardio/10 text-train-cardio',
    hover: 'hover:bg-train-cardio/20',
  },
  stocks: {
    tile: 'bg-train-core/10 text-train-core',
    hover: 'hover:bg-train-core/20',
  },
  loans: {
    tile: 'bg-train-push/10 text-train-push',
    hover: 'hover:bg-train-push/20',
  },
  items: {
    tile: 'bg-train-core/10 text-train-core',
    hover: 'hover:bg-train-core/20',
  },
  personal: {
    tile: 'bg-train-cardio/10 text-train-cardio',
    hover: 'hover:bg-train-cardio/20',
  },
  projects: {
    tile: 'bg-train-pull/10 text-train-pull',
    hover: 'hover:bg-train-pull/20',
  },
  board: {
    tile: 'bg-train-pull/10 text-train-pull',
    hover: 'hover:bg-train-pull/20',
  },
};

/** One widget on Home's strip: a single card that always shows its whole summary. */
export function HomeWidget({
  card,
  nutrition,
  state,
  onMenu,
  onQuickAction,
}: {
  card: WidgetCard;
  nutrition?: NutritionSummary;
  state: SortableState;
  onMenu: () => void;
  onQuickAction?: () => void;
}) {
  const Icon = ICONS[card.key];
  const hue = HUES[card.key];
  const metrics: NutritionMetric[] | undefined = nutrition && [
    {
      label: 'Calories',
      value: nutrition.eatenKcal,
      target: nutrition.targetKcal,
      unit: 'kcal',
      color: MACRO_COLORS.kcal,
      basis: nutrition.targetBasis?.calories,
    },
    {
      label: 'Protein',
      value: nutrition.proteinEatenG,
      target: nutrition.proteinTargetG,
      unit: 'g',
      color: MACRO_COLORS.protein,
      basis: nutrition.targetBasis?.protein,
    },
    {
      label: 'Carbs',
      value: nutrition.carbEatenG,
      target: nutrition.carbTargetG,
      unit: 'g',
      color: MACRO_COLORS.carbs,
      basis: nutrition.targetBasis?.carbs,
    },
    {
      label: 'Fat',
      value: nutrition.fatEatenG,
      target: nutrition.fatTargetG,
      unit: 'g',
      color: MACRO_COLORS.fat,
      basis: nutrition.targetBasis?.fat,
    },
  ];
  // In edit mode the links stay links with their click cancelled: replacing the node under the
  // finger would cancel the touch that is dragging it (see sortable-grid.tsx).
  const open = (event: MouseEvent) => {
    if (state.editing) event.preventDefault();
  };
  return (
    <article
      className={clsx(
        'card home-widget flex h-full flex-col overflow-hidden rounded-2xl px-3 pb-2 pt-2.5 sm:px-4',
        state.editing && !state.dragging && 'widget-jiggle',
        state.dragging && 'border-accent shadow-xl',
      )}
      style={
        state.editing && !state.dragging
          ? { animationDelay: `${(state.index % 4) * 90}ms` }
          : undefined
      }
    >
      <div className="mb-1.5 flex w-full items-center justify-between gap-2">
        <Link
          href={card.href}
          draggable={false}
          tabIndex={state.editing ? -1 : undefined}
          aria-label={`Open ${card.title}`}
          onClick={open}
          className="flex items-center gap-2 text-sm font-semibold hover:text-accent"
        >
          <span
            className={clsx(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl',
              hue.tile,
            )}
          >
            <Icon size={17} aria-hidden />
          </span>
          <span className="truncate">{card.title}</span>
          {card.key === 'nutrition' && (
            <span className="widget-today shrink-0 text-xs font-normal text-ink-faint">
              Today
            </span>
          )}
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          {onQuickAction && (
            <button
              type="button"
              data-widget-action
              aria-label={card.quickAction?.label ?? 'Log food'}
              title={card.quickAction?.label ?? 'Log food'}
              className={clsx(
                'flex h-8 w-8 items-center justify-center rounded-xl',
                hue.tile,
                hue.hover,
              )}
              onClick={onQuickAction}
            >
              {card.quickAction?.kind === 'log-food' || !card.quickAction ? (
                <Plus size={19} aria-hidden />
              ) : (
                <Play size={17} aria-hidden />
              )}
            </button>
          )}
          <button
            type="button"
            data-widget-action
            aria-label={`${card.title} widget options`}
            className="flex h-8 w-7 items-center justify-center rounded-lg text-ink-muted hover:bg-surface"
            onClick={onMenu}
          >
            {state.editing ? (
              <GripVertical size={17} aria-hidden />
            ) : (
              <MoreHorizontal size={19} aria-hidden />
            )}
          </button>
        </div>
      </div>
      <Link
        href={card.href}
        draggable={false}
        tabIndex={state.editing ? -1 : undefined}
        title={`View ${card.title} details`}
        onClick={open}
        className="flex min-h-0 flex-1 flex-col overflow-hidden [justify-content:safe_center]"
      >
        {metrics ? (
          <div className="grid grid-cols-4 items-start gap-1 sm:gap-3">
            {metrics.map((metric) => (
              <NutritionRing key={metric.label} metric={metric} />
            ))}
          </div>
        ) : (
          <>
            {card.subtitle && (
              <p className="mb-2 truncate text-xs text-ink-muted">
                {card.subtitle}
              </p>
            )}
            <dl className="grid grid-cols-3 gap-2">
              {card.stats.map((stat) => (
                <div key={stat.label}>
                  <dd
                    className={clsx(
                      'break-words text-base font-bold leading-tight tabular sm:text-lg',
                      TONE_TEXT[stat.tone ?? 'neutral'],
                    )}
                  >
                    {stat.value}
                    {stat.estimated && <EstimateMark />}
                  </dd>
                  <dt
                    className="mt-1 truncate text-[11px] leading-tight text-ink-faint sm:text-xs"
                    title={stat.label}
                  >
                    {stat.label}
                  </dt>
                </div>
              ))}
            </dl>
            {card.progress !== undefined && (
              <div className="mt-3">
                <ProgressBar ratio={card.progress} />
              </div>
            )}
          </>
        )}
      </Link>
      {card.alert && !metrics && (
        <div className="mt-2 line-clamp-1 text-[11px] leading-tight text-ink-muted">
          {card.alert}
        </div>
      )}
      {nutrition && !nutrition.targetsAvailable && (
        <Link
          className="mt-1 text-center text-[11px] text-accent"
          href="/nutrition?tab=you"
        >
          Set nutrition goals →
        </Link>
      )}
    </article>
  );
}
