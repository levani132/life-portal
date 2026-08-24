import type {
  ActivityLevel,
  CheatDayInfo,
  CheatMealView,
  DayTotals,
  EntryFacts,
  EntryTotals,
  Estimate,
  Food,
  MealEntry,
  MealSlot,
  MealSuggestion,
  NutritionFacts,
  NutritionGoal,
  NutritionProfile,
  NutritionSummary,
  NutritionTargets,
  Recorded,
  ServingTotals,
  Sex,
  SlotTotals,
  TargetFigure,
  WeekBalance,
  WeekDayBalance,
  WeighIn,
} from '@life-portal/shared-types';
import { MEAL_SLOTS } from '@life-portal/shared-types';
import { addDays, diffDays, isAfter, toDay, weekdayOf } from './dates';

/**
 * Food, macros and body-composition maths.
 *
 * Pure and dependency-free, like every other file here: plain data in, plain data out, and the
 * reference "today" always an explicit argument (constitution principle V). The API calls these
 * to build a response; the web calls the *same* functions for the log modal's live preview, so
 * the preview and the stored result cannot disagree.
 *
 * Units, once, so nothing downstream has to guess:
 * - energy is whole **kilocalories**
 * - macronutrients are whole **milligrams** (`*Mg`), converted to grams only for display
 * - body weight is whole **grams**
 * - a food's facts are per **100 base units**, a base unit being a gram or a millilitre
 * - body-fat percentage is a decimal (`0.18` = 18%)
 *
 * Every derived figure carries a `basis` string naming the equation and the inputs behind it
 * (principle VI). A figure the owner supplied is returned as `Recorded`, never as an estimate.
 */

// ------------------------------------------------------------------ constants

/** Multipliers on the basal rate. The single biggest lever on the calorie target. */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
  athlete: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'desk job, no training',
  light: 'light activity or 1–3 sessions a week',
  moderate: '3–5 sessions a week',
  very: '6–7 sessions a week',
  athlete: 'twice a day or physical work',
};

/**
 * The five goals. `proteinPerKgLean` applies when a body-fat percentage was actually measured;
 * it is higher because lean mass is smaller than body weight.
 *
 * Basis: ISSN position stands (Jäger 2017 protein; Aragon 2017 diets), Helms 2014 for the
 * lean-mass protein band in a deficit, Garthe 2011 for the rate of loss that retains lean mass.
 */
export const GOAL_PLAN: Record<
  NutritionGoal,
  {
    label: string;
    energyFactor: number;
    proteinPerKg: number;
    proteinPerKgLean: number;
    fatPerKg: number;
    /**
     * Share of the calorie target protein may take, when a goal needs a different ceiling from
     * the default. Recomposition deliberately runs protein high enough that the usual 40% guard
     * would clip a target the evidence supports.
     */
    proteinEnergyCap?: number;
  }
> = {
  pure_weight_loss: {
    label: 'Pure weight loss',
    energyFactor: 0.75,
    proteinPerKg: 2.2,
    proteinPerKgLean: 2.6,
    fatPerKg: 0.6,
  },
  fat_loss: {
    label: 'Fat loss, keeping muscle',
    energyFactor: 0.85,
    proteinPerKg: 2.0,
    proteinPerKgLean: 2.3,
    fatPerKg: 0.8,
  },
  recomp: {
    label: 'Lose fat, build muscle',
    energyFactor: 0.9,
    proteinPerKg: 2.4,
    proteinPerKgLean: 2.8,
    fatPerKg: 0.8,
    proteinEnergyCap: 0.5,
  },
  maintain: {
    label: 'No change',
    energyFactor: 1,
    proteinPerKg: 1.6,
    proteinPerKgLean: 1.9,
    fatPerKg: 0.9,
  },
  lean_gain: {
    label: 'Muscle without fat',
    energyFactor: 1.1,
    proteinPerKg: 1.8,
    proteinPerKgLean: 2.1,
    fatPerKg: 0.9,
  },
  max_gain: {
    label: 'Growth, as fast as is still useful',
    energyFactor: 1.2,
    proteinPerKg: 1.8,
    proteinPerKgLean: 2.1,
    fatPerKg: 1.0,
  },
};

/** Hard calorie floors, below which a deficit stops being a diet. */
const ENERGY_FLOOR_KCAL: Record<Sex, number> = { male: 1500, female: 1200 };

/** Protein never takes more than this share of the target, which keeps a high BMI sane. */
const PROTEIN_ENERGY_CAP = 0.4;
/** Fat gets at least this share of energy, and at least this much per kg of body weight. */
const FAT_ENERGY_FLOOR = 0.15;
const FAT_PER_KG_FLOOR = 0.5;
/** Protein is the last thing cut, and never below this. */
const PROTEIN_PER_KG_FLOOR = 1.2;

const KCAL_PER_G = { protein: 4, fat: 9, carb: 4 } as const;
/** Rule of thumb for the energy in a kilogram of body mass. See the basis string. */
const KCAL_PER_KG_BODY_MASS = 7700;
const FIBRE_G_PER_1000_KCAL = 14;

