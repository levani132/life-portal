import {
  BadRequestException,
  Body,
  type CallHandler,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Module,
  type NestInterceptor,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import type { Response } from 'express';
import { PROGRESS_RANGES, type ProgressRange, type SetInput, type SetPatch } from '@life-portal/shared-types';
import { RequireModule } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { CatalogueSeeder } from './catalogue.seeder';
import { CatalogueService } from './catalogue.service';
import { PlanSeeder } from './plan.seeder';
import { PlanDayUpdateService } from './plan-day-update.service';
import { PlansService } from './plans.service';
import { ProgressService } from './progress.service';
import { NutritionModule } from '../nutrition/nutrition.module';
import { TrainingProfileService } from './profile.service';
import { SessionsService } from './sessions.service';
import { TrainingLevelService } from './level.service';
import { TrainingRankService } from './rank.service';
import { TrainingSummaryService } from './summary.service';
import { RestAlarmService } from './rest-alarm.service';
import { Today } from '../common/today';
import {
  AddSessionExerciseDto,
  CopyPlanDto,
  CreateExerciseDto,
  CreatePlanDto,
  CreateSetDto,
  FinishSessionDto,
  PlanDayUpdateDto,
  ReorderDto,
  ReplacePlanDto,
  StartSessionDto,
  SwapSessionExerciseDto,
  UpdateExerciseDto,
  UpdateSessionDto,
  UpdateSessionExerciseDto,
  RestAlarmDto,
  UpdateSetDto,
  UpdateTrainingProfileDto,
} from './training.dto';
import {
  Exercise,
  ExerciseSchema,
  TrainingMachine,
  TrainingMachineSchema,
  TrainingPlan,
  TrainingPlanSchema,
  TrainingProfile,
  TrainingProfileSchema,
  WorkoutExercise,
  WorkoutExerciseSchema,
  WorkoutSession,
  WorkoutSessionSchema,
  WorkoutSet,
  WorkoutSetSchema,
} from './training.schemas';

/** Training data is one person's; nothing in between may keep a copy. */
@Injectable()
export class TrainingNoStore implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'private, no-store');
    return next.handle();
  }
}

const toInt = (value?: string) => {
  const parsed = value === undefined ? undefined : Number.parseInt(value, 10);
  return parsed === undefined || Number.isNaN(parsed) ? undefined : parsed;
};

