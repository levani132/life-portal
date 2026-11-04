import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  AUDIENCES,
  REPORT_REASONS,
  MEDIA_KINDS,
  type Audience,
  type FoodPublication,
  type MediaKind,
  type ReportReason,
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
  /** A copy of each attached file's facts, so a read needs no join. The files never change. */
  @Prop({ type: [Object], default: undefined }) media?: AttachedMedia[];
  @Prop({ default: '', maxlength: 120 }) title!: string;
  @Prop({ default: '', maxlength: 1000 }) caption!: string;
  @Prop({ type: String, enum: AUDIENCES, default: 'private' })
  audience!: Audience;
  @Prop({ default: 1 }) version!: number;
  @Prop({ default: false, index: true }) deleted!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}
export const FoodPostSchema = SchemaFactory.createForClass(FoodPostRecord);
FoodPostSchema.index({ userId: 1, requestId: 1 }, { unique: true });
FoodPostSchema.index({ userId: 1, createdAt: -1, _id: -1 });
@Schema({ ...baseSchemaOptions, collection: 'post_reports' })
export class PostReportRecord {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true }) postId!: string;
  @Prop({ type: String, enum: REPORT_REASONS, required: true })
  reason!: ReportReason;
  @Prop({ type: Date }) resolvedAt?: Date;
  createdAt!: Date;
}
export const PostReportSchema = SchemaFactory.createForClass(PostReportRecord);
PostReportSchema.index({ userId: 1, postId: 1 }, { unique: true });

/**
 * The upload ledger. A row is created when an upload link is handed out and is pending until a
 * post claims it (`postId`). Pending rows older than a day are deleted with their files.
 */
@Schema({ ...baseSchemaOptions, collection: 'post_media' })
export class PostMediaRecord {
  @Prop({ required: true }) userId!: string;
  @Prop({ type: String, enum: MEDIA_KINDS, required: true }) kind!: MediaKind;
  @Prop({ required: true }) key!: string;
  @Prop() posterKey?: string;
  @Prop() posterBytes?: number;
  @Prop({ required: true }) contentType!: string;
  @Prop({ required: true }) bytes!: number;
  @Prop({ required: true }) width!: number;
  @Prop({ required: true }) height!: number;
  @Prop() durationMs?: number;
  @Prop() postId?: string;
  /** The create request that claimed it, so a retried publish finds its own media again. */
  @Prop() requestId?: string;
  createdAt!: Date;
}
export const PostMediaSchema = SchemaFactory.createForClass(PostMediaRecord);
PostMediaSchema.index({ userId: 1, createdAt: -1 });
PostMediaSchema.index({ postId: 1 }, { sparse: true });
PostMediaSchema.index(
  { createdAt: 1 },
  { partialFilterExpression: { postId: { $exists: false } } },
);
