import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CONFIG, type AppConfig } from '../config/configuration';
import { MAILER, type Mailer } from '../mail/mailer';
import { verifyEmail } from './emails';
import { EmailTokensService } from './email-tokens.service';
import { User } from './schemas/user.schema';
import { RATE_RULES } from './security/rate-limit-rules';
import { SecurityService, type RequestContext } from './security/security.service';

export const VERIFY_TTL_HOURS = 48;

/**
 * Email verification (issue #27 S5). Never blocks anything: an unverified account signs in and
 * uses the app as before. It exists so that #28 can link another sign-in method only to an
 * address the person has proved they read. A link confirms the address it was sent to, so it is
 * void if the account's email has changed since.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger('EmailVerification');

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @Inject(MAILER) private readonly mailer: Mailer | null,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly tokens: EmailTokensService,
    private readonly security: SecurityService,
  ) {}

  get available(): boolean {
    return Boolean(this.mailer && this.config.webBaseUrl);
  }

  /** Sends a link to the signed-in person's address, unless it is already confirmed. */
  async send(userId: string, ctx: RequestContext): Promise<{ sent: boolean; alreadyVerified: boolean }> {
    const user = await this.users.findById(userId).select('email name emailVerifiedAt');
    if (!user) throw new BadRequestException('Account not found.');
    if (user.emailVerifiedAt) return { sent: false, alreadyVerified: true };
    if (!this.available) {
      throw new ServiceUnavailableException({
        code: 'VERIFY_UNAVAILABLE',
        message: "Email verification isn't available on this Life Portal yet.",
      });
    }
    await this.security.hit(RATE_RULES.verifyByUser, userId, ctx);
    await this.deliver(userId, user.name, user.email, ctx);
    return { sent: true, alreadyVerified: false };
  }

  /** After sign-up: best effort, never awaited by the response, never fails it. */
  sendAfterRegister(userId: string, name: string, email: string, ctx: RequestContext): void {
    if (!this.available) return;
    void this.deliver(userId, name, email, ctx).catch(() => undefined);
  }

  async confirm(token: string, ctx: RequestContext): Promise<{ verified: true }> {
    await this.security.hit(RATE_RULES.resetByIp, ctx.ip, ctx);
    const spent = await this.tokens.consume(token, 'verify_email');
    if (!spent) throw invalid();
    const updated = await this.users.updateOne(
      { _id: spent.userId, email: spent.email },
      { $set: { emailVerifiedAt: new Date() } },
    );
    if (updated.matchedCount === 0) throw invalid();
    await this.security.record('email_verified', ctx, spent.userId);
    return { verified: true };
  }

  /** A completed password reset proves the inbox too. Keeps an earlier confirmation time. */
  async markVerifiedByReset(userId: string): Promise<void> {
    await this.users.updateOne({ _id: userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
  }

  private async deliver(userId: string, name: string, email: string, ctx: RequestContext): Promise<void> {
    try {
      const token = await this.tokens.issue(userId, 'verify_email', VERIFY_TTL_HOURS * 3_600_000, email);
      const link = `${this.config.webBaseUrl}/verify-email#token=${token}`;
      await (this.mailer as Mailer).send(verifyEmail(email, name, link, VERIFY_TTL_HOURS));
      await this.security.record('email_verification_sent', ctx, userId);
    } catch (error) {
      this.logger.error(`Could not send a verification link: ${(error as Error).message}`);
      await this.security.record('email_verification_sent', ctx, userId, 'send_failed');
      throw new ServiceUnavailableException({ code: 'VERIFY_SEND_FAILED', message: 'The email could not be sent. Try again later.' });
    }
  }
}

function invalid(): BadRequestException {
  return new BadRequestException({ code: 'VERIFY_INVALID', message: 'This link has expired or was already used.' });
}
