import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { Measure, RecordEntry, TrainingSummary } from '@life-portal/shared-types';
import {
  RECENT_RECORD_DAYS,
  addDays,
  recordEntryFor,
  sessionDurationSeconds,
  weekSummary,
} from '@life-portal/shared-domain';
import { TrainingProfileService } from './profile.service';
import { ProgressService } from './progress.service';
import { WorkoutExercise, WorkoutSession, WorkoutSet } from './training.schemas';

type SessionRow = WorkoutSession & { _id: unknown };
type ExerciseRow = WorkoutExercise & { _id: unknown };
type SetRow = WorkoutSet & { _id: unknown };

/**
 * The Home card's figures (spec 020 US4, research R11): workouts and time this week, then the
 * newest personal record within 14 days or days since the last workout, and the open session.
 * All derived on read; the arithmetic is `weekSummary` in the domain lib. `today` is the
 * person's day, sent by the browser like every dashboard read.
 */
@Injectable()
export class TrainingSummaryService {
  constructor(
    @InjectModel(WorkoutSession.name) private readonly sessions: Model<WorkoutSession>,
    @InjectModel(WorkoutExercise.name) private readonly workoutExercises: Model<WorkoutExercise>,
    @InjectModel(WorkoutSet.name) private readonly sets: Model<WorkoutSet>,
    private readonly progress: ProgressService,
    private readonly profiles: TrainingProfileService,
  ) {}

  async summary(userId: string, today: string): Promise<TrainingSummary> {
    // 14 days covers this week (at most 7) and the record window.
    const since = addDays(today, -(RECENT_RECORD_DAYS - 1));
    const [recent, last, open, profile] = await Promise.all([
      this.sessions.find({ userId, day: { $gte: since } }).lean<SessionRow[]>(),
      this.sessions.findOne({ userId, day: { $lte: today } }).sort({ day: -1, startedAt: -1 }).lean<SessionRow>(),
      this.sessions.findOne({ userId, status: 'open' }).lean<SessionRow>(),
      this.profiles.read(userId),
    ]);
    const byId = new Map<string, SessionRow>();
    for (const row of [...recent, last, open]) if (row) byId.set(String(row._id), row);
    const ids = [...byId.keys()];
    const [setRows, exerciseRows] = ids.length
      ? await Promise.all([
          this.sets.find({ userId, sessionId: { $in: ids } }).select('sessionId loggedAt').lean<SetRow[]>(),
          this.workoutExercises
            .find({ userId, sessionId: { $in: recent.map((row) => String(row._id)) } })
            .select('exerciseId snapshot')
            .lean<ExerciseRow[]>(),
        ])
      : [[], []];
    const lastSetAt = new Map<string, number>();
    for (const row of setRows) {
      const at = row.loggedAt.getTime();
      if (at > (lastSetAt.get(row.sessionId) ?? 0)) lastSetAt.set(row.sessionId, at);
    }
    const sessions = [...byId.entries()].map(([id, row]) => {
      const lastAt = lastSetAt.get(id);
      return {
        id,
        day: row.day,
        status: row.status as 'open' | 'finished',
        durationSeconds: sessionDurationSeconds({
          startedAt: row.startedAt.toISOString(),
          endedAt: row.endedAt?.toISOString(),
          lastSetAt: lastAt === undefined ? undefined : new Date(lastAt).toISOString(),
        }),
      };
    });
    const records = await this.recentRecords(userId, exerciseRows, since, today);
    return { ...weekSummary({ sessions, records, today }), weightUnit: profile.weightUnit };
  }

  /**
   * Records **set** (marked) in the window, for exercises done in it. Only those exercises' full
   * histories are loaded, because a mark depends on every earlier set.
   */
  private async recentRecords(
    userId: string,
    exerciseRows: ExerciseRow[],
    since: string,
    today: string,
  ): Promise<(RecordEntry & { exerciseName: string })[]> {
    const wanted = new Map<string, { exerciseId: string; measure: Measure; name: string }>();
    for (const row of exerciseRows) {
      const measure = row.snapshot.measure as Measure;
      wanted.set(`${row.exerciseId}:${measure}`, { exerciseId: row.exerciseId, measure, name: row.snapshot.name });
    }
    if (!wanted.size) return [];
    const loaded = await this.progress.load(userId, [...wanted.values()]);
    // One group per marked set, in done order. A set can hold several records at once (a new
    // heaviest is usually a new 1RM too); its kinds stay in `RECORD_KINDS` order, so the card
    // names the plainest one — "heaviest" before an estimate.
    const bySet: (RecordEntry & { exerciseName: string })[][] = [];
    for (const [key, item] of wanted) {
      const progress = loaded.get(key);
      if (!progress) continue;
      for (const set of progress.sets) {
        if (set.day < since || set.day > today) continue;
        const entries = (progress.marks.get(set.id) ?? []).flatMap((kind) => {
          const entry = recordEntryFor(kind, progress.measure, set);
          return entry ? [{ ...entry, exerciseName: item.name }] : [];
        });
        if (entries.length) bySet.push(entries);
      }
    }
    // Latest set first (`weekSummary` takes the newest day; ties keep this order).
    return bySet.reverse().flat();
  }
}
