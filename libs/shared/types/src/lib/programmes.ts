import type { Id, IsoDate, Timestamped } from './common';

export const PROGRAMME_LIMITS = { name: 80, description: 500 } as const;

/**
 * A programme (spec 042): a meal plan and a training plan under one name. It holds only the
 * two ids. Each plan lives in its own library (Food, Training) and can be used, edited and
 * shared there on its own; the programme is the pairing.
 */
export interface ProgrammeInput {
  name: string;
  description?: string;
  mealPlanId?: Id;
  trainingPlanId?: Id;
}

export interface Programme extends Timestamped {
  id: Id;
  userId: Id;
  name: string;
  description?: string;
  /** The meal plan as it is now; absent when none was chosen. */
  mealPlan?: { id: Id; name: string; dayCount: number; dailyKcal: number; complete: boolean; activeSince?: IsoDate };
  /** The training plan as it is now; absent when none was chosen. */
  trainingPlan?: { id: Id; name: string; workoutCount: number; exerciseCount: number; isOwn: boolean };
  /** Halves that were chosen and have since been deleted. */
  gone: ('mealPlan' | 'trainingPlan')[];
}
