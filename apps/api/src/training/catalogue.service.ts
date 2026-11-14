import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model, type QueryFilter } from 'mongoose';
import {
  CATALOGUE_CREDIT,
  EQUIPMENT_TYPES,
  MUSCLES,
  type EquipmentType,
  type Exercise as ExerciseDto,
  type ExerciseInput,
  type ExerciseListItem,
  type ExercisePatch,
  type Measure,
  type Muscle,
  type TrainingDeleteResult,
  type TrainingImage,
} from '@life-portal/shared-types';
import { normaliseSearch, rankLoadNote } from '@life-portal/shared-domain';
import { MediaService } from '../media/media.service';
import { Exercise, TrainingPlan, WorkoutExercise, WorkoutSet } from './training.schemas';

type ExerciseRow = Exercise & { _id: unknown };

export interface CatalogueQuery {
  q?: string;
  muscle?: string;
  equipment?: string;
  limit?: number;
  skip?: number;
}

/** "Recently used" for search ranking (contract: the last 90 days). */
export const RECENT_DAYS = 90;

/** Spec 028: at most this many exercises are kept on a device for offline use. */
export const OFFLINE_CAP = 1000;
/** More matches than this are not ranked; the catalogue has under a thousand rows. */
const RANK_CAP = 2000;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What search matches: the name and every alias, normalised. Server-built. */
export function searchNameFor(name: string, aliases: string[] = []): string {
  return [name, ...aliases].map(normaliseSearch).filter(Boolean).join(' | ');
}

/**
 * Ranks search results: a name or alias that *starts* with the query first, then one with a
 * word starting with it ("bent over row"), then one merely containing it ("throw"); within each
 * tier, exercises the caller used recently first; then by name. Pure, so the order is testable
 * without a database.
 */
export function rankExercises<T extends { name: string; searchName: string; id: string }>(
  rows: T[],
  q: string,
  recent: ReadonlySet<string>,
): T[] {
  const tier = (row: T) => {
    if (!q) return 0;
    const parts = row.searchName.split(' | ');
    if (parts.some((part) => part.startsWith(q))) return 0;
    if (parts.some((part) => part.includes(` ${q}`))) return 1;
    return 2;
  };
  return [...rows].sort((a, b) => {
    const pa = tier(a);
    const pb = tier(b);
    if (pa !== pb) return pa - pb;
    const ra = recent.has(a.id) ? 0 : 1;
    const rb = recent.has(b.id) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id);
  });
}

/**
 * The exercise catalogue: shared rows (no `userId`) plus the caller's own.
 *
 * Deliberately not an `OwnedCrudService`: its `scoped()` adds `userId` to every filter, which
 * would hide the shared catalogue. Every read goes through `visible()`, the one place the
 * shared-or-own rule is written; every write goes through `own()`, so a shared row can never be
 * changed through this API (it answers 404, as for anyone else's row).
 */
@Injectable()
export class CatalogueService {
  constructor(
    @InjectModel(Exercise.name) private readonly exercises: Model<Exercise>,
    @InjectModel(WorkoutExercise.name) private readonly workoutExercises: Model<WorkoutExercise>,
    @InjectModel(WorkoutSet.name) private readonly sets: Model<WorkoutSet>,
    private readonly media: MediaService,
    @Optional() @InjectModel(TrainingPlan.name) private readonly plans?: Model<TrainingPlan>,
  ) {}

  /** Shared rows, or rows owned by this user. Nothing else is ever readable. */
  private visible(
    userId: string,
    extra: Record<string, unknown> = {},
  ): QueryFilter<Exercise> {
    return {
      ...extra,
      $or: [{ userId: { $exists: false } }, { userId }],
    } as QueryFilter<Exercise>;
  }

  /** Exercise ids the caller logged a set of since `nowMs - 90 days`. */
  async recentIds(userId: string, nowMs: number): Promise<Set<string>> {
    const since = new Date(nowMs - RECENT_DAYS * 86_400_000);
    const ids = await this.sets.distinct('exerciseId', { userId, loggedAt: { $gte: since } });
    return new Set(ids.map(String));
  }

  async list(userId: string, query: CatalogueQuery = {}, nowMs = Date.now()): Promise<ExerciseListItem[]> {
    const extra: Record<string, unknown> = { archived: false };
    const q = normaliseSearch(query.q ?? '');
    if (q) extra['searchName'] = { $regex: escapeRegex(q) };
    if (query.muscle && (MUSCLES as readonly string[]).includes(query.muscle)) {
      extra['primaryMuscles'] = query.muscle;
    }
    if (query.equipment && (EQUIPMENT_TYPES as readonly string[]).includes(query.equipment)) {
      extra['equipmentType'] = query.equipment;
    }
    const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
    const skip = Math.max(query.skip ?? 0, 0);
    // Ranking needs every match, so it happens here rather than in Mongo. The catalogue is
    // under a thousand rows and the fields are few.
    const [rows, recent] = await Promise.all([
      this.exercises
        .find(this.visible(userId, extra))
        .select('name searchName primaryMuscles equipmentType measure userId seedKey')
        .sort({ name: 1, _id: 1 })
        .limit(RANK_CAP)
        .lean<ExerciseRow[]>(),
      this.recentIds(userId, nowMs),
    ]);
    const ranked = rankExercises(
      rows.map((row) => ({ row, id: String(row._id), name: row.name, searchName: row.searchName ?? '' })),
      q,
      recent,
    );
    return ranked.slice(skip, skip + limit).map(({ row, id }) => ({
      ...this.toListItem(row),
      ...(recent.has(id) ? { recent: true } : {}),
    }));
  }

  /**
   * Spec 028: what a device keeps for offline use. The caller's own exercises, those they logged
   * in the last 90 days, and those in a plan they can start (their own and the ready-made ones).
   * Capped, newest-used first; the picker says anything else is unavailable offline.
   */
  async offlineList(userId: string, nowMs = Date.now()): Promise<ExerciseListItem[]> {
    const [recent, planIds] = await Promise.all([
      this.recentIds(userId, nowMs),
      this.plans
        ? this.plans
            .find({ archived: false, $or: [{ userId: { $exists: false } }, { userId }] })
            .select('workouts.exercises.exerciseId')
            .lean<{ workouts?: { exercises?: { exerciseId: string }[] }[] }[]>()
            .then((plans) =>
              plans.flatMap((plan) => (plan.workouts ?? []).flatMap((day) => (day.exercises ?? []).map((item) => String(item.exerciseId)))),
            )
        : Promise.resolve([] as string[]),
    ]);
    const ids = [...new Set([...recent, ...planIds])].filter((id) => isValidObjectId(id));
    const fields = 'name searchName primaryMuscles equipmentType measure userId seedKey';
    const [ownRows, usedRows] = await Promise.all([
      this.exercises.find({ userId, archived: false }).select(fields).lean<ExerciseRow[]>(),
      this.exercises.find(this.visible(userId, { archived: false, _id: { $in: ids } })).select(fields).lean<ExerciseRow[]>(),
    ]);
    const byId = new Map([...ownRows, ...usedRows].map((row) => [String(row._id), row]));
    const rows = [...byId.values()]
      .sort((a, b) => Number(recent.has(String(b._id))) - Number(recent.has(String(a._id))) || a.name.localeCompare(b.name))
      .slice(0, OFFLINE_CAP);
    return rows.map((row) => ({
      ...this.toListItem(row),
      ...(recent.has(String(row._id)) ? { recent: true } : {}),
      // #23: so offline search matches aliases ("machine bench press") as the server does.
      ...(row.searchName ? { searchName: row.searchName } : {}),
    }));
  }

  /** One exercise. Archived own rows stay readable, because past workouts refer to them. */
  async get(userId: string, id: string): Promise<ExerciseDto> {
    return this.toExercise(await this.readable(userId, id, { includeArchived: true }));
  }

