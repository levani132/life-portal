'use client';
import { useState } from 'react';
import type { SharedFoodDiary } from '@life-portal/shared-types';
import { addDays, formatDay, mgToG } from '@life-portal/shared-domain';
import { useSocialApi } from '../lib/social-hooks';
import { ErrorNote, Spinner } from './ui';
const SLOT_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
  uncategorized: 'Other foods',
};
export function DailyFoodDiary({
  userId,
  preview = 'normal',
}: {
  userId: string;
  preview?: 'normal' | 'friend' | 'stranger';
}) {
  const [day, setDay] = useState<string | null>(null);
  const query = new URLSearchParams({ preview, ...(day ? { day } : {}) });
  const result = useSocialApi<SharedFoodDiary>(
    `/social/profiles/${userId}/food?${query}`,
  );
  if (result.error)
    return <ErrorNote message="This diary is no longer shared with you." />;
  if (!result.data) return <Spinner label="Opening food diary…" />;
  const diary = result.data;
  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold">Daily food intake</h4>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            aria-label="Previous diary day"
            onClick={() => setDay(addDays(diary.day, -1))}
          >
            ←
          </button>
          <span className="text-sm">{formatDay(diary.day)}</span>
          <button
            type="button"
            className="btn-ghost"
            aria-label="Next diary day"
            disabled={diary.day >= diary.today}
            onClick={() => setDay(addDays(diary.day, 1))}
          >
            →
          </button>
        </div>
      </div>
      <p className="my-3 text-sm text-ink-muted">
        {diary.totals.energyKcal} kcal · P {mgToG(diary.totals.proteinMg)}g · C{' '}
        {mgToG(diary.totals.carbMg)}g · F {mgToG(diary.totals.fatMg)}g
      </p>
      {diary.slots.length === 0 ? (
        <p className="text-sm text-ink-faint">Nothing logged for this day.</p>
      ) : (
        diary.slots.map((slot) => (
          <section key={slot.slot} className="mt-4">
            <h5 className="text-sm font-semibold">{SLOT_LABELS[slot.slot]}</h5>
            <ul className="mt-2 divide-y divide-border">
              {slot.foods.map((food, index) => (
                <li
                  key={index}
                  className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                >
                  <div className="min-w-0 break-words">
                    <p>
                      {food.name}
                      {food.brand && (
                        <span className="ml-1 text-ink-faint">
                          {food.brand}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {food.amount} {food.unit} · P{' '}
                      {mgToG(food.totals.proteinMg)}g · C{' '}
                      {mgToG(food.totals.carbMg)}g · F{' '}
                      {mgToG(food.totals.fatMg)}g
                    </p>
                  </div>
                  <span className="text-ink-muted">
                    {food.totals.energyKcal} kcal
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
