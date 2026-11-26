'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { type PortalWidgetSize, type SharedWidget, type WidgetCard } from '@life-portal/shared-types';
import { api } from '../lib/api';
import { revalidate } from '../lib/hooks';
import { MACRO_COLORS } from '../lib/macro-colors';
import { MacroBar, NutritionRing, WIDGET_HUES, WIDGET_ICONS, type NutritionMetric } from './home-widget';
import { SortableGrid, type SortableState } from './sortable-grid';
import { EstimateMark, ErrorNote } from './ui';

/** A module's widget look: Money is drawn as Home's cash-flow card. */
const keyOf = (module: string): WidgetCard['key'] => (module === 'money' ? 'cashflow' : (module as WidgetCard['key']));
const sizeOf = (widget: SharedWidget): PortalWidgetSize => widget.size ?? (widget.module === 'nutrition' ? 'large' : 'medium');
const SPAN: Record<PortalWidgetSize, string> = {
  small: 'col-span-1 row-span-1',
  medium: 'col-span-2 row-span-1',
  large: 'col-span-2 row-span-2',
};
const NEXT_SIZE: Record<PortalWidgetSize, PortalWidgetSize> = { small: 'medium', medium: 'large', large: 'small' };

/**
 * Spec 046: a portal's widgets, laid out like an iOS home screen: a grid two cells wide on a
 * phone, each widget small (one cell), medium (a row) or large (two rows), packed densely. The
 * widgets look like Home's but only show; nothing on them acts. On your own portal (seen as
 * yourself), holding a widget lets you drag it and tap it to change its size; the arrangement is
 * the portal's alone.
 */
