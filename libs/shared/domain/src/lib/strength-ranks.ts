import {
  RANK_DIVISIONS,
  RANK_TIERS,
  type ExerciseRankView,
  type Measure,
  type RankBasis,
  type RankBenchmark,
  type RankDivision,
  type RankMethod,
  type RankPosition,
  type RankStandards,
  type RankTier,
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
  /** How load is read, shown with the rank and while logging (e.g. "The weight of one dumbbell."). */
  note?: string;
  /**
   * Weaker evidence: an isolation, cable, machine, kettlebell or endurance standard extrapolated
   * from the main lifts by typical ratios rather than published tables of its own. Shown as such.
   */
  provisional?: boolean;
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
  /**
   * How much wider than the base lift the tiers spread: tier i is the base's tier i times the
   * ratio times (base_i / base_Explorer)^spread. App-user data puts an elite isolation or machine
   * lift 4–7× its beginner figure where the base barbell lift is about 3× (see `spreadFor`).
   */
  spread?: number;
  machine?: boolean;
  note?: string;
  provisional?: boolean;
}

/** A load standard: men's tier starts as body-weight multiples, women's derived by family. */
const lift = (men: number[], family: Family, options: LiftOptions = {}): ExerciseStandard => ({
  method: 'e1rm',
  measure: options.measure ?? 'weight_reps',
  starts: { men, women: men.map((value) => r10(value * RANK_WOMEN_FACTORS[family])) },
  ...(options.machine ? { machine: true } : {}),
  ...(options.note ? { note: options.note } : {}),
  ...(options.provisional ? { provisional: true } : {}),
});

/** A variant: another lift's men's standard times a ratio (e.g. incline ≈ 0.80 × flat bench). */
const variant = (base: number[], ratio: number, family: Family, options: LiftOptions = {}) =>
  lift(
    base.map((value) => r10(value * ratio * (value && options.spread ? Math.pow(value / base[1], options.spread) : 1))),
    family,
    options,
  );

/**
 * Spread for a ratio standard (rc1 plausibility review, #5): small raises, flyes and kickbacks
 * (≤ 0.15 of the base) 0.5; other isolation-sized lifts (< 0.6) and every machine 0.25; compound
 * free-weight variants none. Checked against Strength Level's app-user tables for lateral raise,
 * reverse fly, kickback, curl, pushdown and leg press (docs/modules/rank-standards.md).
 */
const spreadFor = (ratio: number, isMachine = false) => (ratio <= 0.15 ? 0.5 : ratio < 0.6 || isMachine ? 0.25 : 0);

// How load is read. Shown with the rank and while logging, so a set is entered the same way the
// standard assumes.
const BAR = 'The bar and plates together.';
const EZ_BAR = 'The EZ bar and plates together.';
const PER_DUMBBELL = 'The weight of one dumbbell.';
const ONE_ARM_DUMBBELL = 'The weight of the dumbbell, one arm at a time.';
const ONE_DUMBBELL_BOTH_HANDS = 'The weight of the one dumbbell, held in both hands.';
const PER_KETTLEBELL = 'The weight of one kettlebell.';
const ONE_KETTLEBELL = 'The weight of the kettlebell.';
const STACK = 'The weight on the stack or the plates loaded; machines differ, so compare like with like.';
const STACK_PER_SIDE = 'The weight on one stack (each side).';
const STACK_ONE_ARM = 'The weight on the stack, one arm or leg at a time.';
const PLATES_LOADED = 'The plates loaded, not the sled or carriage; machines differ, so compare like with like.';
const SMITH = 'The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like.';
const BODY = 'Your body weight counts automatically; log only weight you add, or the assistance a machine gives you.';
const REPS_ONLY = 'Reps in one set; added weight is not counted, and assisted sets do not count.';
const REPS_ANGLE = 'Reps in one set, at a body angle you keep the same; added weight is not counted.';

/** A standard extrapolated by ratio: shown as provisional. */
const rough = (base: number[], ratio: number, family: Family, options: LiftOptions = {}) =>
  variant(base, ratio, family, { spread: spreadFor(ratio, options.machine), ...options, provisional: true });
/** A machine or cable standard: rougher by nature, and provisional. */
const machine = (base: number[], ratio: number, family: Family, note = STACK) =>
  variant(base, ratio, family, { machine: true, note, provisional: true, spread: spreadFor(ratio, true) });

/** Reps tiers at least 3 apart, so each splits into three distinct divisions. */
const spaced = (starts: number[]) => starts.reduce<number[]>((out, value, i) => [...out, i === 0 ? 0 : Math.max(value, out[i - 1] + 3)], []);

/** A reps standard (bodyweight endurance). Women's starts are `womenRatio` of men's. */
const reps = (men: number[], womenRatio: number, provisional = true): ExerciseStandard => ({
  method: 'reps',
  measure: 'bodyweight_reps',
  starts: { men: spaced(men), women: spaced(men.map((value) => Math.round(value * womenRatio))) },
  note: REPS_ONLY,
  ...(provisional ? { provisional: true } : {}),
});

// Base lifts, men, Explorer → Legend (Initiate starts at 0).
const BACK_SQUAT = bw(0, 0.75, 1.1, 1.5, 1.85, 2.2, 2.5, 2.85);
const DEADLIFT = bw(0, 0.9, 1.3, 1.75, 2.15, 2.55, 2.9, 3.25);
const BENCH = bw(0, 0.55, 0.85, 1.1, 1.4, 1.65, 1.9, 2.15);
/** Explorer ≈ one strict rep: scaled, one pull-up at 55 kg scores 0.88 and at 110 kg 1.11. */
const PULL_UP = bw(0, 0.85, 1.05, 1.2, 1.35, 1.55, 1.75, 1.95);
/** Bar dips: a few more reps than pull-ups at each level, so slightly higher multiples. */
const DIP = bw(0, 0.85, 1.15, 1.4, 1.65, 1.9, 2.1, 2.3);