/**
 * Weekly rates as a fraction of body weight, used only to judge a target.
 *
 * The *recommended* bands are 0.5–1.0% a week for loss and 0.25–0.5% for gain (Garthe 2011 and
 * general practice). These are the wider bands at which a rate is worth *commenting on*: `min`
 * is where a change becomes too slow to see against day-to-day water weight, `max` is where it
 * starts costing lean mass. A gentle deficit inside the recommended band must read as sane —
 * the app's own `fat_loss` goal lands near 0.45% a week for an 80 kg frame, and flagging its own
 * recommendation as "slow" would be self-contradictory.
 */
const LOSS_RATE_BAND = { min: 0.0025, max: 0.01 };
const GAIN_RATE_BAND = { min: 0.0025, max: 0.005 };

/** Slot boundaries in minutes past local midnight. Defaults only — the slot stays editable. */
const SLOT_BOUNDARIES: { until: number; slot: MealSlot }[] = [
  { until: 10 * 60 + 30, slot: 'breakfast' },
  { until: 15 * 60 + 30, slot: 'lunch' },
  { until: 17 * 60, slot: 'snack' },
  { until: 21 * 60 + 30, slot: 'dinner' },
];

// ------------------------------------------------------------------ unit maths

export function gToMg(grams: number): number {
  return Math.round(grams * 1000);
}

/** Milligrams to grams, for display. Whole grams by default — labels are not more precise. */
export function mgToG(mg: number | undefined, digits = 0): number {
  if (mg == null) return 0;
  const factor = 10 ** digits;
  return Math.round((mg / 1000) * factor) / factor;
}

/**
 * Scales a food's per-100 facts to an amount of base units.
 *
 * Rounded per entry rather than at the end of a sum, so a row's number and the total's number
 * are the same arithmetic. Sub-calorie error per entry is irrelevant against label accuracy.
 */
export function entryTotals(amount: number, facts: NutritionFacts): EntryTotals {
  const scale = amount / 100;
  const totals: EntryTotals = {
    energyKcal: Math.round(facts.energyKcalPer100 * scale),
    proteinMg: Math.round(facts.proteinMgPer100 * scale),
    fatMg: Math.round(facts.fatMgPer100 * scale),
    carbMg: Math.round(facts.carbMgPer100 * scale),
  };
  if (facts.fibreMgPer100 != null) {
    totals.fibreMg = Math.round(facts.fibreMgPer100 * scale);
  }
  return totals;
}

/** What one serving of a food works out to. */
export function perServingTotals(food: Pick<Food, 'servingSize'> & NutritionFacts): ServingTotals {
  return entryTotals(food.servingSize, food);
}

export function servingsToAmount(servings: number, servingSize: number): number {
  return Math.max(1, Math.round(servings * servingSize));
}

/** Rounded to two places, which is as precise as "1.33 servings" ever needs to be. */
export function amountToServings(amount: number, servingSize: number): number {
  if (servingSize <= 0) return 0;
  return Math.round((amount / servingSize) * 100) / 100;
}

/** The four-or-eight numbers a food form collects, in whichever mode it collected them. */
export interface FactsInput {
  energyKcal: number;
  proteinMg: number;
  fatMg: number;
  carbMg: number;
  fibreMg?: number;
  sugarMg?: number;
  satFatMg?: number;
  sodiumMg?: number;
}

/**
 * Normalises a form's numbers to per-100 storage.
 *
 * `per_serving` values are divided by the serving size; `per_100` values pass through. An
 * absent optional nutriment stays absent — a missing fibre figure is not zero fibre.
 */
export function factsFromInput(
  input: FactsInput,
  mode: 'per_serving' | 'per_100',
  servingSize: number,
): NutritionFacts {
  const scale = mode === 'per_100' ? 1 : servingSize > 0 ? 100 / servingSize : 0;
  const facts: NutritionFacts = {
    energyKcalPer100: Math.round(input.energyKcal * scale),
    proteinMgPer100: Math.round(input.proteinMg * scale),
    fatMgPer100: Math.round(input.fatMg * scale),
    carbMgPer100: Math.round(input.carbMg * scale),
  };
  if (input.fibreMg != null) facts.fibreMgPer100 = Math.round(input.fibreMg * scale);
  if (input.sugarMg != null) facts.sugarMgPer100 = Math.round(input.sugarMg * scale);
  if (input.satFatMg != null) facts.satFatMgPer100 = Math.round(input.satFatMg * scale);
  if (input.sodiumMg != null) facts.sodiumMgPer100 = Math.round(input.sodiumMg * scale);
  return facts;
}

/** The inverse, so an edit form can show the numbers the way they were typed. */
export function factsToInput(
  facts: NutritionFacts,
  mode: 'per_serving' | 'per_100',
  servingSize: number,
): FactsInput {
  const scale = mode === 'per_100' ? 1 : servingSize / 100;
  const input: FactsInput = {
    energyKcal: Math.round(facts.energyKcalPer100 * scale),
    proteinMg: Math.round(facts.proteinMgPer100 * scale),
    fatMg: Math.round(facts.fatMgPer100 * scale),
    carbMg: Math.round(facts.carbMgPer100 * scale),
  };
  if (facts.fibreMgPer100 != null) input.fibreMg = Math.round(facts.fibreMgPer100 * scale);
  if (facts.sugarMgPer100 != null) input.sugarMg = Math.round(facts.sugarMgPer100 * scale);
  if (facts.satFatMgPer100 != null) input.satFatMg = Math.round(facts.satFatMgPer100 * scale);
  if (facts.sodiumMgPer100 != null) input.sodiumMg = Math.round(facts.sodiumMgPer100 * scale);
  return input;
}

