import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import type {
  FoodPost,
  PostComment,
  PostCommentsPage,
  PostEngagement,
} from '@life-portal/shared-types';
import type { ActivityRow } from '@life-portal/shared-domain';
import { NotificationsService } from '../notifications/notifications.service';
import { PostsService } from './posts.service';
import { SocialService } from '../social/social.module';
import { SocialGraphService } from '../social-graph/social-graph.module';

@Schema({ collection: 'post_likes', timestamps: true })
export class PostLikeRecord {
  @Prop({ required: true }) postId!: string;
  @Prop({ required: true }) userId!: string;
  createdAt!: Date;
}
export const PostLikeSchema = SchemaFactory.createForClass(PostLikeRecord);
PostLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

@Schema({ collection: 'post_comments', timestamps: true })
export class PostCommentRecord {
  @Prop({ required: true }) postId!: string;
  @Prop({ required: true }) userId!: string;
  @Prop({ required: true }) requestId!: string;
  @Prop({ required: true, maxlength: 1000 }) text!: string;
  @Prop({ default: false }) deleted!: boolean;
  createdAt!: Date;
}
export const PostCommentSchema =
  SchemaFactory.createForClass(PostCommentRecord);
PostCommentSchema.index(
  { postId: 1, userId: 1, requestId: 1 },
  { unique: true },
);
PostCommentSchema.index({ postId: 1, deleted: 1, _id: -1 });

const LIKE_WINDOW_MS = 15 * 60_000;
const COMMENT_WINDOW_MS = 2 * 60_000;

