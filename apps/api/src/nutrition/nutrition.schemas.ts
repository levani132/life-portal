import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  ACTIVITY_LEVELS,
  FOOD_ENTRY_MODES,
  FOOD_SOURCES,
  FOOD_UNITS,
  MEAL_SLOTS,
  NUTRITION_GOALS,
  SEXES,
} from '@life-portal/shared-types';
import { baseSchemaOptions, dayField, requiredDayField } from '../common/mongoose';

/**
 * Widget 9 — food.
 *
 * Numeric conventions, which are principle II applied to something other than money: energy is
 * whole **kilocalories**, macronutrients are whole **milligrams** (`*Mg`, the way money is
 * `*Cents`), body weight is whole **grams**, and a food's facts are per **100 base units** —
 * a base unit being a gram for solids and a millilitre for liquids.
 *
 * As with `centsField`, the optional nutrient field has **no `default: 0`**. "Unknown fibre" and
 * "no fibre" are different facts, and conflating them would break every `??` downstream — the
 * same mistake that once zeroed two money figures (see `docs/DECISIONS.md`).
 */
const integerValidator = {
  validator: (value: unknown) => value == null || Number.isInteger(value),
  message: 'Nutrition values are whole kilocalories or whole milligrams',
};

/** Optional nutrient. No default, on purpose. */
const nutrientField = { type: Number, min: 0, validate: integerValidator } as const;

/** Required nutrient: the four every food must state. */
const requiredNutrientField = {
  type: Number,
  required: true,
  default: 0,
  min: 0,
  validate: integerValidator,
} as const;

// ------------------------------------------------------------------ foods

@Schema({ ...baseSchemaOptions, collection: 'foods' })
export class Food {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, trim: true, maxlength: 160 }) name!: string;
  @Prop({ trim: true, maxlength: 120 }) brand?: string;
  @Prop({ required: true, enum: FOOD_UNITS, default: 'g' }) unit!: string;
  /** Base units in one serving. */
  @Prop({ required: true, min: 1, max: 5000, validate: integerValidator }) servingSize!: number;
  @Prop({ maxlength: 60 }) servingLabel?: string;
  /** Pure fat is 900 kcal per 100 g, so anything above that is a typo, not a food. */
  @Prop({ ...requiredNutrientField, max: 900 }) energyKcalPer100!: number;
  @Prop({ ...requiredNutrientField, max: 100_000 }) proteinMgPer100!: number;
  @Prop({ ...requiredNutrientField, max: 100_000 }) fatMgPer100!: number;
  @Prop({ ...requiredNutrientField, max: 100_000 }) carbMgPer100!: number;
  @Prop(nutrientField) fibreMgPer100?: number;
  @Prop(nutrientField) sugarMgPer100?: number;
  @Prop(nutrientField) satFatMgPer100?: number;
  @Prop(nutrientField) sodiumMgPer100?: number;
  /** How the owner typed the numbers in, so the edit form reopens the same way. */
  @Prop({ required: true, enum: FOOD_ENTRY_MODES, default: 'per_serving' }) entryMode!: string;
  @Prop({ default: false }) favourite!: boolean;
  @Prop({ maxlength: 32 }) barcode?: string;
  @Prop({ required: true, enum: FOOD_SOURCES, default: 'manual' }) source!: string;
  /** Open Food Facts product code, for the attribution link. */
  @Prop() sourceRef?: string;
  /**
   * A food that has already been logged is archived rather than deleted: the log keeps its
   * snapshot either way, but the picker has to stay clean and the history readable.
   */
  @Prop({ default: false, index: true }) archived!: boolean;
  @Prop({ maxlength: 500 }) notes?: string;
}

export const FoodSchema = SchemaFactory.createForClass(Food);
FoodSchema.index({ userId: 1, name: 1 });
FoodSchema.index({ userId: 1, favourite: -1 });
FoodSchema.index({ userId: 1, barcode: 1 }, { sparse: true });

// ------------------------------------------------------------------ meal entries

/**
 * The facts a meal was logged with, frozen.
 *
 * This is the one place in the codebase where a value is copied rather than referenced, and it
 * is deliberate: an event row records what was true when it happened, exactly as a stock lot
 * records its purchase price. Without it, correcting a food's calories would silently rewrite
 * every day it had ever appeared in. See `docs/DECISIONS.md`.
 */
@Schema({ _id: false })
export class EntryFactsSub {
  @Prop({ required: true }) name!: string;
  @Prop() brand?: string;
  /** The food's serving size at log time, so "1.5 servings" keeps its meaning in history. */
  @Prop({ required: true, min: 1, default: 100 }) servingSize!: number;
  @Prop(requiredNutrientField) energyKcalPer100!: number;
  @Prop(requiredNutrientField) proteinMgPer100!: number;
  @Prop(requiredNutrientField) fatMgPer100!: number;
  @Prop(requiredNutrientField) carbMgPer100!: number;
  @Prop(nutrientField) fibreMgPer100?: number;
  @Prop(nutrientField) sugarMgPer100?: number;
  @Prop(nutrientField) satFatMgPer100?: number;
  @Prop(nutrientField) sodiumMgPer100?: number;
}

export const EntryFactsSchema = SchemaFactory.createForClass(EntryFactsSub);

