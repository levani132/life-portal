import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { assertFreeId, withId } from '../common/client-id';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Types, type Model } from 'mongoose';
import {
  SET_VALUE_FIELDS,
  type EquipmentType,
  type Measure,
  type Muscle,
  type PlanTarget,
  type PlannedExercise,
  type RecordKind,
  type SessionDetail,
  type SessionExercise,
  type SessionListItem,
  type SessionPage,
  type SetInput,
  type SetPatch,
  type WorkoutSet as WorkoutSetDto,
} from '@life-portal/shared-types';
import {
  isStaleSession,
  isValidRpe,
  openTargets,
  sessionDurationSeconds,
  validateSetValues,
} from '@life-portal/shared-domain';
import { CatalogueService } from './catalogue.service';
import { PlansService, toTarget } from './plans.service';
import { ProgressService } from './progress.service';
import { toSet, type SetRow } from './set-row';
import { plannedRowId } from './planned-row-id';
import { WorkoutExercise, WorkoutSession, WorkoutSet } from './training.schemas';

type SessionRow = WorkoutSession & { _id: unknown };
type SetResult = { set: WorkoutSetDto; records: RecordKind[] };
type ExerciseRow = WorkoutExercise & { _id: unknown };

const PAGE_SIZE = 20;

/** Mongo's duplicate-key error: a retried request or a race on a unique index. */
const isDuplicateKey = (error: unknown) =>
  (error as { code?: number } | null)?.code === 11000;

/** Spec 028: how far back a client-reported start may reach (a workout logged offline). */
export const MAX_CLIENT_BACKDATE_MS = 48 * 60 * 60 * 1000;

/**
 * Spec 028: a time the client reports (a workout or set done offline, sent later), clamped so it
 * is never in the future and never before `floorMs`. Absent or unreadable → now.
 */
export function clientTime(iso: string | undefined, floorMs: number, nowMs: number): Date {
  const parsed = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(parsed)) return new Date(nowMs);
  return new Date(Math.max(Math.min(parsed, nowMs), Math.min(floorMs, nowMs)));
}

/** Spec 028: refuses an id the client chose that any row already has, whoever owns it. */

/**
 * Workout sessions, the exercises in them and their sets (spec 020, user story 1).
 *
 * Invariants kept here, each with a test in `sessions.service.spec.ts`:
 * - At most one open session per person; starting again resumes it (index `one_open_session`).
 * - Every create carries a `requestId`; a retry returns the original row instead of a copy.
 * - An exercise's `snapshot` is built here from the catalogue, never accepted from a request and
 *   never refreshed; `exerciseId` cannot change.
 * - A set carries exactly the fields its exercise's measure allows (`validateSetValues`).
 *
 * Every query includes `userId`, so another person's ids answer 404.
 */
