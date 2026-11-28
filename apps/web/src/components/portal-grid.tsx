'use client';

import clsx from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { NutritionSummary, PortalWidgetSize, SharedWidget, WidgetCard } from '@life-portal/shared-types';
import { portalSize, rankLabel } from '@life-portal/shared-domain';
import { api } from '../lib/api';
import { revalidate } from '../lib/hooks';
import { MACRO_COLORS } from '../lib/macro-colors';
import { HomeWidget, MacroBar, NutritionRing, WIDGET_HUES, WIDGET_ICONS, type NutritionMetric } from './home-widget';
import { DailyFoodDiary } from './shared-food-diary';
import { FolderSheet } from './folder-sheet';
import { HistoryRow } from './training/history-row';
import { RankEmblem } from './training/rank-emblem';
import { TrainingHeroView } from './training/training-hero';
import { ScrubBars, barDay } from './scrub-bars';
import { SortableGrid, type SortableState } from './sortable-grid';
import { EstimateMark, ErrorNote } from './ui';

/** A module's widget look: Money is drawn as Home's cash-flow card. */
const keyOf = (module: string): WidgetCard['key'] => (module === 'money' ? 'cashflow' : (module as WidgetCard['key']));
const GAP = '0.625rem';
/**
 * A row is this share of a column's width: a little flatter than square, so a 2×2 widget has
 * about Home's proportions and the portal takes less height (owner, 2026-11-26).
 */
const ROW_RATIO = 0.8;

type Viewer = 'normal' | 'friend' | 'stranger';

/**
 * Spec 046: a portal's widgets, laid out like an iOS home screen. The grid is four columns wide
 * and every row a little flatter than a column is wide (`ROW_RATIO`), so a widget `w`×`h` takes
 * exactly that many cells; they pack
 * densely, as if dropped and arranged by hand. A 1×1 widget is just the module's icon, like an
 * app. Widgets look like Home's, show only, and open like an iOS folder into everything that
 * module shares. On your own portal (seen as yourself), holding a widget arranges: drag it, and
 * its size button opens a picker of squares.
 */
