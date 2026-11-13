import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { createHmac } from 'node:crypto';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  FEED_METRICS_RANGES,
  type FeedMetricCounts,
  type FeedMetricEvent,
  type FeedMetricsBatch,
  type FeedMetricsRange,
  type FeedMetricsReport,
  type FeedMetricsResult,
  type FeedMetricsStatus,
} from '@life-portal/shared-types';
import {
  FEED_METRICS_CONFIG,
  addDays,
  quotaAllows,
  returningDays,
  summariseFeedMetrics,
  uniqueEvents,
} from '@life-portal/shared-domain';
import { AccessService } from '../access/access.module';
import { CONFIG, type AppConfig } from '../config/configuration';
import { PostCommentRecord, PostLikeRecord } from './post-engagement.service';
import { FeedPreferencesRecord, FoodPostRecord } from './posts.schemas';
import { PostsService } from './posts.service';

const DAY_MS = 86_400_000;

/**
 * Short-lived keys (#11): de-duplication (one count per account, post, event and day), visits
 * (for "returning") and the daily quota. Each `key` is an HMAC of the account id and the rest,
 * keyed by a secret derived from `JWT_SECRET`, so it is pseudonymous: anyone with the secret and
 * a candidate account id can recompute it. Nothing else is stored, and Mongo deletes each row at
 * `expiresAt` (2 to 8 days). `owner` is the HMAC of the account and day, so opting out can delete
 * an account's keys without knowing what they were for.
 */
