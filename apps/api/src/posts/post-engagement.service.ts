import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  COMMENTS_MORE,
  COMMENTS_PAGE_MAX,
  REPLIES_FIRST,
  REPLIES_MORE,
  type FoodPost,
  type PostComment,
  type PostCommentsPage,
  type PostEngagement,
} from '@life-portal/shared-types';
import type { ActivityRow } from '@life-portal/shared-domain';
import { NotificationsService } from '../notifications/notifications.service';
import { PostsService } from './posts.service';
import { assertFreeId, withId } from '../common/client-id';
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
// A viewer's own recent likes, for For You affinity (#9).
PostLikeSchema.index({ userId: 1, createdAt: -1 });

@Schema({ collection: 'post_comments', timestamps: true })
export class PostCommentRecord {
  @Prop({ required: true }) postId!: string;
  @Prop({ required: true }) userId!: string;
  @Prop({ required: true }) requestId!: string;
  @Prop({ required: true, maxlength: 1000 }) text!: string;
  @Prop({ default: false }) deleted!: boolean;
  /**
   * A reply: the top-level comment it answers, and the author of the comment that was answered
   * (so "replies to me" is one query). Replies are one level deep: a reply to a reply is stored
   * under the same top-level comment.
   */
  @Prop() parentId?: string;
  @Prop() parentUserId?: string;
  createdAt!: Date;
}
export const PostCommentSchema =
  SchemaFactory.createForClass(PostCommentRecord);
