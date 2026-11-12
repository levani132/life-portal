import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, requiredDayField } from '../common/mongoose';

/**
 * The one persisted badge fact: a person reached a tier (spec 022, research R3). Written once
 * with `$setOnInsert` and never edited or deleted, so later edits to history cannot revoke it.
 * Progress is never stored.
 */
@Schema({ ...baseSchemaOptions, collection: 'badge_awards' })
export class BadgeAward {
  @Prop({ required: true }) userId!: string;
  /** Any string, so a future challenge badge needs no schema change. */
  @Prop({ required: true }) badgeId!: string;
  /** The threshold reached; `1` for an untiered badge. */
  @Prop({ required: true, min: 1 }) tier!: number;
  @Prop(requiredDayField) earnedOn!: string;
  @Prop({ required: true, enum: ['rule', 'challenge'] }) source!: string;
  @Prop() sourceId?: string;
}

export const BadgeAwardSchema = SchemaFactory.createForClass(BadgeAward);
BadgeAwardSchema.index({ userId: 1, badgeId: 1, tier: 1 }, { unique: true });
BadgeAwardSchema.index({ userId: 1, createdAt: -1 });

/** A person's equipped badges, in display order. The tier is never stored: the highest is shown. */
@Schema({ ...baseSchemaOptions, collection: 'badge_selections' })
export class BadgeSelection {
  @Prop({ required: true, unique: true }) userId!: string;
  @Prop({ type: [String], required: true }) equipped!: string[];
}

export const BadgeSelectionSchema = SchemaFactory.createForClass(BadgeSelection);
