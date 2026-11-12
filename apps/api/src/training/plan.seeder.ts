import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { Measure, PlanTarget } from '@life-portal/shared-types';
import { validatePlanTarget } from '@life-portal/shared-domain';
import plansFile from './catalogue/plans.json';
import { Exercise, TrainingPlan } from './training.schemas';

/** `apps/api/src/training/catalogue/plans.json`: our own ready-made plans (research R11). */
export interface PlansFile {
  version: number;
  plans: SeedPlan[];
}

export interface SeedPlan {
  seedKey: string;
  name: string;
  description?: string;
  workouts: {
    /** Becomes the workout's stable id, so progress survives a new version. */
    key: string;
    name: string;
    exercises: { exercise: string; restSeconds?: number; note?: string; superset?: string; targets: PlanTarget[] }[];
  }[];
}

type ExerciseRow = { _id: unknown; seedKey?: string; measure: string };

/**
 * Seeds the shared (ready-made) workout plans at boot, after the exercise catalogue, for the same
 * reason the catalogue seeds itself: production has no job runner (spec 023 research R3).
 *
 * A normal boot costs one count query. When the file's version is ahead, each plan is upserted
 * by `seedKey`, with each workout's file key as its stable id. A plan naming an exercise the
 * catalogue does not have, or a target its measure does not allow, is logged and skipped rather
 * than shipped broken. A shared plan no longer in the file is archived, not deleted: people's
 * sessions point at it. Rows with a `userId` are never touched.
 */
@Injectable()
export class PlanSeeder {
  private readonly logger = new Logger(PlanSeeder.name);

  constructor(
    @InjectModel(TrainingPlan.name) private readonly plans: Model<TrainingPlan>,
    @InjectModel(Exercise.name) private readonly exercises: Model<Exercise>,
  ) {}

  async seed(file: PlansFile = plansFile as PlansFile): Promise<{ written: number; skipped: string[]; upToDate: boolean }> {
    try {
      const current = await this.plans.countDocuments({
        userId: { $exists: false },
        seedKey: { $exists: true },
        seedVersion: file.version,
        archived: false,
      });
      if (current >= file.plans.length) return { written: 0, skipped: [], upToDate: true };

      const keys = [...new Set(file.plans.flatMap((plan) => plan.workouts.flatMap((w) => w.exercises.map((e) => e.exercise))))];
      const rows = await this.exercises
        .find({ userId: { $exists: false }, seedKey: { $in: keys } })
        .select('seedKey measure')
        .lean<ExerciseRow[]>();
      const bySeedKey = new Map(rows.map((row) => [row.seedKey as string, row]));

      const skipped: string[] = [];
      const ops = file.plans.flatMap((plan) => {
        const problem = planProblem(plan, bySeedKey);
        if (problem) {
          this.logger.warn(`Ready-made plan ${plan.seedKey} skipped: ${problem}`);
          skipped.push(plan.seedKey);
          return [];
        }
        return [
          {
            updateOne: {
              // Only shared rows carry a seedKey: a copy never inherits one.
              filter: { seedKey: plan.seedKey },
              update: {
                $set: {
                  seedVersion: file.version,
                  name: plan.name,
                  ...(plan.description ? { description: plan.description } : {}),
                  workouts: plan.workouts.map((workout) => ({
                    id: workout.key,
                    name: workout.name,
                    exercises: workout.exercises.map((exercise, index) => ({
                      id: `${workout.key}:${index}`,
                      exerciseId: String(bySeedKey.get(exercise.exercise)?._id),
                      ...(exercise.restSeconds != null ? { restSeconds: exercise.restSeconds } : {}),
                      ...(exercise.note ? { note: exercise.note } : {}),
                      ...(exercise.superset ? { superset: exercise.superset } : {}),
                      targets: exercise.targets,
                    })),
                  })),
                  archived: false,
                },
              },
              upsert: true,
            },
          },
        ];
      });
      if (ops.length) await this.plans.bulkWrite(ops as never, { ordered: false });

      const inFile = new Set(file.plans.map((plan) => plan.seedKey));
      const dropped = (
        await this.plans
          .find({ userId: { $exists: false }, seedKey: { $exists: true }, archived: false })
          .select('seedKey')
          .lean<{ _id: unknown; seedKey: string }[]>()
      ).filter((row) => !inFile.has(row.seedKey));
      if (dropped.length) {
        await this.plans.bulkWrite(
          dropped.map((row) => ({
            updateOne: { filter: { _id: row._id, userId: { $exists: false } }, update: { $set: { archived: true } } },
          })) as never,
        );
      }
      this.logger.log(
        `Ready-made plans v${file.version}: ${ops.length} written, ${skipped.length} skipped, ${dropped.length} archived`,
      );
      return { written: ops.length, skipped, upToDate: false };
    } catch (error) {
      // Like the catalogue: a failed seed must not stop the API. The next boot tries again.
      this.logger.error(`Ready-made plan seed failed: ${(error as Error).message}`);
      return { written: 0, skipped: [], upToDate: false };
    }
  }
}

/** Why a seed plan cannot be shipped, or `undefined` when it can. */
export function planProblem(plan: SeedPlan, bySeedKey: Map<string, { measure: string }>): string | undefined {
  for (const workout of plan.workouts) {
    for (const exercise of workout.exercises) {
      const row = bySeedKey.get(exercise.exercise);
      if (!row) return `${workout.key} names ${exercise.exercise}, which is not in the catalogue`;
      for (const target of exercise.targets) {
        const problem = validatePlanTarget(row.measure as Measure, target);
        if (problem) return `${workout.key}, ${exercise.exercise}: ${problem}`;
      }
    }
  }
  return undefined;
}
