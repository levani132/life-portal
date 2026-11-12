import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  catalogueEquipment,
  catalogueMeasure,
  catalogueMuscles,
  normaliseSearch,
  type CatalogueEntry,
} from '@life-portal/shared-domain';
import { EXERCISE_LEVELS, MECHANICS } from '@life-portal/shared-types';
import catalogueFile from './catalogue/free-exercise-db.json';
import { PlanSeeder } from './plan.seeder';
import { Exercise } from './training.schemas';

export interface CatalogueFile {
  version: number;
  source: string;
  exercises: CatalogueEntry[];
}

/** `fedb:` marks rows from free-exercise-db, so a later second source cannot collide. */
export const seedKeyFor = (entry: Pick<CatalogueEntry, 'id'>) => `fedb:${entry.id}`;

/** The shared row a dataset entry becomes. Facts only: no images, no instructions (R1). */
export function catalogueRow(entry: CatalogueEntry, version: number) {
  const primary = catalogueMuscles(entry.primaryMuscles);
  const known = <T extends string>(list: readonly T[], value: string | null) =>
    value && (list as readonly string[]).includes(value) ? (value as T) : undefined;
  return {
    seedKey: seedKeyFor(entry),
    seedVersion: version,
    name: entry.name.trim(),
    aliases: [] as string[],
    searchName: normaliseSearch(entry.name),
    primaryMuscles: primary,
    secondaryMuscles: catalogueMuscles(entry.secondaryMuscles).filter(
      (muscle) => !primary.includes(muscle),
    ),
    equipmentType: catalogueEquipment(entry),
    measure: catalogueMeasure(entry),
    mechanic: known(MECHANICS, entry.mechanic),
    level: known(EXERCISE_LEVELS, entry.level),
  };
}

/**
 * Seeds the shared exercise catalogue at boot (spec 020, plan "implementation notes").
 *
 * Production needs the catalogue and the free tier has no job runner, so this runs in
 * `onModuleInit` rather than in `npm run seed`. A normal boot costs one count query: rows are
 * upserted only when fewer rows carry the file's `version` than the file has entries. It only
 * ever writes rows with a `seedKey`, so a person's own exercises are never touched, and it
 * never deletes a row (logged sets refer to them).
 */
@Injectable()
export class CatalogueSeeder implements OnModuleInit {
  private readonly logger = new Logger(CatalogueSeeder.name);

  constructor(
    @InjectModel(Exercise.name) private readonly exercises: Model<Exercise>,
    @Optional() private readonly plans?: PlanSeeder,
  ) {}

  /** Ready-made plans name catalogue exercises, so they are seeded only after it (spec 023). */
  async onModuleInit() {
    await this.seed(catalogueFile as CatalogueFile);
    await this.plans?.seed();
  }

  async seed(file: CatalogueFile): Promise<{ upserted: number; skipped: boolean }> {
    try {
      const current = await this.exercises.countDocuments({
        seedKey: { $exists: true },
        seedVersion: file.version,
      });
      if (current >= file.exercises.length) return { upserted: 0, skipped: true };
      const result = await this.exercises.bulkWrite(
        file.exercises.map((entry) => ({
          updateOne: {
            filter: { seedKey: seedKeyFor(entry) },
            update: {
              $set: catalogueRow(entry, file.version),
              $setOnInsert: { archived: false },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      const upserted = result.upsertedCount + result.modifiedCount;
      this.logger.log(
        `Exercise catalogue v${file.version}: ${result.upsertedCount} added, ${result.modifiedCount} updated`,
      );
      return { upserted, skipped: false };
    } catch (error) {
      // A failed seed must not stop the API: training degrades to an empty catalogue, and the
      // next boot tries again.
      this.logger.error(`Exercise catalogue seed failed: ${(error as Error).message}`);
      return { upserted: 0, skipped: false };
    }
  }
}
