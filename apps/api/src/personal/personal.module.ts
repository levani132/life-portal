import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InjectModel, MongooseModule, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { isValidObjectId, Model } from 'mongoose';
import { NotFoundException } from '@nestjs/common';
import type { Currency, FxContext, PersonalPlan as PersonalPlanDto, PersonalSummary } from '@life-portal/shared-types';
import {
  PERSONAL_PLAN_STATUSES,
  PLAN_COMPANY,
  PLAN_TYPES,
  SUPPORTED_CURRENCIES,
} from '@life-portal/shared-types';
import { personalPlanDate, summarisePersonal } from '@life-portal/shared-domain';
import { baseSchemaOptions, centsField, dayField } from '../common/mongoose';
import { CurrentUser } from '../auth/current-user.decorator';
import { Today } from '../common/today';
import { CashflowModule } from '../cashflow/cashflow.module';
import { CashflowService } from '../cashflow/cashflow.service';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------ schema

/**
 * Widget 8 — activities, dates, trips and travel history.
 *
 * When `autoExpense` is on and the plan has both a cost and a date, the API keeps a one-off
 * cash-flow expense in sync with it, so a planned holiday shows up in the salary projection
 * without being entered twice. The plan owns the amount (constitution principle IV).
 */
@Schema({ ...baseSchemaOptions, collection: 'personal_plans' })
export class PersonalPlan {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, trim: true }) title!: string;
  @Prop({ required: true, enum: PLAN_TYPES, default: 'activity' }) type!: string;
  @Prop({ required: true, enum: PLAN_COMPANY, default: 'alone' }) company!: string;
  @Prop({ required: true, enum: PERSONAL_PLAN_STATUSES, default: 'idea', index: true }) status!: string;
  @Prop() description?: string;
  @Prop(dayField) targetDate?: string;
  @Prop(dayField) startDate?: string;
  @Prop(dayField) endDate?: string;
  @Prop() city?: string;
  @Prop() country?: string;
  @Prop(centsField) estimatedCostCents?: number;
  @Prop(centsField) actualCostCents?: number;
  @Prop({ required: true, enum: SUPPORTED_CURRENCIES, default: 'USD' }) currency!: string;
  @Prop({ default: 3, min: 1 }) priority!: number;
  @Prop({ default: false }) autoExpense!: boolean;
  @Prop() linkedExpenseId?: string;
  @Prop({ default: false }) visited!: boolean;
  @Prop() photoUrl?: string;
  @Prop() notes?: string;
  @Prop({ type: [String], default: [] }) tags!: string[];
}

export const PersonalPlanSchema = SchemaFactory.createForClass(PersonalPlan);

// ------------------------------------------------------------------ dto

export class CreatePlanDto {
  @IsString() @MaxLength(200) title!: string;
  @IsOptional() @IsIn(PLAN_TYPES) type?: string;
  @IsOptional() @IsIn(PLAN_COMPANY) company?: string;
  @IsOptional() @IsIn(PERSONAL_PLAN_STATUSES) status?: string;
  @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @IsOptional() @Matches(DAY) targetDate?: string;
  @IsOptional() @Matches(DAY) startDate?: string;
  @IsOptional() @Matches(DAY) endDate?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(120) country?: string;
  @IsOptional() @IsInt() @Min(0) estimatedCostCents?: number;
  @IsOptional() @IsInt() @Min(0) actualCostCents?: number;
  @IsOptional() @IsIn(SUPPORTED_CURRENCIES) currency?: string;
  @IsOptional() @IsInt() @Min(1) priority?: number;
  /** Mirror the cost into the salary planner as a one-off expense. */
  @IsOptional() @IsBoolean() autoExpense?: boolean;
  @IsOptional() @IsBoolean() visited?: boolean;
  @IsOptional() @IsString() @MaxLength(500) photoUrl?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

export class UpdatePlanDto extends CreatePlanDto {
  @IsOptional() @IsString() @MaxLength(200) override title!: string;
}

// ------------------------------------------------------------------ service

@Injectable()
export class PersonalService {
  constructor(
    @InjectModel(PersonalPlan.name) private readonly plans: Model<PersonalPlan>,
    private readonly cashflow: CashflowService,
  ) {}

