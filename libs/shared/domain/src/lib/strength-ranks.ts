import {
  RANK_DIVISIONS,
  RANK_TIERS,
  type ExerciseRankView,
  type Measure,
  type RankBasis,
  type RankBenchmark,
  type RankMethod,
  type RankPosition,
  type RankStandards,
} from '@life-portal/shared-types';
import { addDays } from './dates';
import { effectiveLoadGrams, estimateOneRepMax, type BodyWeight, type ProgressSet } from './training';

/**
 * Strength ranks (issue #5b): personal, per exercise, against fixed published standards. Pure;
 * "today" is always an argument. Nothing is stored: the API reads the member's own sets and
 * weigh-ins and calls `exerciseRank`. See docs/modules/training.md, "Strength ranks".
 */

/** Days a set keeps the current rank. After that the exercise is inactive, never demoted. */
export const RANK_WINDOW_DAYS = 90;
/** A weigh-in older than this before the set is too stale to scale a lift by. */
export const RANK_BODY_WEIGHT_MAX_AGE_DAYS = 90;
/** A score this far past where Legend starts is taken as a logging error and not counted. */
export const RANK_IMPLAUSIBLE_FACTOR = 1.5;
/** Body weights the e1RM standards are scaled to. */
export const RANK_REFERENCE_BODY_WEIGHT_GRAMS: Record<RankStandards, number> = { men: 80_000, women: 60_000 };
/** Allometric exponent: strength grows with about body mass^(2/3), not in proportion to it. */
export const RANK_ALLOMETRIC_EXPONENT = 2 / 3;

interface ExerciseStandard {
  method: RankMethod;
  /** The measure the standard assumes; a set logged under another one is not comparable. */
  measure: Measure;
  /** Where each of the 8 tiers starts, in score units, for each standards set. */
  starts: Record<RankStandards, number[]>;
}

export interface BenchmarkVersion {
  version: string;
  draft: boolean;
  /** The first set day this version applies to; it applies until the next version's `from`. */
  from: string;
  basis: string;
  /** Keyed by catalogue `seedKey`: only these exact exercises are ranked. */
  exercises: Record<string, ExerciseStandard>;
}

const e1rm = (men: number[], women: number[], measure: Measure = 'weight_reps'): ExerciseStandard => ({
  method: 'e1rm',
  measure,
  starts: { men, women },
});

/**
 * Every published benchmark, oldest first. A version is never edited once it is no longer a
 * draft: a change is a new version with a later `from`, so ranks earned under an older one stand.
 */
export const RANK_BENCHMARKS: readonly BenchmarkVersion[] = [
  {
    version: 'v1-draft',
    draft: true,
    from: '0000-01-01',
    basis:
      'Draft standards set by the app for review: an estimated one-rep max scaled to an 80 kg (men) ' +
      'or 60 kg (women) body weight with a 2/3 exponent, against coaching-style milestones. Not measured ' +
      'from LifePortal members, and not competition records.',
    exercises: {
      'fedb:Barbell_Bench_Press_-_Medium_Grip': e1rm([0, 500, 750, 1000, 1250, 1500, 1750, 2000], [0, 300, 450, 600, 750, 900, 1050, 1200]),
      'fedb:Barbell_Squat': e1rm([0, 750, 1000, 1250, 1500, 1850, 2200, 2600], [0, 550, 750, 950, 1150, 1400, 1650, 1950]),
      'fedb:Barbell_Full_Squat': e1rm([0, 750, 1000, 1250, 1500, 1850, 2200, 2600], [0, 550, 750, 950, 1150, 1400, 1650, 1950]),
      'fedb:Front_Barbell_Squat': e1rm([0, 600, 800, 1000, 1200, 1500, 1750, 2100], [0, 450, 600, 750, 900, 1100, 1300, 1550]),
      'fedb:Barbell_Deadlift': e1rm([0, 1000, 1250, 1500, 1850, 2200, 2600, 3000], [0, 750, 950, 1150, 1400, 1650, 1950, 2250]),
      'fedb:Standing_Military_Press': e1rm([0, 350, 500, 650, 800, 950, 1100, 1300], [0, 220, 320, 420, 520, 620, 720, 850]),
      'fedb:Bent_Over_Barbell_Row': e1rm([0, 500, 650, 800, 1000, 1200, 1400, 1600], [0, 350, 450, 550, 700, 850, 1000, 1150]),
      'fedb:Pullups': e1rm([0, 800, 1000, 1150, 1300, 1450, 1650, 1900], [0, 600, 800, 950, 1080, 1200, 1350, 1550], 'bodyweight_reps'),
      'fedb:Chin-Up': e1rm([0, 800, 1000, 1150, 1300, 1450, 1650, 1900], [0, 600, 800, 950, 1080, 1200, 1350, 1550], 'bodyweight_reps'),
      'fedb:Dips_-_Triceps_Version': e1rm([0, 900, 1100, 1250, 1400, 1600, 1850, 2100], [0, 650, 850, 1000, 1150, 1300, 1500, 1750], 'bodyweight_reps'),
      'fedb:Pushups': {
        method: 'reps',
        measure: 'bodyweight_reps',
        starts: { men: [0, 5, 10, 20, 30, 40, 55, 70], women: [0, 2, 5, 10, 18, 26, 36, 48] },
      },
    },
  },
];