PostCommentSchema.index(
  { postId: 1, userId: 1, requestId: 1 },
  { unique: true },
);
PostCommentSchema.index({ postId: 1, deleted: 1, _id: -1 });
// A viewer's own recent comments, for For You affinity (#9).
PostCommentSchema.index({ userId: 1, createdAt: -1 });
// Replies to someone's comments, for their Activity.
PostCommentSchema.index({ parentUserId: 1, createdAt: -1 }, { sparse: true });

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
      // A comment or reply opens the post on that comment.
      url: (event: { targetId: string; commentId?: string }) => `/posts/${event.targetId}${event.commentId ? `?comment=${event.commentId}` : ''}`,
    };
    this.notifications.register({ type: 'postLike', windowMs: LIKE_WINDOW_MS, ...common });
    this.notifications.register({
      type: 'postComment',
      windowMs: COMMENT_WINDOW_MS,
      ...common,
    });
    this.notifications.register({ type: 'commentReply', windowMs: COMMENT_WINDOW_MS, ...common });
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
    const replies = await this.comments
      .find({ parentUserId: userId, userId: { $ne: userId }, deleted: false, createdAt: filter.createdAt })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    const names = await this.social.displayNames([
      ...likes.map((row) => row.userId),
      ...comments.map((row) => row.userId),
      ...replies.map((row) => row.userId),
      ...reposts.map((row) => row.userId),
    ]);
    const row = (
      type: 'postLike' | 'postComment' | 'postRepost' | 'commentReply',
      r: { postId: string; userId: string; createdAt: Date; _id?: unknown },
    ): ActivityRow => ({
      type,
      actorId: r.userId,
      actorName: names.get(r.userId) ?? 'Former member',
      targetId: r.postId,
      url: type === 'postComment' || type === 'commentReply' ? `/posts/${r.postId}?comment=${String(r._id)}` : `/posts/${r.postId}`,
      postTitle: titles.get(r.postId),
      createdAt: r.createdAt,
    });
    return [
      ...likes.map((r) => row('postLike', r)),
      ...comments.map((r) => row('postComment', r)),
      // A reply under my own post is already there as a comment; these are replies elsewhere.
      ...replies.filter((r) => !titles.has(r.postId)).map((r) => row('commentReply', r)),
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
      | { type: 'postComment'; commentText: string; commentId?: string },
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
      ...(row.parentId ? { parentId: row.parentId } : {}),
    };
  }
  /** Comments the viewer may see: not from someone blocked either way. */
  private async visibleTo(rows: (PostCommentRecord & { _id: unknown })[], viewerId: string, owner: boolean): Promise<PostComment[]> {
    const shown = await Promise.all(
      rows.map(async (row) => {
        if (row.userId !== viewerId && (await this.graph.between(viewerId, row.userId))?.blockedBy.length) return null;
        return this.commentDto(row, viewerId, owner);
      }),
    );
    return shown.filter((row): row is PostComment => row !== null);
  }

  /**
   * A post's top-level comments, newest first, `limit` at a time. Each carries how many replies
   * it has and its newest ones, so a thread can be shown without asking for every reply.
   */
  async list(userId: string, postId: string, before?: string, limit = COMMENTS_MORE): Promise<PostCommentsPage> {
    const post = await this.posts.detail(userId, postId);
    if (before && !isValidObjectId(before)) throw new BadRequestException('Invalid comment cursor.');
    const size = Math.min(Math.max(1, Math.floor(limit) || COMMENTS_MORE), COMMENTS_PAGE_MAX);
    const rows = await this.comments
      .find({ postId, deleted: false, parentId: { $exists: false }, ...(before ? { _id: { $lt: before } } : {}) })
      .sort({ _id: -1 })
      .limit(size + 1)
      .lean();
    const page = rows.slice(0, size);
    const ids = page.map((row) => String(row._id));
    const [counts, newest] = await Promise.all([
      this.comments.aggregate<{ _id: string; n: number }>([{ $match: { postId, deleted: false, parentId: { $in: ids } } }, { $group: { _id: '$parentId', n: { $sum: 1 } } }]),
      Promise.all(ids.map((id) => this.comments.find({ postId, deleted: false, parentId: id }).sort({ _id: -1 }).limit(REPLIES_FIRST).lean())),
    ]);
    const countOf = new Map(counts.map((row) => [row._id, row.n]));
    const comments = await this.visibleTo(page, userId, post.isOwner);
    for (const comment of comments) {
      const index = ids.indexOf(comment.id);
      comment.replyCount = countOf.get(comment.id) ?? 0;
      comment.replies = (await this.visibleTo(newest[index] ?? [], userId, post.isOwner)).reverse();
    }
    return { comments, ...(rows.length > size ? { nextCursor: String(page[page.length - 1]._id) } : {}) };
  }

  /** The replies under one comment, newest first, `limit` at a time. */
  async replies(userId: string, postId: string, commentId: string, before?: string, limit = REPLIES_MORE): Promise<PostCommentsPage> {
    const post = await this.posts.detail(userId, postId);
    if (!isValidObjectId(commentId) || (before && !isValidObjectId(before))) throw new BadRequestException('Invalid comment cursor.');
    const size = Math.min(Math.max(1, Math.floor(limit) || REPLIES_MORE), COMMENTS_PAGE_MAX);
    const rows = await this.comments
      .find({ postId, deleted: false, parentId: commentId, ...(before ? { _id: { $lt: before } } : {}) })
      .sort({ _id: -1 })
      .limit(size + 1)
      .lean();
    const page = rows.slice(0, size);
    return {
      comments: await this.visibleTo(page, userId, post.isOwner),
      ...(rows.length > size ? { nextCursor: String(page[page.length - 1]._id) } : {}),
    };
  }
  async add(userId: string, postId: string, text: string, requestId: string, id?: string, parentId?: string) {
    const post = await this.posts.detail(userId, postId);
    // A reply answers a comment on this post that is still there. Answering a reply lands under
    // the same top-level comment: one level, never a tree.
    let parent: { id: string; userId: string } | undefined;
    if (parentId) {
      const gone = () => new NotFoundException({ code: 'COMMENT_GONE', message: 'That comment is no longer there.' });
      const target = isValidObjectId(parentId) ? await this.comments.findOne({ _id: parentId, postId, deleted: false }).lean() : null;
      if (!target) throw gone();
      const top = target.parentId ? await this.comments.findOne({ _id: target.parentId, postId, deleted: false }).lean() : target;
      if (!top) throw gone();
      if (target.userId !== userId && (await this.graph.between(userId, target.userId))?.blockedBy.length) throw gone();
      // The person answered is the one whose comment was tapped, even under someone else's thread.
      parent = { id: String(top._id), userId: target.userId };
    }
    const value = text.trim();
    if (!value || value.length > 1000)
      throw new BadRequestException('Write a comment of 1–1,000 characters.');
    const actor = await this.social.own(userId);
    const filter = { postId, userId, requestId };
    let created = false;
    // Spec 031: a comment written offline carries the id the device gave it. A retry finds its
    // own row by `requestId`; a new one must not take an id anyone already has.
    if (id && !(await this.comments.exists(filter))) await assertFreeId(this.comments, id);
    try {
      const result = await this.comments.updateOne(
        filter,
        { $setOnInsert: { ...filter, ...withId(id), text: value, deleted: false, ...(parent ? { parentId: parent.id, parentUserId: parent.userId } : {}) } },
        { upsert: true },
      );
      // A retried requestId returns the original comment and must not notify again.
      // A retried requestId returns the original comment and must not notify again.
      created = !!result.upsertedCount;
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }
    const row = await this.comments.findOne(filter).lean();
    if (!row || row.deleted)
      throw new NotFoundException('Comment no longer available.');
    if (created) {
      const commentId = String(row._id);
      this.notifyOwner(post, userId, actor.displayName, { type: 'postComment', commentText: value, commentId });
      // The person answered hears about it too, unless they are the post's owner (told above).
      if (parent && parent.userId !== userId && parent.userId !== post.author.userId)
        void this.notifications.notify({
          type: 'commentReply',
          recipientId: parent.userId,
          actorId: userId,
          actorName: actor.displayName,
          targetId: post.id,
          commentText: value,
          commentId,
        });
    }
    return this.commentDto(row, userId, post.isOwner);
  }

  /**
   * The thread one comment sits in, for a link that points at it: its top-level comment with the
   * reply count, and the reply itself when the link is to a reply. 404 when it is gone or hidden.
   */
  async thread(userId: string, postId: string, commentId: string): Promise<PostComment> {
    const post = await this.posts.detail(userId, postId);
    const gone = () => new NotFoundException({ code: 'COMMENT_GONE', message: 'That comment is no longer there.' });
    const target = isValidObjectId(commentId) ? await this.comments.findOne({ _id: commentId, postId, deleted: false }).lean() : null;
    if (!target) throw gone();
    const top = target.parentId ? await this.comments.findOne({ _id: target.parentId, postId, deleted: false }).lean() : target;
    if (!top) throw gone();
    const [thread] = await this.visibleTo([top], userId, post.isOwner);
    if (!thread) throw gone();
    const replies = target.parentId
      ? [target]
      : await this.comments.find({ postId, deleted: false, parentId: String(top._id) }).sort({ _id: -1 }).limit(REPLIES_FIRST).lean();
    thread.replyCount = await this.comments.countDocuments({ postId, deleted: false, parentId: String(top._id) });
    thread.replies = (await this.visibleTo(replies, userId, post.isOwner)).reverse();
    if (target.parentId && !thread.replies.length) throw gone();
    return thread;
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
    // A removed comment takes its replies with it.
    if (result.matchedCount) await this.comments.updateMany({ postId, parentId: commentId, deleted: false }, { $set: { deleted: true, text: '' } });
    if (!result.matchedCount) {
      // Spec 031: removing a comment already removed (a retry, or another device) is done.
      const gone = await this.comments.exists({
        _id: commentId,
        postId,
        deleted: true,
        ...(!post.isOwner ? { userId } : {}),
      });
      if (!gone) throw new NotFoundException('Comment not found.');
    }
    return { success: true };
  }
}