  async list(userId: string, status?: string): Promise<PersonalPlanDto[]> {
    const rows = await this.plans
      .find({ userId, ...(status ? { status } : {}) })
      .sort({ status: 1, priority: 1, targetDate: 1 });
    return rows.map((r) => r.toJSON() as unknown as PersonalPlanDto);
  }

  async create(userId: string, dto: CreatePlanDto): Promise<PersonalPlanDto> {
    const created = await this.plans.create({ ...dto, userId });
    return this.syncExpense(userId, created.toJSON() as unknown as PersonalPlanDto);
  }

  async update(userId: string, id: string, dto: UpdatePlanDto): Promise<PersonalPlanDto> {
    const updated = await this.plans.findOneAndUpdate(
      { _id: this.oid(id), userId },
      { $set: dto },
      { new: true, runValidators: true },
    );
    if (!updated) throw new NotFoundException(`Plan ${id} not found`);
    return this.syncExpense(userId, updated.toJSON() as unknown as PersonalPlanDto);
  }

  async remove(userId: string, id: string) {
    const deleted = await this.plans.findOneAndDelete({ _id: this.oid(id), userId });
    if (!deleted) throw new NotFoundException(`Plan ${id} not found`);
    // The mirrored expense goes with it — unlike a loan repayment, the money was only ever
    // going to be spent because of this plan.
    await this.cashflow.removePersonalPlanExpense(userId, id);
    return { id, deleted: true as const };
  }

  /**
   * Creates, updates or removes the mirrored cash-flow expense to match the plan's current
   * state. Called after every write so the two can never drift.
   */
  private async syncExpense(userId: string, plan: PersonalPlanDto): Promise<PersonalPlanDto> {
    const shouldMirror =
      plan.autoExpense &&
      plan.status !== 'cancelled' &&
      plan.status !== 'done' &&
      Boolean(plan.estimatedCostCents) &&
      Boolean(personalPlanDate(plan));

    const expenseId = shouldMirror
      ? await this.cashflow.syncPersonalPlanExpense(userId, {
          id: plan.id,
          title: plan.title,
          estimatedCostCents: plan.estimatedCostCents,
          date: personalPlanDate(plan),
          currency: plan.currency,
        })
      : await this.cashflow
          .removePersonalPlanExpense(userId, plan.id)
          .then(() => undefined);

    if (plan.linkedExpenseId !== expenseId) {
      await this.plans.updateOne({ _id: plan.id }, { $set: { linkedExpenseId: expenseId } });
      return { ...plan, linkedExpenseId: expenseId };
    }
    return plan;
  }

  async summary(
    userId: string,
    today: string,
    currency: Currency = 'GEL',
    fx?: FxContext,
  ): Promise<PersonalSummary> {
    return summarisePersonal(await this.list(userId), today, currency, fx);
  }

  private oid(id: string): string {
    if (!isValidObjectId(id)) throw new NotFoundException(`Plan ${id} not found`);
    return id;
  }
}

// ------------------------------------------------------------------ controller

@Controller('personal')
export class PersonalController {
  constructor(private readonly personal: PersonalService) {}

  @Get()
  async overview(
    @CurrentUser('userId') userId: string,
    @Today() today: string,
    @Query('status') status?: string,
  ) {
    const [plans, summary] = await Promise.all([
      this.personal.list(userId, status),
      this.personal.summary(userId, today),
    ]);
    return { today, plans, summary };
  }

  @Get('summary')
  summary(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.personal.summary(userId, today);
  }

  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreatePlanDto) {
    return this.personal.create(userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.personal.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.personal.remove(userId, id);
  }
}

@Module({
  imports: [
    MongooseModule.forFeature([{ name: PersonalPlan.name, schema: PersonalPlanSchema }]),
    CashflowModule,
  ],
  controllers: [PersonalController],
  providers: [PersonalService],
  exports: [PersonalService],
})
export class PersonalModule {}
