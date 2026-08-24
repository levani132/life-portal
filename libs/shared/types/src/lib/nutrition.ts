import type { Estimate, Id, IsoDate, Timestamped } from './common';

/**
 * Widget 9 — "Food".
 *
 * What was eaten today, against what should be eaten, plus a prioritised cheat-day queue.
 *
 * Two conventions to know before reading further:
 *
 * 1. **Nutrition numbers are integers, by analogy with money** (constitution principle II).
 *    Energy is whole kilocalories; macronutrients are whole **milligrams** in fields named
 *    `*Mg`, the way money is named `*Cents`; body weight is whole grams. Nothing is a float,
 *    and the conversion to "27 g of protein" happens at the render edge.
 * 2. **Facts are stored per 100 base units**, where a base unit is a gram for solids and a
 *    millilitre for liquids. Amounts are logged in the same base unit, so every derivation is
 *    one multiply and a serving size is only ever a convenience.
 */

export const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'uncategorized'] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

/** Grams for solids, millilitres for liquids. Never converted between (see docs/DECISIONS.md). */
export const FOOD_UNITS = ['g', 'ml'] as const;
export type FoodUnit = (typeof FOOD_UNITS)[number];

/** How the owner typed a food's numbers in, so the form reopens the way they filled it. */
export const FOOD_ENTRY_MODES = ['per_serving', 'per_100'] as const;
export type FoodEntryMode = (typeof FOOD_ENTRY_MODES)[number];

export const FOOD_SOURCES = ['manual', 'openfoodfacts'] as const;
export type FoodSource = (typeof FOOD_SOURCES)[number];

export const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'very', 'athlete'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const NUTRITION_GOALS = [
  /** Fastest loss the guardrails allow; accepts some lean-mass loss. */
  'pure_weight_loss',
  /** Slower deficit, protein high enough to protect muscle. */
  'fat_loss',
  /**
   * Body recomposition: lose fat and build muscle at the same time. A small deficit and a lot of
   * protein, which is the combination the evidence supports — and it works better the more fat
   * there is to draw on.
   */
  'recomp',
  'maintain',
  /** Small surplus: muscle with as little fat as possible. */
  'lean_gain',
  /** Largest surplus that is still mostly muscle — capped on purpose. */
  'max_gain',
] as const;
export type NutritionGoal = (typeof NUTRITION_GOALS)[number];

export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];

// ------------------------------------------------------------------ foods

/** Per 100 base units. The optional fields are absent when unknown, never zero. */
export interface NutritionFacts {
  energyKcalPer100: number;
  proteinMgPer100: number;
  fatMgPer100: number;
  carbMgPer100: number;
  fibreMgPer100?: number;
  sugarMgPer100?: number;
  satFatMgPer100?: number;
  sodiumMgPer100?: number;
}

export interface Food extends NutritionFacts, Timestamped {
  id: Id;
  userId: Id;
  name: string;
  brand?: string;
  unit: FoodUnit;
  /** Base units in one serving. */
  servingSize: number;
  /** Display only, e.g. "1 slice", "1 can". */
  servingLabel?: string;
  entryMode: FoodEntryMode;
  favourite: boolean;
  barcode?: string;
  source: FoodSource;
  /** Open Food Facts product code, for the attribution link. */
  sourceRef?: string;
  /** A food that has been logged is archived rather than deleted, so history keeps its name. */
  archived: boolean;
  notes?: string;
}

/** What one serving works out to. Derived, so the UI never does the arithmetic twice. */
export interface ServingTotals {
  energyKcal: number;
  proteinMg: number;
  fatMg: number;
  carbMg: number;
  fibreMg?: number;
}

export interface FoodWithUsage extends Food {
  perServing: ServingTotals;
  /** Derived from the log by aggregation — never stored (constitution principle III). */
  lastUsedDay?: IsoDate;
  useCount: number;
}

// ------------------------------------------------------------------ entries

/**
 * The facts a meal was logged with, frozen at that moment. Correcting a food later must not
 * rewrite what happened last week — the same reasoning as a stock lot storing its purchase
 * price rather than today's quote.
 */
export interface EntryFacts extends NutritionFacts {
  name: string;
  brand?: string;
  /**
   * The food's serving size at log time. Frozen with the rest, so "1.5 servings" still means
   * what it meant on the day — a later edit to the serving size cannot rewrite it.
   */
  servingSize: number;
}

export type EntryTotals = ServingTotals;

