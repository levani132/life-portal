'use client';

import type { MealSlot } from '@life-portal/shared-types';
import { localMealContext } from '@life-portal/shared-domain';

/**
 * The browser clock, read in exactly one place.
 *
 * Which day a meal belongs to is the eater's question, not the server's: the API may be in
 * another timezone, and a 01:20 snack belongs to the day that is ending. Both rules live in the
 * domain library (`localMealContext`); this wrapper is the only thing in the web app allowed to
 * call `new Date()` for them, so a component can never quietly disagree.
 */
export function mealContextNow(dayStartHour = 4): { day: string; slot: MealSlot } {
  return localMealContext(new Date(), dayStartHour);
}

/** Today, as the eater's clock sees it. Sent as `?today=` so the API projects the right day. */
export function todayLocal(dayStartHour = 4): string {
  return mealContextNow(dayStartHour).day;
}
