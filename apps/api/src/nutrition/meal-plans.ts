import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsMongoId, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Model, Types, isValidObjectId } from 'mongoose';
import { MEAL_PLAN_LIMITS, MEAL_SLOTS, type ActiveMealPlan, type MealPlan, type MealPlanDay, type MealPlanInput, type MealSlot, type PlanDayAdherence } from '@life-portal/shared-types';
import {
  activePlanDayIndex,
  addDays,
  entryTotals,
  matchPlanDay,
  mealPlanProblem,
  mealPlanView,
  planDayAdherence,
  planLineSlots,
  type PlanFood,
  type PlanRecipe,
} from '@life-portal/shared-domain';
import { RequireModule } from '../access/access.module';
import { ForPages } from '../auth/acting';
import { CurrentUser } from '../auth/current-user.decorator';
import { baseSchemaOptions } from '../common/mongoose';
import { MealEntry } from './nutrition.schemas';
import { NutritionService } from './nutrition.service';

/**
 * A meal plan (spec 042): named days of meals. It stores ids and amounts only; names and every
 * total are worked out on read from the foods as they are now (principle 3). People and pages
 * both keep them; only a person can log a day from one.
 */
@Schema({ _id: false })
class MealPlanEntrySub {
  @Prop({ required: true }) id!: string;
  @Prop({ type: String, required: true, enum: MEAL_SLOTS }) slot!: MealSlot;
  /** Every meal the line may be eaten at, when more than one. `slot` is the first of them. */
  @Prop({ type: [String], enum: MEAL_SLOTS, default: undefined }) slots?: MealSlot[];
  @Prop() savedMealId?: string;
  @Prop() foodId?: string;
  @Prop() amount?: number;
}
const MealPlanEntrySchema = SchemaFactory.createForClass(MealPlanEntrySub);

@Schema({ _id: false })
class MealPlanDaySub {
  @Prop({ required: true }) id!: string;
  @Prop({ required: true, trim: true, maxlength: MEAL_PLAN_LIMITS.dayName }) name!: string;
  @Prop({ type: [MealPlanEntrySchema], default: [] }) entries!: MealPlanEntrySub[];
}
const MealPlanDaySchema = SchemaFactory.createForClass(MealPlanDaySub);

@Schema({ _id: false })
class PlanDayChoiceSub {
  @Prop({ type: String, required: true }) day!: string;
  @Prop({ type: String, required: true }) dayId!: string;
}
const PlanDayChoiceSchema = SchemaFactory.createForClass(PlanDayChoiceSub);

@Schema({ ...baseSchemaOptions, collection: 'meal_plans' })
export class MealPlanRecord {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, trim: true, maxlength: MEAL_PLAN_LIMITS.name }) name!: string;
  @Prop({ maxlength: MEAL_PLAN_LIMITS.description }) description?: string;
  @Prop({ type: [MealPlanDaySchema], default: [] }) days!: MealPlanDaySub[];
  /** A copy saved from a post: one per reader and post, so saving twice makes one plan. */
  @Prop() postImportKey?: string;
  /**
   * Spec 042: set while the person is using this plan, to the calendar day they started. One
   * plan per person has it. A choice, not a derived figure: which of the plan's days is today's
   * is worked out from it on read.
   */
  @Prop({ type: String }) activeSince?: string;
  /**
   * Plan days the person picked for calendar days. Each re-anchors the order from that day
   * (`activePlanDayIndex`). The latest 60 are kept.
   */
  @Prop({ type: [PlanDayChoiceSchema], default: undefined }) dayChoices?: PlanDayChoiceSub[];
  createdAt!: Date;
  updatedAt!: Date;
}
export const MealPlanSchema = SchemaFactory.createForClass(MealPlanRecord);
MealPlanSchema.index({ userId: 1, name: 1 });
MealPlanSchema.index({ userId: 1, postImportKey: 1 }, { unique: true, partialFilterExpression: { postImportKey: { $type: 'string' } } });

const DAY = /^\d{4}-\d{2}-\d{2}$/;

class MealPlanEntryDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @IsIn(MEAL_SLOTS) slot!: MealSlot;
  @IsOptional() @IsMongoId() savedMealId?: string;
  @IsOptional() @IsMongoId() foodId?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20_000) amount?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(MEAL_SLOTS.length) @IsIn(MEAL_SLOTS, { each: true }) slots?: MealSlot[];
}
class MealPlanDayDto {
  @IsOptional() @IsString() @MaxLength(40) id?: string;
  @IsString() @MaxLength(MEAL_PLAN_LIMITS.dayName) name!: string;
  @IsArray() @ArrayMaxSize(MEAL_PLAN_LIMITS.entriesPerDay) @ValidateNested({ each: true }) @Type(() => MealPlanEntryDto) entries!: MealPlanEntryDto[];
}
export class MealPlanDto implements MealPlanInput {
  @IsString() @MaxLength(MEAL_PLAN_LIMITS.name) name!: string;
  @IsOptional() @IsString() @MaxLength(MEAL_PLAN_LIMITS.description) description?: string;
  @IsArray() @ArrayMaxSize(MEAL_PLAN_LIMITS.days) @ValidateNested({ each: true }) @Type(() => MealPlanDayDto) days!: MealPlanDayDto[];
}
export class LogPlanDayDto {
  /** The diary day to log into, chosen on the device like every meal's day. */
  @Matches(DAY) day!: string;
  /** Only these lines of the plan's day; absent: the whole day. */
  @IsOptional() @IsArray() @ArrayMaxSize(MEAL_PLAN_LIMITS.entriesPerDay) @IsString({ each: true }) entryIds?: string[];
  /** The meal to log into, which every line must allow. Absent: each line's first meal. */
  @IsOptional() @IsIn(MEAL_SLOTS) slot?: MealSlot;
}

export class UsePlanDto {
  /** The plan to use from today, or null to stop using one. */
  @IsOptional() @IsMongoId() planId?: string | null;
  @Matches(DAY) today!: string;
}
export class ChoosePlanDayDto {
  /** The calendar day being set. */
  @IsOptional() @Matches(DAY) day?: string;
  /** The first version of this route sent the device's today; still read as the day. */
  @IsOptional() @Matches(DAY) today?: string;
  @IsString() @MaxLength(40) dayId!: string;
}

type Row = MealPlanRecord & { _id: Types.ObjectId };
const newId = () => String(new Types.ObjectId());

@Injectable()
export class MealPlansService {
  constructor(
    @InjectModel(MealPlanRecord.name) private readonly plans: Model<MealPlanRecord>,
    @InjectModel(MealEntry.name) private readonly entries: Model<MealEntry>,
    private readonly nutrition: NutritionService,
  ) {}

  /** The owner's foods and recipes, as the pure view needs them. */
  private async library(userId: string): Promise<{ foods: Map<string, PlanFood>; recipes: Map<string, PlanRecipe> }> {
    const [foods, meals] = await Promise.all([this.nutrition.listFoods(userId, { includeArchived: true }), this.nutrition.listSavedMeals(userId)]);
    return {
      foods: new Map(foods.map((food) => [food.id, food as unknown as PlanFood])),
      recipes: new Map(meals.map((meal) => [meal.id, { name: meal.name, components: meal.components.map((component) => ({ foodId: component.foodId, amount: component.amount })) }])),
    };
  }

  private dto(row: Row, library: Awaited<ReturnType<MealPlansService['library']>>): MealPlan {
    const view = mealPlanView(row.days as MealPlanDay[], library.foods, library.recipes);
    return {
      id: String(row._id),
      userId: row.userId,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      ...(row.activeSince ? { activeSince: row.activeSince } : {}),
      ...view,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } as MealPlan;
  }

  async list(userId: string): Promise<MealPlan[]> {
    const [rows, library] = await Promise.all([this.plans.find({ userId }).sort({ name: 1 }).lean<Row[]>(), this.library(userId)]);
    return rows.map((row) => this.dto(row, library));
  }

