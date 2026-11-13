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
/** The most the work-capacity part can add to a workout's score, in percent. */
export const RANK_WORK_CAPACITY_MAX_PERCENT = 5;
/** A hard set reaches at least this share of the workout's best set. */
export const RANK_HARD_SET_FRACTION = 0.75;

export interface ExerciseStandard {
  method: RankMethod;
  /** The measure the standard assumes; a set logged under another one is not comparable. */
  measure: Measure;
  /** Where each of the 8 tiers starts, in score units, for each standards set. */
  starts: Record<RankStandards, number[]>;
  /**
   * A machine or cable exercise. Its sets count with a specific machine attached; a free-weight
   * standard's sets do not, because a machine is not the lift the standard describes.
   */
  machine?: boolean;
  /** How load is read, shown with the rank (e.g. "The weight of one dumbbell."). */
  note?: string;
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

/** Thousandths of body weight, from multiples: `bw(1.1)` → 1100. */
const bw = (...multiples: number[]) => multiples.map((m) => Math.round(m * 1000));
/** Rounds score units to hundredths of body weight. */
const r10 = (value: number) => Math.round(value / 10) * 10;

/**
 * Women's thresholds as a share of men's, by movement family, after each is scaled to its own
 * reference body weight. From the sex-difference research (women ≈ 50–60% of men's upper-body and
 * 60–70% of lower-body strength in absolute terms; closer once body size is scaled out) and the
 * per-lift women/men ratios of the standards tables. See docs/modules/training.md.
 */
export const RANK_WOMEN_FACTORS = { press: 0.7, pull: 0.72, bodyweightPull: 0.85, legs: 0.78, hipThrust: 0.8 } as const;

type Family = keyof typeof RANK_WOMEN_FACTORS;

interface LiftOptions {
  measure?: Measure;
  machine?: boolean;
  note?: string;
}

/** A load standard: men's tier starts as body-weight multiples, women's derived by family. */
const lift = (men: number[], family: Family, options: LiftOptions = {}): ExerciseStandard => ({
  method: 'e1rm',
  measure: options.measure ?? 'weight_reps',
  starts: { men, women: men.map((value) => r10(value * RANK_WOMEN_FACTORS[family])) },
  ...(options.machine ? { machine: true } : {}),
  ...(options.note ? { note: options.note } : {}),
});

/** A variant: another lift's men's standard times a ratio (e.g. incline ≈ 0.80 × flat bench). */
const variant = (base: number[], ratio: number, family: Family, options: LiftOptions = {}) =>
  lift(base.map((value) => r10(value * ratio)), family, options);

const PER_DUMBBELL = 'The weight of one dumbbell.';
const STACK = 'The weight on the stack or the plates loaded; machines differ, so compare like with like.';

// Base lifts, men, Explorer → Legend (Initiate starts at 0).
const BACK_SQUAT = bw(0, 0.75, 1.1, 1.5, 1.85, 2.2, 2.5, 2.85);
const DEADLIFT = bw(0, 0.9, 1.3, 1.75, 2.15, 2.55, 2.9, 3.25);
const BENCH = bw(0, 0.55, 0.85, 1.1, 1.4, 1.65, 1.9, 2.15);
/** Explorer ≈ one strict rep: scaled, one pull-up at 55 kg scores 0.88 and at 110 kg 1.11. */
const PULL_UP = bw(0, 0.85, 1.05, 1.2, 1.35, 1.55, 1.75, 1.95);

const STANDARDS_V1_DRAFT_2: Record<string, ExerciseStandard> = {
  // Squat and hinge
  'fedb:Barbell_Squat': lift(BACK_SQUAT, 'legs'),
  'fedb:Barbell_Full_Squat': lift(BACK_SQUAT, 'legs'),
  'fedb:Front_Barbell_Squat': variant(BACK_SQUAT, 0.8, 'legs'),
  'fedb:Front_Squat_Clean_Grip': variant(BACK_SQUAT, 0.8, 'legs'),
  'fedb:Barbell_Deadlift': lift(DEADLIFT, 'legs'),
  'fedb:Sumo_Deadlift': lift(DEADLIFT, 'legs'),
  'fedb:Romanian_Deadlift': variant(DEADLIFT, 0.75, 'legs'),
  'fedb:Stiff-Legged_Barbell_Deadlift': variant(DEADLIFT, 0.75, 'legs'),
  'fedb:Barbell_Hip_Thrust': variant(BACK_SQUAT, 1.3, 'hipThrust'),
  // Press
  'fedb:Barbell_Bench_Press_-_Medium_Grip': lift(BENCH, 'press'),
  'fedb:Wide-Grip_Barbell_Bench_Press': lift(BENCH, 'press'),
  'fedb:Bench_Press_-_Powerlifting': lift(BENCH, 'press'),
  'fedb:Decline_Barbell_Bench_Press': lift(BENCH, 'press'),
  'fedb:Close-Grip_Barbell_Bench_Press': variant(BENCH, 0.9, 'press'),
  'fedb:Barbell_Incline_Bench_Press_-_Medium_Grip': variant(BENCH, 0.8, 'press'),
  'fedb:Standing_Military_Press': variant(BENCH, 0.65, 'press'),
  'fedb:Barbell_Shoulder_Press': variant(BENCH, 0.65, 'press'),
  'fedb:Seated_Barbell_Military_Press': variant(BENCH, 0.65, 'press'),
  'fedb:Dumbbell_Bench_Press': variant(BENCH, 0.4, 'press', { note: PER_DUMBBELL }),
  'fedb:Incline_Dumbbell_Press': variant(BENCH, 0.34, 'press', { note: PER_DUMBBELL }),
  'fedb:Dumbbell_Shoulder_Press': variant(BENCH, 0.32, 'press', { note: PER_DUMBBELL }),
  'fedb:Seated_Dumbbell_Press': variant(BENCH, 0.32, 'press', { note: PER_DUMBBELL }),
  // Pull
  'fedb:Bent_Over_Barbell_Row': variant(BENCH, 0.85, 'pull'),
  'fedb:One-Arm_Dumbbell_Row': variant(BENCH, 0.45, 'pull', { note: 'The weight of the dumbbell, one arm at a time.' }),
  // Bodyweight: body weight plus any added load.
  'fedb:Pullups': lift(PULL_UP, 'bodyweightPull', { measure: 'bodyweight_reps' }),
  'fedb:Chin-Up': variant(PULL_UP, 1.03, 'bodyweightPull', { measure: 'bodyweight_reps' }),
  'fedb:Dips_-_Triceps_Version': lift(bw(0, 0.85, 1.15, 1.4, 1.65, 1.9, 2.1, 2.3), 'bodyweightPull', { measure: 'bodyweight_reps' }),
  'fedb:Pushups': {
    method: 'reps',
    measure: 'bodyweight_reps',
    starts: { men: [0, 5, 12, 22, 30, 40, 55, 75], women: [0, 2, 6, 12, 18, 25, 35, 45] },
  },
  // Machines and cables: rougher, because loads differ between machines.
  'fedb:Leg_Press': variant(BACK_SQUAT, 1.75, 'legs', { machine: true, note: STACK }),
  'fedb:Leg_Extensions': variant(BACK_SQUAT, 0.78, 'legs', { machine: true, note: STACK }),
  'fedb:Seated_Leg_Curl': variant(BACK_SQUAT, 0.63, 'legs', { machine: true, note: STACK }),
  'fedb:Wide-Grip_Lat_Pulldown': variant(BENCH, 0.86, 'pull', { machine: true, note: STACK }),
  'fedb:Close-Grip_Front_Lat_Pulldown': variant(BENCH, 0.86, 'pull', { machine: true, note: STACK }),
  'fedb:Seated_Cable_Rows': variant(BENCH, 0.89, 'pull', { machine: true, note: STACK }),
  'fedb:Leverage_Chest_Press': variant(BENCH, 0.9, 'press', { machine: true, note: STACK }),
  'fedb:Machine_Bench_Press': variant(BENCH, 0.9, 'press', { machine: true, note: STACK }),
};

/**
 * Every published benchmark, oldest first. A version is never edited once it is no longer a
 * draft: a change is a new version with a later `from`, so ranks earned under an older one stand.
 * Drafts are replaced in place until the owner freezes v1 (docs/modules/training.md).
 */
export const RANK_BENCHMARKS: readonly BenchmarkVersion[] = [
  {
    version: 'v1-draft-2',
    draft: true,
    from: '0000-01-01',
    basis:
      'Draft standards for review, informed by published coaching standards and app-user percentiles, ' +
      'with the top tier kept below world-record lifts. Your estimated one-rep max is scaled to an 80 kg ' +
      '(men) or 60 kg (women) body weight with a 2/3 exponent. Not measured from LifePortal members, ' +
      'and not percentiles of anyone.',
    exercises: STANDARDS_V1_DRAFT_2,
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
  if (set.machine && !standard.machine) return { skip: 'machine' };
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

interface SessionResult {
  score: number;
  basis: RankBasis;
}

type Excluded = ExerciseRankView['excluded'];

/**
 * Each workout's score under one standard: its best valid set, raised for `e1rm` by one percent per
 * further hard set in that workout (at least `RANK_HARD_SET_FRACTION` of the best), at most
 * `RANK_WORK_CAPACITY_MAX_PERCENT`. Sets past the cap add nothing, so volume cannot dominate.
 * Implausible sets are left out first; `excluded`, when given, counts what was left out and why.
 */
export function sessionResults(
  standard: ExerciseStandard,
  standards: RankStandards,
  sets: readonly RankSet[],
  excluded?: Excluded,
): SessionResult[] {
  const ceiling = standard.starts[standards][7] * RANK_IMPLAUSIBLE_FACTOR;
  const bySession = new Map<string, { score: number; basis: RankBasis }[]>();
  for (const set of sets) {
    const scored = scoreSet(standard, standards, set);
    if ('skip' in scored) {
      if (excluded && scored.skip !== 'invalid') excluded[scored.skip]++;
      continue;
    }
    if (scored.score > ceiling) {
      if (excluded) excluded.implausible++;
      continue;
    }
    const list = bySession.get(set.sessionId) ?? [];
    list.push(scored);
    bySession.set(set.sessionId, list);
  }
  const results: SessionResult[] = [];
  for (const scored of bySession.values()) {
    const top = scored.reduce((best, item) => (item.score > best.score ? item : best));
    if (standard.method !== 'e1rm') {
      results.push(top);
      continue;
    }
    const hardSets = scored.filter((item) => item.score >= top.score * RANK_HARD_SET_FRACTION).length;
    const bonusPercent = Math.min(RANK_WORK_CAPACITY_MAX_PERCENT, hardSets - 1);
    results.push({
      score: Math.round((top.score * (100 + bonusPercent)) / 100),
      basis: { ...top.basis, strengthScore: top.score, hardSets, bonusPercent },
    });
  }
  return results;
}

/**
 * An exercise's current and highest-ever rank. Current: the best workout in the last 90 days
 * under today's benchmark; none → `inactive` (never a lower rank). Highest: the best milestone any
 * workout reached under the benchmark that applied on its day, so a later version never takes one
 * away. Sets after `today` are ignored; an implausible set is excluded and counted.
 */
export function exerciseRank(input: RankInput, versions: readonly BenchmarkVersion[] = RANK_BENCHMARKS): ExerciseRankView {
  const excluded: Excluded = { implausible: 0, noBodyWeight: 0, machine: 0 };
  const base = { exerciseId: input.exerciseId, windowDays: RANK_WINDOW_DAYS, excluded };
  const todayVersion = benchmarkFor(input.today, versions);
  const standard = input.seedKey ? todayVersion.exercises[input.seedKey] : undefined;
  if (!standard || standard.measure !== input.measure) return { ...base, status: 'unranked', reason: 'no_benchmark' };
  if (!input.standards) return { ...base, status: 'unranked', reason: 'needs_standards' };
  const standards = input.standards;
  const benchmark: RankBenchmark = {
    version: todayVersion.version,
    draft: todayVersion.draft,
    method: standard.method,
    standards,
    ...(standard.method === 'e1rm' ? { referenceBodyWeightGrams: RANK_REFERENCE_BODY_WEIGHT_GRAMS[standards] } : {}),
    tierStarts: standard.starts[standards],
    basis: todayVersion.basis,
    ...(standard.note ? { note: standard.note } : {}),
    ...(standard.machine ? { machine: true } : {}),
  };
  const sets = input.sets.filter((set) => set.day <= input.today);

  // Highest ever: each set under the version of its own day.
  let highest: (RankPosition & { version: string }) | undefined;
  const byVersion = new Map<BenchmarkVersion, RankSet[]>();
  for (const set of sets) {
    const version = benchmarkFor(set.day, versions);
    byVersion.set(version, [...(byVersion.get(version) ?? []), set]);
  }
  for (const [version, versionSets] of byVersion) {
    const own = version.exercises[input.seedKey as string];
    if (!own || own.measure !== input.measure) continue;
    for (const result of sessionResults(own, standards, versionSets, excluded)) {
      const position = rankPosition(result.score, own.starts[standards], result.basis);
      if (
        !highest ||
        position.milestone > highest.milestone ||
        (position.milestone === highest.milestone && version.version === highest.version && position.score > highest.score)
      ) {
        highest = { ...position, version: version.version };
      }
    }
  }

  // Current: the window's workouts under today's version.
  const windowStart = addDays(input.today, -(RANK_WINDOW_DAYS - 1));
  let current: RankPosition | undefined;
  for (const result of sessionResults(standard, standards, sets.filter((set) => set.day >= windowStart))) {
    if (!current || result.score > current.score) current = rankPosition(result.score, standard.starts[standards], result.basis);
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