/**
 * Cheap sanity check for a food's numbers: do its macros roughly account for its energy?
 *
 * Returns the implied energy when it disagrees with the stated energy by more than 30%, which
 * is the signature of a per-serving figure typed into a per-100 field. A warning, never a
 * rejection: real labels disagree with their own macros, and alcohol and polyols make the
 * check inexact by construction.
 */
export function macroEnergyMismatch(facts: NutritionFacts): { impliedKcal: number } | undefined {
  const impliedKcal = Math.round(
    (facts.proteinMgPer100 * KCAL_PER_G.protein +
      facts.carbMgPer100 * KCAL_PER_G.carb +
      facts.fatMgPer100 * KCAL_PER_G.fat) /
      1000,
  );
  if (facts.energyKcalPer100 === 0 && impliedKcal === 0) return undefined;
  const reference = Math.max(facts.energyKcalPer100, impliedKcal, 1);
  const gap = Math.abs(facts.energyKcalPer100 - impliedKcal) / reference;
  return gap > 0.3 ? { impliedKcal } : undefined;
}

// ------------------------------------------------------------------ aggregation

export function emptyTotals(): EntryTotals {
  return { energyKcal: 0, proteinMg: 0, fatMg: 0, carbMg: 0 };
}

export function addTotals(a: EntryTotals, b: EntryTotals): EntryTotals {
  const sum: EntryTotals = {
    energyKcal: a.energyKcal + b.energyKcal,
    proteinMg: a.proteinMg + b.proteinMg,
    fatMg: a.fatMg + b.fatMg,
    carbMg: a.carbMg + b.carbMg,
  };
  // Absent stays absent: a day with no fibre data reports unknown, not zero.
  if (a.fibreMg != null || b.fibreMg != null) {
    sum.fibreMg = (a.fibreMg ?? 0) + (b.fibreMg ?? 0);
  }
  return sum;
}

export function sumTotals(all: EntryTotals[]): EntryTotals {
  return all.reduce(addTotals, emptyTotals());
}

/** One totals block per slot, always in menu order, including empty slots. */
export function slotTotals(entries: MealEntry[]): SlotTotals[] {
  return MEAL_SLOTS.map((slot) => {
    const rows = entries.filter((entry) => entry.slot === slot);
    return {
      slot,
      entries: rows,
      totals: sumTotals(rows.map((row) => row.totals)),
    };
  });
}

export function dayTotals(day: string, entries: MealEntry[]): DayTotals {
  const rows = entries.filter((entry) => entry.day === day);
  return {
    day: toDay(day),
    totals: sumTotals(rows.map((row) => row.totals)),
    slots: slotTotals(rows),
    entryCount: rows.length,
  };
}

/** Monday, matching the `en-GB` formatting used everywhere else in the app. */
export function weekStart(day: string): string {
  const weekday = weekdayOf(day);
  // `weekdayOf` is 0 = Sunday, so Sunday is six days after its Monday, not one day before it.
  return addDays(day, -((weekday + 6) % 7));
}

export function weekEnd(day: string): string {
  return addDays(weekStart(day), 6);
}

/**
 * This week's calorie balance, and the allowance banked for a cheat day.
 *
 * Only days that were **actually logged** and are **before today** contribute to the bank.
 * Counting an unlogged day as a full deficit would hand out a fictional two-thousand-calorie
 * allowance every time the owner forgot to log, which is the opposite of useful.
 */
export function weekBalance(
  entries: MealEntry[],
  today: string,
  targetKcal?: number,
): WeekBalance {
  const start = weekStart(today);
  const end = weekEnd(today);
  const days: WeekDayBalance[] = [];
  let eatenKcal = 0;
  let daysLogged = 0;
  let bankedKcal = 0;

  for (let offset = 0; offset < 7; offset += 1) {
    const day = addDays(start, offset);
    const rows = entries.filter((entry) => entry.day === day);
    const dayKcal = rows.reduce((sum, row) => sum + row.totals.energyKcal, 0);
    const logged = rows.length > 0;
    if (logged) {
      daysLogged += 1;
      eatenKcal += dayKcal;
      if (targetKcal != null && day < today) {
        bankedKcal += targetKcal - dayKcal;
      }
    }
    days.push({ day, eatenKcal: dayKcal, logged, isToday: day === today });
  }

  const balance: WeekBalance = {
    weekStart: start,
    weekEnd: end,
    eatenKcal,
    daysLogged,
    days,
    bankedKcal: Math.max(0, bankedKcal),
  };
  if (targetKcal != null) {
    balance.targetKcal = targetKcal * 7;
    balance.differenceKcal = eatenKcal - targetKcal * daysLogged;
  }
  return balance;
}

// ------------------------------------------------------------------ suggestions

/** How far back a slot looks for something to offer again. */
export const SUGGESTION_LOOKBACK_DAYS = 14;

