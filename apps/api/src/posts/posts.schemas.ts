import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  AUDIENCES,
  POST_HOLD_REASONS,
  REPORT_REASONS,
  type PostHoldReason,
  type Audience,
  type ForYouReasonCode,
  type FoodPublication,
  type MediaKind,
  type ReportReason,
  type TrainingPublication,
} from '@life-portal/shared-types';
import { baseSchemaOptions } from '../common/mongoose';
export interface AttachedMedia {
  id: string;
  kind: MediaKind;
  key: string;
  posterKey?: string;
  contentType: string;
  width: number;
  height: number;
  durationMs?: number;
}
@Schema({ ...baseSchemaOptions, collection: 'food_posts' })
export class FoodPostRecord {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true }) requestId!: string;
  /** Present exactly when the post carries food. Text and media posts have neither. */
  @Prop() previewHash?: string;
  @Prop({ type: Object }) publication?: FoodPublication;
  /**
   * Spec 036: the Training attachment, a snapshot built by `TrainingPublicationService` at
   * publishing time. Independent of `publication`: nothing assumes a post has only one of them.
   */
  @Prop({ type: Object }) training?: TrainingPublication;
  @Prop() trainingHash?: string;
  /** Spec 036: whether viewers may copy the Training attachment. Absent means yes. */
  @Prop() allowCopy?: boolean;
  /** A copy of each attached file's facts, so a read needs no join. The files never change. */
  @Prop({ type: [Object], default: undefined }) media?: AttachedMedia[];
  @Prop({ default: '', maxlength: 120 }) title!: string;
  @Prop({ default: '', maxlength: 1000 }) caption!: string;
  @Prop({ type: String, enum: AUDIENCES, default: 'private' })
  audience!: Audience;
  /**
   * A link-only post: `audience` stays `private`, so every list and feed treats it as private,
   * and this key is the secret in its link. Absent on every other post.
   */
  @Prop() linkKey?: string;
  /** Who may read a link-only post besides its author: people sent it, or who opened the link. */
  @Prop({ type: [String], default: undefined }) linkViewers?: string[];
  @Prop({ default: 1 }) version!: number;
  @Prop({ default: false, index: true }) deleted!: boolean;
  /**
   * Set on a repost: the original post's id, and nothing else of its own (no title, caption,
   * food or media). Its `requestId` is `repost:<original id>`, so one member reposts a post once.
   */
  @Prop() repostOf?: string;
  /**
   * Spec 039: while set, only the author can read the post. `heldReason` says why: its photos
   * are waiting for the automatic check, the check flagged them, or people reported it.
   */
  @Prop({ type: Date }) heldAt?: Date;
  @Prop({ type: String, enum: POST_HOLD_REASONS }) heldReason?: PostHoldReason;
  /** The automatic check of this post's photos. Absent: never checked (no photos, or private). */
  @Prop({ type: String, enum: ['ok', 'flagged'] }) mediaCheck?: 'ok' | 'flagged';
  @Prop({ type: [String], default: undefined }) checkCategories?: string[];
  /** What the check scored, per category (0 to 1), and when: numbers only, for tuning the rule. */
  @Prop({ type: Object }) checkScores?: Record<string, number>;
  @Prop({ type: Date }) checkedAt?: Date;
  /** A reviewer kept the post: reports no longer hide it, though they still reach the queue. */
  @Prop({ type: Date }) reviewedAt?: Date;
  createdAt!: Date;
  updatedAt!: Date;
}
export const FoodPostSchema = SchemaFactory.createForClass(FoodPostRecord);
FoodPostSchema.index({ userId: 1, requestId: 1 }, { unique: true });
FoodPostSchema.index({ userId: 1, createdAt: -1, _id: -1 });
FoodPostSchema.index({ repostOf: 1, createdAt: -1 }, { sparse: true });
// For You (spec 018): public posts newest first. Reposts are filtered after the index (Mongo
// cannot build a partial index on a field being absent).
FoodPostSchema.index({ audience: 1, deleted: 1, createdAt: -1, _id: -1 });
@Schema({ ...baseSchemaOptions, collection: 'post_reports' })
export class PostReportRecord {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true }) postId!: string;
  @Prop({ type: String, enum: REPORT_REASONS, required: true })
  reason!: ReportReason;
  @Prop({ type: Date }) resolvedAt?: Date;
  /** What the reviewer decided about the post this report was for. */
  @Prop({ type: String, enum: ['removed', 'kept'] }) resolution?: 'removed' | 'kept';
  createdAt!: Date;
}
export const PostReportSchema = SchemaFactory.createForClass(PostReportRecord);
PostReportSchema.index({ userId: 1, postId: 1 }, { unique: true });
/**
 * "Not interested" feedback on For You (issue #3, task A): one row per viewer and post, or per
 * viewer and author. It only shapes For You; Friends, profiles and direct links are unchanged.
 */
