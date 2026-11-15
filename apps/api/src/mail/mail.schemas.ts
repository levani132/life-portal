import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** What the development sink keeps. Only ever written when MAIL_PROVIDER=dev on loopback. */
@Schema({ collection: 'dev_mail', versionKey: false })
export class DevMail {
  @Prop({ required: true, index: true }) to!: string;
  @Prop({ required: true }) subject!: string;
  @Prop({ required: true }) text!: string;
  @Prop({ required: true }) html!: string;
  @Prop({ required: true }) createdAt!: Date;
  @Prop({ required: true, expires: 0 }) expiresAt!: Date;
}
export const DevMailSchema = SchemaFactory.createForClass(DevMail);