/** How many offers one slot makes. Enough to cover a routine, few enough to scan in one glance. */
export const SUGGESTIONS_PER_SLOT = 4;

/**
 * What each slot offers for one tap, taken from what that slot has eaten before.
 *
 * The point is the routine: the same porridge at breakfast most mornings should be one button,
 * not a search. So a candidate is a `(slot, food)` pair, and it is ranked by
 * **recency-weighted frequency** — each distinct day it appeared contributes `1 / (1 + age)`,
 * where `age` is whole days back from `day`. Yesterday is worth 0.5, a week ago 0.125. A food
 * eaten five mornings running therefore beats yesterday's one-off, and yesterday's one-off still
 * beats something eaten once a fortnight ago. Ties break on the most recent day, then the name,
 * so the order is stable rather than dependent on the order the log came back in.
 *
 * The amount offered is **that food's total in that slot on the most recent day it appeared** —
 * two spoonfuls of oats at one breakfast were one breakfast's worth of oats, and repeating it
 * should repeat the portion, not half of it.
 *
 * Four things are deliberately not offered:
 *
 * - anything already logged in that slot on `day` — that is a fact, not a suggestion;
 * - `day` itself and anything after it, so the day being filled in never suggests itself;
 * - foods that have been deleted or archived, which cannot be logged;
 * - the `uncategorized` slot's history is treated like any other slot's, because a meal filed
 *   there is still a meal that was eaten at roughly that time.
 *
 * Priced with the food's **current** facts, because `createEntry` takes a fresh snapshot: the
 * number on the button has to be the number that lands in the day.
 */
export function mealSuggestions(input: {
  /** The log from `day - lookbackDays` to `day` inclusive. Order does not matter. */
  entries: MealEntry[];
  /** The current catalogue. A suggestion the owner cannot log is not a suggestion. */
  foods: Food[];
  /** The day being filled in. */
  day: string;
  perSlot?: number;
  lookbackDays?: number;
}): MealSuggestion[] {
  const day = toDay(input.day);
  const perSlot = input.perSlot ?? SUGGESTIONS_PER_SLOT;
  const earliest = addDays(day, -(input.lookbackDays ?? SUGGESTION_LOOKBACK_DAYS));
  const catalogue = new Map(input.foods.filter((food) => !food.archived).map((f) => [f.id, f]));

  const alreadyLogged = new Set(
    input.entries.filter((e) => toDay(e.day) === day).map((e) => `${e.slot}:${e.foodId}`),
  );

  interface Candidate {
    slot: MealSlot;
    foodId: string;
    /** Base units per day, so a food eaten twice in one sitting counts as one portion. */
    perDay: Map<string, number>;
  }
  const candidates = new Map<string, Candidate>();

  for (const row of input.entries) {
    const entryDay = toDay(row.day);
    if (entryDay >= day || entryDay < earliest) continue;
    const key = `${row.slot}:${row.foodId}`;
    if (alreadyLogged.has(key)) continue;
    if (!catalogue.has(row.foodId)) continue;

    const candidate = candidates.get(key) ?? { slot: row.slot, foodId: row.foodId, perDay: new Map() };
    candidate.perDay.set(entryDay, (candidate.perDay.get(entryDay) ?? 0) + row.amount);
    candidates.set(key, candidate);
  }

  const scored = [...candidates.values()].map((candidate) => {
    const days = [...candidate.perDay.keys()].sort();
    const lastDay = days[days.length - 1];
    const score = days.reduce((sum, d) => sum + 1 / (1 + diffDays(d, day)), 0);
    const food = catalogue.get(candidate.foodId) as Food;
    const amount = candidate.perDay.get(lastDay) as number;

    const suggestion: MealSuggestion = {
      slot: candidate.slot,
      foodId: candidate.foodId,
      name: food.name,
      brand: food.brand,
      unit: food.unit,
      amount,
      servings: amountToServings(amount, food.servingSize),
      totals: entryTotals(amount, food),
      lastDay,
      dayCount: days.length,
    };
    return { suggestion, score };
  });

  // Slot order first, so the caller can render each slot's offers without re-sorting.
  return MEAL_SLOTS.flatMap((slot) =>
    scored
      .filter((row) => row.suggestion.slot === slot)
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.suggestion.lastDay.localeCompare(a.suggestion.lastDay) ||
          a.suggestion.name.localeCompare(b.suggestion.name),
      )
      .slice(0, perSlot)
      .map((row) => row.suggestion),
  );
}

// ------------------------------------------------------------------ body model

/** Whole years on `today`, counting the birthday itself. */
export function ageOn(birthDate: string, today: string): number {
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number);
  const [year, month, day] = today.split('-').map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return Math.max(0, age);
}

/** The most recent weigh-in that is not in the future. */
export function currentWeighIn(weighIns: WeighIn[], today: string): WeighIn | undefined {
  return weighIns
    .filter((row) => !isAfter(row.day, today))
    .reduce<WeighIn | undefined>(
      (latest, row) => (latest == null || isAfter(row.day, latest.day) ? row : latest),
      undefined,
    );
}

export function leanMassGrams(weightGrams: number, bodyFatPct: number): number {
  return Math.round(weightGrams * (1 - bodyFatPct));
}