/** Spec 020. Contract: `specs/020-training-logging/contracts/api.md`. */
@RequireModule('training')
@UseInterceptors(TrainingNoStore)
@Controller('training')
export class TrainingController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly profiles: TrainingProfileService,
    private readonly sessions: SessionsService,
    private readonly progress: ProgressService,
    private readonly summaries: TrainingSummaryService,
    private readonly plans: PlansService,
    private readonly alarms: RestAlarmService,
    private readonly levels: TrainingLevelService,
    private readonly ranks: TrainingRankService,
    private readonly planUpdates: PlanDayUpdateService,
  ) {}

  /** The Home card's figures, for the person's `today` (spec 020 US4). */
  @Get('summary')
  summary(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.summaries.summary(userId, today);
  }

  /** The caller's uncapped training level (issue #5a); 403 without `trainingLevels`. */
  @Get('level')
  level(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.levels.level(userId, today);
  }

  // ---------------------------------------------------------------- profile

  @Get('profile')
  profile(@CurrentUser('userId') userId: string) {
    return this.profiles.get(userId);
  }

  @Put('profile')
  updateProfile(@CurrentUser('userId') userId: string, @Body() dto: UpdateTrainingProfileDto) {
    return this.profiles.update(userId, dto);
  }

  // ---------------------------------------------------------------- catalogue

  @Get('exercises')
  exercises(
    @CurrentUser('userId') userId: string,
    @Query('q') q?: string,
    @Query('muscle') muscle?: string,
    @Query('equipment') equipment?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    return this.catalogue.list(userId, { q, muscle, equipment, limit: toInt(limit), skip: toInt(skip) });
  }

  @Get('exercises/:id')
  exercise(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.catalogue.get(userId, id);
  }

  /** Sessions newest first, 20 a page; records over every set ever. */
  @Get('exercises/:id/history')
  exerciseHistory(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.progress.history(userId, id, before || undefined);
  }

  /** The statistics view: per-session points in a range, trend, next record (issue #6). */
  @Get('exercises/:id/progress')
  exerciseProgress(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Today() today: string,
    @Query('range') range?: string,
  ) {
    if (range !== undefined && !(PROGRESS_RANGES as readonly string[]).includes(range)) {
      throw new BadRequestException(`range must be one of ${PROGRESS_RANGES.join(', ')}.`);
    }
    return this.progress.progressView(userId, id, (range as ProgressRange | undefined) ?? '3m', today);
  }

  /** Current and highest-ever strength rank (issue #5b); 403 without `trainingRanks`. */
  @Get('exercises/:id/rank')
  exerciseRank(@CurrentUser('userId') userId: string, @Param('id') id: string, @Today() today: string) {
    return this.ranks.rank(userId, id, today);
  }

  @Post('exercises')
  createExercise(@CurrentUser('userId') userId: string, @Body() dto: CreateExerciseDto) {
    return this.catalogue.create(userId, dto);
  }

  /** Own exercises only: a shared row answers 404. */
  @Patch('exercises/:id')
  updateExercise(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExerciseDto,
  ) {
    return this.catalogue.update(userId, id, dto);
  }

  @Delete('exercises/:id')
  deleteExercise(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.catalogue.remove(userId, id);
  }

  // ---------------------------------------------------------------- plans (spec 023)

  @Get('plans')
  listPlans(@CurrentUser('userId') userId: string) {
    return this.plans.list(userId);
  }

  /** Before `plans/:id`, or "suggested" would be read as an id. */
  @Get('plans/suggested')
  suggestedPlans(@CurrentUser('userId') userId: string, @Today() today: string) {
    return this.plans.suggested(userId, today);
  }

  @Get('plans/:id')
  plan(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.plans.detail(userId, id);
  }

  @Post('plans')
  createPlan(@CurrentUser('userId') userId: string, @Body() dto: CreatePlanDto) {
    return this.plans.create(userId, dto);
  }

  @Put('plans/:id')
  replacePlan(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: ReplacePlanDto) {
    return this.plans.replace(userId, id, dto);
  }

  @Post('plans/:id/copy')
  copyPlan(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: CopyPlanDto) {
    return this.plans.copy(userId, id, dto.requestId);
  }

  @Delete('plans/:id')
  removePlan(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.plans.remove(userId, id);
  }

  // ---------------------------------------------------------------- sessions

  @Post('sessions')
  @HttpCode(200)
  start(@CurrentUser('userId') userId: string, @Body() dto: StartSessionDto) {
    return this.sessions.start(userId, dto);
  }

  /** Declared before `sessions/:id` so the literal path wins. 204 when nothing is open. */
  @Get('sessions/current')
  async current(
    @CurrentUser('userId') userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const open = await this.sessions.current(userId);
    if (!open) response.status(204);
    return open ?? undefined;
  }

  @Get('sessions')
  list(@CurrentUser('userId') userId: string, @Query('cursor') cursor?: string) {
    return this.sessions.list(userId, cursor);
  }

  @Get('sessions/:id')
  detail(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.sessions.detail(userId, id);
  }

  @Patch('sessions/:id')
  update(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.sessions.update(userId, id, dto);
  }

  @Post('sessions/:id/finish')
  @HttpCode(200)
  async finish(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: FinishSessionDto,
  ) {
    const finished = await this.sessions.finish(userId, id, dto.at);
    this.alarms.clear(userId);
    return finished;
  }

  /** Issue #15: what this finished workout would change in its plan day, and whether it may. */
  @Get('sessions/:id/plan-update')
  planUpdate(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.planUpdates.preview(userId, id);
  }

  /** Issue #15: apply it, at the reviewed revision. Retry-safe: a workout updates its plan once. */
  @Post('sessions/:id/plan-update')
  @HttpCode(200)
  applyPlanUpdate(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: PlanDayUpdateDto) {
    return this.planUpdates.apply(userId, id, dto);
  }

  @Delete('sessions/:id')
  async remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    const removed = await this.sessions.remove(userId, id);
    this.alarms.clear(userId);
    return removed;
  }

  /** Spec 025: a push when this rest ends. The browser sends it after each set and each change. */
  @Put('sessions/:id/rest-alarm')
  @HttpCode(204)
  async restAlarm(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: RestAlarmDto,
  ): Promise<void> {
    await this.alarms.set(userId, id, dto.at);
  }

  // ---------------------------------------------------------------- exercises in a session

  @Post('sessions/:id/exercises')
  addExercise(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: AddSessionExerciseDto,
  ) {
    return this.sessions.addExercise(userId, id, dto);
  }

  @Post('sessions/:id/exercises/order')
  @HttpCode(200)
  reorder(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: ReorderDto,
  ) {
    return this.sessions.reorderExercises(userId, id, dto.ids);
  }

  @Patch('sessions/:id/exercises/:weId')
  updateSessionExercise(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('weId') weId: string,
    @Body() dto: UpdateSessionExerciseDto,
  ) {
    return this.sessions.updateExercise(userId, id, weId, dto);
  }

  /** Spec 023: replace an exercise that has no sets yet, in the same place. */
  @Post('sessions/:id/exercises/:weId/swap')
  swapExercise(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('weId') weId: string,
    @Body() dto: SwapSessionExerciseDto,
  ) {
    return this.sessions.swapExercise(userId, id, weId, dto);
  }

  @Delete('sessions/:id/exercises/:weId')
  removeExercise(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('weId') weId: string,
  ) {
    return this.sessions.removeExercise(userId, id, weId);
  }

  // ---------------------------------------------------------------- sets

  @Post('sessions/:id/exercises/:weId/sets')
  addSet(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('weId') weId: string,
    @Body() dto: CreateSetDto,
  ) {
    return this.sessions.addSet(userId, id, weId, dto as SetInput);
  }

  @Patch('sets/:setId')
  updateSet(
    @CurrentUser('userId') userId: string,
    @Param('setId') setId: string,
    @Body() dto: UpdateSetDto,
  ) {
    return this.sessions.updateSet(userId, setId, dto as SetPatch);
  }

  @Delete('sets/:setId')
  removeSet(@CurrentUser('userId') userId: string, @Param('setId') setId: string) {
    return this.sessions.removeSet(userId, setId);
  }
}

@Module({
  imports: [
    NutritionModule,
    MongooseModule.forFeature([
      { name: Exercise.name, schema: ExerciseSchema },
      { name: TrainingMachine.name, schema: TrainingMachineSchema },
      { name: TrainingPlan.name, schema: TrainingPlanSchema },
      { name: TrainingProfile.name, schema: TrainingProfileSchema },
      { name: WorkoutSession.name, schema: WorkoutSessionSchema },
      { name: WorkoutExercise.name, schema: WorkoutExerciseSchema },
      { name: WorkoutSet.name, schema: WorkoutSetSchema },
    ]),
  ],
  controllers: [TrainingController],
  providers: [CatalogueSeeder, PlanSeeder, PlansService, PlanDayUpdateService, CatalogueService, ProgressService, TrainingProfileService, SessionsService, TrainingSummaryService, RestAlarmService, TrainingLevelService, TrainingRankService],
  exports: [SessionsService, TrainingSummaryService, TrainingRankService, TrainingProfileService],
})
export class TrainingModule {}
