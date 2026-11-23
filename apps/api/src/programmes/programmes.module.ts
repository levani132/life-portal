import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { Model, Types, isValidObjectId } from 'mongoose';
import { PROGRAMME_LIMITS, type Programme, type ProgrammeInput } from '@life-portal/shared-types';
import { programmeProblem } from '@life-portal/shared-domain';
import { ForPages } from '../auth/acting';
import { CurrentUser } from '../auth/current-user.decorator';
import { baseSchemaOptions } from '../common/mongoose';
import { NutritionModule } from '../nutrition/nutrition.module';
import { MealPlansService } from '../nutrition/meal-plans';
import { PlansService } from '../training/plans.service';
import { TrainingModule } from '../training/training.module';

/**
 * A programme (spec 042): a meal plan and a training plan under one name. The row holds the two
 * ids and nothing else about them (principle 4): each plan lives in its own module and is read
 * through that module's service, so editing a plan changes every programme that pairs it.
 */
@Schema({ ...baseSchemaOptions, collection: 'programmes' })
export class ProgrammeRecord {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, trim: true, maxlength: PROGRAMME_LIMITS.name }) name!: string;
  @Prop({ maxlength: PROGRAMME_LIMITS.description }) description?: string;
  @Prop({ type: String }) mealPlanId?: string;
  @Prop({ type: String }) trainingPlanId?: string;
  createdAt!: Date;
  updatedAt!: Date;
}
export const ProgrammeSchema = SchemaFactory.createForClass(ProgrammeRecord);

export class ProgrammeDto implements ProgrammeInput {
  @IsString() @MaxLength(PROGRAMME_LIMITS.name) name!: string;
  @IsOptional() @IsString() @MaxLength(PROGRAMME_LIMITS.description) description?: string;
  @IsOptional() @IsMongoId() mealPlanId?: string;
  @IsOptional() @IsMongoId() trainingPlanId?: string;
}

type Row = ProgrammeRecord & { _id: Types.ObjectId };

@Injectable()
export class ProgrammesService {
  constructor(
    @InjectModel(ProgrammeRecord.name) private readonly programmes: Model<ProgrammeRecord>,
    private readonly mealPlans: MealPlansService,
    private readonly trainingPlans: PlansService,
  ) {}

  async list(userId: string): Promise<Programme[]> {
    const rows = await this.programmes.find({ userId }).sort({ updatedAt: -1 }).lean<Row[]>();
    if (!rows.length) return [];
    const [meals, training] = await Promise.all([this.mealPlans.list(userId), this.trainingPlans.list(userId)]);
    const trainingPlans = [...training.own, ...training.shared];
    return rows.map((row) => {
      const meal = row.mealPlanId ? meals.find((plan) => plan.id === row.mealPlanId) : undefined;
      const plan = row.trainingPlanId ? trainingPlans.find((each) => each.id === row.trainingPlanId) : undefined;
      return {
        id: String(row._id),
        userId: row.userId,
        name: row.name,
        ...(row.description ? { description: row.description } : {}),
        ...(meal
          ? { mealPlan: { id: meal.id, name: meal.name, dayCount: meal.days.length, dailyKcal: meal.dailyAverage.energyKcal, complete: meal.complete, ...(meal.activeSince ? { activeSince: meal.activeSince } : {}) } }
          : {}),
        ...(plan ? { trainingPlan: { id: plan.id, name: plan.name, workoutCount: plan.workoutCount, exerciseCount: plan.exerciseCount, isOwn: plan.isOwn } } : {}),
        gone: [...(row.mealPlanId && !meal ? (['mealPlan'] as const) : []), ...(row.trainingPlanId && !plan ? (['trainingPlan'] as const) : [])],
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  private async one(userId: string, id: string): Promise<Programme> {
    const found = (await this.list(userId)).find((programme) => programme.id === id);
    if (!found) throw new NotFoundException('Programme not found.');
    return found;
  }

  /** What a save stores: checked, and only plans the owner can read. */
  private async clean(userId: string, input: ProgrammeInput) {
    const problem = programmeProblem(input);
    if (problem) throw new BadRequestException(problem);
    if (input.mealPlanId && !(await this.mealPlans.row(userId, input.mealPlanId))) throw new BadRequestException('That meal plan no longer exists.');
    if (input.trainingPlanId) {
      const plans = await this.trainingPlans.list(userId);
      if (![...plans.own, ...plans.shared].some((plan) => plan.id === input.trainingPlanId)) throw new BadRequestException('That training plan no longer exists.');
    }
    return { name: input.name.trim(), description: (input.description ?? '').trim() };
  }

  async create(userId: string, input: ProgrammeInput): Promise<Programme> {
    const fields = await this.clean(userId, input);
    const created = await this.programmes.create({
      userId,
      ...fields,
      ...(input.mealPlanId ? { mealPlanId: input.mealPlanId } : {}),
      ...(input.trainingPlanId ? { trainingPlanId: input.trainingPlanId } : {}),
    });
    return this.one(userId, String(created._id));
  }

  async replace(userId: string, id: string, input: ProgrammeInput): Promise<Programme> {
    if (!isValidObjectId(id)) throw new NotFoundException('Programme not found.');
    const fields = await this.clean(userId, input);
    const unset = { ...(input.mealPlanId ? {} : { mealPlanId: 1 }), ...(input.trainingPlanId ? {} : { trainingPlanId: 1 }) };
    const result = await this.programmes.updateOne(
      { _id: id, userId },
      {
        $set: { ...fields, ...(input.mealPlanId ? { mealPlanId: input.mealPlanId } : {}), ...(input.trainingPlanId ? { trainingPlanId: input.trainingPlanId } : {}) },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
    );
    if (!result.matchedCount) throw new NotFoundException('Programme not found.');
    return this.one(userId, id);
  }

  /** Removes the pairing only. Both plans stay in their libraries. */
  async remove(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    if (isValidObjectId(id)) await this.programmes.deleteOne({ _id: id, userId });
    return { id, deleted: true };
  }
}

/** Programmes are a library, like meal plans and training plans: open to pages. */
@Controller('programmes')
export class ProgrammesController {
  constructor(private readonly programmes: ProgrammesService) {}

  @ForPages()
  @Get()
  list(@CurrentUser('userId') userId: string): Promise<Programme[]> {
    return this.programmes.list(userId);
  }

  @ForPages()
  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: ProgrammeDto): Promise<Programme> {
    return this.programmes.create(userId, dto);
  }

  @ForPages()
  @Put(':id')
  replace(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: ProgrammeDto): Promise<Programme> {
    return this.programmes.replace(userId, id, dto);
  }

  @ForPages()
  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.programmes.remove(userId, id);
  }
}

@Module({
  imports: [MongooseModule.forFeature([{ name: ProgrammeRecord.name, schema: ProgrammeSchema }]), NutritionModule, TrainingModule],
  controllers: [ProgrammesController],
  providers: [ProgrammesService],
  exports: [ProgrammesService],
})
export class ProgrammesModule {}
