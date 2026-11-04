import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  AUDIENCES,
  REPORT_REASONS,
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