  async one(userId: string, id: string): Promise<MealPlan> {
    const row = isValidObjectId(id) ? await this.plans.findOne({ _id: id, userId }).lean<Row>() : null;
    if (!row) throw new NotFoundException('Meal plan not found.');
    return this.dto(row, await this.library(userId));
  }

  /** The stored row, for the publication service. */
  async row(userId: string, id: string): Promise<Row | null> {
    return isValidObjectId(id) ? this.plans.findOne({ _id: id, userId }).lean<Row>() : null;
  }

  /** What a save stores: checked, with ids given to new days and lines, and only things the owner has. */
  private async clean(userId: string, input: MealPlanInput) {
    const problem = mealPlanProblem(input);
    if (problem) throw new BadRequestException(problem);
    const library = await this.library(userId);
    for (const entry of input.days.flatMap((day) => day.entries)) {
      if (entry.foodId && !library.foods.has(entry.foodId)) throw new BadRequestException('One of those foods no longer exists.');
      if (entry.savedMealId && !library.recipes.has(entry.savedMealId)) throw new BadRequestException('One of those recipes no longer exists.');
    }
    return {
      name: input.name.trim(),
      description: (input.description ?? '').trim(),
      days: input.days.map((day) => ({
        id: day.id || newId(),
        name: day.name.trim(),
        entries: day.entries.map((entry) => ({
          id: entry.id || newId(),
          // `slot` is the first allowed meal; `slots` is kept only when there is a choice.
          slot: entry.slots?.length ? entry.slots[0] : entry.slot,
          ...(entry.slots && entry.slots.length > 1 ? { slots: entry.slots } : {}),
          ...(entry.savedMealId ? { savedMealId: entry.savedMealId } : { foodId: entry.foodId, amount: entry.amount }),
        })),
      })),
    };
  }

  async create(userId: string, input: MealPlanInput): Promise<MealPlan> {
    const created = await this.plans.create({ userId, ...(await this.clean(userId, input)) });
    return this.one(userId, String(created._id));
  }

  async replace(userId: string, id: string, input: MealPlanInput): Promise<MealPlan> {
    if (!isValidObjectId(id)) throw new NotFoundException('Meal plan not found.');
    const result = await this.plans.updateOne({ _id: id, userId }, { $set: await this.clean(userId, input) });
    if (!result.matchedCount) throw new NotFoundException('Meal plan not found.');
    return this.one(userId, id);
  }

  async remove(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    if (isValidObjectId(id)) await this.plans.deleteOne({ _id: id, userId });
    return { id, deleted: true };
  }

  /**
   * Logs a plan's day, or some of its lines, into the diary day the device chose. Each food is
   * logged the normal way, so its numbers are frozen at this moment like any meal's. A line
   * without numbers is refused rather than skipped: nothing is half-logged. A line the diary
   * already has that day (`matchPlanDay`: logged from here, or the same food or recipe logged
   * any other way) is left alone, so nothing is eaten twice.
   */
  async logDay(userId: string, id: string, dayId: string, dto: LogPlanDayDto): Promise<{ logged: number }> {
    const plan = await this.one(userId, id);
    const day = plan.days.find((candidate) => candidate.id === dayId);
    if (!day) throw new NotFoundException('That day is not in this plan.');
    const wanted = dto.entryIds ? day.entries.filter((entry) => dto.entryIds?.includes(entry.id)) : day.entries;
    if (!wanted.length) throw new BadRequestException('There is nothing to log.');
    if (wanted.some((entry) => entry.missing))
      throw new BadRequestException({ code: 'PLAN_INCOMPLETE', message: 'Something in this plan has no foods with numbers any more. Edit the plan first.' });
    if (dto.slot && wanted.some((entry) => !planLineSlots(entry).includes(dto.slot as MealSlot)))
      throw new BadRequestException('That is not one of the meals this is planned for.');
    const done = matchPlanDay(day.entries, await this.diary(userId, dto.day));
    const recipes = (await this.library(userId)).recipes;
    const lines = wanted
      .filter((entry) => !done.has(entry.id))
      .flatMap((entry) => {
        const slot = dto.slot ?? entry.slot;
        return entry.savedMealId
          ? (recipes.get(entry.savedMealId)?.components ?? []).map((component) => ({ planEntryId: entry.id, slot, ...component, savedMealId: entry.savedMealId }))
          : [{ planEntryId: entry.id, slot, foodId: entry.foodId as string, amount: entry.amount as number, savedMealId: undefined }];
      });
    for (const line of lines)
      await this.nutrition.createEntry(userId, { day: dto.day, slot: line.slot, foodId: line.foodId, amount: line.amount } as never, {
        planEntryId: line.planEntryId,
        ...(line.savedMealId ? { savedMealId: line.savedMealId } : {}),
      });
    return { logged: lines.length };
  }

