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

  /**
   * Spec 040: a page is an account nobody signs in to. `kind` is absent for a person. A page has
   * no password and no sign-in identity; its `email` is a reserved address that cannot receive
   * mail, there only because the field is required and unique.
   */
  @Prop({ type: String, enum: ['page'] })
  kind?: 'page';

  /** A page's managers: the people who may act as it. One for now. */
  @Prop({ type: [String], default: undefined })
  managers?: string[];

  /** The person who created the page. What their page limit counts. */
  @Prop()
  createdBy?: string;

  /** The app's own page, set by the owner. */
  @Prop()
  official?: boolean;

  /** Run with AI, as a manager declared. */
  @Prop()
  aiManaged?: boolean;

  /** On a person: how many pages they may create. Absent: the default; -1: no limit. */
  @Prop()
  pageLimit?: number;

  /** Spec 041, on a page: switched off by its manager. Hidden everywhere, nothing deleted. */
  @Prop()
  disabledAt?: Date;

  /** Spec 041, on a person: whether a linked AI assistant may act as the pages they marked "run with AI". */
  @Prop()
  assistantPages?: boolean;

  /** Spec 041, on a person: the owner's override of the assistant's daily caps, per kind. Absent: the defaults. */
  @Prop({ type: Object })
  assistantCaps?: Record<string, number>;

  /**
   * When the person agreed to the terms, privacy policy and community rules, and to their health
   * information being stored, and which dated version (`LEGAL_VERSION`). Absent on accounts made
   * before 2026-11-22, by invitation.
   */
  @Prop()
  agreedAt?: Date;

  @Prop({ maxlength: 20 })
  agreedVersion?: string;

  /**
   * Spec 039: set by the reviewer. A suspended account cannot sign in, has no session, and
   * every feature reads as off for it, so nothing it posted is shown to anyone.
   */
  @Prop()
  suspendedAt?: Date;

  @Prop({ maxlength: 200 })
  suspendedReason?: string;

  /** Spec 045: a page suspended because none of its managers can act; restored with one of them. */
  @Prop()
  suspendedForManagers?: boolean;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ managers: 1 }, { sparse: true });
UserSchema.index({ createdBy: 1 }, { sparse: true });
