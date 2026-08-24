import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import type {
  BarcodeLookupResponse,
  CheatDayInfo,
  CheatMealView,
  DayTotals,
  Food as FoodDto,
  FoodLookupResponse,
  FoodWithUsage,
  MealEntry as MealEntryDto,
  NutritionOverview,
  NutritionProfile as NutritionProfileDto,
  NutritionSummary,
  NutritionTargets,
  RecentMeal,
  SavedMeal as SavedMealDto,
  SavedMealComponentView,
  WeighIn as WeighInDto,
} from '@life-portal/shared-types';
import {
  addDays,
  cheatDayInfo,
  dayTotals,
  decorateEntry,
  entryTotals,
  factsFromInput,
  macroEnergyMismatch,
  mealSuggestions,
  nextCheatDay,
  nutritionTargets,
  perServingTotals,
  servingsToAmount,
  snapshotFacts,
  SUGGESTION_LOOKBACK_DAYS,
  summariseNutrition,
  sumTotals,
  toDay,
  weekBalance,
  weekEnd,
  weekStart,
} from '@life-portal/shared-domain';
import { OpenFoodFactsProvider } from './openfoodfacts.provider';
import {
  CheatMeal,
  Food,
  MealEntry,
  NutritionProfile,
  SavedMeal,
  WeighIn,
} from './nutrition.schemas';
import type {
  CreateCheatMealDto,
  CreateEntryDto,
  CreateFoodDto,
  CreateSavedMealDto,
  LogSavedMealDto,
  RepeatMealDto,
  SaveSlotAsMealDto,
  UpdateCheatMealDto,
  UpdateEntryDto,
  UpdateFoodDto,
  UpdateProfileDto,
  UpdateSavedMealDto,
  UpsertWeighInDto,
} from './nutrition.dto';

/** How many recent meals the "repeat this" list offers. */
const RECENT_MEAL_LIMIT = 10;

const DEFAULT_PROFILE = {
  activityLevel: 'light',
  goal: 'maintain',
  cheatDays: [] as number[],
  dayStartHour: 4,
};

/**
 * Food, macros, body metrics and the cheat-day queue.
 *
 * Six collections, one concern. Every query names `userId` explicitly, as the other multi-model
 * services do (`BoardsService`, `CashflowService`) — there is no unscoped read here.
 *
 * Nothing derived is stored: totals, targets, countdowns, banked calories and the food picker's
 * recency order are all computed on read (principle III). The single exception is the `facts`
 * snapshot on a meal entry, which records what was true when the meal was eaten rather than
 * caching a derivation — the reasoning is in `docs/DECISIONS.md`.
 */
@Injectable()
export class NutritionService {
  private readonly logger = new Logger(NutritionService.name);

  constructor(
    @InjectModel(Food.name) private readonly foods: Model<Food>,
    @InjectModel(MealEntry.name) private readonly entries: Model<MealEntry>,
    @InjectModel(SavedMeal.name) private readonly savedMeals: Model<SavedMeal>,
    @InjectModel(NutritionProfile.name) private readonly profiles: Model<NutritionProfile>,
    @InjectModel(WeighIn.name) private readonly weighIns: Model<WeighIn>,
    @InjectModel(CheatMeal.name) private readonly cheatMeals: Model<CheatMeal>,
    private readonly lookup: OpenFoodFactsProvider,
  ) {}

  // ---------------------------------------------------------------- foods

