import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Another way to sign in to an account (issue #28). Keyed by the provider's stable subject id,
 * never by email: Google's `sub` stays the same when the person changes their Gmail address.
 */
@Schema({ collection: 'user_identities', versionKey: false })
export class UserIdentity {
  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true, enum: ['google'] })
  provider!: 'google';

  @Prop({ required: true })
  subject!: string;

  /** The provider's email when it was linked or last used. Shown, never used to match. */
  @Prop()
  email?: string;

  @Prop({ required: true })
  linkedAt!: Date;

  @Prop()
  lastUsedAt?: Date;
}
export const UserIdentitySchema = SchemaFactory.createForClass(UserIdentity);
UserIdentitySchema.index({ provider: 1, subject: 1 }, { unique: true });
UserIdentitySchema.index({ userId: 1, provider: 1 }, { unique: true });

/** What a finished Google round trip decided, waiting for the browser that started it. */
export type GoogleOutcome =
  | { kind: 'signin'; userId: string }
  | { kind: 'linked'; userId: string }
  | { kind: 'needs_password'; userId: string; subject: string; email: string }
  | { kind: 'needs_invite'; subject: string; email: string; name: string }
  | { kind: 'error'; code: GoogleErrorCode };

export type { GoogleErrorCode } from '@life-portal/shared-types';
import type { GoogleErrorCode } from '@life-portal/shared-types';

/**
 * Short-lived Google sign-in state (issue #28), one collection for three kinds of row, each
 * found by the SHA-256 of a random value that only its holder has:
 *
 * - `start`: the `state` sent to Google, with the PKCE verifier, the nonce and the hash of the
 *   browser's binding secret. 10 minutes.
 * - `result`: the one-time code the callback hands the web app, with the outcome. 5 minutes.
 * - `link_ticket`: lets a signed-in person start a link without a bearer token in a URL. 2 minutes.
 *
 * Every row is spent with an atomic `findOneAndDelete`, so none works twice.
 */
@Schema({ collection: 'oauth_flows', versionKey: false })
export class OAuthFlow {
  @Prop({ required: true, enum: ['start', 'result', 'link_ticket'] })
  kind!: 'start' | 'result' | 'link_ticket';

  @Prop({ required: true, unique: true })
  keyHash!: string;

  /** SHA-256 of the secret the starting browser kept; the result needs the secret itself. */
  @Prop()
  bindingHash?: string;

  @Prop() codeVerifier?: string;
  @Prop() nonce?: string;
  @Prop({ enum: ['signin', 'link'] }) intent?: 'signin' | 'link';
  @Prop() userId?: string;
  @Prop() returnTo?: string;
  @Prop({ type: Object }) outcome?: GoogleOutcome;

  @Prop({ required: true, expires: 0 })
  expiresAt!: Date;
}
export const OAuthFlowSchema = SchemaFactory.createForClass(OAuthFlow);
