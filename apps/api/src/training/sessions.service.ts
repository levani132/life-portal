import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, type Model } from 'mongoose';
import {
  SET_VALUE_FIELDS,
  type EquipmentType,
  type Measure,
  type Muscle,
  type SessionDetail,
  type SessionExercise,
  type SessionListItem,
  type SessionPage,
  type SetInput,
  type SetPatch,
  type SetType,
  type WorkoutSet as WorkoutSetDto,
} from '@life-portal/shared-types';
import {
  isStaleSession,
  isValidRpe,
  sessionDurationSeconds,
  validateSetValues,
} from '@life-portal/shared-domain';
import { CatalogueService } from './catalogue.service';
import { MachinesService } from './machines.service';
import { WorkoutExercise, WorkoutSession, WorkoutSet } from './training.schemas';

type SessionRow = WorkoutSession & { _id: unknown };
type ExerciseRow = WorkoutExercise & { _id: unknown };
type SetRow = WorkoutSet & { _id: unknown };

const PAGE_SIZE = 20;

/** Mongo's duplicate-key error: a retried request or a race on a unique index. */
const isDuplicateKey = (error: unknown) =>
  (error as { code?: number } | null)?.code === 11000;

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
    private readonly machines: MachinesService,
  ) {}

  // ---------------------------------------------------------------- sessions

  async start(
    userId: string,
    input: { requestId: string; day: string },
    nowMs = Date.now(),
  ): Promise<SessionDetail> {
    const retried = await this.sessions.findOne({ userId, requestId: input.requestId }).lean<SessionRow>();
    if (retried) return this.detailOf(userId, retried, nowMs);
    const open = await this.sessions.findOne({ userId, status: 'open' }).lean<SessionRow>();
    if (open) return { ...(await this.detailOf(userId, open, nowMs)), resumed: true };
    try {
      const created = await this.sessions.create({
        userId,
        requestId: input.requestId,
        day: input.day,
        status: 'open',
        startedAt: new Date(nowMs),
      });
      return this.detailOf(userId, created.toObject() as SessionRow, nowMs);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Lost a race: the same request retried, or another device opened a session first.
      const winner =
        (await this.sessions.findOne({ userId, requestId: input.requestId }).lean<SessionRow>()) ??
        (await this.sessions.findOne({ userId, status: 'open' }).lean<SessionRow>());
      if (!winner) throw error;
      const detail = await this.detailOf(userId, winner, nowMs);
      return winner.requestId === input.requestId ? detail : { ...detail, resumed: true };
    }
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
    const endedAt = at === 'lastSet' ? lastSet.loggedAt : new Date(Math.max(nowMs, session.startedAt.getTime()));
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
    input: { requestId: string; exerciseId: string; machineId?: string },
  ): Promise<SessionExercise> {
    await this.ownedSession(userId, sessionId);
    const retried = await this.exercises.findOne({ userId, requestId: input.requestId }).lean<ExerciseRow>();
    if (retried) return this.toSessionExercise(retried, []);
    const exercise = await this.catalogue.readable(userId, input.exerciseId);
    const machine = input.machineId ? await this.machines.owned(userId, input.machineId) : undefined;
    const last = await this.exercises
      .findOne({ userId, sessionId })
      .sort({ order: -1 })
      .select('order')
      .lean<ExerciseRow>();
    try {
      const created = await this.exercises.create({
        userId,
        sessionId,
        requestId: input.requestId,
        order: (last?.order ?? -1) + 1,
        exerciseId: String(exercise._id),
        ...(machine ? { machineId: String(machine._id) } : {}),
        // The one deliberate copy: what the exercise was called and how it was measured when it
        // was done. Built here, never from the request.
        snapshot: {
          name: exercise.name,
          equipmentType: exercise.equipmentType,
          measure: exercise.measure,
          primaryMuscles: exercise.primaryMuscles,
          ...(machine ? { machineName: machine.name } : {}),
          ...(machine?.brand ? { machineBrand: machine.brand } : {}),
        },
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
    patch: { notes?: string; machineId?: string | null },
  ): Promise<SessionExercise> {
    const row = await this.ownedExercise(userId, sessionId, workoutExerciseId);
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    if (patch.notes !== undefined) {
      if (patch.notes.trim()) set['notes'] = patch.notes.trim();
      else unset['notes'] = 1;
    }
    if (patch.machineId !== undefined) {
      // Which machine was used is a correction the person may make later, so the machine part
      // of the snapshot is the one part a PATCH sets. The exercise part is never refreshed.
      if (patch.machineId === null) {
        Object.assign(unset, { machineId: 1, 'snapshot.machineName': 1, 'snapshot.machineBrand': 1 });
      } else {
        const machine = await this.machines.owned(userId, patch.machineId);
        set['machineId'] = String(machine._id);
        set['snapshot.machineName'] = machine.name;
        if (machine.brand) set['snapshot.machineBrand'] = machine.brand;
        else unset['snapshot.machineBrand'] = 1;
      }
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

  async removeExercise(
    userId: string,
    sessionId: string,
    workoutExerciseId: string,
  ): Promise<{ id: string; deleted: true }> {
    const row = await this.ownedExercise(userId, sessionId, workoutExerciseId);
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
  ): Promise<{ set: WorkoutSetDto }> {
    const parent = await this.ownedExercise(userId, sessionId, workoutExerciseId);
    const retried = await this.sets.findOne({ userId, requestId: input.requestId }).lean<SetRow>();
    if (retried) return { set: toSet(retried) };
    const values = pickValues(input);
    this.assertValid(parent.snapshot.measure as Measure, values, input.rpe);
    const last = await this.sets
      .findOne({ userId, workoutExerciseId })
      .sort({ order: -1 })
      .select('order')
      .lean<SetRow>();
    try {
      const created = await this.sets.create({
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
        loggedAt: new Date(nowMs),
      });
      return { set: toSet(created.toObject() as SetRow) };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const winner = await this.sets.findOne({ userId, requestId: input.requestId }).lean<SetRow>();
      if (!winner) throw error;
      return { set: toSet(winner) };
    }
  }

  /**
   * Corrects a set's own values. `null` clears an optional field. The parent exercise's snapshot
   * decides what is valid, and is never touched.
   */
  async updateSet(userId: string, setId: string, patch: SetPatch): Promise<{ set: WorkoutSetDto }> {
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
    return { set: toSet(updated ?? row) };
  }

  async removeSet(userId: string, setId: string): Promise<{ id: string; deleted: true }> {
    const row = await this.ownedSet(userId, setId);
    await this.sets.deleteOne({ _id: row._id, userId });
    return { id: setId, deleted: true };
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
    const previous = await this.previousSets(userId, id, session.startedAt, exercises);
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
      exercises: exercises.map((exercise) => ({
        ...this.toSessionExercise(
          exercise,
          sets.filter((set) => set.workoutExerciseId === String(exercise._id)),
        ),
        previous: previous.get(exercise.exerciseId),
      })),
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
    return {
      id: String(row._id),
      sessionId: row.sessionId,
      exerciseId: row.exerciseId,
      machineId: row.machineId,
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
    };
  }
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

function toSet(row: SetRow): WorkoutSetDto {
  return {
    id: String(row._id),
    workoutExerciseId: row.workoutExerciseId,
    exerciseId: row.exerciseId,
    order: row.order,
    type: row.type as SetType,
    reps: row.reps,
    weightGrams: row.weightGrams,
    assistGrams: row.assistGrams,
    durationSeconds: row.durationSeconds,
    distanceMeters: row.distanceMeters,
    rpe: row.rpe,
    restSeconds: row.restSeconds,
    loggedAt: row.loggedAt.toISOString(),
  };
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
