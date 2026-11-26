import { createHmac } from 'node:crypto';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, Types, isValidObjectId } from 'mongoose';
import type { PageInsights } from '@life-portal/shared-types';
import { addDays } from '@life-portal/shared-domain';
import { User } from '../auth/schemas/user.schema';
import { CONFIG, type AppConfig } from '../config/configuration';
import { FollowsService } from '../follows/follows.module';
import { NutritionPublicationService } from '../nutrition/nutrition-publication.service';
import { PostCommentRecord, PostLikeRecord } from './post-engagement.service';
import { FoodPostRecord } from './posts.schemas';

/**
 * Spec 045: one key per person, post and day, so a view counts once. The key is an HMAC of the
 * three, keyed by a secret derived from `JWT_SECRET`: it names nobody without the secret, and
 * Mongo deletes it after two days. Nothing else about the viewer is stored.
 */
@Schema({ collection: 'post_view_keys', timestamps: false, versionKey: false })
export class PostViewKeyRecord {
  @Prop({ required: true, unique: true }) key!: string;
  @Prop({ type: Date, required: true }) expiresAt!: Date;
}
export const PostViewKeySchema = SchemaFactory.createForClass(PostViewKeyRecord);
PostViewKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** Spec 045: views of a page's post per UTC day. No account. Kept 400 days. */
@Schema({ collection: 'post_views_daily', timestamps: false, versionKey: false })
export class PostViewsDailyRecord {
  @Prop({ required: true }) postId!: string;
  /** The page that wrote it, so a page's views are one query. */
  @Prop({ required: true }) pageId!: string;
  @Prop({ required: true }) day!: string;
  @Prop({ required: true }) count!: number;
  @Prop({ type: Date, required: true }) expiresAt!: Date;
}
export const PostViewsDailySchema = SchemaFactory.createForClass(PostViewsDailyRecord);
PostViewsDailySchema.index({ postId: 1, day: 1 }, { unique: true });
PostViewsDailySchema.index({ pageId: 1, day: 1 });
PostViewsDailySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const utcDay = (at: Date) => at.toISOString().slice(0, 10);
const VIEWS_PER_CALL = 50;
const KEY_DAYS = 2;
const DAILY_DAYS = 400;
export const INSIGHTS_DAYS = 28;
const INSIGHTS_POSTS = 30;

type PostRow = Pick<FoodPostRecord, 'userId' | 'title' | 'caption' | 'audience' | 'createdAt'> & { _id: Types.ObjectId };

/**
 * A page's insights (spec 045): followers, and per post views, likes, comments, reposts and saves.
 * Views are counted for pages' public posts only, from people (never pages, never the page's own
 * managers), once per person, post and day.
 */
@Injectable()
export class PageInsightsService {
  private readonly secret: Buffer;

  constructor(
    @InjectModel(PostViewKeyRecord.name) private readonly keys: Model<PostViewKeyRecord>,
    @InjectModel(PostViewsDailyRecord.name) private readonly daily: Model<PostViewsDailyRecord>,
    @InjectModel(FoodPostRecord.name) private readonly posts: Model<FoodPostRecord>,
    @InjectModel(PostLikeRecord.name) private readonly likes: Model<PostLikeRecord>,
    @InjectModel(PostCommentRecord.name) private readonly comments: Model<PostCommentRecord>,
    @InjectModel(User.name) private readonly users: Model<User>,
    private readonly follows: FollowsService,
    private readonly nutrition: NutritionPublicationService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.secret = createHmac('sha256', config.jwtSecret).update('post-views-v1').digest();
  }

  /** Records that a person saw these posts. Anything not countable is dropped quietly. */
  async recordViews(viewerId: string, postIds: string[], now = new Date()): Promise<{ counted: number }> {
    const ids = [...new Set(postIds)].filter((id) => isValidObjectId(id)).slice(0, VIEWS_PER_CALL);
    if (!ids.length) return { counted: 0 };
    const viewer = await this.users.findById(viewerId).select('kind').lean();
    if (!viewer || viewer.kind === 'page') return { counted: 0 };
    const rows = await this.posts
      .find({ _id: { $in: ids }, deleted: false, audience: 'public', repostOf: { $exists: false }, heldAt: { $exists: false } })
      .select('userId')
      .lean<{ _id: Types.ObjectId; userId: string }[]>();
    const authors = [...new Set(rows.map((row) => row.userId))];
    const pages = new Map(
      (await this.users.find({ _id: { $in: authors }, kind: 'page' }).select('managers').lean<{ _id: Types.ObjectId; managers?: string[] }[]>()).map((row) => [
        String(row._id),
        row.managers ?? [],
      ]),
    );
    const day = utcDay(now);
    let counted = 0;
    for (const row of rows) {
      const managers = pages.get(row.userId);
      if (!managers || managers.includes(viewerId)) continue;
      const postId = String(row._id);
      const key = createHmac('sha256', this.secret).update(`${viewerId}:${postId}:${day}`).digest('base64url');
      try {
        await this.keys.create({ key, expiresAt: new Date(now.getTime() + KEY_DAYS * 86_400_000) });
      } catch (error) {
        if ((error as { code?: number }).code === 11000) continue;
        throw error;
      }
      await this.daily.updateOne(
        { postId, day },
        { $inc: { count: 1 }, $setOnInsert: { pageId: row.userId, expiresAt: new Date(now.getTime() + DAILY_DAYS * 86_400_000) } },
        { upsert: true },
      );
      counted++;
    }
    return { counted };
  }

