import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { TrainingLevel } from '@life-portal/shared-types';
import { sessionDurationSeconds, trainingLevel, type LevelSession } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { WorkoutSession, WorkoutSet } from './training.schemas';

type SessionRow = Pick<WorkoutSession, 'day' | 'status' | 'startedAt' | 'endedAt'> & { _id: unknown };

/**
 * The member's training level (issue #5a). Computed on every read from their own finished
 * sessions and a count of each one's non-warm-up sets; the arithmetic is `trainingLevel` in the
 * domain lib. Nothing is stored, so edits and deletions are reflected next read. Behind the
 * `trainingLevels` flag (on top of `training`, which the controller requires).
 */
@Injectable()
export class TrainingLevelService {
  constructor(
    @InjectModel(WorkoutSession.name) private readonly sessions: Model<WorkoutSession>,
    @InjectModel(WorkoutSet.name) private readonly sets: Model<WorkoutSet>,
    private readonly access: AccessService,
  ) {}

  async level(userId: string, today: string): Promise<TrainingLevel> {
    await this.access.require(userId, 'trainingLevels');
    const rows = await this.sessions
      .find({ userId, status: 'finished', day: { $lte: today } })
      .select('day status startedAt endedAt')
      .lean<SessionRow[]>();
    if (!rows.length) return trainingLevel([], today);
    // One grouped count over the person's sets ({userId, sessionId} index), not a read per session.
    const counts = await this.sets.aggregate<{ _id: string; count: number }>([
      { $match: { userId, type: { $ne: 'warmup' } } },
      { $group: { _id: '$sessionId', count: { $sum: 1 } } },
    ]);
    const working = new Map(counts.map((row) => [String(row._id), row.count]));
    const sessions: LevelSession[] = rows.map((row) => ({
      id: String(row._id),
      day: row.day,
      startedAt: row.startedAt.toISOString(),
      status: row.status as 'finished',
      durationSeconds: sessionDurationSeconds({
        startedAt: row.startedAt.toISOString(),
        endedAt: row.endedAt?.toISOString(),
      }),
      workingSets: working.get(String(row._id)) ?? 0,
    }));
    return trainingLevel(sessions, today);
  }
}
