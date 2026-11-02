import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel, Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import type {
  PostComment,
  PostCommentsPage,
  PostEngagement,
} from '@life-portal/shared-types';
import { PostsService } from './posts.service';
import { SocialService } from '../social/social.module';
import { SocialGraphService } from '../social-graph/social-graph.module';

@Schema({ collection: 'post_likes', timestamps: true })
export class PostLikeRecord {
  @Prop({ required: true }) postId!: string;
  @Prop({ required: true }) userId!: string;
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

@Injectable()
export class PostEngagementService {
  constructor(
    @InjectModel(PostLikeRecord.name)
    private readonly likes: Model<PostLikeRecord>,
    @InjectModel(PostCommentRecord.name)
    private readonly comments: Model<PostCommentRecord>,
    private readonly posts: PostsService,
    private readonly social: SocialService,
    private readonly graph: SocialGraphService,
  ) {}
  private async counts(
    userId: string,
    postId: string,
  ): Promise<PostEngagement> {
    const [likeCount, commentCount, liked] = await Promise.all([
      this.likes.countDocuments({ postId }),
      this.comments.countDocuments({ postId, deleted: false }),
      this.likes.exists({ postId, userId }),
    ]);
    return { likeCount, commentCount, liked: !!liked };
  }
  async stats(userId: string, postId: string) {
    await this.posts.detail(userId, postId);
    return this.counts(userId, postId);
  }
  async setLike(userId: string, postId: string, liked: boolean) {
    await this.posts.detail(userId, postId);
    if (liked) {
      try {
        await this.likes.updateOne(
          { postId, userId },
          { $setOnInsert: { postId, userId } },
          { upsert: true },
        );
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    } else await this.likes.deleteOne({ postId, userId });
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
    await this.social.own(userId);
    const filter = { postId, userId, requestId };
    try {
      await this.comments.updateOne(
        filter,
        { $setOnInsert: { ...filter, text: value, deleted: false } },
        { upsert: true },
      );
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