export function bmi(weightGrams: number, heightCm: number): number {
  const metres = heightCm / 100;
  return weightGrams / 1000 / (metres * metres);
}

/**
 * Deurenberg (1991) body fat from BMI, age and sex.
 *
 * **Display only.** It must never feed the basal rate: Katch–McArdle on an estimated lean mass
 * is Mifflin–St Jeor with extra error, dressed up as precision.
 */
export function estimateBodyFatPct(input: {
  sex: Sex;
  weightGrams: number;
  heightCm: number;
  age: number;
}): Estimate<number> {
  const index = bmi(input.weightGrams, input.heightCm);
  const raw =
    1.2 * index + 0.23 * input.age - 10.8 * (input.sex === 'male' ? 1 : 0) - 5.4;
  const value = Math.min(0.6, Math.max(0.03, Math.round(raw) / 100));
  return {
    value,
    basis:
      'Deurenberg (1991) from BMI, age and sex. A population formula, not a measurement — it ' +
      'reads high for muscular builds and low for slight ones, so it is shown for reference ' +
      'and never used to derive the calorie target.',
    assumptions: { bmi: Math.round(index * 10) / 10, age: input.age, sex: input.sex },
    confidence: 'low',
  };
}

/**
 * Basal metabolic rate, in the order that respects what is actually known:
 * the owner's own measurement, then lean mass when it was measured, then body weight.
 */
export function basalRate(input: {
  profile: Pick<NutritionProfile, 'basalRateKcal' | 'sex' | 'heightCm' | 'birthDate'>;
  weighIn: WeighIn;
  today: string;
}): TargetFigure {
  const { profile, weighIn, today } = input;

  if (profile.basalRateKcal != null) {
    return { value: profile.basalRateKcal, recorded: true };
  }

  const weightKg = weighIn.weightGrams / 1000;

  if (weighIn.bodyFatPct != null) {
    const leanKg = leanMassGrams(weighIn.weightGrams, weighIn.bodyFatPct) / 1000;
    return {
      value: Math.round(370 + 21.6 * leanKg),
      basis:
        'Katch–McArdle (1973): 370 + 21.6 × lean mass, using the body-fat percentage recorded ' +
        'with your weigh-in. Preferred over weight-based equations when lean mass is known.',
      assumptions: {
        leanKg: Math.round(leanKg * 10) / 10,
        bodyFatPct: weighIn.bodyFatPct,
        weightKg: Math.round(weightKg * 10) / 10,
      },
      confidence: 'high',
    };
  }

  const age = ageOn(profile.birthDate as string, today);
  const sex = profile.sex as Sex;
  const heightCm = profile.heightCm as number;
  const value = Math.round(
    10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161),
  );
  return {
    value,
    basis:
      'Mifflin–St Jeor (1990): 10 × kg + 6.25 × cm − 5 × age, plus 5 for men or minus 161 for ' +
      'women. The best-validated predictive equation for the general population. Record a ' +
      'body-fat percentage with a weigh-in to switch to the lean-mass equation.',
    assumptions: { weightKg: Math.round(weightKg * 10) / 10, heightCm, age, sex },
    confidence: 'medium',
  };
}

export function figureValue(figure: TargetFigure | undefined): number | undefined {
  return figure?.value;
}

export function isRecorded(figure: TargetFigure | undefined): figure is Recorded<number> {
  return figure != null && (figure as Recorded<number>).recorded === true;
}

// ------------------------------------------------------------------ targets

export interface TargetsInput {
  profile: NutritionProfile;
  weighIns: WeighIn[];
  today: string;
}

/**
 * The whole target model, in one deterministic pass. The order matters and is documented in
 * `specs/001-nutrition-tracking/research.md` (R5): basal rate, activity, goal, floor, reference
 * mass, protein cap, fat floor, carbohydrate remainder, then the projected rate.
 */