const STANDARDS_V1: Record<string, ExerciseStandard> = {
  // Squat and hinge
  'fedb:Barbell_Squat': lift(BACK_SQUAT, 'legs', { note: BAR }),
  'fedb:Barbell_Full_Squat': lift(BACK_SQUAT, 'legs', { note: BAR }),
  'fedb:Front_Barbell_Squat': variant(BACK_SQUAT, 0.8, 'legs', { note: BAR }),
  'fedb:Front_Squat_Clean_Grip': variant(BACK_SQUAT, 0.8, 'legs', { note: BAR }),
  'fedb:Barbell_Deadlift': lift(DEADLIFT, 'legs', { note: BAR }),
  'fedb:Sumo_Deadlift': lift(DEADLIFT, 'legs', { note: BAR }),
  'fedb:Romanian_Deadlift': variant(DEADLIFT, 0.75, 'legs', { note: BAR }),
  'fedb:Stiff-Legged_Barbell_Deadlift': variant(DEADLIFT, 0.75, 'legs', { note: BAR }),
  'fedb:Barbell_Hip_Thrust': variant(BACK_SQUAT, 1.3, 'hipThrust', { note: BAR }),
  // Press
  'fedb:Barbell_Bench_Press_-_Medium_Grip': lift(BENCH, 'press', { note: BAR }),
  'fedb:Wide-Grip_Barbell_Bench_Press': lift(BENCH, 'press', { note: BAR }),
  'fedb:Bench_Press_-_Powerlifting': lift(BENCH, 'press', { note: BAR }),
  'fedb:Decline_Barbell_Bench_Press': lift(BENCH, 'press', { note: BAR }),
  'fedb:Close-Grip_Barbell_Bench_Press': variant(BENCH, 0.9, 'press', { note: BAR }),
  'fedb:Barbell_Incline_Bench_Press_-_Medium_Grip': variant(BENCH, 0.8, 'press', { note: BAR }),
  'fedb:Standing_Military_Press': variant(BENCH, 0.65, 'press', { note: BAR }),
  'fedb:Barbell_Shoulder_Press': variant(BENCH, 0.65, 'press', { note: BAR }),
  'fedb:Seated_Barbell_Military_Press': variant(BENCH, 0.65, 'press', { note: BAR }),
  'fedb:Dumbbell_Bench_Press': variant(BENCH, 0.4, 'press', { note: PER_DUMBBELL }),
  'fedb:Incline_Dumbbell_Press': variant(BENCH, 0.34, 'press', { note: PER_DUMBBELL }),
  'fedb:Dumbbell_Shoulder_Press': variant(BENCH, 0.32, 'press', { note: PER_DUMBBELL }),
  'fedb:Seated_Dumbbell_Press': variant(BENCH, 0.32, 'press', { note: PER_DUMBBELL }),
  // Pull
  'fedb:Bent_Over_Barbell_Row': variant(BENCH, 0.85, 'pull', { note: BAR }),
  'fedb:One-Arm_Dumbbell_Row': variant(BENCH, 0.45, 'pull', { note: ONE_ARM_DUMBBELL }),
  // Bodyweight: body weight plus any added load.
  'fedb:Pullups': lift(PULL_UP, 'bodyweightPull', { measure: 'bodyweight_reps', note: BODY }),
  'fedb:Chin-Up': variant(PULL_UP, 1.03, 'bodyweightPull', { measure: 'bodyweight_reps', note: BODY }),
  'fedb:Dips_-_Triceps_Version': lift(DIP, 'bodyweightPull', { measure: 'bodyweight_reps', note: BODY }),
  // Logged as weight only until catalogue v2 (#5); now body weight plus a signed external load.
  'fedb:Weighted_Pull_Ups': lift(PULL_UP, 'bodyweightPull', { measure: 'bodyweight_reps', note: BODY }),
  'fedb:Parallel_Bar_Dip': lift(DIP, 'bodyweightPull', { measure: 'bodyweight_reps', note: BODY }),
  'fedb:Dips_-_Chest_Version': lift(DIP, 'bodyweightPull', { measure: 'bodyweight_reps', note: BODY }),
  'fedb:Mixed_Grip_Chin': variant(PULL_UP, 1, 'bodyweightPull', { measure: 'bodyweight_reps', note: BODY, provisional: true }),
  // Rings move, so the same strength makes fewer reps than on a fixed bar.
  'fedb:Ring_Dips': variant(DIP, 0.85, 'bodyweightPull', { measure: 'bodyweight_reps', note: BODY, provisional: true }),
  'fedb:Pushups': {
    method: 'reps',
    measure: 'bodyweight_reps',
    starts: { men: [0, 5, 12, 22, 30, 40, 55, 75], women: [0, 3, 6, 12, 18, 25, 35, 45] },
    note: REPS_ONLY,
  },
  // Machines and cables: rougher, because loads differ between machines.
  'fedb:Leg_Press': variant(BACK_SQUAT, 1.75, 'legs', { machine: true, note: STACK, spread: 0.25 }),
  'fedb:Leg_Extensions': variant(BACK_SQUAT, 0.78, 'legs', { machine: true, note: STACK, spread: 0.25 }),
  'fedb:Seated_Leg_Curl': variant(BACK_SQUAT, 0.63, 'legs', { machine: true, note: STACK, spread: 0.25 }),
  'fedb:Wide-Grip_Lat_Pulldown': variant(BENCH, 0.86, 'pull', { machine: true, note: STACK, spread: 0.25 }),
  'fedb:Close-Grip_Front_Lat_Pulldown': variant(BENCH, 0.86, 'pull', { machine: true, note: STACK, spread: 0.25 }),
  'fedb:Seated_Cable_Rows': variant(BENCH, 0.89, 'pull', { machine: true, note: STACK, spread: 0.25 }),
  'fedb:Leverage_Chest_Press': variant(BENCH, 0.9, 'press', { machine: true, note: STACK, spread: 0.25 }),
  'fedb:Machine_Bench_Press': variant(BENCH, 0.9, 'press', { machine: true, note: STACK, spread: 0.25 }),

  // ── Added in v1-draft-3 (#5, owner 2026-11-13: rank much more of the catalogue) ──────────
  // Ratios to the base lifts follow typical coaching-table relationships between lifts. They are
  // extrapolations, so everything below except the close barbell variants is provisional.

  // Barbell squat and hinge variants
  'fedb:Box_Squat': variant(BACK_SQUAT, 0.95, 'legs', { note: BAR }),
  'fedb:Wide_Stance_Barbell_Squat': variant(BACK_SQUAT, 0.95, 'legs', { note: BAR }),
  'fedb:Narrow_Stance_Squats': variant(BACK_SQUAT, 0.9, 'legs', { note: BAR }),
  'fedb:Zercher_Squats': rough(BACK_SQUAT, 0.75, 'legs', { note: BAR }),
  'fedb:Barbell_Hack_Squat': rough(BACK_SQUAT, 0.6, 'legs', { note: BAR }),
  'fedb:Barbell_Lunge': rough(BACK_SQUAT, 0.55, 'legs', { note: BAR }),
  'fedb:Barbell_Walking_Lunge': rough(BACK_SQUAT, 0.55, 'legs', { note: BAR }),
  'fedb:Barbell_Side_Split_Squat': rough(BACK_SQUAT, 0.5, 'legs', { note: BAR }),
  'fedb:Barbell_Step_Ups': rough(BACK_SQUAT, 0.45, 'legs', { note: BAR }),
  'fedb:Barbell_Glute_Bridge': rough(BACK_SQUAT, 1.1, 'hipThrust', { note: BAR }),
  'fedb:Deficit_Deadlift': variant(DEADLIFT, 0.92, 'legs', { note: BAR }),
  'fedb:Rack_Pulls': variant(DEADLIFT, 1.1, 'legs', { note: BAR }),
  'fedb:Trap_Bar_Deadlift': variant(DEADLIFT, 1.05, 'legs', { note: 'The trap bar and plates together.' }),
  'fedb:Good_Morning': rough(DEADLIFT, 0.45, 'legs', { note: BAR }),
  'fedb:Power_Clean': rough(DEADLIFT, 0.6, 'legs', { note: BAR }),
  'fedb:Barbell_Shrug': rough(DEADLIFT, 0.85, 'pull', { note: BAR }),
  'fedb:Standing_Barbell_Calf_Raise': rough(BACK_SQUAT, 0.8, 'legs', { note: BAR }),

  // Barbell and EZ-bar presses, rows and arms
  'fedb:Floor_Press': variant(BENCH, 0.92, 'press', { note: BAR }),
  'fedb:Wide-Grip_Decline_Barbell_Bench_Press': variant(BENCH, 1, 'press', { note: BAR }),
  'fedb:Standing_Barbell_Press_Behind_Neck': rough(BENCH, 0.6, 'press', { note: BAR }),
  'fedb:JM_Press': rough(BENCH, 0.55, 'press', { note: BAR }),
  'fedb:Lying_Triceps_Press': rough(BENCH, 0.4, 'press', { note: EZ_BAR }),
  'fedb:EZ-Bar_Skullcrusher': rough(BENCH, 0.4, 'press', { note: EZ_BAR }),
  'fedb:Standing_Overhead_Barbell_Triceps_Extension': rough(BENCH, 0.35, 'press', { note: BAR }),
  'fedb:Reverse_Grip_Bent-Over_Rows': variant(BENCH, 0.85, 'pull', { note: BAR }),
  'fedb:T-Bar_Row_with_Handle': rough(BENCH, 0.8, 'pull', { note: 'The plates loaded on the bar.' }),
  'fedb:Upright_Barbell_Row': rough(BENCH, 0.5, 'pull', { note: BAR }),
  'fedb:Barbell_Curl': rough(BENCH, 0.5, 'pull', { note: BAR }),
  'fedb:Wide-Grip_Standing_Barbell_Curl': rough(BENCH, 0.47, 'pull', { note: BAR }),
  'fedb:Close-Grip_Standing_Barbell_Curl': rough(BENCH, 0.48, 'pull', { note: BAR }),
  'fedb:EZ-Bar_Curl': rough(BENCH, 0.47, 'pull', { note: EZ_BAR }),
  'fedb:Close-Grip_EZ_Bar_Curl': rough(BENCH, 0.47, 'pull', { note: EZ_BAR }),
  'fedb:Preacher_Curl': rough(BENCH, 0.42, 'pull', { note: BAR }),
  'fedb:Reverse_Barbell_Curl': rough(BENCH, 0.38, 'pull', { note: BAR }),

  // Dumbbells (load per dumbbell unless noted)
  'fedb:Decline_Dumbbell_Bench_Press': rough(BENCH, 0.42, 'press', { note: PER_DUMBBELL }),
  'fedb:Dumbbell_Bench_Press_with_Neutral_Grip': rough(BENCH, 0.38, 'press', { note: PER_DUMBBELL }),
  'fedb:Hammer_Grip_Incline_DB_Bench_Press': rough(BENCH, 0.32, 'press', { note: PER_DUMBBELL }),
  'fedb:One_Arm_Dumbbell_Bench_Press': rough(BENCH, 0.38, 'press', { note: ONE_ARM_DUMBBELL }),
  'fedb:Dumbbell_Floor_Press': rough(BENCH, 0.37, 'press', { note: PER_DUMBBELL }),
  'fedb:Arnold_Dumbbell_Press': rough(BENCH, 0.28, 'press', { note: PER_DUMBBELL }),
  'fedb:Standing_Dumbbell_Press': rough(BENCH, 0.3, 'press', { note: PER_DUMBBELL }),
  'fedb:Dumbbell_One-Arm_Shoulder_Press': rough(BENCH, 0.3, 'press', { note: ONE_ARM_DUMBBELL }),
  'fedb:Dumbbell_Flyes': rough(BENCH, 0.25, 'press', { note: PER_DUMBBELL }),
  'fedb:Incline_Dumbbell_Flyes': rough(BENCH, 0.22, 'press', { note: PER_DUMBBELL }),
  'fedb:Side_Lateral_Raise': rough(BENCH, 0.13, 'press', { note: PER_DUMBBELL }),
  'fedb:Seated_Side_Lateral_Raise': rough(BENCH, 0.12, 'press', { note: PER_DUMBBELL }),
  'fedb:One-Arm_Side_Laterals': rough(BENCH, 0.14, 'press', { note: ONE_ARM_DUMBBELL }),
  'fedb:Front_Dumbbell_Raise': rough(BENCH, 0.14, 'press', { note: PER_DUMBBELL }),
  'fedb:Reverse_Flyes': rough(BENCH, 0.12, 'pull', { note: PER_DUMBBELL }),
  'fedb:Seated_Bent-Over_Rear_Delt_Raise': rough(BENCH, 0.12, 'pull', { note: PER_DUMBBELL }),
  'fedb:Bent_Over_Two-Dumbbell_Row': rough(BENCH, 0.38, 'pull', { note: PER_DUMBBELL }),
  'fedb:Dumbbell_Incline_Row': rough(BENCH, 0.35, 'pull', { note: PER_DUMBBELL }),
  'fedb:Straight-Arm_Dumbbell_Pullover': rough(BENCH, 0.3, 'pull', { note: ONE_DUMBBELL_BOTH_HANDS }),
  'fedb:Dumbbell_Shrug': rough(DEADLIFT, 0.4, 'pull', { note: PER_DUMBBELL }),
  'fedb:Dumbbell_Bicep_Curl': rough(BENCH, 0.24, 'pull', { note: PER_DUMBBELL }),
  'fedb:Dumbbell_Alternate_Bicep_Curl': rough(BENCH, 0.24, 'pull', { note: PER_DUMBBELL }),
  'fedb:Seated_Dumbbell_Curl': rough(BENCH, 0.23, 'pull', { note: PER_DUMBBELL }),
  'fedb:Incline_Dumbbell_Curl': rough(BENCH, 0.21, 'pull', { note: PER_DUMBBELL }),
  'fedb:Concentration_Curls': rough(BENCH, 0.22, 'pull', { note: ONE_ARM_DUMBBELL }),
  'fedb:Hammer_Curls': rough(BENCH, 0.26, 'pull', { note: PER_DUMBBELL }),
  'fedb:Alternate_Hammer_Curl': rough(BENCH, 0.26, 'pull', { note: PER_DUMBBELL }),
  'fedb:Cross_Body_Hammer_Curl': rough(BENCH, 0.25, 'pull', { note: PER_DUMBBELL }),
  'fedb:Zottman_Curl': rough(BENCH, 0.2, 'pull', { note: PER_DUMBBELL }),
  'fedb:Two-Arm_Dumbbell_Preacher_Curl': rough(BENCH, 0.2, 'pull', { note: PER_DUMBBELL }),
  'fedb:Tricep_Dumbbell_Kickback': rough(BENCH, 0.12, 'press', { note: PER_DUMBBELL }),
  'fedb:Lying_Dumbbell_Tricep_Extension': rough(BENCH, 0.16, 'press', { note: PER_DUMBBELL }),
  'fedb:Standing_Dumbbell_Triceps_Extension': rough(BENCH, 0.3, 'press', { note: ONE_DUMBBELL_BOTH_HANDS }),
  'fedb:Dumbbell_Squat': rough(BACK_SQUAT, 0.3, 'legs', { note: PER_DUMBBELL }),
  'fedb:Dumbbell_Lunges': rough(BACK_SQUAT, 0.25, 'legs', { note: PER_DUMBBELL }),
  'fedb:Dumbbell_Rear_Lunge': rough(BACK_SQUAT, 0.25, 'legs', { note: PER_DUMBBELL }),
  'fedb:Split_Squat_with_Dumbbells': rough(BACK_SQUAT, 0.25, 'legs', { note: PER_DUMBBELL }),
  'fedb:Dumbbell_Step_Ups': rough(BACK_SQUAT, 0.22, 'legs', { note: PER_DUMBBELL }),
  'fedb:Stiff-Legged_Dumbbell_Deadlift': rough(DEADLIFT, 0.35, 'legs', { note: PER_DUMBBELL }),

  // Kettlebells
  'fedb:Goblet_Squat': rough(BACK_SQUAT, 0.45, 'legs', { note: ONE_KETTLEBELL }),
  'fedb:Front_Squats_With_Two_Kettlebells': rough(BACK_SQUAT, 0.3, 'legs', { note: PER_KETTLEBELL }),
  'fedb:Kettlebell_One-Legged_Deadlift': rough(DEADLIFT, 0.3, 'legs', { note: ONE_KETTLEBELL }),
  'fedb:Two-Arm_Kettlebell_Military_Press': rough(BENCH, 0.28, 'press', { note: PER_KETTLEBELL }),
  'fedb:One-Arm_Kettlebell_Row': rough(BENCH, 0.42, 'pull', { note: ONE_KETTLEBELL }),
  'fedb:Two-Arm_Kettlebell_Row': rough(BENCH, 0.35, 'pull', { note: PER_KETTLEBELL }),

  // Cables
  'fedb:Triceps_Pushdown': machine(BENCH, 0.5, 'press'),
  'fedb:Triceps_Pushdown_-_V-Bar_Attachment': machine(BENCH, 0.5, 'press'),
  'fedb:Triceps_Pushdown_-_Rope_Attachment': machine(BENCH, 0.42, 'press'),
  'fedb:Reverse_Grip_Triceps_Pushdown': machine(BENCH, 0.35, 'press'),
  'fedb:Triceps_Overhead_Extension_with_Rope': machine(BENCH, 0.4, 'press'),
  'fedb:Cable_Rope_Overhead_Triceps_Extension': machine(BENCH, 0.4, 'press'),
  'fedb:Cable_One_Arm_Tricep_Extension': machine(BENCH, 0.2, 'press', STACK_ONE_ARM),
  'fedb:Standing_Biceps_Cable_Curl': machine(BENCH, 0.45, 'pull'),
  'fedb:Cable_Hammer_Curls_-_Rope_Attachment': machine(BENCH, 0.42, 'pull'),
  'fedb:Cable_Preacher_Curl': machine(BENCH, 0.38, 'pull'),
  'fedb:Standing_One-Arm_Cable_Curl': machine(BENCH, 0.22, 'pull', STACK_ONE_ARM),
  'fedb:Face_Pull': machine(BENCH, 0.4, 'pull'),
  'fedb:Straight-Arm_Pulldown': machine(BENCH, 0.4, 'pull'),
  'fedb:Rope_Straight-Arm_Pulldown': machine(BENCH, 0.38, 'pull'),
  'fedb:V-Bar_Pulldown': machine(BENCH, 0.86, 'pull'),
  'fedb:Underhand_Cable_Pulldowns': machine(BENCH, 0.86, 'pull'),
  'fedb:Full_Range-Of-Motion_Lat_Pulldown': machine(BENCH, 0.86, 'pull'),
  'fedb:Wide-Grip_Pulldown_Behind_The_Neck': machine(BENCH, 0.75, 'pull'),
  'fedb:One_Arm_Lat_Pulldown': machine(BENCH, 0.45, 'pull', STACK_ONE_ARM),
  'fedb:Seated_One-arm_Cable_Pulley_Rows': machine(BENCH, 0.45, 'pull', STACK_ONE_ARM),
  'fedb:Elevated_Cable_Rows': machine(BENCH, 0.85, 'pull'),
  'fedb:Upright_Cable_Row': machine(BENCH, 0.5, 'pull'),
  'fedb:Cable_Rear_Delt_Fly': machine(BENCH, 0.12, 'pull', STACK_PER_SIDE),
  'fedb:Cable_Seated_Lateral_Raise': machine(BENCH, 0.1, 'press', STACK_ONE_ARM),
  'fedb:Cable_Crossover': machine(BENCH, 0.25, 'press', STACK_PER_SIDE),
  'fedb:Low_Cable_Crossover': machine(BENCH, 0.22, 'press', STACK_PER_SIDE),
  'fedb:Flat_Bench_Cable_Flyes': machine(BENCH, 0.22, 'press', STACK_PER_SIDE),
  'fedb:Cable_Chest_Press': machine(BENCH, 0.6, 'press'),
  'fedb:Seated_Cable_Shoulder_Press': machine(BENCH, 0.5, 'press'),
  'fedb:Pull_Through': machine(DEADLIFT, 0.4, 'hipThrust'),
  'fedb:Cable_Shrugs': machine(DEADLIFT, 0.7, 'pull'),

  // Machines
  'fedb:Lying_Leg_Curls': machine(BACK_SQUAT, 0.6, 'legs'),
  'fedb:Standing_Leg_Curl': machine(BACK_SQUAT, 0.28, 'legs', STACK_ONE_ARM),
  'fedb:Single-Leg_Leg_Extension': machine(BACK_SQUAT, 0.38, 'legs', STACK_ONE_ARM),
  'fedb:Hack_Squat': machine(BACK_SQUAT, 1, 'legs', PLATES_LOADED),
  'fedb:Narrow_Stance_Hack_Squats': machine(BACK_SQUAT, 0.95, 'legs', PLATES_LOADED),
  'fedb:Narrow_Stance_Leg_Press': machine(BACK_SQUAT, 1.65, 'legs', PLATES_LOADED),
  'fedb:Standing_Calf_Raises': machine(BACK_SQUAT, 0.95, 'legs'),
  'fedb:Seated_Calf_Raise': machine(BACK_SQUAT, 0.75, 'legs'),
  'fedb:Calf_Press_On_The_Leg_Press_Machine': machine(BACK_SQUAT, 1.2, 'legs', PLATES_LOADED),
  'fedb:Thigh_Adductor': machine(BACK_SQUAT, 0.75, 'legs'),
  'fedb:Thigh_Abductor': machine(BACK_SQUAT, 0.75, 'legs'),
  'fedb:Butterfly': machine(BENCH, 0.75, 'press'),
  'fedb:Reverse_Machine_Flyes': machine(BENCH, 0.55, 'pull'),
  'fedb:Leverage_Incline_Chest_Press': machine(BENCH, 0.8, 'press'),
  'fedb:Leverage_Decline_Chest_Press': machine(BENCH, 0.95, 'press'),
  'fedb:Leverage_Shoulder_Press': machine(BENCH, 0.6, 'press'),
  'fedb:Machine_Shoulder_Military_Press': machine(BENCH, 0.6, 'press'),
  'fedb:Machine_Triceps_Extension': machine(BENCH, 0.5, 'press'),
  'fedb:Leverage_High_Row': machine(BENCH, 0.85, 'pull'),
  'fedb:Leverage_Iso_Row': machine(BENCH, 0.85, 'pull'),
  'fedb:Lying_T-Bar_Row': machine(BENCH, 0.75, 'pull', PLATES_LOADED),
  'fedb:Machine_Bicep_Curl': machine(BENCH, 0.45, 'pull'),
  'fedb:Machine_Preacher_Curls': machine(BENCH, 0.4, 'pull'),
  'fedb:Leverage_Shrug': machine(DEADLIFT, 0.8, 'pull', PLATES_LOADED),
  'fedb:Smith_Machine_Squat': machine(BACK_SQUAT, 0.95, 'legs', SMITH),
  'fedb:Smith_Machine_Bench_Press': machine(BENCH, 0.95, 'press', SMITH),
  'fedb:Smith_Machine_Incline_Bench_Press': machine(BENCH, 0.8, 'press', SMITH),
  'fedb:Smith_Machine_Close-Grip_Bench_Press': machine(BENCH, 0.85, 'press', SMITH),
  'fedb:Smith_Machine_Overhead_Shoulder_Press': machine(BENCH, 0.62, 'press', SMITH),
  'fedb:Smith_Machine_Bent_Over_Row': machine(BENCH, 0.8, 'pull', SMITH),
  'fedb:Smith_Machine_Stiff-Legged_Deadlift': machine(DEADLIFT, 0.7, 'legs', SMITH),
  'fedb:Smith_Machine_Calf_Raise': machine(BACK_SQUAT, 0.85, 'legs', SMITH),
  'fedb:Smith_Machine_Hip_Raise': machine(BACK_SQUAT, 1.1, 'hipThrust', SMITH),

  // Close variants of the above (same lift, different grip, bench angle, or one arm at a time)
  'fedb:Alternate_Incline_Dumbbell_Curl': rough(BENCH, 0.21, 'pull', { note: PER_DUMBBELL }),
  'fedb:Incline_Hammer_Curls': rough(BENCH, 0.22, 'pull', { note: PER_DUMBBELL }),
  'fedb:Standing_Concentration_Curl': rough(BENCH, 0.2, 'pull', { note: ONE_ARM_DUMBBELL }),
  'fedb:One_Arm_Dumbbell_Preacher_Curl': rough(BENCH, 0.2, 'pull', { note: ONE_ARM_DUMBBELL }),
  'fedb:Preacher_Hammer_Dumbbell_Curl': rough(BENCH, 0.21, 'pull', { note: PER_DUMBBELL }),
  'fedb:Standing_Dumbbell_Reverse_Curl': rough(BENCH, 0.18, 'pull', { note: PER_DUMBBELL }),
  'fedb:Spider_Curl': rough(BENCH, 0.38, 'pull', { note: EZ_BAR }),
  'fedb:Drag_Curl': rough(BENCH, 0.42, 'pull', { note: BAR }),
  'fedb:Reverse_Barbell_Preacher_Curls': rough(BENCH, 0.33, 'pull', { note: EZ_BAR }),
  'fedb:Lying_High_Bench_Barbell_Curl': rough(BENCH, 0.38, 'pull', { note: BAR }),
  'fedb:Overhead_Cable_Curl': machine(BENCH, 0.2, 'pull', STACK_PER_SIDE),
  'fedb:High_Cable_Curls': machine(BENCH, 0.2, 'pull', STACK_PER_SIDE),
  'fedb:Reverse_Cable_Curl': machine(BENCH, 0.36, 'pull'),
  'fedb:Lying_Cable_Curl': machine(BENCH, 0.4, 'pull'),
  'fedb:Standing_Palms-In_Dumbbell_Press': rough(BENCH, 0.3, 'press', { note: PER_DUMBBELL }),
  'fedb:Standing_Alternating_Dumbbell_Press': rough(BENCH, 0.3, 'press', { note: PER_DUMBBELL }),
  'fedb:Standing_Palm-In_One-Arm_Dumbbell_Press': rough(BENCH, 0.3, 'press', { note: ONE_ARM_DUMBBELL }),
  'fedb:Incline_Dumbbell_Bench_With_Palms_Facing_In': rough(BENCH, 0.32, 'press', { note: PER_DUMBBELL }),
  'fedb:Close-Grip_Dumbbell_Press': rough(BENCH, 0.32, 'press', { note: PER_DUMBBELL }),
  'fedb:Decline_Dumbbell_Flyes': rough(BENCH, 0.26, 'press', { note: PER_DUMBBELL }),
  'fedb:One-Arm_Flat_Bench_Dumbbell_Flye': rough(BENCH, 0.24, 'press', { note: ONE_ARM_DUMBBELL }),
  'fedb:Front_Two-Dumbbell_Raise': rough(BENCH, 0.13, 'press', { note: PER_DUMBBELL }),
  'fedb:Front_Plate_Raise': rough(BENCH, 0.22, 'press', { note: 'The weight of the plate, held in both hands.' }),
  'fedb:Standing_Front_Barbell_Raise_Over_Head': rough(BENCH, 0.25, 'press', { note: BAR }),
  'fedb:Lying_One-Arm_Lateral_Raise': rough(BENCH, 0.1, 'press', { note: ONE_ARM_DUMBBELL }),
  'fedb:One-Arm_Incline_Lateral_Raise': rough(BENCH, 0.1, 'press', { note: ONE_ARM_DUMBBELL }),
  'fedb:Front_Cable_Raise': machine(BENCH, 0.12, 'press', STACK_ONE_ARM),
  'fedb:Standing_Low-Pulley_Deltoid_Raise': machine(BENCH, 0.09, 'press', STACK_ONE_ARM),
  'fedb:Dumbbell_Lying_Rear_Lateral_Raise': rough(BENCH, 0.11, 'pull', { note: PER_DUMBBELL }),
  'fedb:Bent_Over_Dumbbell_Rear_Delt_Raise_With_Head_On_Bench': rough(BENCH, 0.12, 'pull', { note: PER_DUMBBELL }),
  'fedb:Cable_Rope_Rear-Delt_Rows': machine(BENCH, 0.4, 'pull'),
  'fedb:Standing_Dumbbell_Upright_Row': rough(BENCH, 0.22, 'pull', { note: PER_DUMBBELL }),
  'fedb:Smith_Machine_Upright_Row': machine(BENCH, 0.48, 'pull', SMITH),
  'fedb:Bent_Over_Two-Dumbbell_Row_With_Palms_In': rough(BENCH, 0.38, 'pull', { note: PER_DUMBBELL }),
  'fedb:Alternating_Kettlebell_Row': rough(BENCH, 0.35, 'pull', { note: PER_KETTLEBELL }),
  'fedb:Bent_Over_Two-Arm_Long_Bar_Row': rough(BENCH, 0.75, 'pull', { note: 'The plates loaded on the bar.' }),
  'fedb:One-Arm_Long_Bar_Row': rough(BENCH, 0.4, 'pull', { note: 'The plates loaded on the bar, one arm.' }),
  'fedb:Kneeling_High_Pulley_Row': machine(BENCH, 0.8, 'pull'),
  'fedb:Kneeling_Single-Arm_High_Pulley_Row': machine(BENCH, 0.4, 'pull', STACK_ONE_ARM),
  'fedb:Bent-Arm_Dumbbell_Pullover': rough(BENCH, 0.32, 'pull', { note: ONE_DUMBBELL_BOTH_HANDS }),
  'fedb:Bent-Arm_Barbell_Pullover': rough(BENCH, 0.4, 'pull', { note: BAR }),
  'fedb:Seated_Triceps_Press': rough(BENCH, 0.28, 'press', { note: ONE_DUMBBELL_BOTH_HANDS }),
  'fedb:Standing_One-Arm_Dumbbell_Triceps_Extension': rough(BENCH, 0.12, 'press', { note: ONE_ARM_DUMBBELL }),
  'fedb:Dumbbell_One-Arm_Triceps_Extension': rough(BENCH, 0.12, 'press', { note: ONE_ARM_DUMBBELL }),
  'fedb:Decline_EZ_Bar_Triceps_Extension': rough(BENCH, 0.38, 'press', { note: EZ_BAR }),
  'fedb:Incline_Barbell_Triceps_Extension': rough(BENCH, 0.36, 'press', { note: BAR }),
  'fedb:Close-Grip_EZ-Bar_Press': rough(BENCH, 0.8, 'press', { note: EZ_BAR }),
  'fedb:Kneeling_Cable_Triceps_Extension': machine(BENCH, 0.4, 'press'),
  'fedb:Cable_Lying_Triceps_Extension': machine(BENCH, 0.4, 'press'),
  'fedb:Standing_Low-Pulley_One-Arm_Triceps_Extension': machine(BENCH, 0.18, 'press', STACK_ONE_ARM),
  'fedb:Board_Press': variant(BENCH, 1.05, 'press', { note: BAR }),
  'fedb:Pin_Presses': variant(BENCH, 1.05, 'press', { note: BAR }),
  'fedb:Decline_Smith_Press': machine(BENCH, 1, 'press', SMITH),
  'fedb:Incline_Cable_Chest_Press': machine(BENCH, 0.5, 'press'),
  'fedb:Standing_Cable_Chest_Press': machine(BENCH, 0.5, 'press'),
  'fedb:Incline_Cable_Flye': machine(BENCH, 0.2, 'press', STACK_PER_SIDE),
  'fedb:Single-Arm_Cable_Crossover': machine(BENCH, 0.15, 'press', STACK_ONE_ARM),
  'fedb:Cable_Shoulder_Press': machine(BENCH, 0.5, 'press'),
  'fedb:Kettlebell_Seated_Press': rough(BENCH, 0.28, 'press', { note: PER_KETTLEBELL }),
  'fedb:Alternating_Kettlebell_Press': rough(BENCH, 0.28, 'press', { note: PER_KETTLEBELL }),
  'fedb:Barbell_Squat_To_A_Bench': variant(BACK_SQUAT, 0.95, 'legs', { note: BAR }),
  'fedb:Front_Barbell_Squat_To_A_Bench': variant(BACK_SQUAT, 0.78, 'legs', { note: BAR }),
  'fedb:Speed_Squats': rough(BACK_SQUAT, 0.6, 'legs', { note: BAR }),
  'fedb:Weighted_Squat': rough(BACK_SQUAT, 0.6, 'legs', { note: 'The weight you hold or wear, without your body weight.' }),
  'fedb:Dumbbell_Squat_To_A_Bench': rough(BACK_SQUAT, 0.3, 'legs', { note: PER_DUMBBELL }),
  'fedb:Plie_Dumbbell_Squat': rough(BACK_SQUAT, 0.45, 'legs', { note: ONE_DUMBBELL_BOTH_HANDS }),
  'fedb:Elevated_Back_Lunge': rough(BACK_SQUAT, 0.5, 'legs', { note: BAR }),
  'fedb:Smith_Single-Leg_Split_Squat': machine(BACK_SQUAT, 0.45, 'legs', SMITH),
  'fedb:Smith_Machine_Leg_Press': machine(BACK_SQUAT, 1.2, 'legs', SMITH),
  'fedb:Lying_Machine_Squat': machine(BACK_SQUAT, 1, 'legs'),
  'fedb:Stiff_Leg_Barbell_Good_Morning': rough(DEADLIFT, 0.42, 'legs', { note: BAR }),
  'fedb:Seated_Good_Mornings': rough(DEADLIFT, 0.3, 'legs', { note: BAR }),
  'fedb:Leverage_Deadlift': machine(DEADLIFT, 1, 'legs', PLATES_LOADED),
  'fedb:Cable_Deadlifts': machine(DEADLIFT, 0.5, 'legs'),
  'fedb:Barbell_Shrug_Behind_The_Back': rough(DEADLIFT, 0.75, 'pull', { note: BAR }),
  'fedb:Smith_Machine_Behind_the_Back_Shrug': machine(DEADLIFT, 0.75, 'pull', SMITH),
  'fedb:Barbell_Seated_Calf_Raise': rough(BACK_SQUAT, 0.6, 'legs', { note: BAR }),
  'fedb:Standing_Dumbbell_Calf_Raise': rough(BACK_SQUAT, 0.35, 'legs', { note: PER_DUMBBELL }),
  'fedb:Calf_Press': machine(BACK_SQUAT, 1.1, 'legs'),
  'fedb:Smith_Machine_Reverse_Calf_Raises': machine(BACK_SQUAT, 0.3, 'legs', SMITH),
  'fedb:Hyperextensions_Back_Extensions': rough(DEADLIFT, 0.15, 'legs', { note: 'The weight you hold, without your body weight.' }),
  'fedb:Single-Arm_Push-Up': reps([0, 1, 3, 6, 10, 14, 19, 25], 0.6),
  'fedb:Incline_Push-Up_Medium': reps([0, 8, 18, 30, 40, 52, 70, 95], 0.65),
  'fedb:Incline_Push-Up_Wide': reps([0, 8, 18, 30, 40, 52, 70, 95], 0.65),
  'fedb:Incline_Push-Up_Close-Grip': reps([0, 6, 15, 25, 34, 45, 60, 80], 0.6),
  'fedb:Pushups_Close_and_Wide_Hand_Positions': reps([0, 5, 12, 22, 30, 40, 55, 75], 0.6),
  'fedb:Natural_Glute_Ham_Raise': reps([0, 1, 3, 5, 8, 11, 15, 20], 0.7),

  // Bodyweight: body weight plus any added load
  'fedb:V-Bar_Pullup': variant(PULL_UP, 1, 'bodyweightPull', { measure: 'bodyweight_reps', note: BODY, provisional: true }),
  'fedb:Wide-Grip_Rear_Pull-Up': variant(PULL_UP, 0.92, 'bodyweightPull', { measure: 'bodyweight_reps', note: BODY, provisional: true }),
  // Bodyweight endurance: reps in one set
  'fedb:Push-Up_Wide': reps([0, 5, 12, 22, 30, 40, 55, 75], 0.6),
  'fedb:Push-Ups_-_Close_Triceps_Position': reps([0, 4, 10, 18, 25, 33, 45, 60], 0.55),
  'fedb:Push-Ups_With_Feet_Elevated': reps([0, 4, 10, 18, 25, 33, 45, 60], 0.55),
  'fedb:Decline_Push-Up': reps([0, 4, 10, 18, 25, 33, 45, 60], 0.55),
  'fedb:Incline_Push-Up': reps([0, 8, 18, 30, 40, 52, 70, 95], 0.65),
  'fedb:Handstand_Push-Ups': reps([0, 1, 3, 6, 10, 14, 19, 25], 0.6),
  'fedb:Bench_Dips': reps([0, 8, 15, 25, 35, 45, 58, 75], 0.75),
  'fedb:Inverted_Row': reps([0, 3, 8, 14, 20, 26, 33, 42], 0.7),
  'fedb:Inverted_Row_with_Straps': { ...reps([0, 3, 8, 14, 20, 26, 33, 42], 0.7), note: REPS_ANGLE },
  'fedb:Suspended_Row': { ...reps([0, 3, 8, 14, 20, 26, 33, 42], 0.7), note: REPS_ANGLE },
  // Unstable handles: about as hard as a feet-elevated push-up.
  'fedb:Suspended_Push-Up': reps([0, 4, 10, 18, 25, 33, 45, 60], 0.55),
  'fedb:Hanging_Leg_Raise': reps([0, 3, 8, 12, 18, 24, 30, 40], 0.85),
  'fedb:Bodyweight_Squat': reps([0, 15, 25, 40, 55, 75, 100, 130], 0.85),
  'fedb:Bodyweight_Walking_Lunge': reps([0, 10, 20, 32, 45, 60, 80, 100], 0.85),
};

