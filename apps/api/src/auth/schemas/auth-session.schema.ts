import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { baseSchemaOptions } from '../../common/mongoose';

/**
 * One signed-in device (issue #27).
 *
 * Holds the SHA-256 of the refresh token currently valid for it, and of the one it replaced.
 * A refresh token is a signed JWT with a random `jti`, so a fast hash is enough: there is
 * nothing to brute-force. (bcrypt was used before and only reads 72 bytes, which every refresh
 * token of one user shared, so revocation did not work. See docs/DECISIONS.md.)
 */
@Schema({ ...baseSchemaOptions, collection: 'auth_sessions' })
export class AuthSessionRecord {
  @Prop({ required: true, index: true })
  userId!: string;

  /** SHA-256 (hex) of the refresh token that is valid now. */
  @Prop({ required: true, unique: true })
  tokenHash!: string;

  /** SHA-256 of the token this one replaced, kept to tell a benign race from a replay. */
  @Prop()
  previousHash?: string;

  @Prop()
  rotatedAt?: Date;

  @Prop({ required: true })
  lastUsedAt!: Date;

  /** Slides forward on every refresh; Mongo deletes the row once it passes. */
  @Prop({ required: true, expires: 0 })
  expiresAt!: Date;

  @Prop({ required: true, maxlength: 80 })
  device!: string;

  @Prop()
  revokedAt?: Date;

  @Prop({ type: String })
  revokedReason?: SessionRevokeReason;

  createdAt?: Date;
}

export type SessionRevokeReason =
  | 'logout'
  | 'logout_all'
  | 'revoked'
  | 'password_change'
  | 'password_reset'
  | 'replay';

export type AuthSessionDocument = HydratedDocument<AuthSessionRecord>;
export const AuthSessionSchema = SchemaFactory.createForClass(AuthSessionRecord);
AuthSessionSchema.index({ userId: 1, revokedAt: 1 });
