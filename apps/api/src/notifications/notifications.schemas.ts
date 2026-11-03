import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { NotificationType } from '@life-portal/shared-types';

/**
 * Three collections, each holding only facts (see data-model.md):
 * a device that can receive pushes, a member's choices, and when we last pushed something.
 * Activity and unread counts are derived on read and never stored here.
 */

@Schema({ collection: 'push_devices', timestamps: true, versionKey: false })
export class PushDevice {
  @Prop({ required: true, index: true }) userId!: string;
  /** Capability URL for this device. Never returned in a response or written to a log. */
  @Prop({ required: true, unique: true, maxlength: 1024 }) endpoint!: string;
  @Prop({
    type: { p256dh: { type: String, required: true }, auth: { type: String, required: true } },
    required: true,
    _id: false,
  })
  keys!: { p256dh: string; auth: string };
  @Prop({ required: true, maxlength: 60 }) label!: string;
  @Prop({ required: true }) lastUsedAt!: Date;
  @Prop() lastSuccessAt?: Date;
  createdAt!: Date;
}
export const PushDeviceSchema = SchemaFactory.createForClass(PushDevice);
PushDeviceSchema.index({ userId: 1, lastUsedAt: -1 });

/** No Mongo defaults on optional fields: a missing value must read as missing. */
@Schema({ collection: 'notification_preferences', timestamps: true, versionKey: false })
export class NotificationPreferencesRecord {
  @Prop({ required: true, unique: true }) userId!: string;
  @Prop() enabled?: boolean;
  @Prop({ type: Object }) types?: Partial<Record<NotificationType, boolean>>;
  @Prop() showCommentPreviews?: boolean;
  @Prop() showMessagePreviews?: boolean;
  @Prop() activitySeenAt?: Date;
  @Prop() offerDismissedAt?: Date;
}
export const NotificationPreferencesSchema = SchemaFactory.createForClass(
  NotificationPreferencesRecord,
);

/** Collapse state only. Losing it at worst sends one extra notification. */
@Schema({ collection: 'notification_deliveries', versionKey: false })
export class NotificationDelivery {
  @Prop({ required: true }) recipientId!: string;
  @Prop({ required: true }) type!: string;
  @Prop({ required: true }) collapseKey!: string;
  @Prop({ required: true }) lastSentAt!: Date;
  @Prop({ required: true }) suppressed!: number;
}
export const NotificationDeliverySchema =
  SchemaFactory.createForClass(NotificationDelivery);
NotificationDeliverySchema.index(
  { recipientId: 1, type: 1, collapseKey: 1 },
  { unique: true },
);
NotificationDeliverySchema.index({ lastSentAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });
