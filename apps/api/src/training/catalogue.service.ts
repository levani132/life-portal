import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model, type QueryFilter } from 'mongoose';
import {
  CATALOGUE_CREDIT,
  EQUIPMENT_TYPES,
  MUSCLES,
  type EquipmentType,
  type Exercise as ExerciseDto,
  type ExerciseListItem,
  type Measure,
  type Muscle,
} from '@life-portal/shared-types';
import { normaliseSearch } from '@life-portal/shared-domain';
import { Exercise } from './training.schemas';

type ExerciseRow = Exercise & { _id: unknown };

export interface CatalogueQuery {
  q?: string;
  muscle?: string;
  equipment?: string;
  limit?: number;
  skip?: number;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Reads the exercise catalogue: shared rows (no `userId`) plus the caller's own.
 *
 * Deliberately not an `OwnedCrudService`: its `scoped()` adds `userId` to every filter, which
 * would hide the shared catalogue. Every read here goes through `visible()`, which is the one
 * place the shared-or-own rule is written. Writes (own rows only) arrive with spec 020's US2.
 */
@Injectable()
export class CatalogueService {
  constructor(
    @InjectModel(Exercise.name) private readonly exercises: Model<Exercise>,
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

  async list(userId: string, query: CatalogueQuery = {}): Promise<ExerciseListItem[]> {
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
    const rows = await this.exercises
      .find(this.visible(userId, extra))
      .sort({ name: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean<ExerciseRow[]>();
    return rows.map((row) => this.toListItem(row));
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

  private toListItem(row: ExerciseRow): ExerciseListItem {
    return {
      id: String(row._id),
      name: row.name,
      primaryMuscles: row.primaryMuscles as Muscle[],
      equipmentType: row.equipmentType as EquipmentType,
      measure: row.measure as Measure,
      isOwn: Boolean(row.userId),
    };
  }

  private toExercise(row: ExerciseRow): ExerciseDto {
    return {
      ...this.toListItem(row),
      aliases: row.aliases ?? [],
      secondaryMuscles: row.secondaryMuscles as Muscle[],
      mechanic: row.mechanic as ExerciseDto['mechanic'],
      level: row.level as ExerciseDto['level'],
      instructions: row.instructions,
      archived: row.archived,
      attribution: row.seedKey ? { ...CATALOGUE_CREDIT } : undefined,
    };
  }
}
