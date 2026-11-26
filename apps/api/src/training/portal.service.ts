import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { PortalTraining } from '@life-portal/shared-types';
import { RECORD_LABELS, addDays, formatRecordValue, portalTrainingWeek, sessionDurationSeconds, trainingWeekStreak } from '@life-portal/shared-domain';
import { CatalogueService } from './catalogue.service';
import { TrainingLevelService } from './level.service';
import { TrainingProfileService } from './profile.service';
import { TrainingRankService } from './rank.service';
import { TrainingSummaryService } from './summary.service';
import { WorkoutExercise, WorkoutSession } from './training.schemas';

type SessionRow = WorkoutSession & { _id: unknown };
const RECORD_DAYS = 60;
const RECENT_WORKOUTS = 10;
const STREAK_DAYS = 7 * 104;

/**
 * Spec 046: Training on a portal, part by part behind the owner's own switches (workouts,
 * records, level, ranks). The caller checks the module's audience. Body weight never appears:
 * records that depend on a weigh-in are left out, and ranks are shown as their tier only.
 */
@Injectable()
export class TrainingPortalService {
  constructor(
    @InjectModel(WorkoutSession.name) private readonly sessions: Model<WorkoutSession>,
    @InjectModel(WorkoutExercise.name) private readonly workoutExercises: Model<WorkoutExercise>,
    private readonly profiles: TrainingProfileService,
    private readonly summary: TrainingSummaryService,
    private readonly levels: TrainingLevelService,
    private readonly ranks: TrainingRankService,
    private readonly catalogue: CatalogueService,
  ) {}

  /** Which parts the owner shares, for Home's card on the portal. */
  async shares(userId: string): Promise<{ workouts: boolean; records: boolean }> {
    const profile = await this.profiles.read(userId);
    return { workouts: profile.shareWorkouts, records: profile.shareRecords };
  }

  async portal(userId: string, today: string): Promise<PortalTraining | undefined> {
    const profile = await this.profiles.read(userId);
    if (!profile.shareWorkouts && !profile.shareRecords && !profile.shareLevel && !profile.shareRanks) return undefined;
    const out: PortalTraining = { weightUnit: profile.weightUnit };
    if (profile.shareWorkouts) {
      const rows = await this.sessions
        .find({ userId, status: 'finished', day: { $gte: addDays(today, -STREAK_DAYS), $lte: today } })
        .sort({ day: -1, startedAt: -1 })
        .select('day startedAt endedAt plan')
        .lean<SessionRow[]>();
      const timed = rows.map((row) => ({
        day: row.day,
        name: row.plan?.workoutName ?? 'Workout',
        durationSeconds: sessionDurationSeconds({ startedAt: row.startedAt.toISOString(), endedAt: row.endedAt?.toISOString() }),
      }));
      const week = await this.summary.summary(userId, today);
      out.workouts = {
        thisWeek: week.workoutsThisWeek,
        minutesThisWeek: Math.round(week.secondsThisWeek / 60),
        streakWeeks: trainingWeekStreak(timed.map((row) => row.day), today),
        days: portalTrainingWeek(today, timed),
        recent: timed.slice(0, RECENT_WORKOUTS).map((row) => ({ day: row.day, name: row.name, minutes: Math.round(row.durationSeconds / 60) })),
      };
    }
    if (profile.shareRecords) {
      const since = addDays(today, -(RECORD_DAYS - 1));
      const recent = await this.sessions.find({ userId, day: { $gte: since, $lte: today } }).select('_id').lean();
      const exercises = recent.length
        ? await this.workoutExercises.find({ userId, sessionId: { $in: recent.map((row) => String(row._id)) } }).select('exerciseId snapshot').lean()
        : [];
      const records = await this.summary.recentRecords(userId, exercises as never, since, today);
      const seen = new Set<string>();
      out.records = records
        // Never a record that rests on a weigh-in: that would show body weight.
        .filter((record) => !record.bodyWeightDay)
        .filter((record) => (seen.has(record.setId) ? false : !!seen.add(record.setId)))
        .slice(0, 5)
        .map((record) => ({ exerciseName: record.exerciseName, label: RECORD_LABELS[record.kind], value: formatRecordValue(record, profile.weightUnit), day: record.day }));
    }
    if (profile.shareLevel) {
      const level = await this.levels.level(userId, today).catch(() => undefined);
      if (level) out.level = { level: level.level, xpIntoLevel: level.xpIntoLevel, xpForLevel: level.xpForLevel };
    }
    if (profile.shareRanks) {
      const badges = await this.ranks.badges(userId, today).catch(() => []);
      if (badges.length) {
        const names = new Map((await this.catalogue.publishable(userId, badges.map((badge) => badge.exerciseId))).map((row) => [String(row._id), row.name]));
        out.ranks = badges
          .map((badge) => ({ exerciseName: names.get(badge.exerciseId) ?? 'Exercise', tier: badge.tier, division: badge.division, current: badge.status === 'ranked' }))
          .slice(0, 12);
      }
    }
    return out;
  }
}