  /** The diary's meals on some days, as matching and adherence need them. */
  private async diary(userId: string, ...days: string[]) {
    const rows = await this.entries
      .find({ userId, day: { $in: days } })
      .select('day slot foodId savedMealId planEntryId amount facts')
      .lean();
    return rows.map((row) => ({
      id: String(row._id),
      day: row.day,
      slot: row.slot as MealSlot,
      foodId: row.foodId,
      ...(row.savedMealId ? { savedMealId: row.savedMealId } : {}),
      ...(row.planEntryId ? { planEntryId: row.planEntryId } : {}),
      totals: entryTotals(row.amount, row.facts as never),
    }));
  }

  /**
   * The plan in use as it applies to one calendar day (spec 042), and how closely the seven days
   * up to today followed it. Which plan day a calendar day is follows the plan's order from the
   * day it was started, re-anchored by any day the person picked. What was eaten is read from
   * the diary and matched on read, so a meal logged before the plan was in use counts too.
   */
  async active(userId: string, today: string, calendarDay = today): Promise<ActiveMealPlan | null> {
    const row = await this.plans.findOne({ userId, activeSince: { $type: 'string' } }).lean<Row>();
    if (!row || !row.days.length) return null;
    const plan = this.dto(row, await this.library(userId));
    const since = row.activeSince as string;
    const dayIds = plan.days.map((day) => day.id);
    const dayOf = (day: string) => plan.days[activePlanDayIndex({ dayIds, since, day, choices: row.dayChoices })];
    const recentDays = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6));
    const diary = await this.diary(userId, ...new Set([calendarDay, ...recentDays]));
    const on = (day: string) => diary.filter((entry) => entry.day === day);
    const day = dayOf(calendarDay);
    const done = matchPlanDay(day.entries, on(calendarDay));
    const recent: PlanDayAdherence[] = recentDays.map((each) => {
      const planDay = dayOf(each);
      return { day: each, dayName: planDay.name, ...planDayAdherence(planDay.entries, on(each)) };
    });
    return {
      planId: plan.id,
      name: plan.name,
      since,
      days: plan.days.map((each) => ({ id: each.id, name: each.name })),
      calendarDay,
      day: { id: day.id, name: day.name, lines: day.entries.map((entry) => ({ ...entry, logged: done.has(entry.id) })), totals: day.totals },
      chosen: (row.dayChoices ?? []).some((choice) => choice.day === calendarDay && choice.dayId === day.id),
      recent,
    };
  }

  /** Starts using a plan from today, or stops using one. Only one is in use at a time. */
  async use(userId: string, dto: UsePlanDto): Promise<{ active: ActiveMealPlan | null }> {
    if (dto.planId) {
      const row = await this.row(userId, dto.planId);
      if (!row) throw new NotFoundException('Meal plan not found.');
      if (!row.days.length) throw new BadRequestException('This plan has no days yet.');
    }
    await this.plans.updateMany(
      { userId, activeSince: { $type: 'string' }, ...(dto.planId ? { _id: { $ne: dto.planId } } : {}) },
      { $unset: { activeSince: 1, dayChoices: 1 } },
    );
    // Using the plan already in use keeps its place: the start day is only set when it starts.
    if (dto.planId) await this.plans.updateOne({ _id: dto.planId, userId, activeSince: { $exists: false } }, { $set: { activeSince: dto.today }, $unset: { dayChoices: 1 } });
    return { active: await this.active(userId, dto.today) };
  }

  /** Picks which of the plan's days a calendar day is. The days after it follow on from there. */
  async chooseDay(userId: string, dto: ChoosePlanDayDto): Promise<{ active: ActiveMealPlan | null }> {
    const calendarDay = dto.day ?? dto.today;
    if (!calendarDay) throw new BadRequestException('Say which day.');
    const row = await this.plans.findOne({ userId, activeSince: { $type: 'string' } }).lean<Row>();
    if (!row) throw new NotFoundException('You are not using a meal plan.');
    if (!row.days.some((day) => day.id === dto.dayId)) throw new NotFoundException('That day is not in this plan.');
    const choices = [...(row.dayChoices ?? []).filter((choice) => choice.day !== calendarDay), { day: calendarDay, dayId: dto.dayId }]
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-60);
    await this.plans.updateOne({ _id: row._id, userId }, { $set: { dayChoices: choices } });
    return { active: await this.active(userId, calendarDay, calendarDay) };
  }

  /** Spec 042: the reader's own copy of a published plan, built from the foods they just saved. */
  async saveImported(userId: string, postId: string, name: string, days: { name: string; entries: { slot: MealSlot; slots?: MealSlot[]; foodId: string; amount: number }[] }[]): Promise<string> {
    try {
      await this.plans.updateOne(
        { userId, postImportKey: postId },
        {
          $setOnInsert: {
            userId,
            postImportKey: postId,
            name: name.trim().slice(0, MEAL_PLAN_LIMITS.name) || 'Meal plan',
            days: days.slice(0, MEAL_PLAN_LIMITS.days).map((day) => ({
              id: newId(),
              name: day.name.slice(0, MEAL_PLAN_LIMITS.dayName),
              entries: day.entries.slice(0, MEAL_PLAN_LIMITS.entriesPerDay).map((entry) => ({ id: newId(), ...entry })),
            })),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const row = await this.plans.findOne({ userId, postImportKey: postId }).select('_id').lean();
    return String(row?._id);
  }
}

/**
 * Meal plans. The library (list, create, replace, delete) is open to pages; logging a day is a
 * person's action on their own diary and carries no marker, so a page is refused.
 */
@RequireModule('nutrition')
@Controller('nutrition/meal-plans')
export class MealPlansController {
  constructor(private readonly plans: MealPlansService) {}

  @ForPages()
  @Get()
  list(@CurrentUser('userId') userId: string): Promise<MealPlan[]> {
    return this.plans.list(userId);
  }

  @ForPages()
  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: MealPlanDto): Promise<MealPlan> {
    return this.plans.create(userId, dto);
  }

  /** The plan in use. A person's own diary: no marker, so a page is refused. */
  @Get('active')
  async active(@CurrentUser('userId') userId: string, @Query('today') today: string, @Query('day') day?: string) {
    if (!DAY.test(today ?? '') || (day !== undefined && !DAY.test(day))) throw new BadRequestException('today and day must be days.');
    return { active: await this.plans.active(userId, today, day ?? today) };
  }

  @Put('active')
  use(@CurrentUser('userId') userId: string, @Body() dto: UsePlanDto) {
    return this.plans.use(userId, dto);
  }

  @Put('active/day')
  chooseDay(@CurrentUser('userId') userId: string, @Body() dto: ChoosePlanDayDto) {
    return this.plans.chooseDay(userId, dto);
  }

  @ForPages()
  @Put(':id')
  replace(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: MealPlanDto): Promise<MealPlan> {
    return this.plans.replace(userId, id, dto);
  }

  @ForPages()
  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.plans.remove(userId, id);
  }

  @Post(':id/days/:dayId/log')
  log(@CurrentUser('userId') userId: string, @Param('id') id: string, @Param('dayId') dayId: string, @Body() dto: LogPlanDayDto) {
    return this.plans.logDay(userId, id, dayId, dto);
  }
}
