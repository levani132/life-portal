'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { SharedFoodDiary } from '@life-portal/shared-types';
import { addDays, formatDay } from '@life-portal/shared-domain';
import { useSocialApi } from '../lib/social-hooks';
import { MacroLine, SLOT_STYLES } from './food-day';
import { FoodThumb } from './food-thumb';
import { MacroSplit } from './macro-split';
import { ErrorNote, Spinner } from './ui';

const SLOT_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
  uncategorized: 'Other foods',
};

/**
 * Someone's shared food diary, one day at a time, in the Food page's own look (spec 046): each
 * meal a card with its colour, icon, total and macro split, each food a row with its picture,
 * amount and macros. Read only: no swipe actions, no adding, no editing.
 */
export function DailyFoodDiary({
  userId,
  preview = 'normal',
}: {
  userId: string;
  preview?: 'normal' | 'friend' | 'stranger';
}) {
  const [day, setDay] = useState<string | null>(null);
  const query = new URLSearchParams({ preview, ...(day ? { day } : {}) });
  const result = useSocialApi<SharedFoodDiary>(`/social/profiles/${userId}/food?${query}`);
  if (result.error) return <ErrorNote message="This diary is no longer shared with you." />;
  if (!result.data) return <Spinner label="Opening food diary…" />;
  const diary = result.data;
  const arrow = 'flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 text-ink-muted disabled:opacity-30';
  return (
    <section className="space-y-2" aria-label="Food diary">
      <header className="flex items-center gap-2">
        <button type="button" className={arrow} aria-label="Previous diary day" onClick={() => setDay(addDays(diary.day, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-sm font-semibold">{diary.day === diary.today ? 'Today' : formatDay(diary.day)}</p>
          <p className="text-xs text-ink-muted">
            <span className="font-semibold tabular text-ink">{diary.totals.energyKcal.toLocaleString()} kcal</span>
            {' · '}
            <MacroLine totals={diary.totals} />
          </p>
        </div>
        <button
          type="button"
          className={arrow}
          aria-label="Next diary day"
          disabled={diary.day >= diary.today}
          onClick={() => setDay(addDays(diary.day, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </header>
      {diary.slots.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-faint">Nothing logged for this day.</p>
      ) : (
        diary.slots.map((slot) => {
          const { icon: Icon, style } = SLOT_STYLES[slot.slot];
          const totals = slot.foods.reduce(
            (sum, food) => ({
              energyKcal: sum.energyKcal + food.totals.energyKcal,
              proteinMg: sum.proteinMg + food.totals.proteinMg,
              carbMg: sum.carbMg + food.totals.carbMg,
              fatMg: sum.fatMg + food.totals.fatMg,
            }),
            { energyKcal: 0, proteinMg: 0, carbMg: 0, fatMg: 0 },
          );
          return (
            <section key={slot.slot} className={clsx('card overflow-hidden border-l-4', style.edge)} aria-label={SLOT_LABELS[slot.slot]}>
              <header className="flex items-center gap-2.5 p-2.5">
                <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow', style.gradient)} aria-hidden>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="block min-w-0 flex-1">
                  <span role="heading" aria-level={3} className="block text-base font-bold leading-tight">
                    {SLOT_LABELS[slot.slot]}
                  </span>
                  <span className="block text-[13px] leading-snug text-ink-muted">
                    <span className={clsx('font-semibold tabular', style.text)}>{totals.energyKcal.toLocaleString()} kcal</span>
                    {' · '}
                    <MacroLine totals={totals} />
                  </span>
                  <MacroSplit macros={totals} className="mt-1.5" />
                </span>
              </header>
              <ul className="space-y-1 px-2.5 pb-2.5">
                {slot.foods.map((food, index) => (
                  <li key={index} className="flex items-center gap-2 rounded-xl bg-surface px-2.5 py-2 text-[15px] leading-snug">
                    <FoodThumb name={food.name} brand={food.brand} macros={food.totals} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {food.name}
                        {food.brand && <span className="ml-1 text-xs font-normal text-ink-faint">{food.brand}</span>}
                      </p>
                      <p className="truncate text-[13px] text-ink-muted">
                        {food.amount} {food.unit}
                      </p>
                      <p className="text-[13px] text-ink-muted">
                        <MacroLine totals={food.totals} />
                      </p>
                    </div>
                    <span className="shrink-0 text-right leading-tight">
                      <span className="tabular block text-base font-bold">{food.totals.energyKcal}</span>
                      <span className="block text-[10px] text-ink-faint">kcal</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </section>
  );
}
