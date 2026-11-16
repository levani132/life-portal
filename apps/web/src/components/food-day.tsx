'use client';

import clsx from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  Cookie,
  MoonStar,
  Salad,
  Share2,
  Sunrise,
  Utensils,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { MealSlot, SlotTotals, WeekBalance } from '@life-portal/shared-types';
import { addDays, formatDay, mgToG, relativeDays, weekdayOf } from '@life-portal/shared-domain';
import { MACRO_TEXT } from '../lib/macro-colors';
import { GROUP_STYLES, type GroupStyle } from '../lib/training-colors';

/**
 * The Food page's look, in step with Training's: a gradient hero for the day, and one colour and
 * icon per meal. Display only. The hues are Training's `train-*` tokens, the theme-aware set
 * (`lib/training-colors.ts`); a meal's colour is derived from its slot, never stored.
 */
export const SLOT_STYLES: Record<MealSlot, { icon: LucideIcon; style: GroupStyle }> = {
  breakfast: { icon: Sunrise, style: GROUP_STYLES.core },
  lunch: { icon: Salad, style: GROUP_STYLES.legs },
  dinner: { icon: MoonStar, style: GROUP_STYLES.arms },
  snack: { icon: Cookie, style: GROUP_STYLES.cardio },
  uncategorized: { icon: UtensilsCrossed, style: GROUP_STYLES.pull },
};

/** `P 20g · C 30g · F 10g`, each letter in its macro's colour (the one palette in `macro-colors`). */
export function MacroLine({ totals, className }: { totals: SlotTotals['totals']; className?: string }) {
  const parts: [string, string, number][] = [
    ['P', MACRO_TEXT.protein, mgToG(totals.proteinMg)],
    ['C', MACRO_TEXT.carbs, mgToG(totals.carbMg)],
    ['F', MACRO_TEXT.fat, mgToG(totals.fatMg)],
  ];
  return (
    <span className={clsx('tabular', className)}>
      {parts.map(([letter, color, grams], index) => (
        <span key={letter}>
          {index > 0 && ' · '}
          <span className={clsx('font-semibold', color)}>{letter}</span> {grams}g
        </span>
      ))}
    </span>
  );
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/**
 * The top of the Today view: the day on a gradient, with the day arrows and the current week as
 * seven days to tap. It says which day this is and how the week is going, and nothing the rings
 * below already say: an earlier version repeated their calories and protein here.
 *
 * A day's bar is what was eaten against the daily target (full at the target); without a target,
 * a logged day is a dot. The week is always the current one (`overview.week`), so on an older day
 * none of the seven is selected and "Today" brings it back.
 */
export function FoodHero({
  day,
  today,
  onChange,
  onShare,
  week,
}: {
  day: string;
  today: string;
  onChange: (day: string) => void;
  onShare?: () => void;
  week: WeekBalance;
}) {
  const dayTarget = week.targetKcal != null ? week.targetKcal / 7 : undefined;
  const round = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 disabled:opacity-40';

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-train-legs-solid via-train-core-solid to-train-push-solid p-3 text-white shadow-lg shadow-train-core-solid/20 sm:p-4">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
      <div className="relative">
        <div className="flex items-center gap-2">
          <button type="button" className={round} onClick={() => onChange(addDays(day, -1))} aria-label="Previous day">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 text-center">
            <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/80">
              <Utensils className="h-3.5 w-3.5" />
              {day === today ? 'Today' : relativeDays(today, day)}
            </p>
            <p className="truncate text-sm font-semibold">{formatDay(day)}</p>
          </div>
          {day !== today && (
            <button
              type="button"
              className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-900 shadow transition-colors hover:bg-white/90"
              onClick={() => onChange(today)}
            >
              Today
            </button>
          )}
          {onShare && (
            <button type="button" className={round} onClick={onShare} aria-label="Share this day" title="Share this day">
              <Share2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            className={round}
            onClick={() => onChange(addDays(day, 1))}
            disabled={day >= today}
            aria-label="Next day"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1.5" role="group" aria-label="This week">
          {week.days.map((item) => {
            const selected = item.day === day;
            const future = item.day > today;
            const fill = dayTarget ? Math.min(1, item.eatenKcal / dayTarget) : item.logged ? 1 : 0;
            return (
              <button
                key={item.day}
                type="button"
                disabled={future}
                aria-pressed={selected}
                aria-label={`${formatDay(item.day)}${item.logged ? `, ${item.eatenKcal.toLocaleString()} kcal` : ', nothing logged'}`}
                onClick={() => onChange(item.day)}
                className={clsx(
                  'flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors disabled:opacity-40',
                  selected ? 'bg-white text-slate-900 shadow' : 'bg-white/15 text-white hover:bg-white/25',
                )}
              >
                <span className={clsx('text-[10px] font-semibold', selected ? 'text-slate-500' : 'text-white/75')}>
                  {WEEKDAYS[weekdayOf(item.day)]}
                </span>
                <span className="text-sm font-bold tabular-nums leading-tight">{Number(item.day.slice(8, 10))}</span>
                <span className={clsx('mt-0.5 h-1 w-full overflow-hidden rounded-full', selected ? 'bg-slate-900/15' : 'bg-white/25')} aria-hidden>
                  <span
                    className={clsx('block h-full rounded-full', selected ? 'bg-train-legs-solid' : 'bg-white')}
                    style={{ width: `${Math.round(fill * 100)}%` }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