  /** The raw row, or 404 when it is malformed, someone else's, or (by default) archived. */
  async readable(
    userId: string,
    id: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<ExerciseRow> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Exercise ${id} not found`);
    const row = await this.exercises
      .findOne(
        this.visible(userId, {
          _id: id,
          ...(options.includeArchived ? {} : { archived: false }),
        }),
      )
      .lean<ExerciseRow>();
    if (!row) throw new NotFoundException(`Exercise ${id} not found`);
    return row;
  }

  // ---------------------------------------------------------------- own exercises

  async create(userId: string, input: ExerciseInput): Promise<ExerciseDto> {
    const aliases = cleanList(input.aliases);
    const created = await this.exercises.create({
      userId,
      name: input.name.trim(),
      aliases,
      searchName: searchNameFor(input.name, aliases),
      primaryMuscles: unique(input.primaryMuscles),
      secondaryMuscles: unique(input.secondaryMuscles ?? []),
      equipmentType: input.equipmentType,
      measure: input.measure,
      ...(cleanList(input.instructions).length ? { instructions: cleanList(input.instructions) } : {}),
      archived: false,
    });
    const row = created.toObject() as ExerciseRow;
    if (!input.imageMediaId) return this.toExercise(row);
    try {
      const image = await this.media.copyForTraining(userId, input.imageMediaId, 'exercises', String(row._id));
      await this.exercises.updateOne({ _id: row._id, userId }, { $set: { image } });
      return this.toExercise({ ...row, image });
    } catch (error) {
      // The photo is part of the same save: without it, undo the row so a retry is clean.
      await this.exercises.deleteOne({ _id: row._id, userId });
      throw error;
    }
  }

  async update(userId: string, id: string, patch: ExercisePatch): Promise<ExerciseDto> {
    const row = await this.own(userId, id);
    if (patch.measure !== undefined && patch.measure !== row.measure && (await this.isLogged(userId, id))) {
      // Past sets were validated against the old measure; their fields would stop making sense.
      throw new ConflictException({
        code: 'MEASURE_LOCKED',
        message: 'This exercise is in a workout already, so how it is measured cannot change. Create a new exercise instead.',
      });
    }
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (patch.name !== undefined) set['name'] = patch.name.trim();
    if (patch.aliases !== undefined) set['aliases'] = cleanList(patch.aliases);
    if (patch.name !== undefined || patch.aliases !== undefined) {
      set['searchName'] = searchNameFor(
        (set['name'] as string | undefined) ?? row.name,
        (set['aliases'] as string[] | undefined) ?? row.aliases ?? [],
      );
    }
    if (patch.primaryMuscles !== undefined) set['primaryMuscles'] = unique(patch.primaryMuscles);
    if (patch.secondaryMuscles !== undefined) set['secondaryMuscles'] = unique(patch.secondaryMuscles);
    if (patch.equipmentType !== undefined) set['equipmentType'] = patch.equipmentType;
    if (patch.measure !== undefined) set['measure'] = patch.measure;
    if (patch.instructions !== undefined) {
      const steps = cleanList(patch.instructions);
      if (steps.length) set['instructions'] = steps;
      else unset['instructions'] = 1;
    }
    if (patch.imageMediaId) {
      set['image'] = await this.media.copyForTraining(userId, patch.imageMediaId, 'exercises', id);
    } else if (patch.removeImage) {
      unset['image'] = 1;
    }
    if (Object.keys(set).length || Object.keys(unset).length) {
      await this.exercises.updateOne(
        { _id: row._id, userId },
        { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      );
    }
    if (row.image && (patch.imageMediaId || patch.removeImage)) void this.media.deleteKey(row.image.key);
    return this.get(userId, id);
  }

  /**
   * Removed when nothing refers to it; archived when a workout or one of the person's own plans
   * does, so history keeps its id and the plan keeps working (spec 023).
   */
  async remove(userId: string, id: string): Promise<TrainingDeleteResult> {
    const row = await this.own(userId, id, { includeArchived: true });
    if ((await this.isLogged(userId, id)) || (await this.inOwnPlan(userId, id))) {
      await this.exercises.updateOne({ _id: row._id, userId }, { $set: { archived: true } });
      return { id, archived: true };
    }
    await this.exercises.deleteOne({ _id: row._id, userId });
    void this.media.deleteKey(row.image?.key);
    return { id, deleted: true };
  }

  /** The caller's own row. Shared and other people's rows are a 404, never a 403. */
  private async own(userId: string, id: string, options: { includeArchived?: boolean } = {}): Promise<ExerciseRow> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Exercise ${id} not found`);
    const row = await this.exercises
      .findOne({ _id: id, userId, ...(options.includeArchived ? {} : { archived: false }) })
      .lean<ExerciseRow>();
    if (!row) throw new NotFoundException(`Exercise ${id} not found`);
    return row;
  }

  private async isLogged(userId: string, exerciseId: string): Promise<boolean> {
    return Boolean(await this.workoutExercises.exists({ userId, exerciseId }));
  }

  private async inOwnPlan(userId: string, exerciseId: string): Promise<boolean> {
    if (!this.plans) return false;
    return Boolean(await this.plans.exists({ userId, 'workouts.exercises.exerciseId': exerciseId }));
  }

  private toListItem(row: ExerciseRow): ExerciseListItem {
    return {
      id: String(row._id),
      name: row.name,
      primaryMuscles: row.primaryMuscles as Muscle[],
      equipmentType: row.equipmentType as EquipmentType,
      measure: row.measure as Measure,
      isOwn: Boolean(row.userId),
      ...this.loadNote(row),
    };
  }

  /** Shared rows only: a private exercise has no standard, whatever it is called. */
  private loadNote(row: ExerciseRow): { loadNote?: string } {
    const note = row.userId ? undefined : rankLoadNote(row.seedKey, row.measure as Measure);
    return note ? { loadNote: note } : {};
  }

  private async toExercise(row: ExerciseRow): Promise<ExerciseDto> {
    return {
      ...this.toListItem(row),
      aliases: row.aliases ?? [],
      secondaryMuscles: (row.secondaryMuscles ?? []) as Muscle[],
      mechanic: row.mechanic as ExerciseDto['mechanic'],
      level: row.level as ExerciseDto['level'],
      instructions: row.instructions,
      archived: row.archived,
      attribution: row.seedKey ? { ...CATALOGUE_CREDIT } : undefined,
      image: await signImage(this.media, row.image),
    };
  }
}

/** A signed link for a stored photo; the key itself never leaves the API. */
export async function signImage(
  media: Pick<MediaService, 'signKey'>,
  image: { key: string; width: number; height: number } | undefined,
): Promise<TrainingImage | undefined> {
  if (!image) return undefined;
  const url = await media.signKey(image.key);
  return url ? { url, width: image.width, height: image.height } : undefined;
}

function cleanList(values: string[] | undefined): string[] {
  return unique((values ?? []).map((value) => value.trim()).filter(Boolean));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
