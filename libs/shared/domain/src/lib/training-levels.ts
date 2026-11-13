import type { TrainingLevel } from '@life-portal/shared-types';
import { addDays, weekdayOf } from './dates';

/**
 * Training levels (issue #5a): uncapped XP for meaningful workouts. A pure function of the
 * member's own finished sessions, with "today" explicit (principle V); nothing is stored, so
 * editing or deleting a workout simply changes the result next read. Docs: `training.md`.
 *
 * - **Meaningful**: finished, at least `minWorkingSets` non-warm-up sets and `minSeconds` long.
 * - **XP**: `baseXp` plus `bonusPerSet` for each non-warm-up set beyond the minimum, at most
 *   `maxBonus`. Effort counts a little; volume in kilograms does not (it would favour heavy
 *   lifters and heavy units over consistency).
 * - **Weekly diminishing returns** (Monday-start weeks): the first `fullPerWeek` workouts earn
 *   full XP, the next `halfPerWeek` half, any more nothing. **Daily**: a second workout on one day
 *   earns half, a third nothing. So farming many tiny or extra sessions earns little, and rest
 *   days and missed weeks never cost anything.
 * - **Curve**: reaching level L + 1 from L needs `xpStep × L`, so the total to reach L is
 *   `xpStep × L(L−1)/2`. With the defaults, ~780 workouts at three a week (8 working sets, 110 XP
 *   each) land at about level 100, and there is no maximum.
 */
export interface TrainingLevelConfig {
  minWorkingSets: number;
  minSeconds: number;
  baseXp: number;
  bonusPerSet: number;
  maxBonus: number;
  fullPerWeek: number;
  halfPerWeek: number;
  xpStep: number;
}

export const TRAINING_LEVEL_CONFIG: TrainingLevelConfig = {
  minWorkingSets: 3,
  minSeconds: 10 * 60,
  baseXp: 100,
  bonusPerSet: 2,
  maxBonus: 20,
  fullPerWeek: 4,
  halfPerWeek: 2,
  xpStep: 17,
};

export interface LevelSession {
  id: string;
  day: string;
  /** ISO start time, to order two workouts on one day. */
  startedAt: string;
  status: 'open' | 'finished';
  durationSeconds: number;
  /** Sets that are not warm-ups. */
  workingSets: number;
}

/** The XP one meaningful workout is worth before any weekly or daily reduction. */
export function workoutXp(session: Pick<LevelSession, 'workingSets'>, config = TRAINING_LEVEL_CONFIG): number {
  const extra = Math.max(0, session.workingSets - config.minWorkingSets);
  return config.baseXp + Math.min(config.maxBonus, extra * config.bonusPerSet);
}

export function isMeaningfulWorkout(session: LevelSession, config = TRAINING_LEVEL_CONFIG): boolean {
  return (
    session.status === 'finished' &&
    session.workingSets >= config.minWorkingSets &&
    session.durationSeconds >= config.minSeconds
  );
}

/** Total XP needed to reach `level` from level 1. */
export function xpToReach(level: number, config = TRAINING_LEVEL_CONFIG): number {
  return (config.xpStep * level * (level - 1)) / 2;
}

/** The level a total of XP gives: the largest L with `xpToReach(L) ≤ xp`. */
export function levelForXp(xp: number, config = TRAINING_LEVEL_CONFIG): number {
  // Solve step·L(L−1)/2 ≤ xp, then correct for floating point at the boundary.
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * xp) / config.xpStep)) / 2));
  while (xpToReach(level + 1, config) <= xp) level += 1;
  while (level > 1 && xpToReach(level, config) > xp) level -= 1;
  return level;
}

function mondayOf(day: string): string {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

export function trainingLevel(
  sessions: LevelSession[],
  today: string,
  config = TRAINING_LEVEL_CONFIG,
): TrainingLevel {
  const meaningful = sessions
    .filter((session) => session.day <= today && isMeaningfulWorkout(session, config))
    .sort((a, b) => a.day.localeCompare(b.day) || a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const perWeek = new Map<string, number>();
  const perDay = new Map<string, number>();
  let xp = 0;
  let counted = 0;
  for (const session of meaningful) {
    const week = mondayOf(session.day);
    // Position among the workouts that earned XP, so one that earns nothing (a third that day)
    // does not use up one of the week's full slots.
    const inWeek = (perWeek.get(week) ?? 0) + 1;
    const inDay = (perDay.get(session.day) ?? 0) + 1;
    const weekFactor = inWeek <= config.fullPerWeek ? 1 : inWeek <= config.fullPerWeek + config.halfPerWeek ? 0.5 : 0;
    const dayFactor = inDay === 1 ? 1 : inDay === 2 ? 0.5 : 0;
    const earned = Math.round(workoutXp(session, config) * weekFactor * dayFactor);
    if (earned > 0) {
      perWeek.set(week, inWeek);
      perDay.set(session.day, inDay);
      xp += earned;
      counted += 1;
    }
  }
  const level = levelForXp(xp, config);
  return {
    level,
    xp,
    xpIntoLevel: xp - xpToReach(level, config),
    xpForLevel: config.xpStep * level,
    countedWorkouts: counted,
  };
}
