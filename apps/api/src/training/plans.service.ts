import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
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
  type NextPlanWorkout,
} from '@life-portal/shared-types';
import { addDays, planProgress, recentPlanIds, validatePlan, type PlanSessionRef } from '@life-portal/shared-domain';
import plansFile from './catalogue/plans.json';
import type { PlansFile } from './plan.seeder';
import { Exercise, TrainingPlan, WorkoutSession } from './training.schemas';

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
    @Optional() @InjectModel(WorkoutSession.name) private readonly sessions?: Model<WorkoutSession>,
  ) {}

  /**
   * The caller's sessions started from a plan, as progress reads them (research R8). Open ones
   * count; deleted ones are simply gone. `filter` narrows by plan or by day.
   */
  private async sessionRefs(userId: string, filter: Record<string, unknown>): Promise<PlanSessionRef[]> {
    if (!this.sessions) return [];
    const rows = await this.sessions
      .find({ userId, 'plan.planId': { $exists: true }, ...filter })
      .select('plan.planId plan.planWorkoutId day startedAt')
      .lean<{ plan: { planId: string; planWorkoutId: string }; day: string; startedAt?: Date }[]>();
    return rows.map((row) => ({
      planId: row.plan.planId,
      planWorkoutId: row.plan.planWorkoutId,
      day: row.day,
      startedAt: row.startedAt ? new Date(row.startedAt).getTime() : 0,
    }));
  }

  private async withProgress(userId: string, rows: PlanRow[]): Promise<PlanListItem[]> {
    const ids = rows.map((row) => String(row._id));
    const sessions = ids.length ? await this.sessionRefs(userId, { 'plan.planId': { $in: ids } }) : [];
    return rows.map((row) => {
      const item = toListItem(row);
      const id = String(row._id);
      const progress = planProgress(
        row.workouts.map((workout) => workout.id),
        sessions.filter((session) => session.planId === id),
      );
      const days = Object.values(progress.lastDoneDay).sort();
      const next = row.workouts.find((workout) => workout.id === progress.nextWorkoutId);
      return {
        ...item,
        ...(days.length ? { lastDoneDay: days[days.length - 1] } : {}),
        ...(next ? { nextWorkout: { id: next.id, name: next.name } } : {}),
      };
    });
  }

  /** Up to three plans the caller used in the 28 days up to `today`, most recent first. */
  async suggested(userId: string, today: string): Promise<PlanListItem[]> {
    const sessions = await this.sessionRefs(userId, { day: { $gte: addDays(today, -27) } });
    // Plans deleted or archived since drop out; look at a few more so three can still show.
    const ids = recentPlanIds(sessions, today, 28, 10).filter(isValidObjectId);
    if (!ids.length) return [];
    const rows = await this.plans.find(this.visible(userId, { _id: { $in: ids }, archived: false })).lean<PlanRow[]>();
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    const ordered = ids.flatMap((id) => byId.get(id) ?? []).slice(0, 3);
    return this.withProgress(userId, ordered);
  }

  /**
   * The workout Home's Play starts (issue #7): the next workout of the most recently used plan
   * among `suggested()`, or undefined when none was used in the last 28 days.
   */
  async nextUp(userId: string, today: string): Promise<NextPlanWorkout | undefined> {
    const [plan] = await this.suggested(userId, today);
    if (!plan?.nextWorkout) return undefined;
    return { planId: plan.id, planName: plan.name, planWorkoutId: plan.nextWorkout.id, workoutName: plan.nextWorkout.name };
  }

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
    const [sharedItems, ownItems] = await Promise.all([this.withProgress(userId, shared), this.withProgress(userId, own)]);
    return { shared: sharedItems, own: ownItems };
  }

  async detail(userId: string, id: string): Promise<PlanDetail> {
    const row = await this.readable(userId, id);
    const ids = [...new Set(row.workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.exerciseId)))];
    const exercises = await this.exercises
      .find({ _id: { $in: ids.filter(isValidObjectId) }, $or: [{ userId: { $exists: false } }, { userId }] })
      .select('name measure equipmentType archived')
      .lean<ExerciseRow[]>();
    const byId = new Map(exercises.map((exercise) => [String(exercise._id), exercise]));
    const progress = planProgress(
      row.workouts.map((workout) => workout.id),
      await this.sessionRefs(userId, { 'plan.planId': String(row._id) }),
    );
    return {
      id: String(row._id),
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      isOwn: Boolean(row.userId),
      archived: row.archived,
      ...(row.copiedFrom ? { copiedFrom: { planId: row.copiedFrom.planId, name: row.copiedFrom.name } } : {}),
      workouts: row.workouts.map((workout) => ({
        id: workout.id,
        revision: workout.revision ?? 0,
        name: workout.name,
        ...(progress.lastDoneDay[workout.id] ? { lastDoneDay: progress.lastDoneDay[workout.id] } : {}),
        isNext: workout.id === progress.nextWorkoutId,
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
            ...(exercise.superset ? { superset: exercise.superset } : {}),
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
    // Issue #15: a day whose exercises change gets a new revision. A save that carries an older
    // revision and would change the day refuses instead of undoing the newer edit.
    const workouts = clean.workouts.map((workout, index) => {
      const stored = workoutIds.get(workout.id);
      if (!stored) return workout;
      const revision = stored.revision ?? 0;
      if (dayKey(stored.exercises) === dayKey(workout.exercises)) return { ...workout, ...(revision ? { revision } : {}) };
      const sent = input.workouts[index]?.revision;
      if (sent !== undefined && sent < revision) throw planChanged(stored.name);
      return { ...workout, revision: revision + 1 };
    });
    await this.plans.updateOne(
      { _id: row._id, userId },
      clean.description === undefined
        ? { $set: { name: clean.name, workouts }, $unset: { description: 1 } }
        : { $set: { ...clean, workouts } },
      { runValidators: true },
    );
    return this.detail(userId, id);
  }

  /**
   * Issue #15: replaces one day's exercises of an own plan, and only that day, if it is still at
   * `revision`. Validated as a whole plan, so a day this leaves invalid is refused. 409
   * `PLAN_CHANGED` when the day moved on since it was reviewed.
   */
  async replaceDay(
    userId: string,
    id: string,
    workoutId: string,
    revision: number,
    exercises: PlanInput['workouts'][number]['exercises'],
  ): Promise<void> {
    const row = await this.own(userId, id);
    const stored = row.workouts.find((workout) => workout.id === workoutId);
    if (!stored) throw new NotFoundException(`Workout ${workoutId} not found in this plan`);
    if ((stored.revision ?? 0) !== revision) throw planChanged(stored.name);
    const input: PlanInput = {
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      workouts: row.workouts.map((workout) => ({
        id: workout.id,
        name: workout.name,
        exercises: workout.id === workoutId ? exercises : workout.exercises.map(toExerciseInput),
      })),
    };
    const clean = await this.checked(
      userId,
      input,
      new Map(row.workouts.map((workout) => [workout.id, workout])),
      new Map(row.workouts.flatMap((workout) => workout.exercises.map((exercise) => [exercise.id, exercise] as const))),
    );
    const day = clean.workouts.find((workout) => workout.id === workoutId);
    if (!day) throw new NotFoundException(`Workout ${workoutId} not found in this plan`);
    const atRevision = revision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision };
    const result = await this.plans.updateOne(
      { _id: row._id, userId, workouts: { $elemMatch: { id: workoutId, ...atRevision } } },
      { $set: { 'workouts.$[day].exercises': day.exercises, 'workouts.$[day].revision': revision + 1 } },
      { arrayFilters: [{ 'day.id': workoutId }], runValidators: true },
    );
    if (!result.matchedCount) throw planChanged(stored.name);
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
          ...(exercise.superset ? { superset: exercise.superset } : {}),
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
          ...(exercise.superset ? { superset: exercise.superset } : {}),
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

type StoredExercise = TrainingPlan['workouts'][number]['exercises'][number];

/** A stored plan exercise as input, without Mongo's extras. */
export function toExerciseInput(exercise: StoredExercise) {
  return {
    id: exercise.id,
    exerciseId: exercise.exerciseId,
    ...(exercise.restSeconds != null ? { restSeconds: exercise.restSeconds } : {}),
    ...(exercise.note ? { note: exercise.note } : {}),
    ...(exercise.superset ? { superset: exercise.superset } : {}),
    targets: exercise.targets.map(toTarget),
  };
}

/** A day's exercises as a comparable string: what a revision tracks (the name is not part of it). */
function dayKey(exercises: readonly StoredExercise[]): string {
  return JSON.stringify(exercises.map(toExerciseInput));
}

/** Issue #15: the day was changed since the caller read it. */
export function planChanged(dayName: string) {
  return new ConflictException({
    code: 'PLAN_CHANGED',
    message: `${dayName} was changed since you opened it. Review it again.`,
  });
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
