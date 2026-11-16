'use client';

import clsx from 'clsx';
import {
  ChevronLeft,
  ChevronRight,
  Cookie,
  Flame,
  ListChecks,
  MoonStar,
  Salad,
  Share2,
  Sunrise,
  Utensils,
  UtensilsCrossed,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { MealSlot, NutritionTargets, SlotTotals } from '@life-portal/shared-types';
import { addDays, figureValue, formatDay, mgToG, relativeDays } from '@life-portal/shared-domain';
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

/**
 * The top of the Today view: the day on a gradient, with the day switcher, what is left to eat
 * and three figures. Its controls are the day arrows, "Today" and Share; everything else only
 * shows where the day stands.
 */
export function FoodHero({
  day,
  today,
  onChange,
  onShare,
  totals,
  targets,
  entryCount,
}: {
  day: string;
  today: string;
  onChange: (day: string) => void;
  onShare?: () => void;
  totals: SlotTotals['totals'];
  targets: NutritionTargets;
  entryCount: number;
}) {
  const target = targets.available ? figureValue(targets.energyKcal) : undefined;
  const proteinTarget = targets.available ? figureValue(targets.proteinG) : undefined;
  const left = target === undefined ? undefined : target - totals.energyKcal;
  const line =
    entryCount === 0
      ? day === today
        ? 'Nothing logged yet. Start with your first meal.'
        : 'Nothing was logged on this day.'
      : left === undefined
        ? `${totals.energyKcal.toLocaleString()} kcal eaten`
        : left >= 0
          ? `${left.toLocaleString()} kcal left to eat`
          : `${Math.abs(left).toLocaleString()} kcal over the target`;
  const round = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 disabled:opacity-40';

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-train-legs-solid via-train-core-solid to-train-push-solid p-4 text-white shadow-lg shadow-train-core-solid/20 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
      <div aria-hidden className="pointer-events-none absolute -bottom-16 right-16 h-32 w-32 rounded-full bg-white/10" />
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
        <div className="mt-3 flex items-center gap-2">
          <p className="flex-1 truncate text-base font-semibold sm:text-lg">{line}</p>
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
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2">
          <HeroStat
            icon={<Flame className="h-4 w-4" />}
            value={totals.energyKcal.toLocaleString()}
            label={target === undefined ? 'kcal eaten' : `of ${target.toLocaleString()} kcal`}
          />
          <HeroStat
            icon={<Zap className="h-4 w-4" />}
            value={`${mgToG(totals.proteinMg)}g`}
            label={proteinTarget === undefined ? 'protein' : `of ${proteinTarget}g protein`}
          />
          <HeroStat icon={<ListChecks className="h-4 w-4" />} value={String(entryCount)} label={entryCount === 1 ? 'item logged' : 'items logged'} />
        </dl>
      </div>
    </section>
  );
}

function HeroStat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="rounded-xl bg-white/15 px-3 py-2 backdrop-blur-sm">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="flex items-center gap-1 text-white/80">{icon}</span>
        <span className="mt-1 block truncate text-xl font-bold tabular-nums leading-tight">{value}</span>
        <span className="block truncate text-[11px] text-white/80">{label}</span>
      </dd>
    </div>
  );
}
