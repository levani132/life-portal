import {
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
import type { SetInput, SetPatch } from '@life-portal/shared-types';
import { RequireModule } from '../access/access.module';
import { CurrentUser } from '../auth/current-user.decorator';
import { CatalogueSeeder } from './catalogue.seeder';
import { CatalogueService } from './catalogue.service';
import { MachinesService } from './machines.service';
import { ProgressService } from './progress.service';
import { NutritionModule } from '../nutrition/nutrition.module';
import { TrainingProfileService } from './profile.service';
import { SessionsService } from './sessions.service';
import {
  AddSessionExerciseDto,
  CreateExerciseDto,
  CreateMachineDto,
  CreateSetDto,
  FinishSessionDto,
  ReorderDto,
  StartSessionDto,
  UpdateExerciseDto,
  UpdateMachineDto,
  UpdateSessionDto,
  UpdateSessionExerciseDto,
  UpdateSetDto,
  UpdateTrainingProfileDto,
} from './training.dto';
import {
  Exercise,
  ExerciseSchema,
  TrainingMachine,
  TrainingMachineSchema,
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
    private readonly machines: MachinesService,
    private readonly progress: ProgressService,
  ) {}

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

  // ---------------------------------------------------------------- machines

  @Get('machines')
  listMachines(@CurrentUser('userId') userId: string, @Query('exerciseId') exerciseId?: string) {
    return this.machines.list(userId, exerciseId || undefined);
  }

  @Get('machines/:id')
  machine(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.machines.get(userId, id);
  }

  @Post('machines')
  createMachine(@CurrentUser('userId') userId: string, @Body() dto: CreateMachineDto) {
    return this.machines.create(userId, dto);
  }

  @Patch('machines/:id')
  updateMachine(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMachineDto,
  ) {
    return this.machines.update(userId, id, dto);
  }

  @Delete('machines/:id')
  deleteMachine(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.machines.remove(userId, id);
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
  finish(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: FinishSessionDto,
  ) {
    return this.sessions.finish(userId, id, dto.at);
  }

  @Delete('sessions/:id')
  remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.sessions.remove(userId, id);
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
      { name: TrainingProfile.name, schema: TrainingProfileSchema },
      { name: WorkoutSession.name, schema: WorkoutSessionSchema },
      { name: WorkoutExercise.name, schema: WorkoutExerciseSchema },
      { name: WorkoutSet.name, schema: WorkoutSetSchema },
    ]),
  ],
  controllers: [TrainingController],
  providers: [CatalogueSeeder, CatalogueService, MachinesService, ProgressService, TrainingProfileService, SessionsService],
  exports: [SessionsService],
})
export class TrainingModule {}
