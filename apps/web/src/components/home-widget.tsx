'use client';

import clsx from 'clsx';
import type React from 'react';
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

export function NutritionRing({
  metric,
  compact = false,
}: {
  metric: NutritionMetric;
  compact?: boolean;
}) {
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
        className={clsx('nutrition-ring', compact && 'nutrition-ring-compact')}
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
          <strong className={compact ? 'text-[10px]' : 'nutrition-ring-value'}>
            {value?.toLocaleString() ?? '—'}
          </strong>
          {!compact && (
            <span className="text-[10px] text-ink-faint sm:text-[10px]">
              {unit}
            </span>
          )}
        </span>
      </div>
      {!compact && (
        <>
          <p className="mt-1.5 text-[10px] font-medium sm:text-xs">{label}</p>
          <p
            className={clsx(
              'mt-0.5 text-[10px] leading-tight sm:text-[11px]',
              over ? 'text-rose-400' : 'text-ink-muted',
            )}
          >
            {remainingText(metric)}
            {metric.basis && <EstimateMark basis={metric.basis} />}
          </p>
        </>
      )}
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
};

export function HomeWidget({
  card,
  nutrition,
  state,
  expanded,
  onSelect,
  onMenu,
  onQuickAction,
}: {
  card: WidgetCard;
  nutrition?: NutritionSummary;
  state: SortableState;
  expanded: boolean;
  onSelect: () => void;
  onMenu: () => void;
  onQuickAction?: () => void;
}) {
  const Icon = ICONS[card.key];
  const metrics: NutritionMetric[] | undefined = nutrition && [
    {
      label: 'Calories',
      value: nutrition.eatenKcal,
      target: nutrition.targetKcal,
      unit: 'kcal',
      color: '#dc9560',
      basis: nutrition.targetBasis?.calories,
    },
    {
      label: 'Protein',
      value: nutrition.proteinEatenG,
      target: nutrition.proteinTargetG,
      unit: 'g',
      color: '#9c87cf',
      basis: nutrition.targetBasis?.protein,
    },
    {
      label: 'Carbs',
      value: nutrition.carbEatenG,
      target: nutrition.carbTargetG,
      unit: 'g',
      color: '#70a9d0',
      basis: nutrition.targetBasis?.carbs,
    },
    {
      label: 'Fat',
      value: nutrition.fatEatenG,
      target: nutrition.fatTargetG,
      unit: 'g',
      color: '#72ae91',
      basis: nutrition.targetBasis?.fat,
    },
  ];
  const select = (event: React.MouseEvent) => {
    event.preventDefault();
    if (!state.editing) onSelect();
  };
  const open = (event: React.MouseEvent) => {
    if (state.editing) event.preventDefault();
  };
  const menuButton = (
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
  );
  // Both faces stay mounted and are laid out at their final sizes (the carousel provides
  // --widget-full and --widget-peek), so resizing the card never reflows them: the carousel
  // changes the frame and the widget crossfades between faces. See widget-carousel.tsx.
  return (
    <article
      className={clsx(
        'card home-widget relative h-full overflow-hidden rounded-2xl',
        state.editing && !state.dragging && 'widget-jiggle',
        state.dragging && 'border-accent shadow-xl',
      )}
      style={
        state.editing && !state.dragging
          ? { animationDelay: `${(state.index % 4) * 90}ms` }
          : undefined
      }
      data-expanded={expanded}
    >
      <div
        className="widget-face widget-face-full flex flex-col px-3 py-3 sm:px-5"
        data-shown={expanded}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div className="mb-3 flex w-full items-center justify-between gap-2">
          <Link
            href={card.href}
            draggable={false}
            tabIndex={state.editing ? -1 : undefined}
            aria-label={`Open ${card.title}`}
            onClick={open}
            className="text-sm font-semibold hover:text-accent"
          >
            {card.title}
            {card.key === 'nutrition' && (
              <span className="ml-2 text-xs font-normal text-ink-faint">
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
                title="Log food"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                onClick={onQuickAction}
              >
                <Plus size={19} aria-hidden />
              </button>
            )}
            {menuButton}
          </div>
        </div>
        <Link
          href={card.href}
          draggable={false}
          tabIndex={state.editing ? -1 : undefined}
          title={`View ${card.title} details`}
          onClick={open}
          className="flex min-h-0 flex-1 flex-col justify-center"
        >
          {metrics ? (
            <div>
              <div className="grid grid-cols-4 items-start gap-1 sm:gap-4">
                {metrics.map((metric) => (
                  <NutritionRing key={metric.label} metric={metric} />
                ))}
              </div>
              <p className="mt-3 text-center text-xs text-violet-400">
                ⚡ Activity adjustment +
                {nutrition?.activity?.adjustmentKcal ?? 0} kcal
              </p>
            </div>
          ) : (
            <>
              {card.subtitle && (
                <p className="mb-3 text-xs text-ink-muted">{card.subtitle}</p>
              )}
              <dl className="grid grid-cols-3 gap-2">
                {card.stats.map((stat) => (
                  <div key={stat.label}>
                    <dd
                      className={clsx(
                        'break-words text-sm font-semibold tabular sm:text-lg',
                        TONE_TEXT[stat.tone ?? 'neutral'],
                      )}
                    >
                      {stat.value}
                      {stat.estimated && <EstimateMark />}
                    </dd>
                    <dt className="mt-1 text-[10px] leading-tight text-ink-faint sm:text-xs">
                      {stat.label}
                    </dt>
                  </div>
                ))}
              </dl>
              {card.progress !== undefined && (
                <div className="mt-4">
                  <ProgressBar ratio={card.progress} />
                </div>
              )}
            </>
          )}
        </Link>
        {card.alert && (
          <div className="mt-2 line-clamp-2 text-[10px] leading-tight text-ink-muted">
            {card.alert}
          </div>
        )}
        {nutrition && !nutrition.targetsAvailable && (
          <Link
            className="mt-2 text-center text-[10px] text-accent"
            href="/nutrition?tab=you"
          >
            Set nutrition goals →
          </Link>
        )}
      </div>
      <div
        className="widget-face widget-face-compact flex flex-col items-center px-1 py-2"
        data-shown={!expanded}
        aria-hidden={expanded}
        inert={expanded}
      >
        <div className="mb-1 flex flex-col-reverse items-center gap-1">
          <Link
            href={card.href}
            draggable={false}
            tabIndex={state.editing ? -1 : undefined}
            aria-label={`Select ${card.title} widget`}
            onClick={select}
            className="text-center text-[10px] font-semibold leading-tight hover:text-accent"
          >
            {card.title}
          </Link>
          {menuButton}
        </div>
        <Link
          href={card.href}
          draggable={false}
          tabIndex={state.editing ? -1 : undefined}
          aria-label={`Select ${card.title} widget summary`}
          onClick={select}
          className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-2"
        >
          {metrics ? (
            <>
              <NutritionRing metric={metrics[0]} compact />
              <span className="text-center text-[10px] leading-tight text-ink-muted">
                {nutrition?.leftKcal !== undefined
                  ? `${Math.abs(nutrition.leftKcal)} kcal ${nutrition.leftKcal < 0 ? 'over' : 'left'}`
                  : `${nutrition?.eatenKcal} kcal eaten`}
              </span>
            </>
          ) : (
            <>
              <Icon size={21} className="text-ink-muted" aria-hidden />
              <strong className="w-full break-words text-center text-xs tabular">
                {card.stats[0]?.value}
              </strong>
              <span className="text-center text-[10px] leading-tight text-ink-faint">
                {card.stats[0]?.label}
              </span>
            </>
          )}
        </Link>
        {onQuickAction && (
          <button
            type="button"
            data-widget-action
            aria-label={card.quickAction?.label ?? 'Log food'}
            title="Log food"
            className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-emerald-400 hover:bg-emerald-500/10"
            onClick={onQuickAction}
          >
            <Plus size={18} aria-hidden />
          </button>
        )}
      </div>
    </article>
  );
}