/**
 * Every published benchmark, oldest first. **v1 is frozen** (owner approval on #5, 2026-11-13):
 * it is `v1-rc1` promoted unchanged, and `strength-ranks.spec.ts` pins its fingerprint. A version
 * that is not a draft is never edited. Any change is a new, separately named version with a later
 * `from` and a documented migration: highest-ever ranks keep the version of their day, and a
 * tournament season keeps the standard copied at its lock.
 */
export const RANK_BENCHMARKS: readonly BenchmarkVersion[] = [
  {
    version: 'v1',
    draft: false,
    from: '0000-01-01',
    basis:
      'Strength standards v1, informed by published coaching standards and app-user tables, ' +
      'with the top tier kept below world-record lifts. Your estimated one-rep max is scaled to an 80 kg ' +
      '(men) or 60 kg (women) body weight with a 2/3 exponent. Not measured from LifePortal members, ' +
      'and not percentiles of anyone.',
    exercises: STANDARDS_V1,
  },
];

/**
 * Names a version was published under before it was renamed without any change to its content.
 * `v1-rc1` was promoted to `v1` unchanged, so anything recorded under `v1-rc1` (a tournament entry's
 * `lockedVersion`) resolves to `v1`.
 */
export const RANK_VERSION_ALIASES: Readonly<Record<string, string>> = { 'v1-rc1': 'v1' };