export function PortalGrid({
  widgets,
  arrangeable = false,
  ownerId,
  viewAs = 'normal',
  onLocked,
}: {
  widgets: SharedWidget[];
  arrangeable?: boolean;
  /** Whose portal, for what a widget opens into (the shared diary). Absent for a visitor. */
  ownerId?: string;
  viewAs?: Viewer;
  /** A visitor without an account: opening a widget asks them to join instead. */
  onLocked?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState(() => widgets.map((widget) => widget.module as string));
  const [sizes, setSizes] = useState<Record<string, PortalWidgetSize>>(() => Object.fromEntries(widgets.map((widget) => [widget.module, portalSize(widget.size, widget.module).size])));
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ widget: SharedWidget; from: DOMRect } | null>(null);
  const shownKey = widgets.map((widget) => `${widget.module}:${widget.size}`).join(',');
  // A fresh read (another device, a new share) replaces what is held, unless arranging now.
  useEffect(() => {
    if (editing) return;
    setOrder(widgets.map((widget) => widget.module));
    setSizes(Object.fromEntries(widgets.map((widget) => [widget.module, portalSize(widget.size, widget.module).size])));
  }, [shownKey]);
  const byModule = new Map(widgets.map((widget) => [widget.module as string, widget]));
  const items = order.map((id) => byModule.get(id)).filter((widget): widget is SharedWidget => !!widget);
  const sizeOf = (widget: SharedWidget) => portalSize(sizes[widget.module] ?? widget.size, widget.module);

  const save = async (nextOrder: string[], nextSizes: Record<string, PortalWidgetSize>) => {
    setError(null);
    try {
      await api.put('/portal/arrangement', { order: nextOrder, sizes: nextSizes });
      await revalidate('/social/me');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The arrangement was not saved.');
    }
  };
  const resize = (module: string, size: PortalWidgetSize) => {
    const next = { ...sizes, [module]: size };
    setSizes(next);
    void save(order, next);
  };
  const openWidget = (widget: SharedWidget, from: DOMRect) => (onLocked ? onLocked() : setOpen({ widget, from }));

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gridAutoRows: `calc((100cqw - 3 * ${GAP}) / 4 * ${ROW_RATIO})`,
    gridAutoFlow: 'row dense',
    gap: GAP,
  };
  const span = (widget: SharedWidget): CSSProperties => {
    const { w, h } = sizeOf(widget);
    return { gridColumn: `span ${w}`, gridRow: `span ${h}` };
  };

  return (
    <div className="[container-type:inline-size]">
      {editing && (
        <div className="mb-3 flex items-center justify-between gap-3 text-xs text-ink-muted">
          <span>Drag to move. Tap a size to change it.</span>
          <button type="button" className="btn-primary" onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      )}
      {arrangeable ? (
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
          style={gridStyle}
          getItemStyle={span}
        >
          {(widget, state) => (
            <PortalWidget
              widget={widget}
              size={sizeOf(widget)}
              state={state}
              onResize={(size) => resize(widget.module, size)}
              onOpen={(from) => openWidget(widget, from)}
            />
          )}
        </SortableGrid>
      ) : (
        <div style={gridStyle}>
          {items.map((widget) => (
            <div key={widget.module} style={span(widget)}>
              <PortalWidget widget={widget} size={sizeOf(widget)} onOpen={(from) => openWidget(widget, from)} />
            </div>
          ))}
        </div>
      )}
      {arrangeable && !editing && <p className="mt-2 text-center text-[11px] text-ink-faint">Tap a widget to open it. Hold one to arrange your portal.</p>}
      {error && <ErrorNote message={error} />}
      {open && <PortalFolder widget={open.widget} from={open.from} ownerId={ownerId} viewAs={viewAs} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * Home's own card for a portal widget: the one the server built (minus what is not shared), or
 * for Food one made from its shared parts, with today's figures as Home's rings take them.
 */
function homeCard(widget: SharedWidget): { card: WidgetCard; nutrition?: NutritionSummary } | null {
  if (widget.card) return { card: widget.card };
  const food = widget.food;
  if (!food?.today) return null;
  const targets = food.targets;
  return {
    card: { key: 'nutrition', id: 'nutrition', title: 'Food', href: '/nutrition', icon: 'utensils', accent: 'green', tone: 'neutral', stats: [], order: 25 },
    nutrition: {
      day: '',
      eatenKcal: food.today.eatenKcal,
      proteinEatenG: food.today.proteinG,
      carbEatenG: food.today.carbG,
      fatEatenG: food.today.fatG,
      entryCount: 0,
      targetsAvailable: !!targets,
      goal: 'maintain',
      ...(targets?.kcal !== undefined ? { targetKcal: targets.kcal } : {}),
      ...(targets?.proteinG !== undefined ? { proteinTargetG: targets.proteinG } : {}),
      ...(targets?.carbG !== undefined ? { carbTargetG: targets.carbG } : {}),
      ...(targets?.fatG !== undefined ? { fatTargetG: targets.fatG } : {}),
      ...(targets?.estimated ? { targetBasis: { calories: 'estimated' } } : {}),
    } as NutritionSummary,
  };
}

/** One read-only widget, in the look of Home's glass card, laid out for its size. */
function PortalWidget({
  widget,
  size,
  state,
  onResize,
  onOpen,
}: {
  widget: SharedWidget;
  size: { w: number; h: number; size: PortalWidgetSize };
  state?: SortableState;
  onResize?: (size: PortalWidgetSize) => void;
  onOpen: (from: DOMRect) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [picking, setPicking] = useState<DOMRect | null>(null);
  const key = keyOf(widget.module);
  const Icon = WIDGET_ICONS[key] ?? WIDGET_ICONS.projects;
  const hue = WIDGET_HUES[key] ?? WIDGET_HUES.projects;
  const editing = !!state?.editing;
  const icon = size.w === 1;
  // Two squares tall and up: Home's own widget, read only, so the portal shows what Home shows.
  const home = !icon && size.h >= 2 ? homeCard(widget) : null;
  const sizeBadge = editing && onResize && (
    <button
      type="button"
      aria-label={`Size of ${widget.title}: ${size.w} by ${size.h}. Change it`}
      className="absolute right-1.5 top-1.5 z-10 rounded-full bg-ink/80 px-1.5 py-0.5 text-[10px] font-semibold tabular text-surface shadow"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        setPicking(event.currentTarget.getBoundingClientRect());
      }}
    >
      {size.w}×{size.h}
    </button>
  );
  const picker = picking && onResize && (
    <SizePicker
      anchor={picking}
      current={size}
      onPick={(next) => {
        setPicking(null);
        if (next !== size.size) onResize(next);
      }}
      onClose={() => setPicking(null)}
    />
  );
  if (home)
    return (
      <div
        ref={ref as never}
        className={clsx('relative h-full', !editing && 'cursor-pointer transition-transform active:scale-[0.98]')}
        role={editing ? undefined : 'button'}
        tabIndex={editing ? -1 : 0}
        aria-label={editing ? undefined : `Open ${widget.title}`}
        onClick={() => {
          if (!editing && ref.current) onOpen(ref.current.getBoundingClientRect());
        }}
        onKeyDown={(event) => {
          if (!editing && (event.key === 'Enter' || event.key === ' ') && ref.current) {
            event.preventDefault();
            onOpen(ref.current.getBoundingClientRect());
          }
        }}
      >
        <HomeWidget
          card={home.card}
          nutrition={home.nutrition}
          state={{ index: state?.index ?? 0, editing, dragging: !!state?.dragging }}
          readOnly
          audience={size.w >= 3 && !editing ? (widget.audience === 'friends' ? 'Friends' : 'Everyone') : undefined}
        />
        {sizeBadge}
        {picker}
      </div>
    );
  return (
    <article
      ref={ref}
      className={clsx(
        'card home-widget relative flex h-full flex-col overflow-hidden rounded-2xl',
        icon ? 'items-center justify-center p-1.5' : 'px-3 pb-2.5 pt-2.5',
        editing && !state?.dragging && 'widget-jiggle',
        state?.dragging && 'border-accent shadow-xl',
        !editing && 'cursor-pointer active:scale-[0.98] transition-transform',
      )}
      style={editing && !state?.dragging ? { animationDelay: `${(state!.index % 4) * 90}ms` } : undefined}
      role={editing ? undefined : 'button'}
      tabIndex={editing ? -1 : 0}
      aria-label={editing ? undefined : `Open ${widget.title}`}
      onClick={() => {
        if (!editing && ref.current) onOpen(ref.current.getBoundingClientRect());
      }}
      onKeyDown={(event) => {
        if (!editing && (event.key === 'Enter' || event.key === ' ') && ref.current) {
          event.preventDefault();
          onOpen(ref.current.getBoundingClientRect());
        }
      }}
    >
      {icon ? (
        <>
          <span className={clsx('flex aspect-square h-3/5 items-center justify-center rounded-[28%]', hue.tile)}>
            <Icon className="h-1/2 w-1/2" aria-hidden />
          </span>
          <span className="mt-1 max-w-full truncate text-[10px] leading-none text-ink-muted">{widget.title}</span>
        </>
      ) : (
        <>
          <header className="mb-1.5 flex items-center gap-2 pr-7">
            <span className={clsx('widget-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', hue.tile)}>
              <Icon size={15} aria-hidden />
            </span>
            <h3 className="widget-title truncate text-sm font-semibold">{widget.title}</h3>
            {size.w >= 3 && !editing && <span className="ml-auto shrink-0 text-[10px] text-ink-faint">{widget.audience === 'friends' ? 'Friends' : 'Everyone'}</span>}
          </header>
          <WidgetBody widget={widget} w={size.w} h={size.h} />
        </>
      )}
      {sizeBadge}
      {picker}
    </article>
  );
}

/** What fills a widget, by its size: a figure when it is one square tall, more as it grows. */
function WidgetBody({ widget, w, h }: { widget: SharedWidget; w: number; h: number }) {
  // One square tall with Home's card: its first figure, as one line.
  const first = widget.card?.stats[0];
  if (h === 1 && first)
    return (
      <p className="mt-auto truncate text-sm">
        <strong className="text-lg tabular">{first.value}</strong>
        <span className="text-ink-muted"> {first.label.toLowerCase()}{widget.card?.subtitle ? ` ${widget.card.subtitle}` : ''}</span>
      </p>
    );
  if (widget.food?.today) return <FoodBody widget={widget} w={w} h={h} />;
  if (widget.training?.workouts) return <TrainingBody widget={widget} w={w} h={h} />;
  const stats = h === 1 ? widget.stats.slice(0, w >= 3 ? 2 : 1) : w === 2 ? widget.stats.slice(0, h >= 3 ? 3 : 2) : widget.stats;
  return (
    <dl className={clsx('mt-auto grid gap-x-3 gap-y-2', w === 2 || h === 1 ? (h === 1 && w >= 3 ? 'grid-cols-2' : 'grid-cols-1') : 'grid-cols-3')}>
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0">
          <dd className="widget-stat-value truncate font-bold leading-tight tabular">
            {stat.value}
            {stat.estimated && <EstimateMark />}
          </dd>
          <dt className="widget-stat-label mt-0.5 text-ink-faint">{stat.label}</dt>
        </div>
      ))}
    </dl>
  );
}

