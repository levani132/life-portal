import { Injectable } from '@nestjs/common';
import type { WorkoutRecap } from '@life-portal/shared-types';
import { workoutRecap, type RankBeforeAfter } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { TrainingLevelService } from './level.service';
import { TrainingRankService } from './rank.service';
import { SessionsService } from './sessions.service';

/**
 * Issue #25: a finished workout's recap, recomputed on every read as of that workout (never
 * stored). Records are the marks on its sets; strength ranks and the training level are worked
 * out by their own engines without and with it, and only when those features are on. An open
 * workout gets its numbers only: nothing is earned until it is finished.
 */
@Injectable()
export class TrainingRecapService {
  constructor(
    private readonly sessions: SessionsService,
    private readonly levels: TrainingLevelService,
    private readonly ranks: TrainingRankService,
    private readonly access: AccessService,
  ) {}

  async recap(userId: string, id: string): Promise<WorkoutRecap> {
    const session = await this.sessions.detail(userId, id);
    if (session.status !== 'finished') return workoutRecap({ session });
    const at = { id: session.id, day: session.day, startedAt: new Date(session.startedAt) };
    const { access } = await this.access.forUser(userId);

    const exerciseIds = [...new Set(session.exercises.filter((exercise) => exercise.sets.some((set) => set.type !== 'warmup')).map((exercise) => exercise.exerciseId))];
    const [levels, ranks] = await Promise.all([
      access.trainingLevels ? this.levels.aroundSession(userId, at) : undefined,
      access.trainingRanks
        ? Promise.all(exerciseIds.map((exerciseId) => this.ranks.aroundSession(userId, exerciseId, at))).then((rows) =>
            rows.flatMap((row, index): RankBeforeAfter[] =>
              row ? [{ exerciseId: exerciseIds[index], name: nameOf(session.exercises, exerciseIds[index]) ?? row.name, before: row.before, after: row.after }] : [],
            ),
          )
        : undefined,
    ]);
    return workoutRecap({ session, ...(levels ? { levels } : {}), ...(ranks ? { ranks } : {}) });
  }
}

/** The name the exercise had in this workout (its snapshot), as everywhere else in the workout. */
function nameOf(exercises: { exerciseId: string; snapshot: { name: string } }[], exerciseId: string): string | undefined {
  return exercises.find((exercise) => exercise.exerciseId === exerciseId)?.snapshot.name;
}
