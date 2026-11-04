import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { MEDIA_KINDS, type MediaKind } from '@life-portal/shared-types';
import { baseSchemaOptions } from '../common/mongoose';

/**
 * The upload ledger. A row is created when an upload link is handed out and is pending until a
 * post claims it (`postId`). Pending rows older than a day are deleted with their files.
 */
@Schema({ ...baseSchemaOptions, collection: 'post_media' })
export class MediaUploadRecord {
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
export const MediaUploadSchema = SchemaFactory.createForClass(MediaUploadRecord);
MediaUploadSchema.index({ userId: 1, createdAt: -1 });
MediaUploadSchema.index({ postId: 1 }, { sparse: true });
MediaUploadSchema.index(
  { createdAt: 1 },
  { partialFilterExpression: { postId: { $exists: false } } },
);