export interface MealEntry extends Timestamped {
  id: Id;
  userId: Id;
  day: IsoDate;
  slot: MealSlot;
  foodId: Id;
  /** Base units eaten. */
  amount: number;
  unit: FoodUnit;
  facts: EntryFacts;
  /** Set when the entry came from a saved meal, so the group can be undone together. */
  savedMealId?: Id;
  /** Set when the entry came from the cheat-day queue. */
  cheatMealId?: Id;
  note?: string;
  /** Derived from `amount` and `facts`. */
  totals: EntryTotals;
  /** Servings this amount works out to, for display. */
  servings: number;
}

export interface SlotTotals {
  slot: MealSlot;
  totals: EntryTotals;
  entries: MealEntry[];
}

export interface DayTotals {
  day: IsoDate;
  totals: EntryTotals;
  slots: SlotTotals[];
  entryCount: number;
}

// ------------------------------------------------------------------ saved meals

export interface SavedMealComponent {
  foodId: Id;
  amount: number;
}

/** A component with today's facts resolved, for display before it is logged. */
export interface SavedMealComponentView extends SavedMealComponent {
  name?: string;
  brand?: string;
  unit?: FoodUnit;
  totals?: EntryTotals;
  /** The referenced food was deleted or archived: the meal cannot be logged until it is fixed. */
  missing: boolean;
}

export interface SavedMeal extends Timestamped {
  id: Id;
  userId: Id;
  name: string;
  defaultSlot?: MealSlot;
  components: SavedMealComponentView[];
  archived: boolean;
  totals: EntryTotals;
  loggable: boolean;
}

/**
 * A food this slot has eaten before, offered for one tap.
 *
 * Derived on every read from the log (principle III) and priced with the food's **current**
 * facts, not with any old snapshot — logging it takes a fresh snapshot, so the calories shown
 * on the button are the calories that land in the day.
 */
export interface MealSuggestion {
  slot: MealSlot;
  foodId: Id;
  name: string;
  brand?: string;
  unit: FoodUnit;
  /** Base units: what this food added to this slot on `lastDay`. */
  amount: number;
  servings: number;
  totals: EntryTotals;
  /** The most recent day this food was eaten in this slot. */
  lastDay: IsoDate;
  /** Distinct days it appeared in this slot inside the lookback window. */
  dayCount: number;
}

/** One of the last few logged meals, for "repeat this". */
export interface RecentMeal {
  day: IsoDate;
  slot: MealSlot;
  label: string;
  entryIds: Id[];
  totals: EntryTotals;
}

// ------------------------------------------------------------------ profile

export interface NutritionProfile extends Timestamped {
  id: Id;
  userId: Id;
  sex?: Sex;
  heightCm?: number;
  birthDate?: IsoDate;
  activityLevel: ActivityLevel;
  goal: NutritionGoal;
  /** The owner's own measured figure. Beats every equation, and is not an estimate. */
  basalRateKcal?: number;
  /** Weekdays, `0` = Sunday, matching `weekdayOf()` in the domain library. */
  cheatDays: number[];
  /** A meal logged before this hour belongs to the previous day. Default 4. */
  dayStartHour: number;
  energyOverrideKcal?: number;
  proteinOverrideG?: number;
  fatOverrideG?: number;
  carbOverrideG?: number;
}

export interface WeighIn extends Timestamped {
  id: Id;
  userId: Id;
  day: IsoDate;
  weightGrams: number;
  /** Decimal, e.g. `0.18` for 18%. The one input that switches the basal-rate equation. */
  bodyFatPct?: number;
  note?: string;
}

// ------------------------------------------------------------------ targets

/**
 * A figure the owner supplied rather than one the system derived. Rendered without the `est`
 * mark, because labelling a recorded value as an estimate is its own kind of lie
 * (constitution principle VI).
 */
export interface Recorded<T = number> {
  value: T;
  recorded: true;
}

export type TargetFigure = Estimate<number> | Recorded<number>;