@Injectable()
export class PostEngagementService implements OnModuleInit {
  constructor(
    @InjectModel(PostLikeRecord.name)
    private readonly likes: Model<PostLikeRecord>,
    @InjectModel(PostCommentRecord.name)
    private readonly comments: Model<PostCommentRecord>,
    private readonly posts: PostsService,
    private readonly social: SocialService,
    private readonly graph: SocialGraphService,
    private readonly notifications: NotificationsService,
  ) {}
  /** Like and comment notifications, and their Activity rows (docs/modules/notifications.md). */
  onModuleInit() {
    const common = {
      requires: ['social' as const, 'foodPosts' as const],
      collapseKey: (event: { targetId: string }) => event.targetId,
      url: (event: { targetId: string }) => `/posts/${event.targetId}`,
    };
    this.notifications.register({ type: 'postLike', windowMs: LIKE_WINDOW_MS, ...common });
    this.notifications.register({
      type: 'postComment',
      windowMs: COMMENT_WINDOW_MS,
      ...common,
    });
    this.notifications.register({ type: 'postRepost', windowMs: LIKE_WINDOW_MS, ...common });
    this.notifications.registerActivitySource({
      rows: (userId, since, before, limit) => this.activity(userId, since, before, limit),
    });
  }
  /** Likes, live comments and reposts by others on the owner's posts. Blocks are filtered by the caller. */
  async activity(
    userId: string,
    since: Date,
    before: Date | undefined,
    limit: number,
  ): Promise<ActivityRow[]> {
    const titles = await this.posts.ownTitles(userId);
    if (!titles.size) return [];
    const filter = {
      postId: { $in: [...titles.keys()] },
      userId: { $ne: userId },
      createdAt: { $gte: since, ...(before ? { $lt: before } : {}) },
    };
    const [likes, comments, reposts] = await Promise.all([
      this.likes.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      this.comments
        .find({ ...filter, deleted: false })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      this.posts.repostRows([...titles.keys()], userId, since, before, limit),
    ]);
    const names = await this.social.displayNames([
      ...likes.map((row) => row.userId),
      ...comments.map((row) => row.userId),
      ...reposts.map((row) => row.userId),
    ]);
    const row = (
      type: 'postLike' | 'postComment' | 'postRepost',
      r: { postId: string; userId: string; createdAt: Date },
    ): ActivityRow => ({
      type,
      actorId: r.userId,
      actorName: names.get(r.userId) ?? 'Former member',
      targetId: r.postId,
      url: `/posts/${r.postId}`,
      postTitle: titles.get(r.postId),
      createdAt: r.createdAt,
    });
    return [
      ...likes.map((r) => row('postLike', r)),
      ...comments.map((r) => row('postComment', r)),
      ...reposts.map((r) =>
        row('postRepost', { postId: r.repostOf!, userId: r.userId, createdAt: r.createdAt }),
      ),
    ];
  }
  /** Tells the post's owner. Not awaited by callers, and never throws. */
  private notifyOwner(
    post: FoodPost,
    userId: string,
    actorName: string,
    extra:
      | { type: 'postLike' }
      | { type: 'postRepost' }
      | { type: 'postComment'; commentText: string },
  ) {
    void this.notifications.notify({
      ...extra,
      recipientId: post.author.userId,
      actorId: userId,
      actorName,
      targetId: post.id,
      postTitle: post.title || post.contentLabel,
    });
  }
  private async counts(
    userId: string,
    postId: string,
  ): Promise<PostEngagement> {
    const [likeCount, commentCount, liked, reposts] = await Promise.all([
      this.likes.countDocuments({ postId }),
      this.comments.countDocuments({ postId, deleted: false }),
      this.likes.exists({ postId, userId }),
      this.posts.repostState(userId, postId),
    ]);
    return { likeCount, commentCount, liked: !!liked, ...reposts };
  }
  async stats(userId: string, postId: string) {
    await this.posts.detail(userId, postId);
    return this.counts(userId, postId);
  }
  async setLike(userId: string, postId: string, liked: boolean) {
    const post = await this.posts.detail(userId, postId);
    if (liked) {
      try {
        const result = await this.likes.updateOne(
          { postId, userId },
          { $setOnInsert: { postId, userId } },
          { upsert: true },
        );
        // Only a new like notifies; repeating a like is a no-op.
        if (result.upsertedCount) {
          const actor = await this.social.postAuthor(userId);
          if (actor) this.notifyOwner(post, userId, actor.displayName, { type: 'postLike' });
        }
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    } else await this.likes.deleteOne({ postId, userId });
    return this.counts(userId, postId);
  }
  async setRepost(userId: string, postId: string, reposted: boolean) {
    if (reposted) {
      const { post, created } = await this.posts.repost(userId, postId);
      if (created) {
        const actor = await this.social.postAuthor(userId);
        if (actor) this.notifyOwner(post, userId, actor.displayName, { type: 'postRepost' });
      }
    } else {
      await this.posts.unrepost(userId, postId);
    }
    return this.counts(userId, postId);
  }
  private async commentDto(
    row: PostCommentRecord & { _id: unknown },
    viewerId: string,
    owner: boolean,
  ): Promise<PostComment> {
    const author = await this.social.postAuthor(row.userId);
    return {
      id: String(row._id),
      text: row.text,
      createdAt: row.createdAt.toISOString(),
      author: author ?? {
        userId: '',
        displayName: 'Former member',
        username: '',
      },
      canDelete: owner || row.userId === viewerId,
    };
  }
  async list(
    userId: string,
    postId: string,
    before?: string,
  ): Promise<PostCommentsPage> {
    const post = await this.posts.detail(userId, postId);
    if (before && !isValidObjectId(before))
      throw new BadRequestException('Invalid comment cursor.');
    const rows = await this.comments
      .find({
        postId,
        deleted: false,
        ...(before ? { _id: { $lt: before } } : {}),
      })
      .sort({ _id: -1 })
      .limit(21)
      .lean();
    const visible = await Promise.all(
      rows.slice(0, 20).map(async (row) => {
        if (
          row.userId !== userId &&
          (await this.graph.between(userId, row.userId))?.blockedBy.length
        )
          return null;
        return this.commentDto(row, userId, post.isOwner);
      }),
    );
    return {
      comments: visible.filter((row): row is PostComment => row !== null),
      ...(rows.length > 20 ? { nextCursor: String(rows[19]._id) } : {}),
    };
  }
  async add(userId: string, postId: string, text: string, requestId: string) {
    const post = await this.posts.detail(userId, postId);
    const value = text.trim();
    if (!value || value.length > 1000)
      throw new BadRequestException('Write a comment of 1–1,000 characters.');
    const actor = await this.social.own(userId);
    const filter = { postId, userId, requestId };
    try {
      const result = await this.comments.updateOne(
        filter,
        { $setOnInsert: { ...filter, text: value, deleted: false } },
        { upsert: true },
      );
      // A retried requestId returns the original comment and must not notify again.
      if (result.upsertedCount)
        this.notifyOwner(post, userId, actor.displayName, {
          type: 'postComment',
          commentText: value,
        });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const row = await this.comments.findOne(filter).lean();
    if (!row || row.deleted)
      throw new NotFoundException('Comment no longer available.');
    return this.commentDto(row, userId, post.isOwner);
  }
  async remove(userId: string, postId: string, commentId: string) {
    const post = await this.posts.detail(userId, postId);
    if (!isValidObjectId(commentId))
      throw new NotFoundException('Comment not found.');
    const result = await this.comments.updateOne(
      {
        _id: commentId,
        postId,
        deleted: false,
        ...(!post.isOwner ? { userId } : {}),
      },
      { $set: { deleted: true, text: '' } },
    );
    if (!result.matchedCount) throw new NotFoundException('Comment not found.');
    return { success: true };
  }
}
