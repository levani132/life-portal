import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  SYNC_HEALTH_RANGES,
  type SyncAgeBucket,
  type SyncHealthCount,
  type SyncHealthMetric,
  type SyncHealthRange,
  type SyncHealthReport,
} from '@life-portal/shared-types';
import { addDays, summariseSyncHealth } from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';

/** Counters are kept this long, then Mongo deletes them. */
export const SYNC_HEALTH_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

/**
 * One counter (issue #22): a day, a metric, a bounded key, a count. Deliberately nothing else —
 * no account, no hash of one, no path, no body — so it cannot be traced back to a person's data.
 * With very few accounts a day's counts can still reflect one person's activity; the page says so.
 */
@Schema({ collection: 'sync_health_daily', timestamps: false, versionKey: false })
export class SyncHealthDaily {
  @Prop({ required: true }) day!: string;
  @Prop({ required: true }) metric!: string;
  @Prop({ required: true }) key!: string;
  @Prop({ required: true, default: 0 }) count!: number;
  @Prop({ required: true }) expiresAt!: Date;
}
export const SyncHealthDailySchema = SchemaFactory.createForClass(SyncHealthDaily);
SyncHealthDailySchema.index({ day: 1, metric: 1, key: 1 }, { unique: true });
SyncHealthDailySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** What one keyed write met at the server. */
export interface SyncOutcome {
  replayed: boolean;
  /** The refusal's counter key (`syncRefusalKey`), when it was refused. */
  refusal?: string;
  age?: SyncAgeBucket;
}

@Injectable()
export class SyncHealthService {
  private readonly logger = new Logger(SyncHealthService.name);

  constructor(
    @InjectModel(SyncHealthDaily.name) private readonly daily: Model<SyncHealthDaily>,
    private readonly access: AccessService,
  ) {}

  /**
   * Counts one write. Never awaited by the request and never throws: a counter must not slow or
   * fail the write it describes.
   */
  record(outcome: SyncOutcome, now = new Date()): void {
    const day = now.toISOString().slice(0, 10);
    const counts: [SyncHealthMetric, string][] = [['writes', 'all']];
    if (outcome.replayed) counts.push(['replays', 'all']);
    if (outcome.refusal) counts.push(['refusals', outcome.refusal]);
    if (outcome.age) counts.push(['age', outcome.age]);
    const expiresAt = new Date(Date.parse(`${day}T00:00:00Z`) + (SYNC_HEALTH_RETENTION_DAYS + 1) * DAY_MS);
    void this.daily
      .bulkWrite(
        counts.map(([metric, key]) => ({
          updateOne: {
            filter: { day, metric, key },
            update: { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
            upsert: true,
          },
        })),
        { ordered: false },
      )
      .catch((error: unknown) => this.logger.warn(`could not count a write: ${(error as Error).message}`));
  }

  /** Developer only. */
  async report(userId: string, range: number, now = new Date()): Promise<SyncHealthReport> {
    this.access.requireDeveloper(userId);
    if (!SYNC_HEALTH_RANGES.includes(range as SyncHealthRange)) throw new BadRequestException('Unknown range.');
    const to = now.toISOString().slice(0, 10);
    const from = addDays(to, -(range - 1));
    const rows = await this.daily
      .find({ day: { $gte: from, $lte: to } })
      .select('day metric key count')
      .lean<SyncHealthCount[]>();
    return summariseSyncHealth(rows, range as SyncHealthRange, from, to);
  }
}
