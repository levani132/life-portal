import type { Measure, RankBasis, RankStandards } from '@life-portal/shared-types';
import { addDays } from './dates';
import {
  RANK_BENCHMARKS,
  RANK_WINDOW_DAYS,
  benchmarkFor,
  sessionResults,
  type BenchmarkVersion,
  type ExerciseStandard,
  type RankSet,
} from './strength-ranks';
import type { Season } from './tournaments';

/**
 * Tournament scoring (#12, owner-approved 2026-11-13). Pure: the caller supplies the sets.
 *
 *   improvement      = max(0, best / baseline − 1)
 *   improvementBonus = min(5%, improvement / 15% × 5%)       (linear to +15%, then capped)
 *   tournamentScore  = best × (1 + improvementBonus)
 *
 * `best` is the best valid **strength** score of the season: the normalised one-rep-max score
 * (or reps), never the rank's separate work-capacity bonus. `baseline` is the same measure over
 * the 90 days before the lock, frozen at the lock. No points for workouts, sets or volume, and no
 * penalty for getting weaker. Integer arithmetic throughout so ties are exact.
 */

/** The cap on the improvement bonus: +5%, in basis points. */
export const TOURNAMENT_BONUS_MAX_BP = 500;
/** The improvement at which the bonus reaches the cap: +15%, in basis points. */
export const TOURNAMENT_BONUS_FULL_AT_BP = 1500;

/** A workout's best set under a standard, scored without the work-capacity bonus. */
export interface StrengthBest {
  score: number;
  basis: RankBasis;
}

/**
 * The best per-workout strength score among sets dated `from`–`to` (inclusive). Uses the rank
 * rules unchanged: warm-ups, machine sets on a free-weight standard, sets without a fresh weigh-in
 * and implausible sets never count. The work-capacity bonus is stripped.
 */
export function bestStrength(
  standard: ExerciseStandard,
  standards: RankStandards,
  sets: readonly RankSet[],
  from: string,
  to: string,
): StrengthBest | undefined {
  let best: StrengthBest | undefined;
  for (const result of sessionResults(standard, standards, sets.filter((set) => set.day >= from && set.day <= to))) {
    const score = result.basis.strengthScore ?? result.score;
    if (!best || score > best.score) {
      const { hardSets: _hardSets, bonusPercent: _bonusPercent, strengthScore: _strengthScore, ...basis } = result.basis;
      best = { score, basis };
    }
  }
  return best;
}

/**
 * The standard a tournament is scored under: the benchmark version frozen at the lock when it
 * still exists, otherwise the current one with `changed: true` (a draft was replaced). Undefined
 * when the exercise has no standard for this measure.
 */
export function tournamentStandard(
  seedKey: string | undefined,
  measure: Measure,
  lockedVersion: string | undefined,
  today: string,
  versions: readonly BenchmarkVersion[] = RANK_BENCHMARKS,
): { standard: ExerciseStandard; version: string; changed: boolean } | undefined {
  if (!seedKey) return undefined;
  const locked = lockedVersion ? versions.find((version) => version.version === lockedVersion) : undefined;
  const chosen = locked ?? benchmarkFor(today, versions);
  const standard = chosen.exercises[seedKey];
  if (!standard || standard.measure !== measure) return undefined;
  return { standard, version: chosen.version, changed: !!lockedVersion && chosen.version !== lockedVersion };
}

/** The days a season's baseline and its competition are measured over. */
export function scoringWindows(target: Pick<Season, 'firstDay' | 'lastDay'>) {
  const baselineTo = addDays(target.firstDay, -1);
  return {
    /** The 90 days before the lock: the same window as a current rank. */
    baselineFrom: addDays(baselineTo, -(RANK_WINDOW_DAYS - 1)),
    baselineTo,
    seasonFrom: target.firstDay,
    seasonTo: target.lastDay,
  };
}

export interface TournamentScore {
  /** The final tournament score, in the same units as `strengthScore`. */
  score: number;
  /** The season's best valid strength score. */
  strengthScore: number;
  /** The frozen baseline. */
  baseline: number;
  /** Improvement over the baseline, basis points, never negative (rounded down). */
  improvementBp: number;
  /** The bonus applied, basis points, 0–500 (rounded down). */
  bonusBp: number;
  /** The bonus was not applied because the standards changed after the lock. */
  bonusWithheld?: 'standards_changed';
}

/**
 * One entrant's tournament score. Improvement and bonus are rounded **down** to a basis point, so
 * rounding never adds a bonus that wasn't earned; the score is rounded to the nearest unit. A
 * missing or zero baseline, or `withholdBonus`, gives no bonus: improvement is never invented.
 */
export function tournamentScore(strengthScore: number, baseline: number, withholdBonus = false): TournamentScore {
  const improvementBp = baseline > 0 ? Math.max(0, Math.floor(((strengthScore - baseline) * 10_000) / baseline)) : 0;
  const earnedBp = Math.min(TOURNAMENT_BONUS_MAX_BP, Math.floor((improvementBp * TOURNAMENT_BONUS_MAX_BP) / TOURNAMENT_BONUS_FULL_AT_BP));
  const bonusBp = withholdBonus ? 0 : earnedBp;
  return {
    score: Math.round((strengthScore * (10_000 + bonusBp)) / 10_000),
    strengthScore,
    baseline,
    improvementBp,
    bonusBp,
    ...(withholdBonus && earnedBp > 0 ? { bonusWithheld: 'standards_changed' as const } : {}),
  };
}

/**
 * Orders a group by descending tournament score. Exactly equal scores share a place (1, 1, 3);
 * there is no tie-break by volume or workouts. Rows without a score (no valid set this season)
 * come last with no place. Equal rows keep their input order.
 */
export function placeStandings<T extends { score?: number }>(rows: readonly T[]): (T & { place?: number })[] {
  const scored = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.score !== undefined)
    .sort((a, b) => (b.row.score as number) - (a.row.score as number) || a.index - b.index);
  const out: (T & { place?: number })[] = [];
  scored.forEach(({ row }, i) => {
    const previous = out[i - 1];
    const place = previous && previous.score === row.score ? (previous.place as number) : i + 1;
    out.push({ ...row, place });
  });
  for (const row of rows) if (row.score === undefined) out.push({ ...row });
  return out;
}
