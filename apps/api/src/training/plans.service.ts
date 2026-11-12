import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Types, type Model, type QueryFilter } from 'mongoose';
import {
  PLAN_LIMITS,
  type EquipmentType,
  type Measure,
  type PlanDetail,
  type PlanInput,
  type PlanList,
  type PlanListItem,
  type PlanTarget,
} from '@life-portal/shared-types';
import { validatePlan } from '@life-portal/shared-domain';
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

  // ---------------------------------------------------------------- own plans (US2)

  /** A new own plan. Ids are assigned here; a retried `requestId` returns the original. */
  async create(userId: string, input: PlanInput & { requestId: string }): Promise<PlanDetail> {
    const retried = await this.plans.findOne({ userId, requestId: input.requestId }).lean<PlanRow>();
    if (retried) return this.detail(userId, String(retried._id));
    await this.assertUnderLimit(userId);
    const clean = await this.checked(userId, input, new Map(), new Map());
    try {
      const created = await this.plans.create({ userId, requestId: input.requestId, archived: false, ...clean });
      return this.detail(userId, String(created._id));
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const winner = await this.plans.findOne({ userId, requestId: input.requestId }).lean<PlanRow>();
      if (!winner) throw error;
      return this.detail(userId, String(winner._id));
    }
  }

  /**
   * Replaces the whole of an own plan (last write wins, research R1). An item that carries an `id`
   * keeps it, so sessions keep pointing at their workout; an unknown `id` is refused rather than
   * trusted; items without one are new; items left out are removed.
   */
  async replace(userId: string, id: string, input: PlanInput): Promise<PlanDetail> {
    const row = await this.own(userId, id);
    const workoutIds = new Map(row.workouts.map((workout) => [workout.id, workout]));
    const exerciseIds = new Map(
      row.workouts.flatMap((workout) => workout.exercises.map((exercise) => [exercise.id, exercise] as const)),
    );
    const clean = await this.checked(userId, input, workoutIds, exerciseIds);
    await this.plans.updateOne(
      { _id: row._id, userId },
      clean.description === undefined
        ? { $set: { name: clean.name, workouts: clean.workouts }, $unset: { description: 1 } }
        : { $set: clean },
      { runValidators: true },
    );
    return this.detail(userId, id);
  }

  /** Any plan the caller can see, as a new own plan with new ids. Never linked to the original. */
  async copy(userId: string, id: string, requestId: string): Promise<PlanDetail> {
    const retried = await this.plans.findOne({ userId, requestId }).lean<PlanRow>();
    if (retried) return this.detail(userId, String(retried._id));
    const source = await this.readable(userId, id);
    await this.assertUnderLimit(userId);
    const suffix = ' (copy)';
    const created = await this.plans.create({
      userId,
      requestId,
      archived: false,
      name: `${source.name.slice(0, PLAN_LIMITS.name - suffix.length)}${suffix}`,
      ...(source.description ? { description: source.description } : {}),
      copiedFrom: { planId: String(source._id), name: source.name },
      workouts: source.workouts.map((workout) => ({
        id: newId(),
        name: workout.name,
        exercises: workout.exercises.map((exercise) => ({
          id: newId(),
          exerciseId: exercise.exerciseId,
          ...(exercise.restSeconds != null ? { restSeconds: exercise.restSeconds } : {}),
          ...(exercise.note ? { note: exercise.note } : {}),
          targets: exercise.targets.map(toTarget),
        })),
      })),
    });
    return this.detail(userId, String(created._id));
  }

  /** Own plans only. Sessions started from it keep their frozen names and suggestions. */
  async remove(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    const row = await this.own(userId, id);
    await this.plans.deleteOne({ _id: row._id, userId });
    return { id, deleted: true };
  }

  private async assertUnderLimit(userId: string) {
    if ((await this.plans.countDocuments({ userId })) >= PLAN_LIMITS.ownPlans) {
      throw new ConflictException({
        code: 'PLAN_LIMIT',
        message: `You can keep up to ${PLAN_LIMITS.ownPlans} plans. Delete one to make room.`,
      });
    }
  }

  /** The caller's own plan; shared and other people's plans are a 404, as for exercises. */
  private async own(userId: string, id: string): Promise<PlanRow> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Plan ${id} not found`);
    const row = await this.plans.findOne({ _id: id, userId }).lean<PlanRow>();
    if (!row) throw new NotFoundException(`Plan ${id} not found`);
    return row;
  }

  /**
   * Trims and checks a plan, resolving ids: a sent id must be one of `known`, each at most once.
   * Exercises must be shared or the caller's own (archived own ones too, so a plan keeps working
   * after its exercise is deleted).
   */
  private async checked(
    userId: string,
    input: PlanInput,
    knownWorkouts: Map<string, unknown>,
    knownExercises: Map<string, unknown>,
  ) {
    const ids = [...new Set(input.workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)))].filter(isValidObjectId);
    const rows = await this.exercises
      .find({ _id: { $in: ids }, $or: [{ userId: { $exists: false } }, { userId }] })
      .select('measure')
      .lean<{ _id: unknown; measure: string }[]>();
    const measures = new Map(rows.map((row) => [String(row._id), row.measure as Measure]));
    const plan: PlanInput = {
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      workouts: input.workouts.map((workout) => ({
        ...workout,
        name: workout.name.trim(),
        exercises: workout.exercises.map((exercise) => ({
          ...exercise,
          note: exercise.note?.trim() || undefined,
          targets: exercise.targets.map(toTarget),
        })),
      })),
    };
    const problems = validatePlan(plan, (exerciseId) => measures.get(exerciseId));
    if (problems.length) {
      throw new BadRequestException({ message: problems.map((p) => p.message), problems });
    }
    const seen = new Set<string>();
    const resolve = (id: string | undefined, known: Map<string, unknown>) => {
      if (id === undefined) return newId();
      if (!known.has(id) || seen.has(id)) throw new BadRequestException(`Unknown or repeated id ${id} in this plan.`);
      seen.add(id);
      return id;
    };
    return {
      name: plan.name,
      description: plan.description,
      workouts: plan.workouts.map((workout) => ({
        id: resolve(workout.id, knownWorkouts),
        name: workout.name,
        exercises: workout.exercises.map((exercise) => ({
          id: resolve(exercise.id, knownExercises),
          exerciseId: exercise.exerciseId,
          ...(exercise.restSeconds != null ? { restSeconds: exercise.restSeconds } : {}),
          ...(exercise.note ? { note: exercise.note } : {}),
          targets: exercise.targets,
        })),
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

const newId = () => new Types.ObjectId().toHexString();

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