export interface NutritionTargets {
  available: boolean;
  /** Named inputs the calculation is missing, e.g. `['birthDate', 'weighIn']`. */
  missingInputs: string[];
  bmr?: TargetFigure;
  tdee?: Estimate<number>;
  /** Deurenberg estimate, shown when body fat was not measured. Display only. */
  bodyFatPct?: Estimate<number>;
  /** Present when a weigh-in recorded it. */
  bodyFatRecordedPct?: number;
  energyKcal?: TargetFigure;
  proteinG?: TargetFigure;
  fatG?: TargetFigure;
  carbG?: TargetFigure;
  fibreG?: Estimate<number>;
  /** Set when a goal's deficit was clipped by the safety floor. */
  floorApplied?: { floorKcal: number; requestedKcal: number; reason: string };
  /** Set when a macro had to be cut to keep carbohydrate non-negative. */
  macroAdjustment?: { what: 'fat' | 'protein'; fromG: number; toG: number; reason: string };
  projectedWeeklyChangeKg?: number;
  rateVerdict?: 'sane' | 'fast' | 'slow';
  /** Goal-specific caveat, e.g. why maximum growth stops at +20%. */
  goalNote?: string;
  weightGrams?: number;
  weighInDay?: IsoDate;
}

// ------------------------------------------------------------------ week and cheat day

export interface WeekDayBalance {
  day: IsoDate;
  eatenKcal: number;
  logged: boolean;
  isToday: boolean;
}

export interface WeekBalance {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  eatenKcal: number;
  /** Absent when targets are unavailable. */
  targetKcal?: number;
  differenceKcal?: number;
  daysLogged: number;
  days: WeekDayBalance[];
  /**
   * Calories under target on days already logged this week, clamped at zero. An allowance for
   * the cheat day, not a rule. Unlogged days are excluded, so forgetting to log does not hand
   * out a fictional deficit.
   */
  bankedKcal: number;
}

export interface CheatMeal extends Timestamped {
  id: Id;
  userId: Id;
  foodId: Id;
  amount: number;
  order: number;
  eaten: boolean;
  eatenDay?: IsoDate;
  note?: string;
}

/** A queue row with the referenced food resolved. The row never copies the food's facts. */
export interface CheatMealView extends CheatMeal {
  name?: string;
  brand?: string;
  unit?: FoodUnit;
  servings?: number;
  totals?: EntryTotals;
  missing: boolean;
}

export interface CheatDayInfo {
  cheatDays: number[];
  nextDay?: IsoDate;
  daysUntil?: number;
  isToday: boolean;
  queue: CheatMealView[];
  queueTotals: EntryTotals;
  bankedKcal: number;
}

// ------------------------------------------------------------------ lookup

/** One Open Food Facts hit, mapped to this app's shape. Unknown nutriments stay absent. */
export interface FoodLookupResult {
  code: string;
  name: string;
  brand?: string;
  unit: FoodUnit;
  servingSize?: number;
  energyKcalPer100?: number;
  proteinMgPer100?: number;
  fatMgPer100?: number;
  carbMgPer100?: number;
  fibreMgPer100?: number;
  sugarMgPer100?: number;
  satFatMgPer100?: number;
  sodiumMgPer100?: number;
  imageUrl?: string;
  /** ODbL notice and source URL, rendered wherever the result is shown. */
  attribution: string;
}

export interface FoodLookupStatus {
  available: boolean;
  /** Why the lookup is unavailable, for the UI to show plainly. */
  reason?: string;
}

export interface FoodLookupResponse extends FoodLookupStatus {
  results: FoodLookupResult[];
}

export interface BarcodeLookupResponse extends FoodLookupStatus {
  result?: FoodLookupResult;
}

// ------------------------------------------------------------------ summary and overview

export interface NutritionSummary {
  day: IsoDate;
  eatenKcal: number;
  proteinEatenG: number;
  entryCount: number;
  targetsAvailable: boolean;
  targetKcal?: number;
  leftKcal?: number;
  proteinTargetG?: number;
  proteinLeftG?: number;
  goal: NutritionGoal;
  nextCheatDay?: IsoDate;
  daysUntilCheat?: number;
}

/** Everything the detail page renders, in one round trip. */
export interface NutritionOverview {
  today: IsoDate;
  /** The day being viewed, which may not be today. */
  day: IsoDate;
  profile: NutritionProfile;
  targets: NutritionTargets;
  dayTotals: DayTotals;
  week: WeekBalance;
  cheat: CheatDayInfo;
  weighIns: WeighIn[];
  foods: FoodWithUsage[];
  savedMeals: SavedMeal[];
  recentMeals: RecentMeal[];
  /** Per-slot one-tap offers, in slot order then rank. Empty until something has been eaten. */
  suggestions: MealSuggestion[];
  foodLookup: FoodLookupStatus;
}
