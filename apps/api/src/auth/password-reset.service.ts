import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { CONFIG, type AppConfig } from '../config/configuration';
import { MAILER, type Mailer } from '../mail/mailer';
import { assertPasswordPolicy, BCRYPT_ROUNDS } from './auth.service';
import { passwordResetEmail } from './emails';
import { EmailTokensService } from './email-tokens.service';
import { User } from './schemas/user.schema';
import { RATE_RULES } from './security/rate-limit-rules';
import { SecurityService, type RequestContext } from './security/security.service';
import { SessionsService } from './sessions.service';
import { EmailVerificationService } from './email-verification.service';

export const RESET_TTL_MINUTES = 30;

const GENERIC_SENT = "If that email has an account, we've sent a link to reset the password. It expires in 30 minutes.";
const INVALID_LINK = 'This link has expired or was already used. Request a new one.';

/**
 * Forgot / reset password (issue #27 S3).
 *
 * - The request answers the same whether or not the email exists, and does the account's
 *   work (token, email) after answering, so timing reveals nothing either.
 * - The token is 32 random bytes in the link's fragment; only its SHA-256 is stored. It works
 *   once, for 30 minutes, and asking again voids the previous one.
 * - Resetting signs every device out and voids every other reset link. It does not sign in:
 *   the person signs in with the new password.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger('PasswordReset');

  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @Inject(MAILER) private readonly mailer: Mailer | null,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly tokens: EmailTokensService,
    private readonly sessions: SessionsService,
    private readonly security: SecurityService,
    private readonly verification: EmailVerificationService,
  ) {}

  get available(): boolean {
    return Boolean(this.mailer && this.config.webBaseUrl);
  }

  async request(rawEmail: string, ctx: RequestContext): Promise<{ message: string }> {
    if (!this.available) throw unavailable();
    const email = rawEmail.toLowerCase().trim();
    await this.security.hit(RATE_RULES.forgotByIp, ctx.ip, ctx);
    await this.security.hit(RATE_RULES.forgotByAccount, email, ctx);
    const user = await this.users.findOne({ email }).select('_id name email').lean<{ _id: unknown; name: string; email: string }>();
    if (user) void this.sendLink(String(user._id), user.name, user.email, ctx);
    return { message: GENERIC_SENT };
  }

  /** Whether a link still works, so the page can say so before asking for a password. */
  async check(token: string, ctx: RequestContext): Promise<{ valid: boolean }> {
    await this.security.hit(RATE_RULES.resetByIp, ctx.ip, ctx);
    return { valid: Boolean(await this.tokens.peek(token, 'password_reset')) };
  }

  async reset(token: string, password: string, ctx: RequestContext): Promise<{ success: true }> {
    await this.security.hit(RATE_RULES.resetByIp, ctx.ip, ctx);
    // Check the password before spending the token, so a weak one does not burn the link.
    const pending = await this.tokens.peek(token, 'password_reset');
    const user = pending ? await this.users.findById(pending.userId).select('email') : null;
    if (!pending || !user) return this.invalid(ctx);
    assertPasswordPolicy(password, user.email);

    const spent = await this.tokens.consume(token, 'password_reset');
    if (!spent || spent.userId !== pending.userId) return this.invalid(ctx);

    await this.users.updateOne({ _id: spent.userId }, { $set: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) } });
    await this.sessions.revokeAll(spent.userId, 'password_reset');
    await this.tokens.voidAll(spent.userId, 'password_reset');
    await this.verification.markVerifiedByReset(spent.userId);
    await this.security.record('password_reset_completed', ctx, spent.userId);
    return { success: true };
  }

  private async invalid(ctx: RequestContext): Promise<never> {
    await this.security.record('password_reset_failed', ctx);
    throw new BadRequestException({ code: 'RESET_INVALID', message: INVALID_LINK });
  }

  private async sendLink(userId: string, name: string, email: string, ctx: RequestContext): Promise<void> {
    try {
      const token = await this.tokens.issue(userId, 'password_reset', RESET_TTL_MINUTES * 60_000);
      const link = `${this.config.webBaseUrl}/reset-password#token=${token}`;
      await (this.mailer as Mailer).send(passwordResetEmail(email, name, link, RESET_TTL_MINUTES));
      await this.security.record('password_reset_requested', ctx, userId);
    } catch (error) {
      // The person already got the generic answer; this is for whoever runs the server.
      this.logger.error(`Could not send a reset link: ${(error as Error).message}`);
      await this.security.record('password_reset_requested', ctx, userId, 'send_failed');
    }
  }
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'RESET_UNAVAILABLE',
    message: "Password reset by email isn't available yet. Ask the person who runs this Life Portal.",
  });
}
