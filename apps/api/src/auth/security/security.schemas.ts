import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** One counter per (rule, hashed subject, window). Mongo deletes it once the window is over. */
@Schema({ collection: 'auth_rate_limits', versionKey: false })
export class RateLimitCounter {
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop({ required: true, default: 0 })
  count!: number;

  @Prop({ required: true, expires: 0 })
  expiresAt!: Date;
}
export const RateLimitCounterSchema = SchemaFactory.createForClass(RateLimitCounter);

export type SecurityEventType =
  | 'register'
  | 'login_succeeded'
  | 'login_failed'
  | 'logout'
  | 'logout_all'
  | 'session_revoked'
  | 'sessions_revoked_others'
  | 'refresh_replay'
  | 'password_changed'
  | 'password_change_failed'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'password_reset_failed'
  | 'email_verification_sent'
  | 'email_verified'
  | 'rate_limited'
  | 'google_signin'
  | 'google_linked'
  | 'google_unlinked'
  | 'google_failed'
  /** Spec 038. Recorded with no account: the account is gone. */
  | 'account_deleted'
  /** Spec 039. */
  | 'account_suspended'
  | 'account_restored';

/**
 * A security event (issue #27 S2), kept 90 days. Never an email, a password, a token or a raw IP:
 * `ipHash` is an HMAC that lets events from one address be grouped, not traced back to it.
 */
@Schema({ collection: 'security_events', versionKey: false })
export class SecurityEvent {
  @Prop({ required: true })
  type!: SecurityEventType;

  @Prop({ index: true })
  userId?: string;

  @Prop()
  ipHash?: string;

  /** A short, fixed vocabulary detail, e.g. the rate-limit bucket or a refusal code. */
  @Prop({ maxlength: 40 })
  detail?: string;

  @Prop({ required: true })
  at!: Date;

  @Prop({ required: true, expires: 0 })
  expiresAt!: Date;
}
export const SecurityEventSchema = SchemaFactory.createForClass(SecurityEvent);
SecurityEventSchema.index({ type: 1, at: -1 });
