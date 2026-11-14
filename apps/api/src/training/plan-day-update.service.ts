import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import type {
  Measure,
  PlanDayUpdateInput,
  PlanDayUpdatePreview,
  PlanDayUpdateResult,
  PlanInput,
} from '@life-portal/shared-types';
import { planDayUpdate, validatePlan, type PlanDayUpdateDiff } from '@life-portal/shared-domain';
import { PlansService, toExerciseInput, toTarget, type PlanRow } from './plans.service';
import { Exercise, WorkoutExercise, WorkoutSession, WorkoutSet } from './training.schemas';

type SessionRow = WorkoutSession & { _id: unknown; updatedAt?: Date };
type ExerciseRow = WorkoutExercise & { _id: unknown };
type SetRow = WorkoutSet & { _id: unknown };

interface Prepared {
  preview: PlanDayUpdatePreview;
  session: SessionRow;
  plan?: PlanRow;
  diff?: PlanDayUpdateDiff;
}

/**
 * Issue #15: offer to update the plan day a finished workout was started from, and apply it.
 * The change itself is `planDayUpdate` in the domain lib (a patch onto the day as it is now); this
 * reads the rows, decides whether it may be offered, and writes only that day of that plan.
 *
 * Nothing about the workout changes: its snapshots, `planned` copies, sets, records, ranks and
 * tournament entries stay as they are. The one thing written on the session is `planUpdate`,
 * which makes a repeated submit return the first result.
 */
@Injectable()
export class PlanDayUpdateService {
  constructor(
    @InjectModel(WorkoutSession.name) private readonly sessions: Model<WorkoutSession>,
    @InjectModel(WorkoutExercise.name) private readonly exercises: Model<WorkoutExercise>,
    @InjectModel(WorkoutSet.name) private readonly sets: Model<WorkoutSet>,
    @InjectModel(Exercise.name) private readonly catalogue: Model<Exercise>,
    private readonly plans: PlansService,
  ) {}

  async preview(userId: string, sessionId: string): Promise<PlanDayUpdatePreview> {
    return (await this.prepare(userId, sessionId)).preview;
  }

  async apply(userId: string, sessionId: string, input: PlanDayUpdateInput): Promise<PlanDayUpdateResult> {
    const { preview, session, plan, diff } = await this.prepare(userId, sessionId);
    if (session.planUpdate) return resultOf(session.planUpdate);
    if (preview.status !== 'available' || !plan || !diff || !session.plan) {
      throw new ConflictException({ code: 'NOTHING_TO_APPLY', message: preview.message ?? 'There is nothing to update.' });
    }
    if (preview.revision !== input.revision) {
      throw new ConflictException({
        code: 'PLAN_CHANGED',
        message: `${preview.workoutName ?? 'This day'} was changed since you opened it. Review it again.`,
      });
    }
    const workoutId = session.plan.planWorkoutId;
    let result: PlanDayUpdateResult;
    if (plan.userId) {
      await this.plans.replaceDay(userId, String(plan._id), workoutId, input.revision, diff.exercises);
      result = { planId: String(plan._id), planWorkoutId: workoutId, copied: false };
    } else {
      result = await this.applyToCopy(userId, plan, workoutId, input.requestId, diff);
    }
    await this.sessions.updateOne(
      { _id: session._id, userId, planUpdate: { $exists: false } },
      { $set: { planUpdate: { requestId: input.requestId, ...result, at: new Date() } } },
    );
    const stored = await this.sessions.findOne({ _id: session._id, userId }).select('planUpdate').lean<SessionRow>();
    return stored?.planUpdate ? resultOf(stored.planUpdate) : result;
  }

  /**
   * A ready-made plan cannot be edited, so the caller gets their own copy with this day updated.
   * `copy()` keeps the order of days and exercises, so ids map across by position. Retried with
   * the same `requestId`, `copy()` returns the copy already made; if its day was already updated
   * then, it is left alone.
   */
  private async applyToCopy(
    userId: string,
    plan: PlanRow,
    workoutId: string,
    requestId: string,
    diff: PlanDayUpdateDiff,
  ): Promise<PlanDayUpdateResult> {
    const copy = await this.plans.copy(userId, String(plan._id), requestId);
    const dayIndex = plan.workouts.findIndex((workout) => workout.id === workoutId);
    const source = plan.workouts[dayIndex];
    const target = copy.workouts[dayIndex];
    if (!source || !target) throw new NotFoundException(`Workout ${workoutId} not found in this plan`);
    const result = { planId: copy.id, planWorkoutId: target.id, copied: true };
    if (target.revision !== 0) return result;
    const ids = new Map(source.exercises.map((exercise, index) => [exercise.id, target.exercises[index]?.id]));
    const exercises = diff.exercises.map((exercise) => {
      if (exercise.id === undefined) return exercise;
      const id = ids.get(exercise.id);
      return id ? { ...exercise, id } : { ...exercise, id: undefined };
    });
    await this.plans.replaceDay(userId, copy.id, target.id, 0, exercises);
    return result;
  }