function foodMetrics(widget: SharedWidget): NutritionMetric[] {
  const today = widget.food!.today!;
  const targets = widget.food?.targets;
  return [
    { label: 'Calories', value: today.eatenKcal, target: targets?.kcal, unit: 'kcal', color: MACRO_COLORS.kcal, ...(targets?.estimated ? { basis: 'estimated' } : {}) },
    { label: 'Protein', value: today.proteinG, target: targets?.proteinG, unit: 'g', color: MACRO_COLORS.protein },
    { label: 'Carbs', value: today.carbG, target: targets?.carbG, unit: 'g', color: MACRO_COLORS.carbs },
    { label: 'Fat', value: today.fatG, target: targets?.fatG, unit: 'g', color: MACRO_COLORS.fat },
  ];
}

/** Food, as on Home: the calories ring with the macros beside it; the week below when it is tall. */
function FoodBody({ widget, w, h }: { widget: SharedWidget; w: number; h: number }) {
  const metrics = foodMetrics(widget);
  const today = widget.food!.today!;
  const target = widget.food?.targets?.kcal;
  if (h === 1)
    return (
      <p className="mt-auto truncate text-sm">
        <strong className="text-lg tabular">{today.eatenKcal.toLocaleString('en-GB')}</strong>
        <span className="text-ink-muted"> {target ? `/ ${target.toLocaleString('en-GB')} kcal` : 'kcal today'}</span>
      </p>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2.5">
        <div className={clsx('shrink-0', w >= 3 ? 'w-[72px]' : 'w-[58px]')}>
          <NutritionRing metric={metrics[0]} />
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5">
          {metrics.slice(1).map((metric) => (
            <MacroBar key={metric.label} metric={metric} />
          ))}
        </ul>
      </div>
      {h >= 3 && widget.food?.week && <WeekBars widget={widget} />}
    </div>
  );
}