@Schema({ ...baseSchemaOptions, collection: 'meal_entries' })
export class MealEntry {
  @Prop({ required: true, index: true }) userId!: string;
  /** Supplied by the client from its own clock and the day-start hour, never derived here. */
  @Prop(requiredDayField) day!: string;
  @Prop({ required: true, enum: MEAL_SLOTS }) slot!: string;
  @Prop({ required: true, index: true }) foodId!: string;
  /** Base units eaten. */
  @Prop({ required: true, min: 1, max: 20_000, validate: integerValidator }) amount!: number;
  @Prop({ required: true, enum: FOOD_UNITS }) unit!: string;
  @Prop({ type: EntryFactsSchema, required: true }) facts!: EntryFactsSub;
  /** Set when the entry came from a saved meal, so the group can be undone together. */
  @Prop({ index: true }) savedMealId?: string;
  /** Set when the entry came from the cheat-day queue. */
  @Prop({ index: true }) cheatMealId?: string;
  @Prop({ maxlength: 300 }) note?: string;
}

export const MealEntrySchema = SchemaFactory.createForClass(MealEntry);
MealEntrySchema.index({ userId: 1, day: -1 });
MealEntrySchema.index({ userId: 1, day: 1, slot: 1 });
MealEntrySchema.index({ userId: 1, foodId: 1 });

// ------------------------------------------------------------------ saved meals

@Schema({ _id: false })
export class SavedMealComponentSub {
  @Prop({ required: true }) foodId!: string;
  @Prop({ required: true, min: 1, max: 20_000, validate: integerValidator }) amount!: number;
}

export const SavedMealComponentSchema = SchemaFactory.createForClass(SavedMealComponentSub);

/**
 * A named group of foods — "my oatmeal bowl". Components **reference** foods and never copy
 * their facts (principle IV): the meal has not been eaten yet, so the right numbers are today's.
 * The snapshot happens when it is logged, one entry per component.
 */
@Schema({ ...baseSchemaOptions, collection: 'saved_meals' })
export class SavedMeal {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, trim: true, maxlength: 120 }) name!: string;
  @Prop({ enum: MEAL_SLOTS }) defaultSlot?: string;
  @Prop({ type: [SavedMealComponentSchema], default: [] })
  components!: SavedMealComponentSub[];
  @Prop({ default: false }) archived!: boolean;
}

export const SavedMealSchema = SchemaFactory.createForClass(SavedMeal);
SavedMealSchema.index({ userId: 1, name: 1 });

// ------------------------------------------------------------------ profile

/**
 * Intent, not measurement: the goal, the activity level, the height. Weight and body fat live in
 * `weigh_ins` because they are measurements, and a measurement has a date (principle III).
 */
@Schema({ ...baseSchemaOptions, collection: 'nutrition_profiles' })
export class NutritionProfile {
  @Prop({ required: true, index: true, unique: true }) userId!: string;
  @Prop({ enum: SEXES }) sex?: string;
  @Prop({ min: 100, max: 250 }) heightCm?: number;
  @Prop(dayField) birthDate?: string;
  @Prop({ required: true, enum: ACTIVITY_LEVELS, default: 'light' }) activityLevel!: string;
  @Prop({ required: true, enum: NUTRITION_GOALS, default: 'maintain' }) goal!: string;
  /** The owner's own measured figure. Beats every equation, and is not an estimate. */
  @Prop({ min: 800, max: 5000 }) basalRateKcal?: number;
  /** Weekdays, `0` = Sunday, matching `weekdayOf()`. */
  @Prop({ type: [Number], default: [] }) cheatDays!: number[];
  /** A meal logged before this hour belongs to the previous day. */
  @Prop({ required: true, default: 4, min: 0, max: 12 }) dayStartHour!: number;
  @Prop({ min: 800, max: 8000 }) energyOverrideKcal?: number;
  @Prop({ min: 0, max: 500 }) proteinOverrideG?: number;
  @Prop({ min: 0, max: 500 }) fatOverrideG?: number;
  @Prop({ min: 0, max: 1000 }) carbOverrideG?: number;
}

export const NutritionProfileSchema = SchemaFactory.createForClass(NutritionProfile);

// ------------------------------------------------------------------ weigh-ins

@Schema({ ...baseSchemaOptions, collection: 'weigh_ins' })
export class WeighIn {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop(requiredDayField) day!: string;
  @Prop({ required: true, min: 20_000, max: 400_000, validate: integerValidator })
  weightGrams!: number;
  /** Decimal, e.g. `0.18`. The one input that switches the basal-rate equation. */
  @Prop({ min: 0.03, max: 0.6 }) bodyFatPct?: number;
  @Prop({ maxlength: 300 }) note?: string;
}

export const WeighInSchema = SchemaFactory.createForClass(WeighIn);
// One weigh-in per day: stepping on the scale twice corrects the figure rather than stacking two
// rows with the same day and an ambiguous winner, exactly as `cash_balances` does.
WeighInSchema.index({ userId: 1, day: 1 }, { unique: true });

// ------------------------------------------------------------------ cheat queue

@Schema({ ...baseSchemaOptions, collection: 'cheat_meals' })
export class CheatMeal {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true }) foodId!: string;
  @Prop({ required: true, min: 1, max: 20_000, validate: integerValidator }) amount!: number;
  @Prop({ default: 0 }) order!: number;
  @Prop({ default: false }) eaten!: boolean;
  @Prop(dayField) eatenDay?: string;
  @Prop({ maxlength: 300 }) note?: string;
}

export const CheatMealSchema = SchemaFactory.createForClass(CheatMeal);
CheatMealSchema.index({ userId: 1, order: 1 });