/** A version name with its alias resolved. */
export const canonicalRankVersion = (version: string) => RANK_VERSION_ALIASES[version] ?? version;

/**
 * How load is entered for a shared catalogue exercise under the newest standards ("The weight of
 * one dumbbell."), so logging can say so. Undefined for unranked or private exercises.
 */
export function rankLoadNote(seedKey: string | undefined, measure: Measure, versions: readonly BenchmarkVersion[] = RANK_BENCHMARKS) {
  const standard = seedKey ? versions[versions.length - 1].exercises[seedKey] : undefined;
  return standard && standard.measure === measure ? standard.note : undefined;
}

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
  if (standard.method === 'reps') {
    // Reps of your own body weight: an assisted set is a different, easier exercise.
    return set.assistGrams ? { skip: 'invalid' } : { score: set.reps, basis: base };
  }
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
    ...(standard.provisional ? { provisional: true } : {}),
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

// ------------------------------------------------------------------ rank journey (#13), display

/** One tier of the rank journey: its three division starts and where the member stands. */
export interface RankLadderRung {
  tier: RankTier;
  /** 0 (Initiate) to 7 (Legend). */
  index: number;
  /** Where III, II and I start, in score units. */
  starts: [number, number, number];
  /** `current`: the member's current tier. `reached`: at or below the best tier ever reached. */
  state: 'current' | 'reached' | 'locked';
  /** The division its emblem shows: the one held or reached there, I below that, III when locked. */
  division: RankDivision;
}