export function PortalGrid({ widgets, arrangeable = false }: { widgets: SharedWidget[]; arrangeable?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(() => widgets.map((widget) => widget.module as string));
  const [sizes, setSizes] = useState<Record<string, PortalWidgetSize>>(() => Object.fromEntries(widgets.map((widget) => [widget.module, sizeOf(widget)])));
  const [error, setError] = useState<string | null>(null);
  const shownKey = widgets.map((widget) => `${widget.module}:${sizeOf(widget)}`).join(',');
  // A fresh read from the server (another device, a new share) replaces what is held, unless arranging.
  useEffect(() => {
    if (editing) return;
    setOrder(widgets.map((widget) => widget.module));
    setSizes(Object.fromEntries(widgets.map((widget) => [widget.module, sizeOf(widget)])));
  }, [shownKey]);
  const byModule = new Map(widgets.map((widget) => [widget.module as string, widget]));
  const items = order.map((id) => byModule.get(id)).filter((widget): widget is SharedWidget => !!widget);

  const save = async (nextOrder: string[], nextSizes: Record<string, PortalWidgetSize>) => {
    setError(null);
    try {
      await api.put('/portal/arrangement', { order: nextOrder, sizes: nextSizes });
      await revalidate('/social/me');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The arrangement was not saved.');
    }
  };
  const resize = (module: string) => {
    const next = { ...sizes, [module]: NEXT_SIZE[sizes[module] ?? 'medium'] };
    setSizes(next);
    void save(order, next);
  };

  const grid = 'grid grid-flow-row-dense grid-cols-2 gap-3 [grid-auto-rows:9.75rem] sm:grid-cols-4';
  if (!arrangeable)
    return (
      <div className={grid}>
        {items.map((widget) => (
          <div key={widget.module} className={SPAN[sizes[widget.module] ?? sizeOf(widget)]}>
            <PortalWidget widget={widget} size={sizes[widget.module] ?? sizeOf(widget)} />
          </div>
        ))}
      </div>
    );
  return (
    <div>
      {editing && (
        <div className="mb-3 flex items-center justify-between gap-3 text-xs text-ink-muted">
          <span>Drag to move. Tap a widget to change its size.</span>
          <button type="button" className="btn-primary" onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      )}
      <SortableGrid
        items={items}
        getId={(widget) => widget.module}
        getLabel={(widget) => widget.title}
        editing={editing}
        onEditingChange={setEditing}
        onOrderChange={setOrder}
        onCommit={(next) => {
          setOrder(next);
          void save(next, sizes);
        }}
        className={grid}
        getItemStyle={(widget) => {
          const size = sizes[widget.module] ?? sizeOf(widget);
          return { gridColumn: size === 'small' ? 'span 1' : 'span 2', gridRow: size === 'large' ? 'span 2' : 'span 1' };
        }}
      >
        {(widget, state) => (
          <PortalWidget widget={widget} size={sizes[widget.module] ?? sizeOf(widget)} state={state} onResize={state.editing ? () => resize(widget.module) : undefined} />
        )}
      </SortableGrid>
      {!editing && items.length > 1 && <p className="mt-2 text-center text-[11px] text-ink-faint">Hold a widget to arrange your portal.</p>}
      {error && <ErrorNote message={error} />}
    </div>
  );
}

/** One read-only widget, in the look of Home's card. */
function PortalWidget({ widget, size, state, onResize }: { widget: SharedWidget; size: PortalWidgetSize; state?: SortableState; onResize?: () => void }) {
  const key = keyOf(widget.module);
  const Icon = WIDGET_ICONS[key] ?? WIDGET_ICONS.projects;
  const hue = WIDGET_HUES[key] ?? WIDGET_HUES.projects;
  return (
    <article
      className={clsx(
        'card flex h-full flex-col overflow-hidden rounded-2xl px-3 pb-2.5 pt-2.5',
        state?.editing && !state.dragging && 'widget-jiggle',
        state?.dragging && 'border-accent shadow-xl',
      )}
      style={state?.editing && !state.dragging ? { animationDelay: `${(state.index % 4) * 90}ms` } : undefined}
      onClick={onResize}
    >
      <header className="mb-1.5 flex items-center gap-2">
        <span className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', hue.tile)}>
          <Icon size={15} aria-hidden />
        </span>
        <h3 className="truncate text-sm font-semibold">{widget.title}</h3>
        <span className="ml-auto shrink-0 text-[10px] text-ink-faint">{onResize ? sizeLabel(size) : widget.audience === 'friends' ? 'Friends' : 'Everyone'}</span>
      </header>
      {widget.food ? <FoodBody widget={widget} size={size} /> : <Stats widget={widget} size={size} />}
    </article>
  );
}

/** M, T, W… for a `YYYY-MM-DD` day. */
const weekday = (day: string) => 'SMTWTFS'[new Date(`${day}T12:00:00Z`).getUTCDay()];

const sizeLabel = (size: PortalWidgetSize) => ({ small: 'Small', medium: 'Medium', large: 'Large' })[size];

function Stats({ widget, size }: { widget: SharedWidget; size: PortalWidgetSize }) {
  const stats = size === 'small' ? widget.stats.slice(0, 2) : widget.stats;
  return (
    <dl className={clsx('mt-auto grid gap-2', size === 'small' ? 'grid-cols-1' : 'grid-cols-3')}>
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0">
          <dd className="truncate text-base font-bold leading-tight tabular">
            {stat.value}
            {stat.estimated && <EstimateMark />}
          </dd>
          <dt className="mt-0.5 truncate text-[11px] text-ink-faint">{stat.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Food: today's rings (against targets when those are shared), then the week, then any weight. */
function FoodBody({ widget, size }: { widget: SharedWidget; size: PortalWidgetSize }) {
  const food = widget.food!;
  const today = food.today;
  const targets = food.targets;
  const metrics: NutritionMetric[] | undefined = today && [
    { label: 'Calories', value: today.eatenKcal, target: targets?.kcal, unit: 'kcal', color: MACRO_COLORS.kcal, ...(targets?.estimated ? { basis: 'estimated' } : {}) },
    { label: 'Protein', value: today.proteinG, target: targets?.proteinG, unit: 'g', color: MACRO_COLORS.protein },
    { label: 'Carbs', value: today.carbG, target: targets?.carbG, unit: 'g', color: MACRO_COLORS.carbs },
    { label: 'Fat', value: today.fatG, target: targets?.fatG, unit: 'g', color: MACRO_COLORS.fat },
  ];
  const weight = widget.stats.find((stat) => stat.label === 'Weight');
  if (!metrics) return <Stats widget={widget} size={size} />;
  if (size === 'small')
    return (
      <div className="mt-auto flex items-center gap-2">
        <div className="w-14 shrink-0">
          <NutritionRing metric={metrics[0]} />
        </div>
        <p className="min-w-0 text-[11px] leading-tight text-ink-muted">Today</p>
      </div>
    );
  // Bars against the larger of the week's highest day and the daily target, so a full day reads full.
  const most = Math.max(1, ...(food.week?.days.map((day) => day.kcal) ?? [0]), targets?.kcal ?? 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5">
        <div className="w-[62px] shrink-0">
          <NutritionRing metric={metrics[0]} />
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5">
          {metrics.slice(1).map((metric) => (
            <MacroBar key={metric.label} metric={metric} />
          ))}
        </ul>
      </div>
      {size === 'large' && food.week && (
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <p className="mb-1 flex justify-between text-[11px] text-ink-muted">
            <span className="font-medium">This week</span>
            <span className="tabular">
              {food.week.avgKcal !== undefined ? `${food.week.avgKcal.toLocaleString('en-GB')} kcal a day · ` : ''}
              {food.week.daysLogged}/7 days
            </span>
          </p>
          <div className="flex min-h-0 flex-1 items-end gap-1.5" aria-label={`Calories each day this week; ${food.week.daysLogged} of 7 days logged`}>
            {food.week.days.map((day) => (
              <div key={day.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span
                  title={`${day.day}: ${day.kcal} kcal`}
                  className={clsx('w-full rounded-md', day.kcal ? 'bg-accent-solid/70' : 'bg-border')}
                  style={{ height: day.kcal ? `${Math.max(12, (day.kcal / most) * 100)}%` : '4px' }}
                />
                <span className="text-[10px] leading-none text-ink-faint">{weekday(day.day)}</span>
              </div>
            ))}
          </div>
          {weight && <p className="mt-1 text-[11px] text-ink-muted">Weight {weight.value}</p>}
        </div>
      )}
    </div>
  );
}

