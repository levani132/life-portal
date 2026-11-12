import {
  BADGE_CATALOGUE,
  EARLY_MEMBER_CUTOFF,
  type BadgeDefinition,
  type BadgeId,
} from '@life-portal/shared-types';
import { addDays, isAfter, isBefore, weekdayOf } from './dates';
import { weekStart } from './nutrition';

/**
 * Profile badges (spec 022). Pure: everything is computed from plain facts and an explicit
 * `today`. Nothing here is stored except, by the caller, the fact that a tier was reached.
 */

export interface TierReached {
  tier: number;
  reachedOn: string;
}

export interface BadgeEvaluation {
  badgeId: BadgeId;
  /** Every tier the history reaches, ascending. */
  reached: TierReached[];
  /** Toward the lowest tier not reached. Absent when there is nothing left to reach. */
  progress?: { current: number; next: number };
}

/** One food day: whole kcal eaten and that day's starting target, if one was computable. */
export interface FoodDayFacts {
  day: string;
  eatenKcal: number;
  targetKcal?: number;
}

export interface BadgeInputs {
  accountCreatedOn: string;
  setupCompleted: boolean;
  /** One day per original, live post. */
  postDays: string[];
  /** One entry per current friendship; `undefined` when the acceptance day is unknown. */
  friendAcceptedDays: (string | undefined)[];
  /** Absent when food was not loaded (every food tier already earned, or no data). */
  food?: { days: FoodDayFacts[]; cheatDays: number[] };
  /** One day per finished workout. Absent when training was not loaded. */
  training?: { finishedDays: string[] };
}

/** A run of consecutive counted days. Each element is the day that count was reached. */
export type Run = string[];

type DayKind = 'count' | 'skip' | 'break';

/**
 * Walks every day from `from` to `today` and groups counted days into runs.
 *
 * A `'skip'` day neither extends nor breaks a run. `today` never breaks one: the day is not
 * over yet, so a `'break'` on `today` is read as a skip. `current` is the length of the run
 * still open at `today`, or 0.
 */
function runsOf(
  from: string,
  today: string,
  classify: (day: string) => DayKind,
): { runs: Run[]; current: number } {
  const runs: Run[] = [];
  let open: Run | null = null;
  for (let day = from; !isAfter(day, today); day = addDays(day, 1)) {
    let kind = classify(day);
    if (kind === 'break' && day === today) kind = 'skip';
    if (kind === 'count') {
      if (!open) {
        open = [];
        runs.push(open);
      }
      open.push(day);
    } else if (kind === 'break') {
      open = null;
    }
  }
  return { runs, current: open ? open.length : 0 };
}

/** The earliest day any run reached `tier` counted days. */
function runReached(runs: Run[], tier: number): string | undefined {
  for (const run of runs) if (run.length >= tier) return run[tier - 1];
  return undefined;
}

function sortedUnique(days: string[], today: string): string[] {
  return [...new Set(days)].filter((day) => !isAfter(day, today)).sort();
}

/** Consecutive food days with at least one entry. */
export function loggingStreak(
  days: string[],
  today: string,
): { current: number; runs: Run[] } {
  const logged = sortedUnique(days, today);
  if (!logged.length) return { current: 0, runs: [] };
  const set = new Set(logged);
  return runsOf(logged[0], today, (day) => (set.has(day) ? 'count' : 'break'));
}

/** `|eaten − target| ≤ 10% of target`, in integers. */
export function isOnTarget(row: FoodDayFacts): boolean {
  const target = row.targetKcal;
  if (target == null || target <= 0) return false;
  return Math.abs(row.eatenKcal - target) * 10 <= target;
}

/**
 * On-target streaks and the total.
 *
 * - A configured cheat weekday is skipped in streaks, whatever was eaten.
 * - A day with no entries, or with no computable target, breaks the streak and is not counted.
 * - The total counts every on-target day, a cheat day included.
 */
export function onTargetDays(
  rows: FoodDayFacts[],
  cheatWeekdays: number[],
  today: string,
): { current: number; runs: Run[]; totalDays: string[] } {
  const byDay = new Map(
    rows.filter((row) => !isAfter(row.day, today)).map((row) => [row.day, row]),
  );
  const totalDays = [...byDay.values()]
    .filter(isOnTarget)
    .map((row) => row.day)
    .sort();
  if (!byDay.size) return { current: 0, runs: [], totalDays };
  const first = [...byDay.keys()].sort()[0];
  const cheat = new Set(cheatWeekdays);
  const streak = runsOf(first, today, (day) => {
    if (cheat.has(weekdayOf(day))) return 'skip';
    const row = byDay.get(day);
    return row && isOnTarget(row) ? 'count' : 'break';
  });
  return { ...streak, totalDays };
}

/**
 * Consecutive Monday-start weeks with at least `minPerWeek` finished workouts. Training has no
 * daily streak on purpose: rest days are part of training. A run's element for a week is the day
 * of the workout that made the week count. The week containing `today` extends a run once it
 * counts and never breaks one before it ends.
 */