/** The version that applies to a set done on `day`. */
export function benchmarkFor(day: string, versions: readonly BenchmarkVersion[] = RANK_BENCHMARKS): BenchmarkVersion {
  let found = versions[0];
  for (const version of versions) if (version.from <= day) found = version;
  return found;
}

/** Division boundaries: each tier's width split in three; Legend's width is Master's. */
export function milestoneStarts(tierStarts: readonly number[]): number[] {
  const out: number[] = [];
  tierStarts.forEach((start, i) => {
    const width = (tierStarts[i + 1] ?? start + (start - tierStarts[i - 1])) - start;
    for (let d = 0; d < 3; d++) out.push(Math.round(start + (width * d) / 3));
  });
  return out;
}

/** Where a score sits: its milestone, the next one's start and the progress to it. */
export function rankPosition(score: number, tierStarts: readonly number[], basis: RankBasis): RankPosition {
  const starts = milestoneStarts(tierStarts);
  let milestone = 0;
  for (let i = 0; i < starts.length; i++) if (score >= starts[i]) milestone = i;
  const nextScore = starts[milestone + 1];
  const from = starts[milestone];
  return {
    milestone,
    tier: RANK_TIERS[Math.floor(milestone / 3)],
    division: RANK_DIVISIONS[milestone % 3],
    score,
    ...(nextScore === undefined ? {} : { nextScore }),
    progress: nextScore === undefined ? 1000 : Math.min(999, Math.floor(((score - from) * 1000) / (nextScore - from))),
    basis,
  };
}

/** The weigh-in on or before `day`, if it is no older than `RANK_BODY_WEIGHT_MAX_AGE_DAYS`. */
export function freshBodyWeight(body: BodyWeight | undefined, day: string): BodyWeight | undefined {
  return body && body.day >= addDays(day, -RANK_BODY_WEIGHT_MAX_AGE_DAYS) ? body : undefined;
}

/** A set as ranks see it: a progress set, and whether a specific machine was used. */
export interface RankSet extends ProgressSet {
  /** Logged with a machine attached: not the free-weight lift the standard describes. */
  machine?: boolean;
}

type Scored = { score: number; basis: RankBasis } | { skip: 'noBodyWeight' | 'machine' | 'invalid' };

/** One set's score under a standard, or why it has none. */
export function scoreSet(standard: ExerciseStandard, standards: RankStandards, set: RankSet): Scored {
  if (set.type === 'warmup' || !set.reps || set.reps < 1) return { skip: 'invalid' };
  if (set.machine) return { skip: 'machine' };
  const base = { setId: set.id, sessionId: set.sessionId, day: set.day, reps: set.reps };
  if (standard.method === 'reps') return { score: set.reps, basis: base };
  const body = freshBodyWeight(set.body, set.day);
  if (!body) return { skip: 'noBodyWeight' };
  const load = effectiveLoadGrams(standard.measure, set, body);
  const oneRepMax = load && estimateOneRepMax(load.grams, set.reps);
  if (!load || !oneRepMax) return { skip: 'invalid' };
  const reference = RANK_REFERENCE_BODY_WEIGHT_GRAMS[standards];
  const scaled = oneRepMax * Math.pow(reference / body.weightGrams, RANK_ALLOMETRIC_EXPONENT);
  return {
    score: Math.round((scaled * 1000) / reference),
    basis: {
      ...base,
      loadGrams: load.grams,
      oneRepMaxGrams: oneRepMax,
      bodyWeightGrams: body.weightGrams,
      bodyWeightDay: body.day,
    },
  };
}

