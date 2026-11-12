import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type {
  ExerciseHistory,
  ExerciseHistorySession,
  Measure,
  OneRepMaxEstimate,
  RecordKind,
  SetType,
} from '@life-portal/shared-types';
import {
  bestOneRepMax,
  bestSetOf,
  bodyWeightOn,
  effectiveLoadGrams,
  personalRecords,
  sessionVolumeGrams,
  type BodyWeight,
  type ProgressSet,
} from '@life-portal/shared-domain';
import { NutritionService } from '../nutrition/nutrition.service';
import { CatalogueService } from './catalogue.service';
import { toSet, type SetRow } from './set-row';
import { WorkoutExercise, WorkoutSession, WorkoutSet } from './training.schemas';

type SessionRow = WorkoutSession & { _id: unknown };
type SetLoad = { grams: number; bodyWeightDay: string };
type ExerciseRow = WorkoutExercise & { _id: unknown };

/** History pages: 20 sessions. */
export const HISTORY_PAGE_SIZE = 20;

const NEEDS_BODY_WEIGHT = new Set<Measure>(['bodyweight_reps', 'assisted_reps']);

/** One exercise's sets in the order they were done, ready for the pure progress functions. */
export interface ExerciseProgress {
  measure: Measure;
  /** In done order: session day, session start, set order. */
  sets: ProgressSet[];
  byId: Map<string, ProgressSet>;
  rows: Map<string, SetRow>;
  sessions: Map<string, { day: string; startedAt: Date }>;
  marks: Map<string, RecordKind[]>;
}

/**
 * Progress for spec 020 US3: per-exercise history, records and labelled 1RM estimates. Nothing
 * here is stored (principle 3): every figure is recomputed from `workout_sets` on read, so a
 * corrected or deleted set moves every record at once. Body weight comes from Nutrition's
 * `weighInsUpTo` (principle 4); a set never carries one.
 *
 * Only sets logged under the exercise's current measure count: a shared catalogue row's measure
 * could change in a catalogue version, and past sets keep the measure in their snapshot.
 */
@Injectable()
export class ProgressService {
  constructor(
    @InjectModel(WorkoutSession.name) private readonly sessions: Model<WorkoutSession>,
    @InjectModel(WorkoutExercise.name) private readonly workoutExercises: Model<WorkoutExercise>,
    @InjectModel(WorkoutSet.name) private readonly sets: Model<WorkoutSet>,
    private readonly catalogue: CatalogueService,
    private readonly nutrition: NutritionService,
  ) {}

  /**
   * Every set of each `(exerciseId, measure)` the caller logged, in done order, with body weight
   * where the measure needs it, and the record marks. A few queries for any number of exercises.
   */
  async load(
    userId: string,
    wanted: { exerciseId: string; measure: Measure }[],
  ): Promise<Map<string, ExerciseProgress>> {
    const result = new Map<string, ExerciseProgress>();
    if (!wanted.length) return result;
    const exerciseIds = [...new Set(wanted.map((item) => item.exerciseId))];
    const [workoutExercises, rows] = await Promise.all([
      this.workoutExercises
        .find({ userId, exerciseId: { $in: exerciseIds } })
        .select('_id snapshot.measure')
        .lean<ExerciseRow[]>(),
      this.sets.find({ userId, exerciseId: { $in: exerciseIds } }).lean<SetRow[]>(),
    ]);
    const measureOf = new Map(workoutExercises.map((row) => [String(row._id), row.snapshot?.measure as Measure]));
    const sessionIds = [...new Set(rows.map((row) => row.sessionId))];
    const sessionRows = sessionIds.length
      ? await this.sessions
          .find({ userId, _id: { $in: sessionIds } })
          .select('day startedAt')
          .lean<SessionRow[]>()
      : [];
    const sessions = new Map(sessionRows.map((row) => [String(row._id), { day: row.day, startedAt: row.startedAt }]));
    const latestDay = sessionRows.reduce((max, row) => (row.day > max ? row.day : max), '');
    const weighIns: BodyWeight[] =
      latestDay && wanted.some((item) => NEEDS_BODY_WEIGHT.has(item.measure))
        ? await this.nutrition.weighInsUpTo(userId, latestDay)
        : [];

    for (const { exerciseId, measure } of wanted) {
      // Each set paired with its session; a set whose session is gone is not progress.
      const mine = rows.flatMap((row) => {
        const session = sessions.get(row.sessionId);
        return row.exerciseId === exerciseId && measureOf.get(row.workoutExerciseId) === measure && session
          ? [{ row, session }]
          : [];
      });
      mine.sort(
        (a, b) =>
          a.session.day.localeCompare(b.session.day) ||
          a.session.startedAt.getTime() - b.session.startedAt.getTime() ||
          a.row.sessionId.localeCompare(b.row.sessionId) ||
          a.row.order - b.row.order ||
          a.row.loggedAt.getTime() - b.row.loggedAt.getTime(),
      );
      const sets = mine.map(({ row, session }): ProgressSet => ({
        id: String(row._id),
        sessionId: row.sessionId,
        day: session.day,
        type: row.type as SetType,
        reps: row.reps,
        weightGrams: row.weightGrams,
        assistGrams: row.assistGrams,
        durationSeconds: row.durationSeconds,
        distanceMeters: row.distanceMeters,
        body: NEEDS_BODY_WEIGHT.has(measure) ? bodyWeightOn(weighIns, session.day) : undefined,
      }));
      result.set(`${exerciseId}:${measure}`, {
        measure,
        sets,
        byId: new Map(sets.map((set) => [set.id, set])),
        rows: new Map(mine.map(({ row }) => [String(row._id), row])),
        sessions,
        marks: personalRecords(measure, sets).marks,
      });
    }
    return result;
  }