@Schema({ collection: 'feed_metric_keys', timestamps: false, versionKey: false })
export class FeedMetricKeyRecord {
  @Prop({ required: true, unique: true }) key!: string;
  @Prop({ required: true, index: true }) owner!: string;
  /** Quota rows only: events accepted today. */
  @Prop() count?: number;
  @Prop({ type: Date, required: true }) expiresAt!: Date;
}
export const FeedMetricKeySchema = SchemaFactory.createForClass(FeedMetricKeyRecord);
FeedMetricKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Aggregate daily counts (#11): one row per UTC day for the totals (`postId: ''`) and one per day
 * and post. No account id, no key, no time of day. Deleted by Mongo after 90 days.
 */
@Schema({ collection: 'feed_metrics_daily', timestamps: false, versionKey: false })
export class FeedMetricsDailyRecord {
  @Prop({ required: true }) day!: string;
  @Prop({ default: '' }) postId!: string;
  @Prop({ type: Object }) counts?: FeedMetricCounts;
  @Prop() visitors?: number;
  @Prop() returningVisitors?: number;
  @Prop({ type: Date, required: true }) expiresAt!: Date;
}
export const FeedMetricsDailySchema = SchemaFactory.createForClass(FeedMetricsDailyRecord);
FeedMetricsDailySchema.index({ day: 1, postId: 1 }, { unique: true });
FeedMetricsDailySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

type PostRow = FoodPostRecord & { _id: Types.ObjectId };

/**
 * For You measurement (#11), behind `forYouMetrics` (off for everyone by default). Counts what
 * For You shows and what people do with it, as daily aggregates only. It never feeds ranking:
 * nothing here is read by `ForYouService`.
 *
 * An event counts only when the account has the flag and has not opted out, the post is one this
 * viewer may see in For You right now, an engagement event matches a stored like, comment, repost
 * or Not interested, the same account has not already counted that post and event today, and
 * the account is under its daily cap. Anything else is dropped quietly.
 */
@Injectable()
export class FeedMetricsService {
  private readonly secret: Buffer;

  constructor(
    @InjectModel(FeedMetricKeyRecord.name) private readonly keys: Model<FeedMetricKeyRecord>,
    @InjectModel(FeedMetricsDailyRecord.name) private readonly daily: Model<FeedMetricsDailyRecord>,
    @InjectModel(FeedPreferencesRecord.name) private readonly prefs: Model<FeedPreferencesRecord>,
    @InjectModel(FoodPostRecord.name) private readonly posts: Model<FoodPostRecord>,
    @InjectModel(PostLikeRecord.name) private readonly likes: Model<PostLikeRecord>,
    @InjectModel(PostCommentRecord.name) private readonly comments: Model<PostCommentRecord>,
    private readonly feed: PostsService,
    private readonly access: AccessService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    // Its own key, so a metrics key never equals any other HMAC made from the JWT secret.
    this.secret = createHmac('sha256', config.jwtSecret).update('for-you-metrics-v1').digest();
  }

  async status(userId: string): Promise<FeedMetricsStatus> {
    await this.feed.forYouGate(userId);
    const [{ access }, prefs] = await Promise.all([
      this.access.forUser(userId),
      this.prefs.findOne({ userId }).select('metricsOptOut').lean(),
    ]);
    const optedOut = prefs?.metricsOptOut === true;
    return { enabled: access.forYouMetrics, optedOut, active: access.forYouMetrics && !optedOut };
  }

  /** Opting out stops new events at once and deletes this account's short-lived keys. */
  async setOptOut(userId: string, optedOut: boolean, now = new Date()): Promise<FeedMetricsStatus> {
    await this.feed.forYouGate(userId);
    await this.prefs.updateOne({ userId }, { $set: { metricsOptOut: optedOut } }, { upsert: true });
    if (optedOut) await this.forget(userId, now);
    return this.status(userId);
  }

  /**
   * Deletes every key this account may have (they all live at most `visitDays`). The daily
   * aggregates hold no account and are not affected. Account deletion must call this too.
   */
  async forget(userId: string, now = new Date()) {
    const today = utcDay(now);
    const owners = Array.from({ length: FEED_METRICS_CONFIG.visitDays + 1 }, (_, i) => this.owner(userId, addDays(today, -i)));
    await this.keys.deleteMany({ owner: { $in: owners } });
  }

  async record(userId: string, batch: FeedMetricsBatch, now = new Date()): Promise<FeedMetricsResult> {
    const events = uniqueEvents(batch.events ?? []).filter((event) => isValidObjectId(event.postId));
    const dropped = (n: number) => ({ accepted: n, dropped: (batch.events?.length ?? 0) - n });
    const status = await this.status(userId);
    if (!status.active) return dropped(0);
    const day = utcDay(now);
    const owner = this.owner(userId, day);
    if (batch.visit) await this.visit(userId, day, owner, now);
    if (!events.length) return dropped(0);

    const counted = await this.verified(userId, events);
    const fresh: { postId: string; type: FeedMetricEvent }[] = [];
    for (const event of counted) {
      const key = this.hmac('event', userId, event.postId, event.type, day);
      const result = await this.keys.updateOne(
        { key },
        { $setOnInsert: { owner, expiresAt: expiry(now, FEED_METRICS_CONFIG.keyDays) } },
        { upsert: true },
      );
      if (result.upsertedCount) fresh.push(event);
    }
    if (!fresh.length) return dropped(0);
    const allowed = await this.reserve(userId, day, owner, fresh.length, now);
    const accepted = fresh.slice(0, allowed);
    if (!accepted.length) return dropped(0);

    const totals: Record<string, number> = {};
    const perPost = new Map<string, Record<string, number>>();
    for (const { postId, type } of accepted) {
      totals[`counts.${type}`] = (totals[`counts.${type}`] ?? 0) + 1;
      const row = perPost.get(postId) ?? {};
      row[`counts.${type}`] = (row[`counts.${type}`] ?? 0) + 1;
      perPost.set(postId, row);
    }
    const expiresAt = expiry(now, FEED_METRICS_CONFIG.aggregateDays);
    await this.daily.bulkWrite([
      { updateOne: { filter: { day, postId: '' }, update: { $inc: totals, $setOnInsert: { expiresAt } }, upsert: true } },
      ...[...perPost].map(([postId, inc]) => ({
        updateOne: { filter: { day, postId }, update: { $inc: inc, $setOnInsert: { expiresAt } }, upsert: true },
      })),
    ]);
    return dropped(accepted.length);
  }

  async report(userId: string, range: number, now = new Date()): Promise<FeedMetricsReport> {
    this.access.requireDeveloper(userId);
    if (!FEED_METRICS_RANGES.includes(range as FeedMetricsRange)) throw new BadRequestException('Unknown range.');
    const to = utcDay(now);
    const from = addDays(to, -(range - 1));
    const rows = await this.daily.find({ day: { $gte: from, $lte: to } }).select('day postId counts visitors returningVisitors').lean();
    return summariseFeedMetrics(rows, from, to);
  }

  /** The events whose post this viewer may see in For You now, and whose engagement is real. */
  private async verified(userId: string, events: { postId: string; type: FeedMetricEvent }[]) {
    const ids = [...new Set(events.map((event) => event.postId))];
    const rows: PostRow[] = await this.posts.find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } }).lean();
    const filter = await this.feed.forYouFilter(userId);
    const visible = new Set((await this.feed.forYouEligible(userId, rows, filter)).map((row) => String(row._id)));
    // Not interested takes the post out of For You, so it is checked without that exclusion and
    // only counts when the feedback row exists.
    const dismissed = new Set(
      (await this.feed.forYouEligible(userId, rows, { ...filter, notInterested: new Set() }))
        .map((row) => String(row._id))
        .filter((id) => filter.notInterested.has(id)),
    );
    const out: typeof events = [];
    for (const event of events) {
      if (event.type === 'notInterested') {
        if (dismissed.has(event.postId)) out.push(event);
        continue;
      }
      if (!visible.has(event.postId)) continue;
      if (event.type === 'like' && !(await this.likes.exists({ postId: event.postId, userId }))) continue;
      if (event.type === 'comment' && !(await this.comments.exists({ postId: event.postId, userId, deleted: false }))) continue;
      if (event.type === 'repost' && !(await this.posts.exists({ userId, repostOf: event.postId, deleted: { $ne: true } }))) continue;
      out.push(event);
    }
    return out;
  }

  /** The first visit of the day counts a visitor, and a returning one if any of the last 7 days had one. */
  private async visit(userId: string, day: string, owner: string, now: Date) {
    const result = await this.keys.updateOne(
      { key: this.hmac('visit', userId, day) },
      { $setOnInsert: { owner, expiresAt: expiry(now, FEED_METRICS_CONFIG.visitDays) } },
      { upsert: true },
    );
    if (!result.upsertedCount) return;
    const returning = await this.keys.exists({ key: { $in: returningDays(day).map((d) => this.hmac('visit', userId, d)) } });
    await this.daily.updateOne(
      { day, postId: '' },
      {
        $inc: { visitors: 1, ...(returning ? { returningVisitors: 1 } : {}) },
        $setOnInsert: { expiresAt: expiry(now, FEED_METRICS_CONFIG.aggregateDays) },
      },
      { upsert: true },
    );
  }

  /** Adds `wanted` to today's count and answers how many of them fit under the cap. */
  private async reserve(userId: string, day: string, owner: string, wanted: number, now: Date) {
    const key = this.hmac('quota', userId, day);
    await this.keys.updateOne(
      { key },
      { $inc: { count: wanted }, $setOnInsert: { owner, expiresAt: expiry(now, FEED_METRICS_CONFIG.keyDays) } },
      { upsert: true },
    );
    const row = await this.keys.findOne({ key }).select('count').lean();
    return quotaAllows(row?.count ?? wanted, wanted);
  }

  private owner(userId: string, day: string) {
    return this.hmac('owner', userId, day);
  }

  private hmac(...parts: string[]) {
    return createHmac('sha256', this.secret).update(parts.join('\u0000')).digest('base64url');
  }
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10);
const expiry = (now: Date, days: number) => new Date(now.getTime() + days * DAY_MS);