export function weeklyConsistency(
  finishedDays: string[],
  today: string,
  minPerWeek = 2,
): { current: number; runs: Run[] } {
  const days = [...finishedDays].filter((day) => !isAfter(day, today)).sort();
  if (!days.length) return { current: 0, runs: [] };
  const byWeek = new Map<string, string[]>();
  for (const day of days) {
    const week = weekStart(day);
    byWeek.set(week, [...(byWeek.get(week) ?? []), day]);
  }
  const thisWeek = weekStart(today);
  const runs: Run[] = [];
  let open: Run | null = null;
  for (let week = weekStart(days[0]); !isAfter(week, thisWeek); week = addDays(week, 7)) {
    const sessions = byWeek.get(week) ?? [];
    if (sessions.length >= minPerWeek) {
      if (!open) {
        open = [];
        runs.push(open);
      }
      open.push(sessions[minPerWeek - 1]);
    } else if (week !== thisWeek) {
      open = null;
    }
  }
  return { runs, current: open ? open.length : 0 };
}

/** The day the n-th event happened, for each tier the events reach. */
export function countMilestones(dates: string[], tiers: number[]): TierReached[] {
  const sorted = [...dates].sort();
  return tiers
    .filter((tier) => sorted.length >= tier)
    .map((tier) => ({ tier, reachedOn: sorted[tier - 1] }));
}

function fromRuns(runs: Run[], tiers: number[]): TierReached[] {
  return tiers.flatMap((tier) => {
    const reachedOn = runReached(runs, tier);
    return reachedOn ? [{ tier, reachedOn }] : [];
  });
}

function evaluation(
  def: BadgeDefinition,
  reached: TierReached[],
  current: number | undefined,
  bounds: { from: string; to: string },
): BadgeEvaluation {
  const clamped = reached.map(({ tier, reachedOn }) => ({
    tier,
    reachedOn: isBefore(reachedOn, bounds.from)
      ? bounds.from
      : isAfter(reachedOn, bounds.to)
        ? bounds.to
        : reachedOn,
  }));
  const next = def.tiers.find((tier) => !clamped.some((r) => r.tier === tier));
  return {
    badgeId: def.id,
    reached: clamped,
    ...(next != null && current != null ? { progress: { current, next } } : {}),
  };
}

/**
 * Evaluates the standard badges, the food badges when `input.food` is given, and the training
 * badges when `input.training` is given. Every
 * `reachedOn` lies between the account's creation day and `today`.
 */
export function evaluateBadges(input: BadgeInputs, today: string): BadgeEvaluation[] {
  const bounds = { from: input.accountCreatedOn, to: today };
  const def = (id: BadgeId) => BADGE_CATALOGUE.find((badge) => badge.id === id) as BadgeDefinition;
  const friends = input.friendAcceptedDays.map((day) => day ?? today);
  const early =
    EARLY_MEMBER_CUTOFF == null || isBefore(input.accountCreatedOn, EARLY_MEMBER_CUTOFF);
  const out: BadgeEvaluation[] = [
    evaluation(def('setup'), input.setupCompleted ? [{ tier: 1, reachedOn: today }] : [], undefined, bounds),
    evaluation(def('firstPost'), countMilestones(input.postDays, [1]), undefined, bounds),
    evaluation(def('firstFriend'), countMilestones(friends, [1]), undefined, bounds),
    evaluation(def('connected'), countMilestones(friends, def('connected').tiers), friends.length, bounds),
    evaluation(
      def('earlyMember'),
      early ? [{ tier: 1, reachedOn: input.accountCreatedOn }] : [],
      undefined,
      bounds,
    ),
  ];
  if (input.food) {
    const logging = loggingStreak(
      input.food.days.map((row) => row.day),
      today,
    );
    const target = onTargetDays(input.food.days, input.food.cheatDays, today);
    out.push(
      evaluation(def('loggingStreak'), fromRuns(logging.runs, def('loggingStreak').tiers), logging.current, bounds),
      evaluation(def('onTargetStreak'), fromRuns(target.runs, def('onTargetStreak').tiers), target.current, bounds),
      evaluation(
        def('daysOnTarget'),
        countMilestones(target.totalDays, def('daysOnTarget').tiers),
        target.totalDays.length,
        bounds,
      ),
    );
  }
  if (input.training) {
    const finished = input.training.finishedDays.filter((day) => !isAfter(day, today));
    const weekly = weeklyConsistency(finished, today);
    out.push(
      evaluation(def('firstWorkout'), countMilestones(finished, [1]), undefined, bounds),
      evaluation(def('workouts'), countMilestones(finished, def('workouts').tiers), finished.length, bounds),
      evaluation(def('consistency'), fromRuns(weekly.runs, def('consistency').tiers), weekly.current, bounds),
    );
  }
  return out;
}