  /**
   * The food picker's list: favourites first, then most recently eaten, then most recently
   * added. Recency and use count come from one aggregation over the log rather than a stored
   * counter, which would drift the moment an entry is deleted or back-dated.
   */
  async listFoods(
    userId: string,
    options: { q?: string; favourite?: boolean; includeArchived?: boolean } = {},
  ): Promise<FoodWithUsage[]> {
    const filter: Record<string, unknown> = { userId };
    if (!options.includeArchived) filter['archived'] = false;
    if (options.favourite) filter['favourite'] = true;
    if (options.q?.trim()) {
      // Escaped, because a stray `(` in a search box should not be a 500.
      const pattern = new RegExp(options.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter['$or'] = [{ name: pattern }, { brand: pattern }];
    }

    const [rows, usage] = await Promise.all([
      this.foods.find(filter),
      this.usageByFood(userId),
    ]);

    return rows
      .map((row) => {
        const food = row.toJSON() as unknown as FoodDto;
        const used = usage.get(food.id);
        const withUsage: FoodWithUsage = {
          ...food,
          perServing: perServingTotals(food),
          useCount: used?.useCount ?? 0,
        };
        if (used?.lastUsedDay) withUsage.lastUsedDay = used.lastUsedDay;
        return withUsage;
      })
      .sort((a, b) => {
        if (a.favourite !== b.favourite) return a.favourite ? -1 : 1;
        if (a.lastUsedDay !== b.lastUsedDay) {
          return (b.lastUsedDay ?? '').localeCompare(a.lastUsedDay ?? '');
        }
        return b.createdAt.localeCompare(a.createdAt);
      });
  }

  private async usageByFood(
    userId: string,
  ): Promise<Map<string, { lastUsedDay: string; useCount: number }>> {
    const rows = await this.entries.aggregate<{
      _id: string;
      lastUsedDay: string;
      useCount: number;
    }>([
      { $match: { userId } },
      { $group: { _id: '$foodId', lastUsedDay: { $max: '$day' }, useCount: { $sum: 1 } } },
    ]);
    return new Map(
      rows.map((row) => [String(row._id), { lastUsedDay: row.lastUsedDay, useCount: row.useCount }]),
    );
  }

  async createFood(userId: string, dto: CreateFoodDto): Promise<FoodDto> {
    const servingSize = dto.servingSize;
    const entryMode = (dto.entryMode ?? 'per_serving') as 'per_serving' | 'per_100';
    const facts = factsFromInput(dto, entryMode, servingSize);
    this.warnOnImplausibleFacts(dto.name, facts);

    const created = await this.foods.create({
      userId,
      name: dto.name,
      brand: dto.brand,
      unit: dto.unit ?? 'g',
      servingSize,
      servingLabel: dto.servingLabel,
      entryMode,
      favourite: dto.favourite ?? false,
      barcode: dto.barcode,
      source: 'manual',
      archived: dto.archived ?? false,
      notes: dto.notes,
      ...facts,
    } as never);
    return created.toJSON() as unknown as FoodDto;
  }

  async updateFood(userId: string, id: string, dto: UpdateFoodDto): Promise<FoodDto> {
    const existing = await this.findFood(userId, id);
    const servingSize = dto.servingSize ?? existing.servingSize;
    const entryMode = (dto.entryMode ?? existing.entryMode) as 'per_serving' | 'per_100';

    const patch: Record<string, unknown> = {
      ...(dto.name != null ? { name: dto.name } : {}),
      ...(dto.brand != null ? { brand: dto.brand } : {}),
      ...(dto.unit != null ? { unit: dto.unit } : {}),
      ...(dto.servingLabel != null ? { servingLabel: dto.servingLabel } : {}),
      ...(dto.favourite != null ? { favourite: dto.favourite } : {}),
      ...(dto.barcode != null ? { barcode: dto.barcode } : {}),
      ...(dto.archived != null ? { archived: dto.archived } : {}),
      ...(dto.notes != null ? { notes: dto.notes } : {}),
      servingSize,
      entryMode,
    };

    // The four numbers travel together: re-normalising from a partial set would mix a new
    // per-serving protein figure with an old per-100 carbohydrate one.
    if (dto.energyKcal != null || dto.proteinMg != null || dto.fatMg != null || dto.carbMg != null) {
      const facts = factsFromInput(
        {
          energyKcal: dto.energyKcal ?? 0,
          proteinMg: dto.proteinMg ?? 0,
          fatMg: dto.fatMg ?? 0,
          carbMg: dto.carbMg ?? 0,
          ...(dto.fibreMg != null ? { fibreMg: dto.fibreMg } : {}),
          ...(dto.sugarMg != null ? { sugarMg: dto.sugarMg } : {}),
          ...(dto.satFatMg != null ? { satFatMg: dto.satFatMg } : {}),
          ...(dto.sodiumMg != null ? { sodiumMg: dto.sodiumMg } : {}),
        },
        entryMode,
        servingSize,
      );
      this.warnOnImplausibleFacts(dto.name ?? existing.name, facts);
      Object.assign(patch, facts);
    }

    const updated = await this.foods.findOneAndUpdate(
      { userId, _id: id },
      { $set: patch },
      { new: true, runValidators: true },
    );
    if (!updated) throw new NotFoundException(`Food ${id} not found`);
    return updated.toJSON() as unknown as FoodDto;
  }

  /**
   * Deleting a food that has been eaten would orphan nothing — entries keep their snapshot — but
   * it would erase the row the log points at, so a logged food is archived instead. An unused
   * food is deleted outright.
   */
  async removeFood(
    userId: string,
    id: string,
  ): Promise<{ id: string; deleted?: true; archived?: true }> {
    await this.findFood(userId, id);
    const [entryCount, cheatCount, savedCount] = await Promise.all([
      this.entries.countDocuments({ userId, foodId: id }),
      this.cheatMeals.countDocuments({ userId, foodId: id }),
      this.savedMeals.countDocuments({ userId, 'components.foodId': id }),
    ]);
    if (entryCount + cheatCount + savedCount === 0) {
      await this.foods.findOneAndDelete({ userId, _id: id });
      return { id, deleted: true };
    }
    await this.foods.findOneAndUpdate({ userId, _id: id }, { $set: { archived: true } });
    return { id, archived: true };
  }

  /** A warning in the log, never a rejection: real labels disagree with their own macros. */
  private warnOnImplausibleFacts(name: string, facts: Parameters<typeof macroEnergyMismatch>[0]) {
    const mismatch = macroEnergyMismatch(facts);
    if (mismatch) {
      this.logger.warn(
        `"${name}" states ${facts.energyKcalPer100} kcal/100 but its macros imply ${mismatch.impliedKcal}. Stored as entered.`,
      );
    }
  }

  private async findFood(userId: string, id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException(`Food ${id} not found`);
    const found = await this.foods.findOne({ userId, _id: id });
    if (!found) throw new NotFoundException(`Food ${id} not found`);
    return found.toJSON() as unknown as FoodDto;
  }

  // ---------------------------------------------------------------- lookup

  async searchLookup(query: string): Promise<FoodLookupResponse> {
    return this.lookup.search(query ?? '');
  }

  async barcodeLookup(code: string): Promise<BarcodeLookupResponse> {
    return this.lookup.byBarcode(code);
  }

  /**
   * Imports a product as the owner's own food row. From then on it is theirs and editable — the
   * import is a starting point, not a live link to somebody else's database.
   */
  async importFood(userId: string, code: string): Promise<FoodDto> {
    const found = await this.lookup.byBarcode(code);
    if (!found.result) {
      throw new BadRequestException(
        found.reason ?? `Open Food Facts has no usable product for ${code}. Add it by hand instead.`,
      );
    }
    const result = found.result;
    if (result.energyKcalPer100 == null) {
      throw new BadRequestException(
        `"${result.name}" has no calorie figure in Open Food Facts, so it cannot be imported as-is. Add it by hand from the packet.`,
      );
    }

    const created = await this.foods.create({
      userId,
      name: result.name,
      brand: result.brand,
      unit: result.unit,
      servingSize: result.servingSize ?? 100,
      entryMode: 'per_100',
      favourite: false,
      barcode: /^\d+$/.test(result.code) ? result.code : undefined,
      source: 'openfoodfacts',
      sourceRef: result.code,
      archived: false,
      energyKcalPer100: result.energyKcalPer100,
      proteinMgPer100: result.proteinMgPer100 ?? 0,
      fatMgPer100: result.fatMgPer100 ?? 0,
      carbMgPer100: result.carbMgPer100 ?? 0,
      fibreMgPer100: result.fibreMgPer100,
      sugarMgPer100: result.sugarMgPer100,
      satFatMgPer100: result.satFatMgPer100,
      sodiumMgPer100: result.sodiumMgPer100,
    } as never);
    return created.toJSON() as unknown as FoodDto;
  }

  // ---------------------------------------------------------------- profile and weigh-ins

  /** Created on first read with defaults, exactly as `SettingsService.get` does. */
  async profile(userId: string): Promise<NutritionProfileDto> {
    const found = await this.profiles.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, ...DEFAULT_PROFILE } },
      { new: true, upsert: true },
    );
    return found.toJSON() as unknown as NutritionProfileDto;
  }

  /**
   * Two things this has to get right, both of which Mongo is strict about:
   *
   * 1. **No path may appear in `$set` and `$setOnInsert` at once** — Mongo rejects the whole
   *    update with `ConflictingUpdateOperators` rather than picking one, so a default is only
   *    seeded for a field the caller did not send.
   * 2. **An explicit `null` clears the field.** `undefined` disappears in JSON, so a form that
   *    wants to *remove* an override (a measured basal rate, a manual protein target) has to send
   *    `null`, and that has to become `$unset` — `$set: null` would leave a null sitting where the
   *    type says the field is absent, which is the mistake `centsField` exists to prevent.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<NutritionProfileDto> {
    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};
    for (const [field, value] of Object.entries(dto)) {
      if (value === null) unset[field] = '';
      else if (value !== undefined) set[field] = value;
    }
    const seed = Object.fromEntries(
      Object.entries(DEFAULT_PROFILE).filter(([field]) => !(field in set) && !(field in unset)),
    );

    const updated = await this.profiles.findOneAndUpdate(
      { userId },
      {
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
        $setOnInsert: { userId, ...seed },
      },
      { new: true, upsert: true, runValidators: true },
    );
    return updated.toJSON() as unknown as NutritionProfileDto;
  }

  async listWeighIns(userId: string): Promise<WeighInDto[]> {
    const rows = await this.weighIns.find({ userId }).sort({ day: 1 });
    return rows.map((row) => row.toJSON() as unknown as WeighInDto);
  }

  /** One weigh-in per day: stepping on the scale twice corrects it rather than stacking rows. */
  async upsertWeighIn(userId: string, today: string, dto: UpsertWeighInDto): Promise<WeighInDto> {
    const day = dto.day ? toDay(dto.day) : today;
    const patch: Record<string, unknown> = { weightGrams: dto.weightGrams };
    // `$unset` rather than skipping, so clearing a body-fat reading actually clears it and the
    // basal rate falls back to the weight-based equation.
    const unset: Record<string, ''> = {};
    if (dto.bodyFatPct != null) patch['bodyFatPct'] = dto.bodyFatPct;
    else unset['bodyFatPct'] = '';
    if (dto.note != null) patch['note'] = dto.note;

    const saved = await this.weighIns.findOneAndUpdate(
      { userId, day },
      { $set: patch, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { new: true, upsert: true, runValidators: true },
    );
    return saved.toJSON() as unknown as WeighInDto;
  }

  async removeWeighIn(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Weigh-in ${id} not found`);
    const deleted = await this.weighIns.findOneAndDelete({ userId, _id: id });
    if (!deleted) throw new NotFoundException(`Weigh-in ${id} not found`);
    return { id, deleted: true };
  }

  async targets(userId: string, today: string): Promise<NutritionTargets> {
    const [profile, weighIns] = await Promise.all([this.profile(userId), this.listWeighIns(userId)]);
    return nutritionTargets({ profile, weighIns, today });
  }

  // ---------------------------------------------------------------- entries

  async listEntries(
    userId: string,
    range: { day?: string; from?: string; to?: string },
  ): Promise<MealEntryDto[]> {
    const filter: Record<string, unknown> = { userId };
    if (range.day) filter['day'] = toDay(range.day);
    else if (range.from || range.to) {
      filter['day'] = {
        ...(range.from ? { $gte: toDay(range.from) } : {}),
        ...(range.to ? { $lte: toDay(range.to) } : {}),
      };
    }
    const rows = await this.entries.find(filter).sort({ day: -1, createdAt: 1 });
    return rows.map((row) => this.serializeEntry(row));
  }

  private serializeEntry(row: unknown): MealEntryDto {
    const plain = (row as { toJSON: () => unknown }).toJSON() as Omit<
      MealEntryDto,
      'totals' | 'servings'
    >;
    return decorateEntry(plain);
  }

  /**
   * The one write that matters. The `facts` snapshot is built here from the food, never accepted
   * from the client: what a meal contained is not something a request gets to assert.
   */
  async createEntry(userId: string, dto: CreateEntryDto): Promise<MealEntryDto> {
    const food = await this.findFood(userId, dto.foodId);
    const amount = this.resolveAmount(dto, food.servingSize);
    const created = await this.entries.create({
      userId,
      day: toDay(dto.day),
      slot: dto.slot,
      foodId: food.id,
      amount,
      unit: food.unit,
      facts: snapshotFacts(food),
      note: dto.note,
    } as never);
    return this.serializeEntry(created);
  }

  /**
   * Corrects an amount, a slot, a day or a note.
   *
   * The snapshot is deliberately **not** refreshed: fixing "I ate 60 g, not 40 g" must not
   * silently re-price the meal with numbers that were edited afterwards. `foodId` is not editable
   * either — a different food is a different meal.
   */
  async updateEntry(userId: string, id: string, dto: UpdateEntryDto): Promise<MealEntryDto> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Entry ${id} not found`);
    const existing = await this.entries.findOne({ userId, _id: id });
    if (!existing) throw new NotFoundException(`Entry ${id} not found`);

    const patch: Record<string, unknown> = {};
    if (dto.day) patch['day'] = toDay(dto.day);
    if (dto.slot) patch['slot'] = dto.slot;
    if (dto.note != null) patch['note'] = dto.note;
    if (dto.amount != null || dto.servings != null) {
      patch['amount'] = this.resolveAmount(dto, existing.facts.servingSize);
    }

    const updated = await this.entries.findOneAndUpdate(
      { userId, _id: id },
      { $set: patch },
      { new: true, runValidators: true },
    );
    if (!updated) throw new NotFoundException(`Entry ${id} not found`);
    return this.serializeEntry(updated);
  }

  async removeEntry(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Entry ${id} not found`);
    const deleted = await this.entries.findOneAndDelete({ userId, _id: id });
    if (!deleted) throw new NotFoundException(`Entry ${id} not found`);
    return { id, deleted: true };
  }

  /** Servings are converted with the serving size and stored as base units. */
  private resolveAmount(
    dto: { amount?: number; servings?: number },
    servingSize: number,
  ): number {
    if (dto.amount != null && dto.servings != null) {
      throw new BadRequestException('Give either an amount or a number of servings, not both.');
    }
    if (dto.amount != null) return dto.amount;
    if (dto.servings != null) return servingsToAmount(dto.servings, servingSize);
    throw new BadRequestException('An amount or a number of servings is required.');
  }

  /**
   * Logs an earlier meal again. The facts are taken from the food **as it is now** — this is a
   * new meal, so it gets today's numbers — falling back to the old snapshot when the food itself
   * has since been deleted.
   */
  async repeatMeal(userId: string, dto: RepeatMealDto): Promise<MealEntryDto[]> {
    const filter: Record<string, unknown> = { userId, day: toDay(dto.sourceDay) };
    if (dto.sourceSlot) filter['slot'] = dto.sourceSlot;
    if (dto.entryIds?.length) filter['_id'] = { $in: dto.entryIds.filter(isValidObjectId) };

    const sources = await this.entries.find(filter).sort({ createdAt: 1 });
    if (sources.length === 0) {
      throw new BadRequestException('There is nothing logged there to repeat.');
    }

    const foods = await this.foods.find({
      userId,
      _id: { $in: sources.map((row) => row.foodId).filter(isValidObjectId) },
    });
    const byId = new Map(foods.map((row) => [String(row._id), row.toJSON() as unknown as FoodDto]));

    const created = await this.entries.insertMany(
      sources.map((source) => {
        const food = byId.get(source.foodId);
        return {
          userId,
          day: toDay(dto.day),
          slot: dto.slot ?? source.slot,
          foodId: source.foodId,
          amount: source.amount,
          unit: food?.unit ?? source.unit,
          facts: food ? snapshotFacts(food) : source.facts,
          note: source.note,
        };
      }) as never,
    );
    return created.map((row) => this.serializeEntry(row));
  }

  // ---------------------------------------------------------------- saved meals

  async listSavedMeals(userId: string): Promise<SavedMealDto[]> {
    const [rows, foods] = await Promise.all([
      this.savedMeals.find({ userId, archived: false }).sort({ name: 1 }),
      this.listFoods(userId, { includeArchived: true }),
    ]);
    const byId = new Map(foods.map((food) => [food.id, food]));

    return rows.map((row) => {
      const plain = row.toJSON() as unknown as Omit<
        SavedMealDto,
        'components' | 'totals' | 'loggable'
      > & { components: { foodId: string; amount: number }[] };

      const components: SavedMealComponentView[] = plain.components.map((component) => {
        const food = byId.get(component.foodId);
        if (!food || food.archived) {
          return { ...component, missing: true, ...(food ? { name: food.name } : {}) };
        }
        return {
          ...component,
          name: food.name,
          brand: food.brand,
          unit: food.unit,
          totals: entryTotals(component.amount, food),
          missing: false,
        };
      });

      return {
        ...plain,
        components,
        totals: sumTotals(components.filter((c) => c.totals).map((c) => c.totals as never)),
        loggable: components.length > 0 && components.every((c) => !c.missing),
      };
    });
  }

  async createSavedMeal(userId: string, dto: CreateSavedMealDto): Promise<SavedMealDto> {
    await this.assertFoodsExist(userId, dto.components.map((c) => c.foodId));
    const created = await this.savedMeals.create({
      userId,
      name: dto.name,
      defaultSlot: dto.defaultSlot,
      components: dto.components,
      archived: false,
    } as never);
    return this.oneSavedMeal(userId, String(created._id));
  }

  /** Saves what was logged in one slot as a reusable meal, which is how real ones get built. */
  async saveSlotAsMeal(userId: string, dto: SaveSlotAsMealDto): Promise<SavedMealDto> {
    const entries = await this.entries.find({ userId, day: toDay(dto.day), slot: dto.slot });
    if (entries.length === 0) {
      throw new BadRequestException('There is nothing logged in that slot to save.');
    }
    const created = await this.savedMeals.create({
      userId,
      name: dto.name,
      defaultSlot: dto.slot,
      components: entries.map((entry) => ({ foodId: entry.foodId, amount: entry.amount })),
      archived: false,
    } as never);
    return this.oneSavedMeal(userId, String(created._id));
  }

  async updateSavedMeal(
    userId: string,
    id: string,
    dto: UpdateSavedMealDto,
  ): Promise<SavedMealDto> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Saved meal ${id} not found`);
    if (dto.components?.length) {
      await this.assertFoodsExist(userId, dto.components.map((c) => c.foodId));
    }
    const updated = await this.savedMeals.findOneAndUpdate(
      { userId, _id: id },
      { $set: { ...dto } },
      { new: true, runValidators: true },
    );
    if (!updated) throw new NotFoundException(`Saved meal ${id} not found`);
    return this.oneSavedMeal(userId, id);
  }

  async removeSavedMeal(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Saved meal ${id} not found`);
    const deleted = await this.savedMeals.findOneAndDelete({ userId, _id: id });
    if (!deleted) throw new NotFoundException(`Saved meal ${id} not found`);
    return { id, deleted: true };
  }

  /** One entry per component, each with its own snapshot, all tagged with the meal they came from. */
  async logSavedMeal(userId: string, id: string, dto: LogSavedMealDto): Promise<MealEntryDto[]> {
    const meal = await this.oneSavedMeal(userId, id);
    if (!meal.loggable) {
      throw new BadRequestException(
        `"${meal.name}" refers to a food that has been deleted or archived. Fix the meal before logging it.`,
      );
    }
    const foods = await this.foods.find({
      userId,
      _id: { $in: meal.components.map((c) => c.foodId).filter(isValidObjectId) },
    });
    const byId = new Map(foods.map((row) => [String(row._id), row.toJSON() as unknown as FoodDto]));

    const created = await this.entries.insertMany(
      meal.components.map((component) => {
        const food = byId.get(component.foodId) as FoodDto;
        return {
          userId,
          day: toDay(dto.day),
          slot: dto.slot ?? meal.defaultSlot ?? 'uncategorized',
          foodId: food.id,
          amount: component.amount,
          unit: food.unit,
          facts: snapshotFacts(food),
          savedMealId: meal.id,
        };
      }) as never,
    );
    return created.map((row) => this.serializeEntry(row));
  }

  private async oneSavedMeal(userId: string, id: string): Promise<SavedMealDto> {
    const all = await this.listSavedMeals(userId);
    const found = all.find((meal) => meal.id === id);
    if (!found) throw new NotFoundException(`Saved meal ${id} not found`);
    return found;
  }

  private async assertFoodsExist(userId: string, foodIds: string[]): Promise<void> {
    const ids = foodIds.filter(isValidObjectId);
    const count = await this.foods.countDocuments({ userId, _id: { $in: ids } });
    if (count !== new Set(ids).size) {
      throw new BadRequestException('One of those foods no longer exists.');
    }
  }

  // ---------------------------------------------------------------- cheat day

  async cheatInfo(userId: string, today: string): Promise<CheatDayInfo> {
    const [profile, rows, foods, week] = await Promise.all([
      this.profile(userId),
      this.cheatMeals.find({ userId }).sort({ order: 1, createdAt: 1 }),
      this.listFoods(userId, { includeArchived: true }),
      this.weekBalanceFor(userId, today),
    ]);
    const byId = new Map(foods.map((food) => [food.id, food]));

    const queue: CheatMealView[] = rows.map((row) => {
      const plain = row.toJSON() as unknown as CheatMealView;
      const food = byId.get(plain.foodId);
      if (!food || food.archived) return { ...plain, missing: true };
      return {
        ...plain,
        name: food.name,
        brand: food.brand,
        unit: food.unit,
        servings: Math.round((plain.amount / food.servingSize) * 100) / 100,
        totals: entryTotals(plain.amount, food),
        missing: false,
      };
    });

    return cheatDayInfo({
      today,
      cheatDays: profile.cheatDays,
      queue,
      bankedKcal: week.bankedKcal,
    });
  }

  async createCheatMeal(
    userId: string,
    today: string,
    dto: CreateCheatMealDto,
  ): Promise<CheatDayInfo['queue']> {
    const food = await this.findFood(userId, dto.foodId);
    const amount = this.resolveAmount(dto, food.servingSize);
    // New rows go to the back of the queue; the owner reorders deliberately.
    const last = await this.cheatMeals.find({ userId }).sort({ order: -1 }).limit(1);
    await this.cheatMeals.create({
      userId,
      foodId: food.id,
      amount,
      order: (last[0]?.order ?? -1) + 1,
      eaten: false,
      note: dto.note,
    } as never);
    return (await this.cheatInfo(userId, today)).queue;
  }

  async updateCheatMeal(
    userId: string,
    id: string,
    today: string,
    dto: UpdateCheatMealDto,
  ): Promise<CheatDayInfo['queue']> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Cheat meal ${id} not found`);
    const existing = await this.cheatMeals.findOne({ userId, _id: id });
    if (!existing) throw new NotFoundException(`Cheat meal ${id} not found`);

    const patch: Record<string, unknown> = {};
    if (dto.note != null) patch['note'] = dto.note;
    if (dto.eaten != null) {
      patch['eaten'] = dto.eaten;
      // Re-queueing clears the day it was eaten, so the row stops claiming a past cheat day.
      if (!dto.eaten) patch['eatenDay'] = undefined;
    }
    if (dto.amount != null || dto.servings != null) {
      const food = await this.findFood(userId, existing.foodId);
      patch['amount'] = this.resolveAmount(dto, food.servingSize);
    }

    await this.cheatMeals.findOneAndUpdate({ userId, _id: id }, { $set: patch }, { runValidators: true });
    return (await this.cheatInfo(userId, today)).queue;
  }

  async removeCheatMeal(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Cheat meal ${id} not found`);
    const deleted = await this.cheatMeals.findOneAndDelete({ userId, _id: id });
    if (!deleted) throw new NotFoundException(`Cheat meal ${id} not found`);
    return { id, deleted: true };
  }

  /** The full id array, rewritten to `order: index` — the same shape boards use. */
  async reorderCheatMeals(
    userId: string,
    today: string,
    order: string[],
  ): Promise<CheatDayInfo['queue']> {
    await Promise.all(
      order
        .filter(isValidObjectId)
        .map((id, index) =>
          this.cheatMeals.updateOne({ userId, _id: id }, { $set: { order: index } }),
        ),
    );
    return (await this.cheatInfo(userId, today)).queue;
  }

  /** Turns a queued row into a real meal, and marks the row as eaten on that day. */
  async logCheatMeal(
    userId: string,
    id: string,
    dto: LogSavedMealDto,
  ): Promise<{ entry: MealEntryDto; cheat: CheatDayInfo }> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Cheat meal ${id} not found`);
    const row = await this.cheatMeals.findOne({ userId, _id: id });
    if (!row) throw new NotFoundException(`Cheat meal ${id} not found`);

    const food = await this.findFood(userId, row.foodId);
    const day = toDay(dto.day);
    const created = await this.entries.create({
      userId,
      day,
      slot: dto.slot ?? 'uncategorized',
      foodId: food.id,
      amount: row.amount,
      unit: food.unit,
      facts: snapshotFacts(food),
      cheatMealId: String(row._id),
      note: row.note,
    } as never);

    await this.cheatMeals.updateOne(
      { userId, _id: id },
      { $set: { eaten: true, eatenDay: day } },
    );
    return { entry: this.serializeEntry(created), cheat: await this.cheatInfo(userId, day) };
  }

  // ---------------------------------------------------------------- derived views

  private async weekBalanceFor(userId: string, today: string) {
    const [entries, targets] = await Promise.all([
      this.listEntries(userId, { from: weekStart(today), to: weekEnd(today) }),
      this.targets(userId, today),
    ]);
    return weekBalance(entries, today, targets.energyKcal?.value);
  }

  async dayView(userId: string, day: string): Promise<DayTotals> {
    return dayTotals(day, await this.listEntries(userId, { day }));
  }

  /** The last few logged meals, newest first, for one-tap repeating. */
  private async recentMeals(userId: string, today: string): Promise<RecentMeal[]> {
    const entries = await this.listEntries(userId, { from: addDays(today, -14), to: today });
    const groups = new Map<string, RecentMeal>();
    for (const entry of entries) {
      const key = `${entry.day}:${entry.slot}`;
      const existing = groups.get(key);
      if (existing) {
        existing.entryIds.push(entry.id);
        existing.totals = sumTotals([existing.totals, entry.totals]);
        existing.label = `${existing.entryIds.length} items`;
      } else {
        groups.set(key, {
          day: entry.day,
          slot: entry.slot,
          label: entry.facts.name,
          entryIds: [entry.id],
          totals: entry.totals,
        });
      }
    }
    return [...groups.values()]
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, RECENT_MEAL_LIMIT);
  }

  /** Everything `/nutrition` renders, in one round trip. */
  async overview(userId: string, today: string, day?: string): Promise<NutritionOverview> {
    const viewed = day ? toDay(day) : today;
    const [profile, weighIns, foods, savedMeals] = await Promise.all([
      this.profile(userId),
      this.listWeighIns(userId),
      this.listFoods(userId),
      this.listSavedMeals(userId),
    ]);
    const targets = nutritionTargets({ profile, weighIns, today });

    // One window covers both the day being viewed and the history its suggestions rank over.
    const [history, weekEntries, recent, cheat] = await Promise.all([
      this.listEntries(userId, { from: addDays(viewed, -SUGGESTION_LOOKBACK_DAYS), to: viewed }),
      this.listEntries(userId, { from: weekStart(today), to: weekEnd(today) }),
      this.recentMeals(userId, today),
      this.cheatInfo(userId, today),
    ]);

    return {
      today,
      day: viewed,
      profile,
      targets,
      dayTotals: dayTotals(viewed, history),
      week: weekBalance(weekEntries, today, targets.energyKcal?.value),
      cheat,
      weighIns,
      foods,
      savedMeals,
      recentMeals: recent,
      suggestions: mealSuggestions({ entries: history, foods, day: viewed }),
      foodLookup: this.lookup.status,
    };
  }

  /** The dashboard card's three numbers, plus the cheat-day countdown. */
  async summary(userId: string, today: string): Promise<NutritionSummary> {
    const [profile, weighIns, entries] = await Promise.all([
      this.profile(userId),
      this.listWeighIns(userId),
      this.listEntries(userId, { day: today }),
    ]);
    const targets = nutritionTargets({ profile, weighIns, today });
    const totals = dayTotals(today, entries);
    const next = nextCheatDay(today, profile.cheatDays);

    return summariseNutrition({
      day: today,
      totals: totals.totals,
      entryCount: totals.entryCount,
      targets,
      goal: profile.goal,
      cheat: next ? { nextDay: next.day, daysUntil: next.daysUntil } : undefined,
    });
  }
}
