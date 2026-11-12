'use client';

import clsx from 'clsx';
import { MACRO_COLORS } from '../lib/macro-colors';
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
} from 'react';
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

export function NutritionRing({
  metric,
  compact = false,
  shared = false,
  stagger,
}: {
  metric: NutritionMetric;
  /** Ring and number only, for the small food card on Home. */
  compact?: boolean;
  /** The calories ring on Home: the one piece that moves between the widget's two faces. */
  shared?: boolean;
  /** Position in the staggered entrance on Home's food widget. */
  stagger?: number;
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
    <div
      className="min-w-0 text-center"
      data-fade={stagger !== undefined || undefined}
      style={
        stagger !== undefined
          ? ({ '--stagger': stagger } as CSSProperties)
          : undefined
      }
    >
      <div
        className={clsx('nutrition-ring', compact && 'nutrition-ring-compact')}
        data-shared={shared || undefined}
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
        <span className="nutrition-ring-text absolute inset-0 flex flex-col items-center justify-center tabular leading-tight">
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
        // Beside a moving ring, its captions fade in with the first of the macros.
        <div
          data-fade={shared || undefined}
          style={shared ? ({ '--stagger': 1 } as CSSProperties) : undefined}
        >
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
  training: Dumbbell,
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
  const root = useRef<HTMLElement>(null);
  const wasExpanded = useRef(expanded);
  // The calories ring is the same piece of content in both faces, so instead of crossfading it
  // flies and scales from where it was to where it now is (a FLIP), while everything else fades
  // around it. Its number is styled differently in each face, so that part crossfades in flight.
  useLayoutEffect(() => {
    if (wasExpanded.current === expanded) return;
    wasExpanded.current = expanded;
    const el = root.current;
    if (!el || !metrics) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const from = el.querySelector<HTMLElement>(
      '.widget-face[data-shown="false"] [data-shared]',
    );
    const to = el.querySelector<HTMLElement>(
      '.widget-face[data-shown="true"] [data-shared]',
    );
    if (!from || !to || typeof to.animate !== 'function') return;
    const cancel = (node: HTMLElement) =>
      node
        .getAnimations?.({ subtree: true })
        .forEach((animation) => animation.cancel());
    cancel(to);
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    cancel(from);
    if (!b.width || !b.height) return;
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    to.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px) scale(${a.width / b.width})`,
        },
        { transform: 'none' },
      ],
      { duration: 460, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
    );
    to.querySelector('.nutrition-ring-text')?.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 240, delay: 40, easing: 'ease-out', fill: 'backwards' },
    );
  });
  const select = (event: MouseEvent) => {
    event.preventDefault();
    if (!state.editing) onSelect();
  };
  const open = (event: MouseEvent) => {
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
      ref={root}
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
        className={clsx(
          'widget-face widget-face-full flex flex-col px-3 pb-2 pt-2.5 sm:px-5',
          metrics && 'widget-face-staged',
        )}
        data-shown={expanded}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div
          className="mb-1.5 flex w-full items-center justify-between gap-2"
          data-fade
        >
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
              <span className="widget-today ml-2 text-xs font-normal text-ink-faint">
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
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                onClick={onQuickAction}
              >
                {card.quickAction?.kind === 'log-food' || !card.quickAction ? (
                  <Plus size={19} aria-hidden />
                ) : (
                  <Play size={17} aria-hidden />
                )}
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
          className="flex min-h-0 flex-1 flex-col overflow-hidden [justify-content:safe_center]"
        >
          {metrics ? (
            <div>
              <div className="grid grid-cols-4 items-start gap-1 sm:gap-4">
                {metrics.map((metric, index) =>
                  index === 0 ? (
                    <NutritionRing key={metric.label} metric={metric} shared />
                  ) : (
                    <NutritionRing
                      key={metric.label}
                      metric={metric}
                      stagger={index}
                    />
                  ),
                )}
              </div>
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
                        'break-words text-sm font-semibold leading-tight tabular sm:text-lg',
                        TONE_TEXT[stat.tone ?? 'neutral'],
                      )}
                    >
                      {stat.value}
                      {stat.estimated && <EstimateMark />}
                    </dd>
                    <dt
                      className="mt-1 truncate text-[10px] leading-tight text-ink-faint sm:text-xs"
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
          <div className="mt-2 line-clamp-1 text-[10px] leading-tight text-ink-muted">
            {card.alert}
          </div>
        )}
        {nutrition && !nutrition.targetsAvailable && (
          <Link
            className="mt-1 text-center text-[10px] text-accent"
            href="/nutrition?tab=you"
            data-fade
            style={{ '--stagger': 4 } as CSSProperties}
          >
            Set nutrition goals →
          </Link>
        )}
      </div>
      <div
        className={clsx(
          'widget-face widget-face-compact flex flex-col items-center px-1 py-2',
          metrics && 'widget-face-staged',
        )}
        data-shown={!expanded}
        aria-hidden={expanded}
        inert={expanded}
      >
        <div
          className="mb-1 flex flex-col-reverse items-center gap-1"
          data-fade
        >
          <Link
            href={card.href}
            draggable={false}
            tabIndex={state.editing ? -1 : undefined}
            aria-label={`Select ${card.title} widget`}
            onClick={select}
            className="line-clamp-2 text-center text-[10px] font-semibold leading-tight hover:text-accent"
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
              <NutritionRing metric={metrics[0]} compact shared />
              <span
                className="text-center text-[10px] leading-tight text-ink-muted"
                data-fade
              >
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
      </div>
    </article>
  );
}