/**
 * The eight tiers for the rank journey, **Legend first** (you climb up). Purely a reading of the
 * existing view: thresholds come from `milestoneStarts(tierStarts)`, nothing is scored here, and a
 * tier counts as reached when the current or highest-ever rank is in it or above it.
 */
export function rankLadder(
  tierStarts: readonly number[],
  current?: Pick<RankPosition, 'milestone'>,
  highest?: Pick<RankPosition, 'milestone'>,
): RankLadderRung[] {
  const starts = milestoneStarts(tierStarts);
  const top = Math.max(current?.milestone ?? -1, highest?.milestone ?? -1);
  const topTier = top < 0 ? -1 : Math.floor(top / 3);
  const currentTier = current ? Math.floor(current.milestone / 3) : -1;
  return RANK_TIERS.map((tier, index): RankLadderRung => {
    const own = [starts[index * 3], starts[index * 3 + 1], starts[index * 3 + 2]] as [number, number, number];
    if (index === currentTier && current) {
      return { tier, index, starts: own, state: 'current', division: RANK_DIVISIONS[current.milestone % 3] };
    }
    if (index <= topTier) {
      const division = index === topTier ? RANK_DIVISIONS[top % 3] : 'I';
      return { tier, index, starts: own, state: 'reached', division };
    }
    return { tier, index, starts: own, state: 'locked', division: 'III' };
  }).reverse();
}

/**
 * About how much heavier the estimated one-rep max must be to reach the next division, in grams:
 * the score formula run backwards for `nextScore`, assuming the same body weight and the same
 * work-capacity bonus as the ranked workout. An estimate, shown as one; `undefined` for a reps
 * standard, at Legend I, or without the body weight the score was scaled with.
 */
export function oneRepMaxToNextGrams(position: RankPosition, standards: RankStandards): number | undefined {
  const { nextScore, basis } = position;
  if (nextScore === undefined || !basis.bodyWeightGrams || !basis.oneRepMaxGrams) return undefined;
  const reference = RANK_REFERENCE_BODY_WEIGHT_GRAMS[standards];
  const bonus = 1 + (basis.bonusPercent ?? 0) / 100;
  const needed = ((nextScore / bonus) * reference) / 1000 / Math.pow(reference / basis.bodyWeightGrams, RANK_ALLOMETRIC_EXPONENT);
  return Math.max(0, Math.ceil(needed - basis.oneRepMaxGrams));
}
