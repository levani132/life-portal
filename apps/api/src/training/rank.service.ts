import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { ExerciseRankView, Measure, RankStandards, SetType } from '@life-portal/shared-types';
import {
  bestStrength,
  bodyWeightOn,
  exerciseRank,
  freezeStandard,
  tournamentStandard,
  type FrozenStandard,
  type RankSet,
  type StrengthBest,
} from '@life-portal/shared-domain';
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

  /**
   * For tournaments (#12): a member's rank on a catalogue exercise under the given standards (their
   * competition category), counting only sets logged before `savedBefore` when given, so a set
   * saved after a lock or a deadline never changes what was frozen. No feature check: the caller
   * has already decided this member may be ranked here. Also returns the exercise's name.
   */
  async rankFor(
    userId: string,
    exerciseId: string,
    today: string,
    standards: RankStandards,
    savedBefore?: Date,
  ): Promise<{ view: ExerciseRankView; name: string; seedKey?: string }> {
    const exercise = await this.catalogue.readable(userId, exerciseId, { includeArchived: true });
    const measure = exercise.measure as Measure;
    const seedKey = exercise.userId ? undefined : exercise.seedKey;
    const sets = await this.load(userId, exerciseId, measure, today, savedBefore);
    return { view: exerciseRank({ exerciseId, seedKey, measure, standards, sets, today }), name: exercise.name, seedKey };
  }

  /**
   * For tournament scoring (#12): the best valid strength score (no work-capacity bonus) among a
   * member's sets dated `from`–`to` and saved before `savedBefore`, under the standard frozen at
   * the lock (`locked`: its copy, or for older entries its version name, or today's when that
   * version no longer exists: `changed`). Returns the copy it scored under, which the lock stores.
   * Sets are read under the frozen standard's measure. No feature check, as for `rankFor`.
   */
  async strengthBest(
    userId: string,
    exerciseId: string,
    standards: RankStandards,
    window: { from: string; to: string },
    savedBefore: Date,
    locked: string | FrozenStandard | undefined,
    today: string,
  ): Promise<{ best?: StrengthBest; version?: string; standard?: FrozenStandard; changed: boolean }> {
    const exercise = await this.catalogue.readable(userId, exerciseId, { includeArchived: true });
    const measure = exercise.measure as Measure;
    const scoring = tournamentStandard(exercise.userId ? undefined : exercise.seedKey, measure, locked, today);
    if (!scoring) return { changed: false };
    const sets = await this.load(userId, exerciseId, scoring.standard.measure, window.to, savedBefore);
    const best = bestStrength(scoring.standard, standards, sets, window.from, window.to);
    return {
      ...(best ? { best } : {}),
      version: scoring.version,
      standard: freezeStandard(scoring.version, scoring.standard),
      changed: scoring.changed,
    };
  }

  /** The caller's sets of one exercise under its current measure, in finished sessions up to today. */
  private async load(userId: string, exerciseId: string, measure: Measure, today: string, savedBefore?: Date): Promise<RankSet[]> {
    const [rows, exercises] = await Promise.all([
      this.sets.find({ userId, exerciseId, ...(savedBefore ? { loggedAt: { $lt: savedBefore } } : {}) }).lean<SetRow[]>(),
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
