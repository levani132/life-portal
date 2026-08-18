import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { baseSchemaOptions } from '../../common/mongoose';

@Schema({
  ...baseSchemaOptions,
  collection: 'users',
  toJSON: {
    ...(baseSchemaOptions.toJSON as object),
    // Belt and braces: even if a controller returns a raw user, no hash leaves the process.
    transform: (doc, ret: Record<string, unknown>) => {
      const base = (baseSchemaOptions.toJSON as { transform: (d: unknown, r: Record<string, unknown>) => Record<string, unknown> }).transform;
      const out = base(doc, ret);
      delete out['passwordHash'];
      delete out['refreshTokenHash'];
      return out;
    },
  },
})
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true, index: true })
  email!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  /**
   * Hash of the currently valid refresh token. Storing it lets logout actually invalidate a
   * session rather than merely asking the client to forget the token.
   */
  @Prop({ select: false })
  refreshTokenHash?: string;

  @Prop({ type: [String], default: ['owner'] })
  roles!: string[];

  @Prop()
  lastLoginAt?: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