  /** The page's insights, for one of its managers (or the page itself, for its assistant). */
  async insights(personId: string, pageId: string, now = new Date()): Promise<PageInsights> {
    const page = isValidObjectId(pageId) ? await this.users.findOne({ _id: pageId, kind: 'page' }).select('managers').lean() : null;
    if (!page || !(personId === pageId || (page.managers ?? []).includes(personId)))
      throw new ForbiddenException({ code: 'NOT_A_MANAGER', message: 'You do not manage that page.' });
    const today = utcDay(now);
    const firstDay = addDays(today, -(INSIGHTS_DAYS - 1));
    const since = new Date(`${firstDay}T00:00:00.000Z`);
    const posts = await this.posts
      .find({ userId: pageId, deleted: false, repostOf: { $exists: false } })
      .sort({ createdAt: -1 })
      .limit(INSIGHTS_POSTS)
      .select('userId title caption audience createdAt')
      .lean<PostRow[]>();
    const ids = posts.map((row) => String(row._id));
    const allIds = (await this.posts.find({ userId: pageId, deleted: false, repostOf: { $exists: false } }).select('_id').lean()).map((row) => String(row._id));
    const group = (match: Record<string, unknown>) => [{ $match: match }, { $group: { _id: '$postId', n: { $sum: 1 } } }];
    const [followers, followDates, views, viewsWindow, likes, comments, reposts, likesWindow, commentsWindow, repostsWindow, saves] = await Promise.all([
      this.follows.followerCount(pageId),
      this.follows.followedSince(pageId, since),
      this.daily.aggregate<{ _id: string; n: number }>([{ $match: { postId: { $in: ids } } }, { $group: { _id: '$postId', n: { $sum: '$count' } } }]),
      this.daily.aggregate<{ n: number }>([{ $match: { pageId, day: { $gte: firstDay } } }, { $group: { _id: null, n: { $sum: '$count' } } }]),
      this.likes.aggregate<{ _id: string; n: number }>(group({ postId: { $in: ids } })),
      this.comments.aggregate<{ _id: string; n: number }>(group({ postId: { $in: ids }, deleted: false })),
      this.posts.aggregate<{ _id: string; n: number }>([{ $match: { repostOf: { $in: ids }, deleted: false } }, { $group: { _id: '$repostOf', n: { $sum: 1 } } }]),
      this.likes.countDocuments({ postId: { $in: allIds }, createdAt: { $gte: since } }),
      this.comments.countDocuments({ postId: { $in: allIds }, deleted: false, createdAt: { $gte: since } }),
      this.posts.countDocuments({ repostOf: { $in: allIds }, deleted: false, createdAt: { $gte: since } }),
      this.nutrition.saveCounts(ids),
    ]);
    const map = (rows: { _id: string; n: number }[]) => new Map(rows.map((row) => [row._id, row.n]));
    const [viewsBy, likesBy, commentsBy, repostsBy] = [map(views), map(likes), map(comments), map(reposts)];
    const perDay = new Map<string, number>();
    for (const at of followDates) perDay.set(utcDay(at), (perDay.get(utcDay(at)) ?? 0) + 1);
    const newFollowersByDay = Array.from({ length: INSIGHTS_DAYS }, (_, i) => {
      const day = addDays(firstDay, i);
      return { day, count: perDay.get(day) ?? 0 };
    });
    return {
      days: INSIGHTS_DAYS,
      followers,
      newFollowersByDay,
      totals: { views: viewsWindow[0]?.n ?? 0, likes: likesWindow, comments: commentsWindow, reposts: repostsWindow, newFollowers: followDates.length },
      posts: posts.map((row) => {
        const id = String(row._id);
        const text = (row.title || row.caption || '').trim();
        return {
          id,
          label: text ? (text.length > 80 ? `${text.slice(0, 79)}…` : text) : 'A post',
          createdAt: row.createdAt.toISOString(),
          views: viewsBy.get(id) ?? 0,
          likes: likesBy.get(id) ?? 0,
          comments: commentsBy.get(id) ?? 0,
          reposts: repostsBy.get(id) ?? 0,
          saves: saves.get(id) ?? 0,
        };
      }),
    };
  }
}