export interface RankInput {
  exerciseId: string;
  /** The catalogue row's `seedKey`; private exercises have none and are never ranked. */
  seedKey?: string;
  measure: Measure;
  standards?: RankStandards;
  /** Every set of the exercise, finished sessions only. */
  sets: readonly RankSet[];
  today: string;
}

/**
 * An exercise's current and highest-ever rank. Current: the best valid set in the last 90 days
 * under today's benchmark; none → `inactive` (never a lower rank). Highest: the best milestone any
 * valid set reached under the benchmark that applied on its day, so a later version never takes
 * one away. Sets after `today` are ignored; an implausible score is excluded and counted.
 */
export function exerciseRank(input: RankInput, versions: readonly BenchmarkVersion[] = RANK_BENCHMARKS): ExerciseRankView {
  const excluded = { implausible: 0, noBodyWeight: 0, machine: 0 };
  const base = { exerciseId: input.exerciseId, windowDays: RANK_WINDOW_DAYS, excluded };
  const todayVersion = benchmarkFor(input.today, versions);
  const standard = input.seedKey ? todayVersion.exercises[input.seedKey] : undefined;
  if (!standard || standard.measure !== input.measure) return { ...base, status: 'unranked', reason: 'no_benchmark' };
  const benchmarkView = (standards: RankStandards): RankBenchmark => ({
    version: todayVersion.version,
    draft: todayVersion.draft,
    method: standard.method,
    standards,
    ...(standard.method === 'e1rm' ? { referenceBodyWeightGrams: RANK_REFERENCE_BODY_WEIGHT_GRAMS[standards] } : {}),
    tierStarts: standard.starts[standards],
    basis: todayVersion.basis,
  });
  if (!input.standards) return { ...base, status: 'unranked', reason: 'needs_standards' };
  const standards = input.standards;
  const benchmark = benchmarkView(standards);
  const windowStart = addDays(input.today, -(RANK_WINDOW_DAYS - 1));

  let current: RankPosition | undefined;
  let highest: (RankPosition & { version: string }) | undefined;
  for (const set of input.sets) {
    if (set.day > input.today) continue;
    const version = benchmarkFor(set.day, versions);
    const own = version.exercises[input.seedKey as string];
    if (own && own.measure === input.measure) {
      const scored = scoreSet(own, standards, set);
      if ('skip' in scored) {
        if (scored.skip !== 'invalid') excluded[scored.skip]++;
      } else if (scored.score > own.starts[standards][7] * RANK_IMPLAUSIBLE_FACTOR) {
        excluded.implausible++;
      } else {
        const position = rankPosition(scored.score, own.starts[standards], scored.basis);
        if (!highest || position.milestone > highest.milestone || (position.milestone === highest.milestone && version.version === highest.version && position.score > highest.score)) {
          highest = { ...position, version: version.version };
        }
      }
    }
    if (set.day < windowStart) continue;
    const now = scoreSet(standard, standards, set);
    if ('skip' in now || now.score > standard.starts[standards][7] * RANK_IMPLAUSIBLE_FACTOR) continue;
    if (!current || now.score > current.score) current = rankPosition(now.score, standard.starts[standards], now.basis);
  }
  if (current) {
    return {
      ...base,
      status: 'ranked',
      benchmark,
      current,
      ...(highest ? { highest } : {}),
      currentUntil: addDays(current.basis.day, RANK_WINDOW_DAYS - 1),
    };
  }
  if (highest) return { ...base, status: 'inactive', benchmark, highest };
  return {
    ...base,
    status: 'unranked',
    reason: excluded.noBodyWeight > 0 ? 'needs_body_weight' : 'no_valid_sets',
    benchmark,
  };
}

/** "Veteran II" */
export const rankLabel = (position: Pick<RankPosition, 'tier' | 'division'>) => `${position.tier} ${position.division}`;