export const FEED_FEEDBACK_KINDS = ['post', 'author'] as const;
export type FeedFeedbackKind = (typeof FEED_FEEDBACK_KINDS)[number];
@Schema({ ...baseSchemaOptions, collection: 'feed_feedback' })
export class FeedFeedbackRecord {
  @Prop({ required: true }) userId!: string;
  @Prop({ type: String, enum: FEED_FEEDBACK_KINDS, required: true })
  kind!: FeedFeedbackKind;
  /** A post id for `post`, a user id for `author`. */
  @Prop({ required: true }) targetId!: string;
  createdAt!: Date;
}
export const FeedFeedbackSchema = SchemaFactory.createForClass(FeedFeedbackRecord);
FeedFeedbackSchema.index({ userId: 1, kind: 1, targetId: 1 }, { unique: true });
/**
 * A viewer's ranked For You session (#9): the order of at most 300 post ids and short reason
 * codes, so paging stays stable while engagement moves. The one documented exception to "derived
 * is never persisted" in posts (DECISIONS 2026-11-13): it holds no content, one row per viewer
 * (replaced by each new first page) and Mongo's TTL monitor deletes it after `expiresAt`. Every
 * post is re-read and re-checked when its page is served.
 */
@Schema({ ...baseSchemaOptions, collection: 'for_you_sessions' })
export class ForYouSessionRecord {
  @Prop({ required: true, unique: true }) userId!: string;
  /** Random per session: seeds exploration and binds cursors to this session. */
  @Prop({ required: true }) seed!: string;
  @Prop({ type: String, enum: ['ranked', 'chronological'], required: true })
  mode!: 'ranked' | 'chronological';
  @Prop({ type: [Object], default: [] })
  entries!: { postId: string; reasons: { code: ForYouReasonCode; topicId?: string }[] }[];
  /** How far into `entries` the viewer has been served: everything before it counts as seen. */
  @Prop({ default: 0 }) served!: number;
  /** Posts served in earlier sessions, newest last, so a refresh leads with what is new to them. */
  @Prop({ type: [String], default: [] }) seen!: string[];
  @Prop({ type: Date, required: true }) expiresAt!: Date;
}
export const ForYouSessionSchema = SchemaFactory.createForClass(ForYouSessionRecord);
ForYouSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
/**
 * A viewer's explicit For You preferences (#10): the interest ids they chose and when they last
 * reset recommendations. Their own choices, not an inferred profile; private, used by For You only.
 */
@Schema({ ...baseSchemaOptions, collection: 'feed_preferences' })
export class FeedPreferencesRecord {
  @Prop({ required: true, unique: true }) userId!: string;
  @Prop({ type: [String], default: [] }) interests!: string[];
  @Prop({ type: Date }) recommendationsResetAt?: Date;
  /** Opted out of For You measurement (#11). Absent means not opted out. */
  @Prop() metricsOptOut?: boolean;
}
export const FeedPreferencesSchema = SchemaFactory.createForClass(FeedPreferencesRecord);
