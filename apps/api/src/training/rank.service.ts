import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { ExerciseRankView, Measure, SetType } from '@life-portal/shared-types';
import { bodyWeightOn, exerciseRank, type RankSet } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { NutritionService } from '../nutrition/nutrition.service';
import { CatalogueService } from './catalogue.service';
import { TrainingProfileService } from './profile.service';
import type { SetRow } from './set-row';
import { WorkoutExercise, WorkoutSession, WorkoutSet } from './training.schemas';

type SessionRow = Pick<WorkoutSession, 'day' | 'startedAt'> & { _id: unknown };
type ExerciseRow = Pick<WorkoutExercise, 'machineId'> & { _id: unknown; snapshot?: { measure?: string } };

/**
 * Strength ranks (issue #5b), behind `trainingRanks`. Every read recomputes the rank from the
 * caller's own finished sets of one exercise, their weigh-ins (from Nutrition) and their chosen
 * standards; the arithmetic is `exerciseRank` in the domain lib. Nothing is stored, so an edited
 * or deleted set, or a corrected weigh-in, is reflected at once, and no other member's data is
 * ever read.
 */
@Injectable()
export class TrainingRankService {
  constructor(
    @InjectModel(WorkoutSession.name) private readonly sessions: Model<WorkoutSession>,
    @InjectModel(WorkoutExercise.name) private readonly workoutExercises: Model<WorkoutExercise>,
    @InjectModel(WorkoutSet.name) private readonly sets: Model<WorkoutSet>,
    private readonly catalogue: CatalogueService,
    private readonly nutrition: NutritionService,
    private readonly profiles: TrainingProfileService,
    private readonly access: AccessService,
  ) {}

  async rank(userId: string, exerciseId: string, today: string): Promise<ExerciseRankView> {
    await this.access.require(userId, 'trainingRanks');
    const exercise = await this.catalogue.readable(userId, exerciseId, { includeArchived: true });
    const measure = exercise.measure as Measure;
    const [profile, sets] = await Promise.all([this.profiles.read(userId), this.load(userId, exerciseId, measure, today)]);
    return exerciseRank({
      exerciseId,
      // A private exercise never has a benchmark, whatever it is called.
      seedKey: exercise.userId ? undefined : exercise.seedKey,
      measure,
      standards: profile.rankStandards,
      sets,
      today,
    });
  }

  /** The caller's sets of one exercise under its current measure, in finished sessions up to today. */
  private async load(userId: string, exerciseId: string, measure: Measure, today: string): Promise<RankSet[]> {
    const [rows, exercises] = await Promise.all([
      this.sets.find({ userId, exerciseId }).lean<SetRow[]>(),
      this.workoutExercises.find({ userId, exerciseId }).select('_id machineId snapshot.measure').lean<ExerciseRow[]>(),
    ]);
    if (!rows.length) return [];
    const byId = new Map(exercises.map((row) => [String(row._id), row]));
    const sessionRows = await this.sessions
      .find({ userId, status: 'finished', day: { $lte: today }, _id: { $in: [...new Set(rows.map((row) => row.sessionId))] } })
      .select('day startedAt')
      .lean<SessionRow[]>();
    const sessions = new Map(sessionRows.map((row) => [String(row._id), row]));
    const weighIns = sessionRows.length ? await this.nutrition.weighInsUpTo(userId, today) : [];
    return rows.flatMap((row) => {
      const session = sessions.get(row.sessionId);
      const workoutExercise = byId.get(row.workoutExerciseId);
      if (!session || workoutExercise?.snapshot?.measure !== measure) return [];
      return [
        {
          id: String(row._id),
          sessionId: row.sessionId,
          day: session.day,
          type: row.type as SetType,
          reps: row.reps,
          weightGrams: row.weightGrams,
          assistGrams: row.assistGrams,
          body: bodyWeightOn(weighIns, session.day),
          machine: !!workoutExercise.machineId,
        },
      ];
    });
  }
}