export function nutritionTargets(input: TargetsInput): NutritionTargets {
  const { profile, weighIns, today } = input;
  const weighIn = currentWeighIn(weighIns, today);
  const missingInputs: string[] = [];

  if (!profile.sex) missingInputs.push('sex');
  if (!weighIn) missingInputs.push('weighIn');
  // Height and age are only needed by the weight-based equation, so a recorded basal rate
  // excuses them.
  if (profile.basalRateKcal == null) {
    if (!profile.heightCm) missingInputs.push('heightCm');
    if (!profile.birthDate) missingInputs.push('birthDate');
  }
  if (missingInputs.length > 0 || !weighIn) {
    return { available: false, missingInputs };
  }

  const sex = profile.sex as Sex;
  const bodyKg = weighIn.weightGrams / 1000;
  const bmrFigure = basalRate({ profile, weighIn, today });
  const bmrValue = bmrFigure.value;

  const factor = ACTIVITY_FACTORS[profile.activityLevel];
  const tdeeValue = Math.round(bmrValue * factor);
  const tdee: Estimate<number> = {
    value: tdeeValue,
    basis: `Basal rate × ${factor} for "${ACTIVITY_LABELS[profile.activityLevel]}". Activity is the biggest single lever here, and it is self-reported — if your weight moves differently from the projection, this is the number to adjust first.`,
    assumptions: { bmr: bmrValue, activityLevel: profile.activityLevel, factor },
    confidence: 'medium',
  };

  const plan = GOAL_PLAN[profile.goal];
  const requestedKcal = Math.round(tdeeValue * plan.energyFactor);
  const floorKcal = Math.max(Math.round(bmrValue), ENERGY_FLOOR_KCAL[sex]);

  let energyKcal = Math.max(requestedKcal, floorKcal);
  let floorApplied: NutritionTargets['floorApplied'];
  if (energyKcal > requestedKcal) {
    floorApplied = {
      floorKcal: energyKcal,
      requestedKcal,
      reason: `${plan.label} asks for ${requestedKcal} kcal, which is under the floor of ${floorKcal} kcal (the greater of your basal rate and ${ENERGY_FLOOR_KCAL[sex]} kcal). The target was raised to the floor: a deficit that big costs muscle and adherence, and buys little extra fat loss.`,
    };
  }

  const energyOverridden = profile.energyOverrideKcal != null;
  if (energyOverridden) {
    energyKcal = profile.energyOverrideKcal as number;
    floorApplied = undefined;
  }

  // Reference mass: lean mass only when it was actually measured (see estimateBodyFatPct).
  const bodyFatRecordedPct = weighIn.bodyFatPct;
  const leanKg =
    bodyFatRecordedPct != null
      ? leanMassGrams(weighIn.weightGrams, bodyFatRecordedPct) / 1000
      : undefined;
  const massKg = leanKg ?? bodyKg;
  const proteinPerKg = leanKg != null ? plan.proteinPerKgLean : plan.proteinPerKg;

  let proteinG = Math.round(proteinPerKg * massKg);
  const proteinCap = plan.proteinEnergyCap ?? PROTEIN_ENERGY_CAP;
  const proteinCapG = Math.floor((energyKcal * proteinCap) / KCAL_PER_G.protein);
  let proteinCapped = false;
  if (proteinG > proteinCapG) {
    proteinG = proteinCapG;
    proteinCapped = true;
  }

  let fatG = Math.round(
    Math.max(
      plan.fatPerKg * massKg,
      FAT_PER_KG_FLOOR * bodyKg,
      (energyKcal * FAT_ENERGY_FLOOR) / KCAL_PER_G.fat,
    ),
  );

  if (profile.proteinOverrideG != null) proteinG = profile.proteinOverrideG;
  if (profile.fatOverrideG != null) fatG = profile.fatOverrideG;

  let macroAdjustment: NutritionTargets['macroAdjustment'];
  let carbG = Math.round(
    (energyKcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat) / KCAL_PER_G.carb,
  );

  if (carbG < 0) {
    // Carbohydrate must not go negative. Fat gives way first, then protein, and never below
    // the floors — the alternative is a target that silently does not add up.
    let overshootKcal = -carbG * KCAL_PER_G.carb;
    const fatFloorG = Math.round(FAT_PER_KG_FLOOR * bodyKg);
    const fatCutG = Math.min(Math.max(0, fatG - fatFloorG), Math.ceil(overshootKcal / KCAL_PER_G.fat));
    const reasons: string[] = [];
    if (fatCutG > 0) {
      reasons.push(`fat cut from ${fatG} g to ${fatG - fatCutG} g`);
      macroAdjustment = {
        what: 'fat',
        fromG: fatG,
        toG: fatG - fatCutG,
        reason: '',
      };
      fatG -= fatCutG;
      overshootKcal -= fatCutG * KCAL_PER_G.fat;
    }
    if (overshootKcal > 0) {
      const proteinFloorG = Math.round(PROTEIN_PER_KG_FLOOR * massKg);
      const proteinCutG = Math.min(
        Math.max(0, proteinG - proteinFloorG),
        Math.ceil(overshootKcal / KCAL_PER_G.protein),
      );
      if (proteinCutG > 0) {
        reasons.push(`protein cut from ${proteinG} g to ${proteinG - proteinCutG} g`);
        macroAdjustment = {
          what: 'protein',
          fromG: proteinG,
          toG: proteinG - proteinCutG,
          reason: '',
        };
        proteinG -= proteinCutG;
      }
    }
    if (macroAdjustment) {
      macroAdjustment.reason = `Protein and fat together came to more than ${energyKcal} kcal, which would leave carbohydrate negative. ${reasons.join(', then ')}. Fat gives way before protein, and neither goes below its floor.`;
    }
    carbG = Math.max(
      0,
      Math.round(
        (energyKcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat) / KCAL_PER_G.carb,
      ),
    );
  }

  if (profile.carbOverrideG != null) carbG = profile.carbOverrideG;

  const massBasis =
    leanKg != null
      ? `${proteinPerKg} g per kg of lean mass (${Math.round(leanKg * 10) / 10} kg, from your recorded body-fat percentage)`
      : `${proteinPerKg} g per kg of body weight (${Math.round(bodyKg * 10) / 10} kg)`;

  const projectedWeeklyChangeKg =
    Math.round(((energyKcal - tdeeValue) * 7 * 100) / KCAL_PER_KG_BODY_MASS) / 100;
  const ratePct = Math.abs(projectedWeeklyChangeKg) / bodyKg;
  let rateVerdict: NutritionTargets['rateVerdict'] = 'sane';
  if (projectedWeeklyChangeKg < 0) {
    rateVerdict =
      ratePct > LOSS_RATE_BAND.max ? 'fast' : ratePct < LOSS_RATE_BAND.min ? 'slow' : 'sane';
  } else if (projectedWeeklyChangeKg > 0) {
    rateVerdict =
      ratePct > GAIN_RATE_BAND.max ? 'fast' : ratePct < GAIN_RATE_BAND.min ? 'slow' : 'sane';
  }

  const energyBasis = `${plan.label}: maintenance ${tdeeValue} kcal × ${plan.energyFactor}.${
    floorApplied ? ' Raised to the floor — see the warning.' : ''
  }`;

  const targets: NutritionTargets = {
    available: true,
    missingInputs: [],
    bmr: bmrFigure,
    tdee,
    energyKcal: energyOverridden
      ? { value: energyKcal, recorded: true }
      : {
          value: energyKcal,
          basis: energyBasis,
          assumptions: { tdee: tdeeValue, goal: profile.goal, factor: plan.energyFactor },
          confidence: 'medium',
        },
    proteinG:
      profile.proteinOverrideG != null
        ? { value: proteinG, recorded: true }
        : {
            value: proteinG,
            basis: `${massBasis}.${proteinCapped ? ` Capped at ${Math.round(proteinCap * 100)}% of the calorie target.` : ''} Protein is the macro worth hitting: in a deficit it is what decides whether the weight lost is fat or muscle.`,
            assumptions: { perKg: proteinPerKg, massKg: Math.round(massKg * 10) / 10, capped: proteinCapped },
            confidence: 'medium',
          },
    fatG:
      profile.fatOverrideG != null
        ? { value: fatG, recorded: true }
        : {
            value: fatG,
            basis: `${plan.fatPerKg} g per kg, floored at ${FAT_PER_KG_FLOOR} g per kg of body weight and at ${Math.round(FAT_ENERGY_FLOOR * 100)}% of energy — hormones and satiety both suffer below that.`,
            assumptions: { perKg: plan.fatPerKg, massKg: Math.round(massKg * 10) / 10 },
            confidence: 'medium',
          },
    carbG:
      profile.carbOverrideG != null
        ? { value: carbG, recorded: true }
        : {
            value: carbG,
            basis: 'Whatever energy is left after protein and fat. Carbohydrate is the flexible one on purpose — it fuels training, and moving it is how the target absorbs a heavy day.',
            assumptions: { energyKcal, proteinG, fatG },
            confidence: 'medium',
          },
    fibreG: {
      value: Math.round((energyKcal / 1000) * FIBRE_G_PER_1000_KCAL),
      basis: `${FIBRE_G_PER_1000_KCAL} g per 1000 kcal (Institute of Medicine, 2005). A suggestion, not a limit.`,
      confidence: 'medium',
    },
    projectedWeeklyChangeKg,
    rateVerdict,
    weightGrams: weighIn.weightGrams,
    weighInDay: weighIn.day,
  };

  if (floorApplied) targets.floorApplied = floorApplied;
  if (macroAdjustment) targets.macroAdjustment = macroAdjustment;
  if (bodyFatRecordedPct != null) {
    targets.bodyFatRecordedPct = bodyFatRecordedPct;
  } else if (profile.heightCm && profile.birthDate) {
    targets.bodyFatPct = estimateBodyFatPct({
      sex,
      weightGrams: weighIn.weightGrams,
      heightCm: profile.heightCm,
      age: ageOn(profile.birthDate, today),
    });
  }

  const rateNote =
    rateVerdict === 'fast'
      ? ` At ${projectedWeeklyChangeKg} kg a week that is faster than the ${projectedWeeklyChangeKg < 0 ? '0.5–1.0%' : '0.25–0.5%'} of body weight a week that keeps the change useful.`
      : rateVerdict === 'slow'
        ? ` At ${projectedWeeklyChangeKg} kg a week the change will be slow enough to be hard to see against day-to-day noise.`
        : '';

  if (profile.goal === 'recomp') {
    targets.goalNote =
      'Losing fat and building muscle at once is real, but it is conditional: it needs resistance ' +
      'training, this much protein, sleep, and it goes faster the more body fat you start with. ' +
      'The deficit is deliberately small — go much deeper and the fat still comes off, but the ' +
      'muscle stops arriving, which is the half of this goal that is hard to get back.' +
      rateNote;
  } else if (profile.goal === 'max_gain') {
    targets.goalNote = `Capped at +20% over maintenance on purpose. Muscle can only be built so fast; a bigger surplus than this mostly adds fat, which you then have to diet off again.${rateNote}`;
  } else if (rateNote) {
    targets.goalNote = rateNote.trim();
  }

  return targets;
}