  /** The record kinds one set holds and its effective load, for a set create or update response. */
  async figuresForSet(
    userId: string,
    exerciseId: string,
    measure: Measure,
    setId: string,
  ): Promise<{ records: RecordKind[]; effectiveLoad?: SetLoad }> {
    const progress = (await this.load(userId, [{ exerciseId, measure }])).get(`${exerciseId}:${measure}`);
    return { records: progress?.marks.get(setId) ?? [], ...ProgressService.loadField(progress, setId) };
  }

  /**
   * `{effectiveLoad}` for a bodyweight or assisted set with a weigh-in on or before its day, else
   * `{}`: a plain weight × reps set's load is its weight, and without a weigh-in there is none.
   */
  static loadField(progress: ExerciseProgress | undefined, setId: string): { effectiveLoad?: SetLoad } {
    if (!progress || !NEEDS_BODY_WEIGHT.has(progress.measure)) return {};
    const set = progress.byId.get(setId);
    const load = set && effectiveLoadGrams(progress.measure, set, set.body);
    return load?.bodyWeightDay ? { effectiveLoad: { grams: load.grams, bodyWeightDay: load.bodyWeightDay } } : {};
  }

  /** The best estimate among one session's sets of an exercise. */
  static sessionOneRepMax(progress: ExerciseProgress | undefined, sessionId: string): OneRepMaxEstimate | undefined {
    if (!progress) return undefined;
    return bestOneRepMax(progress.measure, progress.sets.filter((set) => set.sessionId === sessionId));
  }

  /**
   * One exercise's history: sessions newest first, 20 a page, each with its sets, best set, volume
   * and 1RM estimate; records over every set ever, not just the page.
   */
  async history(userId: string, exerciseId: string, before?: string): Promise<ExerciseHistory> {
    const exercise = await this.catalogue.get(userId, exerciseId);
    const cursor = before ? decodeCursor(before) : undefined;
    const progress = (await this.load(userId, [{ exerciseId: exercise.id, measure: exercise.measure }])).get(
      `${exercise.id}:${exercise.measure}`,
    );
    const allSets = progress?.sets ?? [];
    const measure = exercise.measure;
    const { best } = personalRecords(measure, allSets);

    const bySession = new Map<string, { day: string; startedAt: Date; sessionId: string; sets: ProgressSet[] }>();
    for (const set of allSets) {
      const meta = progress?.sessions.get(set.sessionId);
      if (!meta) continue;
      const group = bySession.get(set.sessionId) ?? { ...meta, sessionId: set.sessionId, sets: [] };
      group.sets.push(set);
      bySession.set(set.sessionId, group);
    }
    const ordered = [...bySession.values()]
      .sort((a, b) => b.day.localeCompare(a.day) || b.startedAt.getTime() - a.startedAt.getTime() || b.sessionId.localeCompare(a.sessionId))
      .filter((item) => !cursor || isBefore(item, cursor));
    const page = ordered.slice(0, HISTORY_PAGE_SIZE);
    const sessions: ExerciseHistorySession[] = page.map((group) => ({
      sessionId: group.sessionId,
      day: group.day,
      sets: group.sets.flatMap((set) => {
        const row = progress?.rows.get(set.id);
        return row
          ? [{ ...toSet(row), records: progress?.marks.get(set.id) ?? [], ...ProgressService.loadField(progress, set.id) }]
          : [];
      }),
      bestSetId: bestSetOf(measure, group.sets),
      volumeGrams: sessionVolumeGrams(measure, group.sets),
      oneRepMax: bestOneRepMax(measure, group.sets),
    }));
    const last = page[page.length - 1];
    return {
      exercise: {
        id: exercise.id,
        name: exercise.name,
        primaryMuscles: exercise.primaryMuscles,
        equipmentType: exercise.equipmentType,
        measure: exercise.measure,
        isOwn: exercise.isOwn,
      },
      sessions,
      records: best,
      nextCursor:
        ordered.length > HISTORY_PAGE_SIZE && last
          ? encodeCursor({ day: last.day, startedAt: last.startedAt.toISOString(), sessionId: last.sessionId })
          : undefined,
    };
  }
}

interface Cursor {
  day: string;
  startedAt: string;
  sessionId: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(text: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')) as Cursor;
    if (typeof parsed.day === 'string' && typeof parsed.startedAt === 'string' && typeof parsed.sessionId === 'string') {
      return parsed;
    }
  } catch {
    // fall through
  }
  throw new BadRequestException('That page link is not valid any more. Reload the history.');
}

/** Strictly older than the cursor in newest-first order. */
function isBefore(item: { day: string; startedAt: Date; sessionId: string }, cursor: Cursor): boolean {
  if (item.day !== cursor.day) return item.day < cursor.day;
  const a = item.startedAt.getTime();
  const b = Date.parse(cursor.startedAt);
  if (a !== b) return a < b;
  return item.sessionId < cursor.sessionId;
}
