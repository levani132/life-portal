import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model, type QueryFilter } from 'mongoose';
import type {
  EquipmentType,
  Measure,
  PlanDetail,
  PlanList,
  PlanListItem,
  PlanTarget,
} from '@life-portal/shared-types';
import plansFile from './catalogue/plans.json';
import type { PlansFile } from './plan.seeder';
import { Exercise, TrainingPlan } from './training.schemas';

export type PlanRow = TrainingPlan & { _id: unknown; createdAt?: Date; updatedAt?: Date };
type ExerciseRow = Pick<Exercise, 'name' | 'measure' | 'equipmentType' | 'archived'> & { _id: unknown };

/** Ready-made plans are listed in the order the seed file gives them. */
const SEED_ORDER = new Map((plansFile as PlansFile).plans.map((plan, index) => [plan.seedKey, index]));

/**
 * Workout plans (spec 023). Shared (ready-made) plans have no `userId`, so, as in
 * `CatalogueService`, reads need `$or` with the caller's own rows and this does not extend
 * `OwnedCrudService`: its scoping would hide every shared plan. Every filter is written here, and
 * someone else's plan answers 404 like a missing one.
 */
@Injectable()
export class PlansService {
  constructor(
    @InjectModel(TrainingPlan.name) private readonly plans: Model<TrainingPlan>,
    @InjectModel(Exercise.name) private readonly exercises: Model<Exercise>,
  ) {}

  /** Shared rows, or rows owned by this user. Nothing else is ever readable. */
  private visible(userId: string, extra: Record<string, unknown> = {}): QueryFilter<TrainingPlan> {
    return { ...extra, $or: [{ userId: { $exists: false } }, { userId }] } as QueryFilter<TrainingPlan>;
  }

  async list(userId: string): Promise<PlanList> {
    const rows = await this.plans.find(this.visible(userId, { archived: false })).lean<PlanRow[]>();
    const shared = rows
      .filter((row) => !row.userId)
      .sort((a, b) => (SEED_ORDER.get(a.seedKey ?? '') ?? 999) - (SEED_ORDER.get(b.seedKey ?? '') ?? 999));
    const own = rows
      .filter((row) => row.userId)
      .sort((a, b) => stamp(b) - stamp(a));
    return { shared: shared.map(toListItem), own: own.map(toListItem) };
  }

  async detail(userId: string, id: string): Promise<PlanDetail> {
    const row = await this.readable(userId, id);
    const ids = [...new Set(row.workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.exerciseId)))];
    const exercises = await this.exercises
      .find({ _id: { $in: ids.filter(isValidObjectId) }, $or: [{ userId: { $exists: false } }, { userId }] })
      .select('name measure equipmentType archived')
      .lean<ExerciseRow[]>();
    const byId = new Map(exercises.map((exercise) => [String(exercise._id), exercise]));
    return {
      id: String(row._id),
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      isOwn: Boolean(row.userId),
      archived: row.archived,
      ...(row.copiedFrom ? { copiedFrom: { planId: row.copiedFrom.planId, name: row.copiedFrom.name } } : {}),
      workouts: row.workouts.map((workout) => ({
        id: workout.id,
        name: workout.name,
        isNext: false,
        exercises: workout.exercises.map((exercise) => {
          const found = byId.get(exercise.exerciseId);
          return {
            id: exercise.id,
            exerciseId: exercise.exerciseId,
            exercise: found
              ? {
                  name: found.name,
                  measure: found.measure as Measure,
                  equipmentType: found.equipmentType as EquipmentType,
                  archived: found.archived,
                }
              : { name: 'Exercise no longer available', measure: 'weight_reps', equipmentType: 'other', archived: true },
            ...(exercise.restSeconds != null ? { restSeconds: exercise.restSeconds } : {}),
            ...(exercise.note ? { note: exercise.note } : {}),
            targets: exercise.targets.map(toTarget),
          };
        }),
      })),
    };
  }

  /** The raw plan, shared or the caller's own (archived ones too), or 404. */
  async readable(userId: string, id: string): Promise<PlanRow> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Plan ${id} not found`);
    const row = await this.plans.findOne(this.visible(userId, { _id: id })).lean<PlanRow>();
    if (!row) throw new NotFoundException(`Plan ${id} not found`);
    return row;
  }
}

const stamp = (row: PlanRow) => (row.updatedAt ?? row.createdAt)?.getTime() ?? 0;

/** A stored target without Mongo's extras: only the fields that are set. */
export function toTarget(target: PlanTarget): PlanTarget {
  const out: PlanTarget = { type: target.type ?? 'working' };
  for (const field of ['reps', 'repsMax', 'weightGrams', 'assistGrams', 'durationSeconds', 'distanceMeters'] as const) {
    const value = target[field];
    if (value !== undefined && value !== null) out[field] = value;
  }
  return out;
}

function toListItem(row: PlanRow): PlanListItem {
  return {
    id: String(row._id),
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    isOwn: Boolean(row.userId),
    workoutCount: row.workouts.length,
    exerciseCount: row.workouts.reduce((total, workout) => total + workout.exercises.length, 0),
  };
}