// ------------------------------------------------------------------ time and slots

/**
 * Which day a meal eaten "now" belongs to.
 *
 * `dayStartHour` exists because a 01:20 snack belongs to the day that is ending, not to the one
 * that just started. Takes a `Date` and reads its **local** components deliberately: the day is
 * the eater's, not the server's.
 */
export function localDay(now: Date, dayStartHour = 4): string {
  const shifted = new Date(now.getTime());
  if (now.getHours() < dayStartHour) {
    shifted.setDate(shifted.getDate() - 1);
  }
  const year = shifted.getFullYear();
  const month = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The slot a meal at this local time most likely belongs to. A default, never a rule. */
export function defaultSlot(hour: number, minute = 0): MealSlot {
  const minutes = hour * 60 + minute;
  for (const boundary of SLOT_BOUNDARIES) {
    if (minutes < boundary.until) return boundary.slot;
  }
  return 'snack';
}

/** Convenience for the browser: the day and slot for a given instant. */
export function localMealContext(now: Date, dayStartHour = 4): { day: string; slot: MealSlot } {
  return { day: localDay(now, dayStartHour), slot: defaultSlot(now.getHours(), now.getMinutes()) };
}

// ------------------------------------------------------------------ cheat day

/**
 * The next configured cheat day at or after `today`. Today counts as zero days, because on the
 * day itself the answer to "when is it" is "now".
 */
export function nextCheatDay(
  today: string,
  cheatDays: number[],
): { day: string; daysUntil: number; isToday: boolean } | undefined {
  const wanted = new Set(cheatDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (wanted.size === 0) return undefined;
  for (let offset = 0; offset < 7; offset += 1) {
    const day = addDays(today, offset);
    if (wanted.has(weekdayOf(day))) {
      return { day, daysUntil: offset, isToday: offset === 0 };
    }
  }
  return undefined;
}

export function cheatDayInfo(input: {
  today: string;
  cheatDays: number[];
  queue: CheatMealView[];
  bankedKcal: number;
}): CheatDayInfo {
  const next = nextCheatDay(input.today, input.cheatDays);
  const info: CheatDayInfo = {
    cheatDays: input.cheatDays,
    isToday: next?.isToday ?? false,
    queue: input.queue,
    queueTotals: sumTotals(
      input.queue.filter((row) => !row.eaten && row.totals).map((row) => row.totals as EntryTotals),
    ),
    bankedKcal: input.bankedKcal,
  };
  if (next) {
    info.nextDay = next.day;
    info.daysUntil = next.daysUntil;
  }
  return info;
}

// ------------------------------------------------------------------ summary

/** The three numbers on the dashboard card, plus the cheat-day countdown. */
export function summariseNutrition(input: {
  day: string;
  totals: EntryTotals;
  entryCount: number;
  targets: NutritionTargets;
  goal: NutritionGoal;
  cheat?: { nextDay?: string; daysUntil?: number };
}): NutritionSummary {
  const targetKcal = input.targets.energyKcal?.value;
  const proteinTargetG = input.targets.proteinG?.value;
  const proteinEatenG = mgToG(input.totals.proteinMg);

  const summary: NutritionSummary = {
    day: input.day,
    eatenKcal: input.totals.energyKcal,
    proteinEatenG,
    entryCount: input.entryCount,
    targetsAvailable: input.targets.available,
    goal: input.goal,
  };
  if (targetKcal != null) {
    summary.targetKcal = targetKcal;
    summary.leftKcal = targetKcal - input.totals.energyKcal;
  }
  if (proteinTargetG != null) {
    summary.proteinTargetG = proteinTargetG;
    summary.proteinLeftG = proteinTargetG - proteinEatenG;
  }
  if (input.cheat?.nextDay) {
    summary.nextCheatDay = input.cheat.nextDay;
    summary.daysUntilCheat = input.cheat.daysUntil;
  }
  return summary;
}

/** Reconstructs a logged entry's derived fields. Used wherever entries are serialised. */
export function decorateEntry(row: Omit<MealEntry, 'totals' | 'servings'>): MealEntry {
  return {
    ...row,
    totals: entryTotals(row.amount, row.facts),
    servings: amountToServings(row.amount, row.facts.servingSize),
  };
}

/** The snapshot written onto a new entry: the facts as they are right now, and nothing else. */
export function snapshotFacts(food: Food): EntryFacts {
  const facts: EntryFacts = {
    name: food.name,
    servingSize: food.servingSize,
    energyKcalPer100: food.energyKcalPer100,
    proteinMgPer100: food.proteinMgPer100,
    fatMgPer100: food.fatMgPer100,
    carbMgPer100: food.carbMgPer100,
  };
  if (food.brand) facts.brand = food.brand;
  if (food.fibreMgPer100 != null) facts.fibreMgPer100 = food.fibreMgPer100;
  if (food.sugarMgPer100 != null) facts.sugarMgPer100 = food.sugarMgPer100;
  if (food.satFatMgPer100 != null) facts.satFatMgPer100 = food.satFatMgPer100;
  if (food.sodiumMgPer100 != null) facts.sodiumMgPer100 = food.sodiumMgPer100;
  return facts;
}

/** Days until the next cheat day, or `undefined` when none is configured. */
export function daysUntilCheatDay(today: string, cheatDays: number[]): number | undefined {
  return nextCheatDay(today, cheatDays)?.daysUntil;
}

/** Exported for the UI's "x of y" copy, so the same rounding is used everywhere. */
export function remainingOf(target: number | undefined, eaten: number): number | undefined {
  return target == null ? undefined : target - eaten;
}
