import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { FeatureAccess } from '@life-portal/shared-types';
import { HydratedDocument } from 'mongoose';
import { baseSchemaOptions } from '../../common/mongoose';

@Schema({
  ...baseSchemaOptions,
  collection: 'users',
  toJSON: {
    ...(baseSchemaOptions.toJSON as object),
    // Belt and braces: even if a controller returns a raw user, no hash leaves the process.
    transform: (doc, ret: Record<string, unknown>) => {
      const base = (
        baseSchemaOptions.toJSON as {
          transform: (
            d: unknown,
            r: Record<string, unknown>,
          ) => Record<string, unknown>;
        }
      ).transform;
      const out = base(doc, ret);
      delete out['passwordHash'];
      delete out['refreshTokenHash'];
      return out;
    },
  },
})
export class User {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  /**
   * Absent for an account made with Google (issue #28) until a password is added through
   * "Forgot password". Sign-in, change and unlink all handle that.
   */
  @Prop({ select: false })
  passwordHash?: string;

  /**
   * @deprecated Never read since issue #27; sessions live in `auth_sessions`. It was a bcrypt
   * hash, and bcrypt only reads 72 bytes, which every refresh token of one user shared, so it
   * could not revoke anything. Kept in the schema only so sign-in can `$unset` it.
   */
  @Prop({ select: false })
  refreshTokenHash?: string;

  @Prop({ type: [String], default: ['owner'] })
  roles!: string[];

  // Missing on legacy accounts; resolved as internal without changing stored data.
  @Prop({ type: String, enum: ['production', 'internal'] })
  cohort?: 'production' | 'internal';

  @Prop({ type: Object, default: {} })
  featureOverrides?: Partial<FeatureAccess>;

  @Prop()
  lastLoginAt?: Date;

  /**
   * When the person proved they read this address (issue #27): a verification link, or a
   * password reset, which needs the inbox too. Missing on every account made before #27, which
   * is never blocked for it. Linking another sign-in method (#28) requires it.
   */
  @Prop()
  emailVerifiedAt?: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
