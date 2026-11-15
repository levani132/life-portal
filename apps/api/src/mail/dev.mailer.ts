import { Logger } from '@nestjs/common';
import type { Model } from 'mongoose';
import type { Mailer, MailMessage } from './mailer';
import type { DevMail } from './mail.schemas';

/**
 * Development sink (issue #27): stores each message in `dev_mail` for a day instead of sending
 * it. Configuration refuses it unless WEB_BASE_URL is a loopback address, so it cannot run in
 * production. It logs who and what, never the body, because the body holds the link.
 */
export class DevMailer implements Mailer {
  readonly provider = 'dev' as const;
  private readonly logger = new Logger('DevMail');

  constructor(private readonly mail: Model<DevMail>) {}

  async send(message: MailMessage): Promise<void> {
    const createdAt = new Date();
    await this.mail.create({ ...message, createdAt, expiresAt: new Date(createdAt.getTime() + 86_400_000) });
    this.logger.log(`Stored "${message.subject}" for ${message.to} in dev_mail (not sent).`);
  }
}