const minutesText = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`);

/** Training, as on Home: this week's workouts and time, the streak; the week from three squares tall. */
function TrainingBody({ widget, w, h }: { widget: SharedWidget; w: number; h: number }) {
  const training = widget.training!;
  const workouts = training.workouts!;
  if (h === 1)
    return (
      <p className="mt-auto truncate text-sm">
        <strong className="text-lg tabular">{workouts.thisWeek}</strong>
        <span className="text-ink-muted"> {workouts.thisWeek === 1 ? 'workout' : 'workouts'} this week</span>
      </p>
    );
  const figures = [
    { label: 'Workouts', value: String(workouts.thisWeek) },
    { label: 'Time', value: minutesText(workouts.minutesThisWeek) },
    { label: 'Week streak', value: String(workouts.streakWeeks) },
  ].slice(0, w >= 3 ? 3 : 2);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="text-[11px] text-ink-muted">this week</p>
      <dl className={clsx('grid gap-x-3 gap-y-2', w >= 3 ? 'grid-cols-3' : 'grid-cols-1')}>
        {figures.map((figure) => (
          <div key={figure.label} className="min-w-0">
            <dd className="widget-stat-value truncate font-bold leading-tight tabular">{figure.value}</dd>
            <dt className="widget-stat-label mt-0.5 text-ink-faint">{figure.label}</dt>
          </div>
        ))}
      </dl>
      {h >= 3 && <MinutesBars widget={widget} />}
      {h >= 4 && training.records?.[0] && (
        <p className="mt-2 truncate text-xs">
          <span className="font-semibold text-success">{training.records[0].value}</span>
          <span className="text-ink-muted"> PR · {training.records[0].exerciseName}</span>
        </p>
      )}
    </div>
  );
}

/** Minutes trained on each of the last seven days; in a folder, touch a bar for its minutes. */
function MinutesBars({ widget, tall = false, interactive = false }: { widget: SharedWidget; tall?: boolean; interactive?: boolean }) {
  const days = widget.training!.workouts!.days;
  return (
    <ScrubBars
      className={clsx('mt-3 flex-1', tall && 'min-h-32')}
      label="Minutes trained each day this week"
      barClass="bg-train-arms-solid/70"
      max={30}
      interactive={interactive}
      bars={days.map((day) => ({ key: day.day, value: day.minutes, axis: weekLetter(day.day), valueText: day.minutes ? minutesText(day.minutes) : 'No workout', when: barDay(day.day) }))}
    />
  );
}

const weekLetter = (day: string) => 'SMTWTFS'[new Date(`${day}T12:00:00Z`).getUTCDay()];

/**
 * Everything Training shares, opened: Training's own hero, history rows and rank emblems, read
 * only (spec 046 step 2), so a friend sees what the owner sees on their own Training page.
 */
function TrainingFolder({ widget }: { widget: SharedWidget }) {
  const training = widget.training!;
  return (
    <>
      {(training.workouts || training.level) && (
        <TrainingHeroView visitor summary={training.workouts?.summary} level={training.level} />
      )}
      {training.workouts && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">This week</p>
          <div className="flex h-20 flex-col">
            <MinutesBars widget={widget} interactive />
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {training.workouts.streakWeeks} {training.workouts.streakWeeks === 1 ? 'week' : 'weeks'} in a row
          </p>
        </section>
      )}
      {training.records && training.records.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Recent records</p>
          <ul className="divide-y divide-border">
            {training.records.map((record) => (
              <li key={`${record.exerciseName}:${record.day}:${record.label}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {record.exerciseName}
                  <span className="text-ink-faint"> · {record.label}</span>
                </span>
                <span className="shrink-0 font-semibold text-success tabular">{record.value}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {training.ranks && training.ranks.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Strength ranks</p>
          <ul className="grid grid-cols-2 gap-2">
            {training.ranks.map((rank) => (
              <li key={rank.exerciseName} className="card flex items-center gap-2 p-2">
                <RankEmblem tier={rank.tier} division={rank.division} size={28} muted={!rank.current} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{rank.exerciseName}</span>
                  <span className="block text-xs text-ink-muted">{rankLabel(rank)}{rank.current ? '' : ' · highest'}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {training.workouts && training.workouts.recent.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">History</p>
          <ul className="space-y-2">
            {training.workouts.recent.map((session, index) => (
              <li key={`${session.day}:${index}`}>
                <HistoryRow session={session} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** The last seven days of calories, against the larger of the best day and the target. */
function WeekBars({ widget, tall = false }: { widget: SharedWidget; tall?: boolean }) {
  const week = widget.food!.week!;
  const weight = widget.stats.find((stat) => stat.label === 'Weight');
  return (
    <div className={clsx('mt-3 flex min-h-0 flex-1 flex-col', tall && 'min-h-40')}>
      <p className="mb-1 flex justify-between gap-2 text-[11px] text-ink-muted">
        <span className="font-medium">This week</span>
        <span className="truncate tabular">
          {week.avgKcal !== undefined ? `${week.avgKcal.toLocaleString('en-GB')} kcal a day · ` : ''}
          {week.daysLogged}/7 days
        </span>
      </p>
      <ScrubBars
        className="flex-1"
        label={`Calories each day this week; ${week.daysLogged} of 7 days logged`}
        barClass="bg-accent-solid/70"
        max={widget.food?.targets?.kcal}
        interactive={tall}
        bars={week.days.map((day) => ({ key: day.day, value: day.kcal, axis: weekLetter(day.day), valueText: day.kcal ? `${day.kcal.toLocaleString('en-GB')} kcal` : 'Nothing logged', when: barDay(day.day) }))}
      />
      {weight && <p className="mt-1 text-[11px] text-ink-muted">Weight {weight.value}</p>}
    </div>
  );
}

/**
 * The size picker: a 4×4 board of squares that grows out of the size button. Pointing at a square
 * shows the widget that size; tapping picks it. A one-wide widget is an icon, so it stays 1×1.
 */
function SizePicker({ anchor, current, onPick, onClose }: { anchor: DOMRect; current: { w: number; h: number }; onPick: (size: PortalWidgetSize) => void; onClose: () => void }) {
  const [hover, setHover] = useState(current);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };
    const esc = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  const width = 4 * 34 + 3 * 5 + 24;
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  const top = Math.min(anchor.bottom + 6, window.innerHeight - 220);
  const pick = (w: number, h: number) => ({ w, h: w === 1 ? 1 : h });
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="Widget size"
      className="portal-pop fixed z-[60] rounded-2xl border border-border bg-surface p-3 shadow-2xl"
      style={{ left, top, width, transformOrigin: `${anchor.right - left - 12}px -6px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="grid grid-cols-4 gap-[5px]" onPointerLeave={() => setHover(current)}>
        {Array.from({ length: 16 }, (_, index) => {
          const col = (index % 4) + 1;
          const row = Math.floor(index / 4) + 1;
          const on = col <= hover.w && row <= hover.h;
          return (
            <button
              key={index}
              type="button"
              aria-label={`${col} by ${col === 1 ? 1 : row}`}
              className={clsx('h-[34px] w-[34px] rounded-lg border transition-colors', on ? 'border-transparent bg-accent-solid' : 'border-border bg-ink/5')}
              onPointerEnter={() => setHover(pick(col, row))}
              onFocus={() => setHover(pick(col, row))}
              onClick={() => {
                const size = pick(col, row);
                onPick(`${size.w}x${size.h}` as PortalWidgetSize);
              }}
            />
          );
        })}
      </div>
      <p className="mt-2 text-center text-xs font-medium tabular">
        {hover.w} × {hover.h}
        {hover.w === 1 && <span className="font-normal text-ink-muted"> · icon</span>}
      </p>
    </div>,
    document.body,
  );
}

/**
 * A widget opened, like an iOS folder: a window that grows out of the widget, the width of the
 * screen, with everything that module shares. Closed by its button, a tap outside or Escape.
 */
function PortalFolder({ widget, from, ownerId, viewAs, onClose }: { widget: SharedWidget; from: DOMRect; ownerId?: string; viewAs: Viewer; onClose: () => void }) {
  const key = keyOf(widget.module);
  const Icon = WIDGET_ICONS[key] ?? WIDGET_ICONS.projects;
  const hue = WIDGET_HUES[key] ?? WIDGET_HUES.projects;
  return (
    <FolderSheet
      from={from}
      label={widget.title}
      onClose={onClose}
      aside={widget.audience === 'friends' ? 'Friends' : 'Everyone'}
      icon={
        <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', hue.tile)}>
          <Icon size={18} aria-hidden />
        </span>
      }
    >
      <FolderBody widget={widget} ownerId={ownerId} viewAs={viewAs} />
    </FolderSheet>
  );
}

/** Everything one module shares, opened. */
function FolderBody({ widget, ownerId, viewAs }: { widget: SharedWidget; ownerId?: string; viewAs: Viewer }) {
  const food = widget.food;
  // With today's rings shown, the figures that repeat them are left out.
  const stats = widget.training ? [] : food?.today ? widget.stats.filter((stat) => !['Eaten today', 'Protein', 'Logged foods'].includes(stat.label)) : widget.stats;
  return (
    <div className="space-y-4">
      {food?.today && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Today</p>
          <div className="grid grid-cols-4 gap-2">
            {foodMetrics(widget).map((metric) => (
              <NutritionRing key={metric.label} metric={metric} />
            ))}
          </div>
        </section>
      )}
      {/* Food's own day, read only, between today's rings and the week at the bottom. */}
      {widget.hasDiary && ownerId && <DailyFoodDiary key={`${ownerId}:${viewAs}`} userId={ownerId} preview={viewAs} />}
      {stats.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-xl bg-ink/5 px-3 py-2">
              <dd className="text-lg font-bold tabular">
                {stat.value}
                {stat.estimated && <EstimateMark />}
              </dd>
              <dt className="text-xs text-ink-muted">{stat.label}</dt>
            </div>
          ))}
        </dl>
      )}
      {widget.training && <TrainingFolder widget={widget} />}
      {food?.week && (
        <section className="flex flex-col" style={{ height: '11rem' }}>
          <WeekBars widget={widget} tall />
        </section>
      )}
    </div>
  );
}
