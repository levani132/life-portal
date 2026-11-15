import { Module } from '@nestjs/common';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CONFIG, type AppConfig } from '../config/configuration';
import { DevMailer } from './dev.mailer';
import { DevMail, DevMailSchema } from './mail.schemas';
import { MAILER, type Mailer } from './mailer';
import { ResendMailer } from './resend.mailer';

/** Provides `MAILER`: a `Mailer`, or `null` when no provider is configured. */
@Module({
  imports: [MongooseModule.forFeature([{ name: DevMail.name, schema: DevMailSchema }])],
  providers: [
    {
      provide: MAILER,
      inject: [CONFIG, getModelToken(DevMail.name)],
      useFactory: (config: AppConfig, devMail: Model<DevMail>): Mailer | null => {
        if (config.mail?.provider === 'resend') return new ResendMailer(config.mail.apiKey, config.mail.from);
        if (config.mail?.provider === 'dev') return new DevMailer(devMail);
        return null;
      },
    },
  ],
  exports: [MAILER],
})
export class MailModule {}
