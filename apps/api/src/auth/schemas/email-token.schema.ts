import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * A one-time token sent by email (issue #27): a password reset or an email verification. Only
 * the SHA-256 of the token is stored. `usedAt` is set atomically when it is spent or replaced;
 * Mongo deletes the row once it expires.
 */
@Schema({ collection: 'auth_email_tokens', versionKey: false })
export class EmailToken {
  @Prop({ required: true, enum: ['password_reset', 'verify_email'] })
  purpose!: 'password_reset' | 'verify_email';

  @Prop({ required: true, index: true })
  userId!: string;

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  /** For verification: the address the link confirms, so a later email change cannot reuse it. */
  @Prop()
  email?: string;

  @Prop({ required: true })
  createdAt!: Date;

  @Prop({ required: true, expires: 0 })
  expiresAt!: Date;

  @Prop()
  usedAt?: Date;
}
export type EmailTokenDocument = HydratedDocument<EmailToken>;
export const EmailTokenSchema = SchemaFactory.createForClass(EmailToken);
EmailTokenSchema.index({ userId: 1, purpose: 1, usedAt: 1 });