  private async prepare(userId: string, sessionId: string): Promise<Prepared> {
    if (!isValidObjectId(sessionId)) throw new NotFoundException(`Workout ${sessionId} not found`);
    const session = await this.sessions.findOne({ _id: sessionId, userId }).lean<SessionRow>();
    if (!session) throw new NotFoundException(`Workout ${sessionId} not found`);
    const empty = { changes: [], before: [], after: [] };
    if (!session.plan) {
      return { session, preview: { status: 'not_from_plan', ...empty } };
    }
    const named = {
      planId: session.plan.planId,
      planWorkoutId: session.plan.planWorkoutId,
      planName: session.plan.planName,
      workoutName: session.plan.workoutName,
    };
    if (session.planUpdate) {
      return { session, preview: { status: 'applied', ...named, applied: resultOf(session.planUpdate), ...empty } };
    }
    if (session.status !== 'finished') {
      return { session, preview: { status: 'open', ...named, ...empty } };
    }
    const plan = await this.plans.readable(userId, session.plan.planId).catch((error: unknown) => {
      if (error instanceof NotFoundException) return undefined;
      throw error;
    });
    const day = plan?.workouts.find((workout) => workout.id === session.plan?.planWorkoutId);
    if (!plan || plan.archived || !day) {
      return {
        session,
        preview: {
          status: 'missing',
          ...named,
          message: !plan || plan.archived ? 'That plan no longer exists.' : `${named.workoutName} is no longer in ${named.planName}.`,
          ...empty,
        },
      };
    }
    const current = { ...named, planName: plan.name, workoutName: day.name };

    const [rows, sets] = await Promise.all([
      this.exercises.find({ userId, sessionId }).sort({ order: 1 }).lean<ExerciseRow[]>(),
      this.sets.find({ userId, sessionId }).sort({ order: 1, loggedAt: 1 }).lean<SetRow[]>(),
    ]);
    const setsBy = new Map<string, SetRow[]>();
    for (const set of sets) setsBy.set(set.workoutExerciseId, [...(setsBy.get(set.workoutExerciseId) ?? []), set]);

    // Every exercise of the plan, not only this day's: the whole plan is validated below.
    const ids = [...new Set(plan.workouts.flatMap((workout) => workout.exercises.map((exercise) => exercise.exerciseId)))].filter(isValidObjectId);
    const found = await this.catalogue
      .find({ _id: { $in: ids }, $or: [{ userId: { $exists: false } }, { userId }] })
      .select('name measure')
      .lean<{ _id: unknown; name: string; measure: string }[]>();
    const catalogue = new Map(found.map((row) => [String(row._id), { name: row.name, measure: row.measure as Measure }]));

    const diff = planDayUpdate({
      day: day.exercises.map((exercise) => ({ ...toExerciseInput(exercise) })),
      lookup: (exerciseId) => catalogue.get(exerciseId),
      session: rows.map((row) => ({
        exerciseId: row.exerciseId,
        name: row.snapshot.name,
        measure: row.snapshot.measure as Measure,
        ...(row.planned ? { planExerciseId: row.planned.planExerciseId } : {}),
        ...(row.restSeconds != null ? { restSeconds: row.restSeconds } : {}),
        ...(row.superset ? { superset: row.superset } : {}),
        sets: (setsBy.get(String(row._id)) ?? []).map((set) => ({
          type: set.type,
          ...(set.reps != null ? { reps: set.reps } : {}),
          ...(set.durationSeconds != null ? { durationSeconds: set.durationSeconds } : {}),
          ...(set.distanceMeters != null ? { distanceMeters: set.distanceMeters } : {}),
        })),
      })),
      removed: session.removedPlanExerciseIds ?? [],
    });

    const revision = day.revision ?? 0;
    const editedSince =
      session.plan.revision !== undefined
        ? session.plan.revision !== revision
        : Boolean(plan.updatedAt && plan.updatedAt.getTime() > new Date(session.startedAt).getTime());
    const base = {
      ...current,
      ...(plan.userId ? {} : { shared: true }),
      revision,
      ...(editedSince ? { editedSince: true } : {}),
      changes: diff.changes,
      before: diff.before,
      after: diff.after,
    };
    if (!diff.changes.length) return { session, plan, diff, preview: { ...base, status: 'no_changes' } };

    // The whole plan with this day replaced must still be a valid plan (a superset split up, a
    // retired exercise): otherwise nothing is offered rather than a save that fails.
    const measures = new Map(catalogue);
    for (const row of rows) measures.set(row.exerciseId, { name: row.snapshot.name, measure: row.snapshot.measure as Measure });
    const proposed: PlanInput = {
      name: plan.name,
      workouts: plan.workouts.map((workout) => ({
        name: workout.name,
        exercises:
          workout.id === day.id
            ? diff.exercises
            : workout.exercises.map((exercise) => ({ ...toExerciseInput(exercise), targets: exercise.targets.map(toTarget) })),
      })),
    };
    const problems = validatePlan(proposed, (exerciseId) => measures.get(exerciseId)?.measure);
    if (problems.length) {
      return { session, plan, diff, preview: { ...base, status: 'invalid', message: problems[0].message } };
    }
    return { session, plan, diff, preview: { ...base, status: 'available' } };
  }
}

function resultOf(update: NonNullable<WorkoutSession['planUpdate']>): PlanDayUpdateResult {
  return { planId: update.planId, planWorkoutId: update.planWorkoutId, copied: update.copied };
}