@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(WorkoutSession.name) private readonly sessions: Model<WorkoutSession>,
    @InjectModel(WorkoutExercise.name) private readonly exercises: Model<WorkoutExercise>,
    @InjectModel(WorkoutSet.name) private readonly sets: Model<WorkoutSet>,
    private readonly catalogue: CatalogueService,
    private readonly progress: ProgressService,
    @Optional() private readonly plans?: PlansService,
  ) {}

  // ---------------------------------------------------------------- sessions

  /**
   * The day of every finished workout, for profile badges (spec 022 US4). An open session does
   * not count; a finished one always has at least one set (`finish` refuses an empty one).
   */
  async finishedDays(userId: string): Promise<string[]> {
    const rows = await this.sessions
      .find({ userId, status: 'finished' })
      .select('day')
      .lean<{ day: string }[]>();
    return rows.map((row) => row.day);
  }

  /**
   * Starts a workout, empty or (spec 023) from a plan's workout. A plan start copies the
   * workout's exercises and targets onto the session (`planned`): suggestions are fixed here and
   * never follow later edits of the plan. An open session is resumed instead, with nothing added.
   */
  async start(
    userId: string,
    input: {
      requestId: string;
      day: string;
      planId?: string;
      planWorkoutId?: string;
      /** Spec 028: the id the client gave it (offline). */
      id?: string;
      /** Spec 028: when it really started (offline), clamped to the last 48 hours. */
      startedAt?: string;
    },
    nowMs = Date.now(),
  ): Promise<SessionDetail> {
    if (Boolean(input.planId) !== Boolean(input.planWorkoutId)) {
      throw new BadRequestException('Send both planId and planWorkoutId, or neither.');
    }
    const retried = await this.sessions.findOne({ userId, requestId: input.requestId }).lean<SessionRow>();
    if (retried) {
      await this.finishPlanStart(userId, retried);
      return this.detailOf(userId, retried, nowMs);
    }
    const open = await this.sessions.findOne({ userId, status: 'open' }).lean<SessionRow>();
    if (open && input.id) throw this.sessionConflict(open);
    if (open) return { ...(await this.detailOf(userId, open, nowMs)), resumed: true };
    await assertFreeId(this.sessions, input.id);
    const fromPlan = input.planId && input.planWorkoutId
      ? await this.planWorkout(userId, input.planId, input.planWorkoutId)
      : undefined;
    try {
      const created = await this.sessions.create({
        ...withId(input.id),
        userId,
        requestId: input.requestId,
        day: input.day,
        status: 'open',
        startedAt: input.startedAt ? clientTime(input.startedAt, nowMs - MAX_CLIENT_BACKDATE_MS, nowMs) : new Date(nowMs),
        ...(fromPlan
          ? {
              plan: {
                planId: String(fromPlan.plan._id),
                planWorkoutId: fromPlan.workout.id,
                planName: fromPlan.plan.name,
                workoutName: fromPlan.workout.name,
                // Issue #15: so a later "update this day" can say the day was edited since.
                revision: fromPlan.workout.revision ?? 0,
              },
            }
          : {}),
      });
      const row = created.toObject() as SessionRow;
      if (fromPlan) await this.addPlanned(userId, row, fromPlan.workout);
      return this.detailOf(userId, row, nowMs);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Lost a race: the same request retried, or another device opened a session first.
      const mine = await this.sessions.findOne({ userId, requestId: input.requestId }).lean<SessionRow>();
      const winner = mine ?? (await this.sessions.findOne({ userId, status: 'open' }).lean<SessionRow>());
      if (!winner) {
        if (input.id) throw new ConflictException({ code: 'ID_TAKEN', message: 'That id is already in use. Try again.' });
        throw error;
      }
      // Spec 028: a workout with its own id (made offline) is never folded into another one.
      if (!mine && input.id) throw this.sessionConflict(winner);
      const detail = await this.detailOf(userId, winner, nowMs);
      return winner.requestId === input.requestId ? detail : { ...detail, resumed: true };
    }
  }

  /**
   * Spec 028: a workout made offline (it has its own id) while another one is open, here or on
   * another device. Never merged and never resumed silently: the person chooses.
   */
  private sessionConflict(open: SessionRow) {
    return new ConflictException({
      code: 'SESSION_CONFLICT',
      message: 'Another workout is already open, probably on another device.',
      openSessionId: String(open._id),
    });
  }

  async current(userId: string, nowMs = Date.now()): Promise<SessionDetail | null> {
    const open = await this.sessions.findOne({ userId, status: 'open' }).lean<SessionRow>();
    return open ? this.detailOf(userId, open, nowMs) : null;
  }

  async detail(userId: string, id: string, nowMs = Date.now()): Promise<SessionDetail> {
    return this.detailOf(userId, await this.ownedSession(userId, id), nowMs);
  }

  async list(userId: string, cursor?: string): Promise<SessionPage> {
    const after = decodeCursor(cursor);
    const filter: Record<string, unknown> = { userId };
    if (after) {
      filter['$or'] = [
        { day: { $lt: after.day } },
        { day: after.day, startedAt: { $lt: new Date(after.startedAt) } },
      ];
    }
    const rows = await this.sessions
      .find(filter)
      .sort({ day: -1, startedAt: -1 })
      .limit(PAGE_SIZE + 1)
      .lean<SessionRow[]>();
    const page = rows.slice(0, PAGE_SIZE);
    const ids = page.map((row) => String(row._id));
    const [exercises, sets] = await Promise.all([
      this.exercises
        .find({ userId, sessionId: { $in: ids } })
        .sort({ order: 1 })
        .select('sessionId snapshot.name')
        .lean<ExerciseRow[]>(),
      this.sets
        .find({ userId, sessionId: { $in: ids } })
        .select('sessionId loggedAt')
        .lean<SetRow[]>(),
    ]);
    const sessions: SessionListItem[] = page.map((row) => {
      const id = String(row._id);
      const own = sets.filter((set) => set.sessionId === id);
      const lastSetAt = latest(own.map((set) => set.loggedAt));
      return {
        id,
        day: row.day,
        status: row.status as SessionListItem['status'],
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString(),
        durationSeconds: sessionDurationSeconds({
          startedAt: row.startedAt.toISOString(),
          endedAt: row.endedAt?.toISOString(),
          lastSetAt,
        }),
        exerciseNames: exercises
          .filter((exercise) => exercise.sessionId === id)
          .map((exercise) => exercise.snapshot.name),
        setCount: own.length,
        ...(row.plan ? { plan: { planName: row.plan.planName, workoutName: row.plan.workoutName } } : {}),
      };
    });
    const last = page[page.length - 1];
    return {
      sessions,
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? encodeCursor({ day: last.day, startedAt: last.startedAt.toISOString() })
          : undefined,
    };
  }

  async update(
    userId: string,
    id: string,
    patch: { day?: string; notes?: string },
    nowMs = Date.now(),
  ): Promise<SessionDetail> {
    const session = await this.ownedSession(userId, id);
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (patch.day !== undefined) set['day'] = patch.day;
    if (patch.notes !== undefined) {
      if (patch.notes.trim()) set['notes'] = patch.notes.trim();
      else unset['notes'] = 1;
    }
    if (Object.keys(set).length || Object.keys(unset).length) {
      await this.sessions.updateOne(
        { _id: session._id, userId },
        { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
        { runValidators: true },
      );
    }
    return this.detail(userId, id, nowMs);
  }

  /**
   * Finishes a session at now, or at its last set (for one left open by mistake). A session
   * with no sets cannot be finished: the client offers to discard it instead (story 1, #6).
   */
  async finish(
    userId: string,
    id: string,
    at: 'now' | 'lastSet' = 'now',
    nowMs = Date.now(),
    /** Spec 028: when it was really finished (offline); never before its last set. */
    endedAtIso?: string,
  ): Promise<SessionDetail> {
    const session = await this.ownedSession(userId, id);
    if (session.status === 'finished') return this.detailOf(userId, session, nowMs);
    const lastSet = await this.sets
      .findOne({ userId, sessionId: id })
      .sort({ loggedAt: -1 })
      .select('loggedAt')
      .lean<SetRow>();
    if (!lastSet) {
      throw new ConflictException({
        code: 'EMPTY_SESSION',
        message: 'This workout has no sets yet. Discard it instead?',
      });
    }
    await this.dropUnloggedPlanned(userId, id);
    const floor = Math.max(session.startedAt.getTime(), new Date(lastSet.loggedAt).getTime());
    const endedAt = endedAtIso
      ? clientTime(endedAtIso, floor, Math.max(nowMs, floor))
      : at === 'lastSet'
        ? lastSet.loggedAt
        : new Date(Math.max(nowMs, session.startedAt.getTime()));
    await this.sessions.updateOne(
      { _id: session._id, userId, status: 'open' },
      { $set: { status: 'finished', endedAt } },
    );
    return this.detail(userId, id, nowMs);
  }

  async remove(userId: string, id: string): Promise<{ id: string; deleted: true }> {
    const session = await this.ownedSession(userId, id);
    await this.sets.deleteMany({ userId, sessionId: id });
    await this.exercises.deleteMany({ userId, sessionId: id });
    await this.sessions.deleteOne({ _id: session._id, userId });
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------- exercises in a session

  async addExercise(
    userId: string,
    sessionId: string,
    input: { requestId: string; exerciseId: string; id?: string },
  ): Promise<SessionExercise> {
    await this.ownedSession(userId, sessionId);
    const retried = await this.exercises.findOne({ userId, requestId: input.requestId }).lean<ExerciseRow>();
    if (retried) return this.toSessionExercise(retried, []);
    await assertFreeId(this.exercises, input.id);
    const exercise = await this.catalogue.readable(userId, input.exerciseId);
    const last = await this.exercises
      .findOne({ userId, sessionId })
      .sort({ order: -1 })
      .select('order')
      .lean<ExerciseRow>();
    try {
      const created = await this.exercises.create({
        ...withId(input.id),
        userId,
        sessionId,
        requestId: input.requestId,
        order: (last?.order ?? -1) + 1,
        exerciseId: String(exercise._id),
        // The one deliberate copy: what the exercise was called and how it was measured when it
        // was done. Built here, never from the request.
        snapshot: snapshotOf(exercise),
      });
      return this.toSessionExercise(created.toObject() as ExerciseRow, []);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const winner = await this.exercises.findOne({ userId, requestId: input.requestId }).lean<ExerciseRow>();
      if (!winner) throw error;
      return this.toSessionExercise(winner, []);
    }
  }

  async updateExercise(
    userId: string,
    sessionId: string,
    workoutExerciseId: string,
    patch: { notes?: string; skipped?: boolean; restSeconds?: number | null; superset?: string | null },
  ): Promise<SessionExercise> {
    const row = await this.ownedExercise(userId, sessionId, workoutExerciseId);
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (patch.skipped !== undefined) {
      if (!row.planned) throw new BadRequestException('Only an exercise from a plan can be skipped.');
      if (patch.skipped) set['skipped'] = true;
      else unset['skipped'] = 1;
    }
    // Spec 025: what the person chose during this workout; `planned` is never touched.
    if (patch.restSeconds !== undefined) {
      if (patch.restSeconds === null) unset['restSeconds'] = 1;
      else set['restSeconds'] = patch.restSeconds;
    }
    if (patch.superset !== undefined) {
      if (patch.superset === null) unset['superset'] = 1;
      else set['superset'] = patch.superset;
    }
    if (patch.notes !== undefined) {
      if (patch.notes.trim()) set['notes'] = patch.notes.trim();
      else unset['notes'] = 1;
    }
    if (Object.keys(set).length || Object.keys(unset).length) {
      await this.exercises.updateOne(
        { _id: row._id, userId },
        { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      );
    }
    const [updated, sets] = await Promise.all([
      this.exercises.findOne({ _id: row._id, userId }).lean<ExerciseRow>(),
      this.sets.find({ userId, workoutExerciseId }).sort({ order: 1, loggedAt: 1 }).lean<SetRow[]>(),
    ]);
    return this.toSessionExercise(updated ?? row, sets);
  }

  /** The full id array in the new order, as boards and the cheat queue do. */
  async reorderExercises(userId: string, sessionId: string, ids: string[]): Promise<string[]> {
    await this.ownedSession(userId, sessionId);
    const rows = await this.exercises.find({ userId, sessionId }).select('_id').lean<ExerciseRow[]>();
    const current = new Set(rows.map((row) => String(row._id)));
    if (ids.length !== current.size || new Set(ids).size !== ids.length || !ids.every((id) => current.has(id))) {
      throw new BadRequestException('Send every exercise in this workout exactly once.');
    }
    await this.exercises.bulkWrite(
      ids.map((id, order) => ({
        updateOne: { filter: { _id: id, userId, sessionId }, update: { $set: { order } } },
      })),
    );
    return ids;
  }

  /**
   * Spec 023: replaces an exercise that has no sets yet with another, in the same place. A new
   * row, with a new snapshot, because `exerciseId` is never editable. The plan's targets carry
   * over when the measure is the same; otherwise the same number of empty sets remain.
   */
  async swapExercise(
    userId: string,
    sessionId: string,
    workoutExerciseId: string,
    input: { requestId: string; exerciseId: string; id?: string },
  ): Promise<SessionExercise> {
    await this.ownedSession(userId, sessionId);
    const retried = await this.exercises.findOne({ userId, requestId: input.requestId }).lean<ExerciseRow>();
    if (retried) return this.toSessionExercise(retried, []);
    const row = await this.ownedExercise(userId, sessionId, workoutExerciseId);
    await assertFreeId(this.exercises, input.id);
    if (await this.sets.exists({ userId, workoutExerciseId })) {
      throw new ConflictException({
        code: 'HAS_SETS',
        message: 'This exercise already has sets. Add the other exercise instead.',
      });
    }
    const exercise = await this.catalogue.readable(userId, input.exerciseId);
    const planned = row.planned
      ? {
          planExerciseId: row.planned.planExerciseId,
          ...(row.planned.restSeconds != null ? { restSeconds: row.planned.restSeconds } : {}),
          ...(row.planned.note ? { note: row.planned.note } : {}),
          targets:
            exercise.measure === row.snapshot.measure
              ? row.planned.targets.map(toTarget)
              : row.planned.targets.map((target) => ({ type: target.type ?? 'working' })),
        }
      : undefined;
    let created: ExerciseRow;
    try {
      created = (
        await this.exercises.create({
          ...withId(input.id),
          userId,
          sessionId,
          requestId: input.requestId,
          order: row.order,
          exerciseId: String(exercise._id),
          snapshot: snapshotOf(exercise),
          ...(planned ? { planned } : {}),
          // A swap keeps the exercise's place: its superset and the rest chosen for it.
          ...(row.restSeconds != null ? { restSeconds: row.restSeconds } : {}),
          ...(row.superset ? { superset: row.superset } : {}),
        })
      ).toObject() as ExerciseRow;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const winner = await this.exercises.findOne({ userId, requestId: input.requestId }).lean<ExerciseRow>();
      if (!winner) throw error;
      return this.toSessionExercise(winner, []);
    }
    await this.exercises.deleteOne({ _id: row._id, userId });
    return this.toSessionExercise(created, []);
  }

  async removeExercise(
    userId: string,
    sessionId: string,
    workoutExerciseId: string,
  ): Promise<{ id: string; deleted: true }> {
    const row = await this.ownedExercise(userId, sessionId, workoutExerciseId);
    // Issue #15: a plan exercise removed on purpose, as opposed to one left undone (finishing drops
    // those too). Recorded first, so a retried delete still records it.
    if (row.planned) {
      await this.sessions.updateOne(
        { _id: sessionId, userId },
        { $addToSet: { removedPlanExerciseIds: row.planned.planExerciseId } },
      );
    }
    await this.sets.deleteMany({ userId, workoutExerciseId });
    await this.exercises.deleteOne({ _id: row._id, userId });
    return { id: workoutExerciseId, deleted: true };
  }

  // ---------------------------------------------------------------- sets

  async addSet(
    userId: string,
    sessionId: string,
    workoutExerciseId: string,
    input: SetInput,
    nowMs = Date.now(),
  ): Promise<SetResult> {
    const parent = await this.ownedExercise(userId, sessionId, workoutExerciseId);
    const retried = await this.sets.findOne({ userId, requestId: input.requestId }).lean<SetRow>();
    if (retried) return this.withRecords(userId, parent, retried);
    await assertFreeId(this.sets, input.id);
    const values = pickValues(input);
    this.assertValid(parent.snapshot.measure as Measure, values, input.rpe);
    const last = await this.sets
      .findOne({ userId, workoutExerciseId })
      .sort({ order: -1 })
      .select('order')
      .lean<SetRow>();
    try {
      // Spec 028: a set logged offline keeps the time it was done, within its workout.
      const loggedAt = input.loggedAt
        ? clientTime(input.loggedAt, (await this.ownedSession(userId, sessionId)).startedAt.getTime(), nowMs)
        : new Date(nowMs);
      const created = await this.sets.create({
        ...withId(input.id),
        userId,
        sessionId,
        workoutExerciseId,
        exerciseId: parent.exerciseId,
        requestId: input.requestId,
        order: (last?.order ?? -1) + 1,
        type: input.type ?? 'working',
        ...values,
        ...(input.rpe != null ? { rpe: input.rpe } : {}),
        ...(input.restSeconds != null ? { restSeconds: input.restSeconds } : {}),
        loggedAt,
      });
      return this.withRecords(userId, parent, created.toObject() as SetRow);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const winner = await this.sets.findOne({ userId, requestId: input.requestId }).lean<SetRow>();
      if (!winner) throw error;
      return this.withRecords(userId, parent, winner);
    }
  }

  /** A set response with the records it holds (computed on read, contract `{set, records}`). */
  private async withRecords(userId: string, parent: ExerciseRow, row: SetRow): Promise<SetResult> {
    const { records, effectiveLoad } = await this.progress.figuresForSet(
      userId,
      parent.exerciseId,
      parent.snapshot.measure as Measure,
      String(row._id),
    );
    return { set: { ...toSet(row), records, ...(effectiveLoad ? { effectiveLoad } : {}) }, records };
  }

  /**
   * Corrects a set's own values. `null` clears an optional field. The parent exercise's snapshot
   * decides what is valid, and is never touched.
   */
  async updateSet(userId: string, setId: string, patch: SetPatch): Promise<SetResult> {
    const row = await this.ownedSet(userId, setId);
    const parent = await this.exercises.findOne({ _id: row.workoutExerciseId, userId }).lean<ExerciseRow>();
    if (!parent) throw new NotFoundException(`Set ${setId} not found`);
    const merged = { ...pickValues(row), ...pickValues(patch, true) };
    const rpe = patch.rpe === undefined ? row.rpe : (patch.rpe ?? undefined);
    this.assertValid(parent.snapshot.measure as Measure, merged, rpe);
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    for (const field of [...SET_VALUE_FIELDS, 'rpe', 'restSeconds', 'type'] as const) {
      if (!(field in patch)) continue;
      const value = patch[field as keyof SetPatch];
      if (value === null || value === undefined) unset[field] = 1;
      else set[field] = value;
    }
    if ('type' in unset) delete unset['type'];
    if (Object.keys(set).length || Object.keys(unset).length) {
      await this.sets.updateOne(
        { _id: row._id, userId },
        { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
        { runValidators: true },
      );
    }
    const updated = await this.sets.findOne({ _id: row._id, userId }).lean<SetRow>();
    return this.withRecords(userId, parent, updated ?? row);
  }

  async removeSet(userId: string, setId: string): Promise<{ id: string; deleted: true }> {
    const row = await this.ownedSet(userId, setId);
    await this.sets.deleteOne({ _id: row._id, userId });
    return { id: setId, deleted: true };
  }

  // ---------------------------------------------------------------- plan starts (spec 023)

  /** The plan (shared or the caller's) and its workout, or 404; 400 when it has no exercises. */
  private async planWorkout(userId: string, planId: string, planWorkoutId: string) {
    if (!this.plans) throw new NotFoundException(`Plan ${planId} not found`);
    const plan = await this.plans.readable(userId, planId);
    const workout = plan.workouts.find((candidate) => candidate.id === planWorkoutId);
    if (!workout) throw new NotFoundException(`Workout ${planWorkoutId} not found in this plan`);
    if (!workout.exercises.length) {
      throw new BadRequestException({
        code: 'EMPTY_WORKOUT',
        message: 'This workout has no exercises yet. Add some to the plan first.',
      });
    }
    return { plan, workout };
  }

  /**
   * One workout exercise per planned exercise, with its targets copied. Each row's `requestId` is
   * derived from the session's, so a retried start fills in what is missing and never doubles.
   */
  private async addPlanned(
    userId: string,
    session: SessionRow,
    workout: {
      exercises: { id: string; exerciseId: string; restSeconds?: number; note?: string; superset?: string; targets: PlanTarget[] }[];
    },
  ) {
    const sessionId = String(session._id);
    const exercises = await Promise.all(
      workout.exercises.map((planned) =>
        this.catalogue.readable(userId, planned.exerciseId, { includeArchived: true }),
      ),
    );
    for (const [order, planned] of workout.exercises.entries()) {
      const exercise = exercises[order];
      try {
        await this.exercises.create({
          // Spec 028: derived, so a device that started this workout offline already knows it.
          _id: new Types.ObjectId(plannedRowId(session.requestId, planned.id)),
          userId,
          sessionId,
          requestId: `${session.requestId}:${planned.id}`,
          order,
          exerciseId: String(exercise._id),
          snapshot: snapshotOf(exercise),
          planned: {
            planExerciseId: planned.id,
            ...(planned.restSeconds != null ? { restSeconds: planned.restSeconds } : {}),
            ...(planned.note ? { note: planned.note } : {}),
            targets: planned.targets.map(toTarget),
          },
          // Spec 025: the superset is copied like the targets, but the person may change it.
          ...(planned.superset ? { superset: planned.superset } : {}),
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }
  }

  /** A retried plan start whose first attempt died before adding its exercises. */
  private async finishPlanStart(userId: string, session: SessionRow) {
    if (!session.plan || session.status !== 'open') return;
    if (await this.exercises.exists({ userId, sessionId: String(session._id) })) return;
    try {
      const { workout } = await this.planWorkout(userId, session.plan.planId, session.plan.planWorkoutId);
      await this.addPlanned(userId, session, workout);
    } catch {
      // The plan changed or went away in between: the workout stays as it is.
    }
  }

  /** On finish, planned exercises with nothing logged are not part of the workout (FR-016). */
  private async dropUnloggedPlanned(userId: string, sessionId: string) {
    const planned = await this.exercises
      .find({ userId, sessionId, planned: { $exists: true } })
      .select('_id')
      .lean<ExerciseRow[]>();
    if (!planned.length) return;
    const logged = new Set(
      (await this.sets.distinct('workoutExerciseId', { userId, sessionId })).map(String),
    );
    const unlogged = planned.map((row) => String(row._id)).filter((id) => !logged.has(id));
    if (unlogged.length) await this.exercises.deleteMany({ userId, sessionId, _id: { $in: unlogged } });
  }

  // ---------------------------------------------------------------- helpers

  private assertValid(measure: Measure, values: Record<string, number | undefined>, rpe?: number) {
    const problem = validateSetValues(measure, values);
    if (problem) throw new BadRequestException(problem);
    if (rpe != null && !isValidRpe(rpe)) {
      throw new BadRequestException('RPE must be between 1 and 10, in half steps.');
    }
  }

  private async ownedSession(userId: string, id: string): Promise<SessionRow> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Workout ${id} not found`);
    const row = await this.sessions.findOne({ _id: id, userId }).lean<SessionRow>();
    if (!row) throw new NotFoundException(`Workout ${id} not found`);
    return row;
  }

  private async ownedExercise(userId: string, sessionId: string, id: string): Promise<ExerciseRow> {
    if (!isValidObjectId(sessionId) || !isValidObjectId(id)) {
      throw new NotFoundException(`Exercise ${id} not found in this workout`);
    }
    const row = await this.exercises.findOne({ _id: id, userId, sessionId }).lean<ExerciseRow>();
    if (!row) throw new NotFoundException(`Exercise ${id} not found in this workout`);
    return row;
  }

  private async ownedSet(userId: string, id: string): Promise<SetRow> {
    if (!isValidObjectId(id)) throw new NotFoundException(`Set ${id} not found`);
    const row = await this.sets.findOne({ _id: id, userId }).lean<SetRow>();
    if (!row) throw new NotFoundException(`Set ${id} not found`);
    return row;
  }

  private async detailOf(userId: string, session: SessionRow, nowMs: number): Promise<SessionDetail> {
    const id = String(session._id);
    const [exercises, sets] = await Promise.all([
      this.exercises.find({ userId, sessionId: id }).sort({ order: 1 }).lean<ExerciseRow[]>(),
      this.sets.find({ userId, sessionId: id }).sort({ order: 1, loggedAt: 1 }).lean<SetRow[]>(),
    ]);
    const [previous, progress] = await Promise.all([
      this.previousSets(userId, id, session.startedAt, exercises),
      this.progress.load(
        userId,
        exercises.map((exercise) => ({ exerciseId: exercise.exerciseId, measure: exercise.snapshot.measure as Measure })),
      ),
    ]);
    const lastSetAt = latest(sets.map((set) => set.loggedAt));
    const startedAt = session.startedAt.toISOString();
    const status = session.status as SessionDetail['status'];
    return {
      id,
      day: session.day,
      status,
      startedAt,
      endedAt: session.endedAt?.toISOString(),
      notes: session.notes,
      durationSeconds: sessionDurationSeconds({ startedAt, endedAt: session.endedAt?.toISOString(), lastSetAt }),
      isStale: isStaleSession({ status, startedAt, lastSetAt }, nowMs),
      lastSetAt,
      ...(session.plan ? { plan: toSessionPlan(session.plan) } : {}),
      exercises: exercises.map((exercise) => {
        const own = progress.get(`${exercise.exerciseId}:${exercise.snapshot.measure}`);
        const item = this.toSessionExercise(
          exercise,
          sets.filter((set) => set.workoutExerciseId === String(exercise._id)),
        );
        return {
          ...item,
          sets: item.sets.map((set) => ({
            ...set,
            records: own?.marks.get(set.id) ?? [],
            ...ProgressService.loadField(own, set.id),
          })),
          previous: previous.get(exercise.exerciseId),
          oneRepMax: ProgressService.sessionOneRepMax(own, id),
        };
      }),
    };
  }

  /**
   * For each exercise, the person's sets of it from their most recent session that started
   * before this one: what "last time" means beside a set row.
   */
  private async previousSets(
    userId: string,
    sessionId: string,
    before: Date,
    exercises: ExerciseRow[],
  ): Promise<Map<string, SessionExercise['previous']>> {
    const result = new Map<string, SessionExercise['previous']>();
    const exerciseIds = [...new Set(exercises.map((exercise) => exercise.exerciseId))];
    await Promise.all(
      exerciseIds.map(async (exerciseId) => {
        const latestSet = await this.sets
          .findOne({ userId, exerciseId, sessionId: { $ne: sessionId }, loggedAt: { $lt: before } })
          .sort({ loggedAt: -1 })
          .select('sessionId')
          .lean<SetRow>();
        if (!latestSet) return;
        const [session, sets] = await Promise.all([
          this.sessions.findOne({ _id: latestSet.sessionId, userId }).select('day').lean<SessionRow>(),
          this.sets
            .find({ userId, exerciseId, sessionId: latestSet.sessionId })
            .sort({ order: 1, loggedAt: 1 })
            .lean<SetRow[]>(),
        ]);
        if (!session) return;
        result.set(exerciseId, { sessionId: latestSet.sessionId, day: session.day, sets: sets.map(toSet) });
      }),
    );
    return result;
  }

  private toSessionExercise(row: ExerciseRow, sets: SetRow[]): SessionExercise {
    const planned: PlannedExercise | undefined = row.planned
      ? {
          planExerciseId: row.planned.planExerciseId,
          ...(row.planned.restSeconds != null ? { restSeconds: row.planned.restSeconds } : {}),
          ...(row.planned.note ? { note: row.planned.note } : {}),
          targets: row.planned.targets.map(toTarget),
        }
      : undefined;
    return {
      id: String(row._id),
      sessionId: row.sessionId,
      exerciseId: row.exerciseId,
      // Legacy (before #14): read back as logged, never written any more.
      ...(row.machineId ? { machineId: row.machineId } : {}),
      order: row.order,
      snapshot: {
        name: row.snapshot.name,
        equipmentType: row.snapshot.equipmentType as EquipmentType,
        measure: row.snapshot.measure as Measure,
        primaryMuscles: row.snapshot.primaryMuscles as Muscle[],
        machineName: row.snapshot.machineName,
        machineBrand: row.snapshot.machineBrand,
      },
      notes: row.notes,
      sets: sets.map(toSet),
      ...(planned ? { planned } : {}),
      skipped: Boolean(row.skipped),
      openTargets: openTargets(planned, sets.length, Boolean(row.skipped)),
      ...(row.restSeconds != null ? { restSeconds: row.restSeconds } : {}),
      ...(row.superset ? { superset: row.superset } : {}),
    };
  }
}

/**
 * What an exercise was when it was added to a workout. Built here, never from a request. Since #14
 * there is no machine part: the exercise's name says its equipment. Rows logged earlier keep
 * their `machineName`/`machineBrand` as history.
 */
function snapshotOf(exercise: { name: string; equipmentType: string; measure: string; primaryMuscles: string[] }) {
  return {
    name: exercise.name,
    equipmentType: exercise.equipmentType,
    measure: exercise.measure,
    primaryMuscles: exercise.primaryMuscles,
  };
}

function toSessionPlan(plan: NonNullable<SessionRow['plan']>) {
  return {
    planId: plan.planId,
    planWorkoutId: plan.planWorkoutId,
    planName: plan.planName,
    workoutName: plan.workoutName,
  };
}

/** The value fields of a set or request. With `keepNull`, `null` survives to mean "clear it". */
function pickValues(
  source: Partial<Record<(typeof SET_VALUE_FIELDS)[number], number | null | undefined>>,
  keepNull = false,
): Record<string, number | undefined> {
  const values: Record<string, number | undefined> = {};
  for (const field of SET_VALUE_FIELDS) {
    if (!(field in source)) continue;
    const value = source[field];
    if (value === undefined) continue;
    if (value === null) {
      if (keepNull) values[field] = undefined;
      continue;
    }
    values[field] = value;
  }
  return values;
}


function latest(dates: Date[]): string | undefined {
  if (!dates.length) return undefined;
  return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function encodeCursor(position: { day: string; startedAt: string }): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

function decodeCursor(cursor?: string): { day: string; startedAt: string } | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      day?: unknown;
      startedAt?: unknown;
    };
    if (
      typeof parsed.day === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.day) &&
      typeof parsed.startedAt === 'string' &&
      !Number.isNaN(Date.parse(parsed.startedAt))
    ) {
      return { day: parsed.day, startedAt: parsed.startedAt };
    }
  } catch {
    // fall through
  }
  throw new BadRequestException('Invalid cursor');
}
