import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AuthSession, GoogleExchangeResult, SignInMethods } from '@life-portal/shared-types';
import { CONFIG, type AppConfig } from '../../config/configuration';
import { AuthService } from '../auth.service';
import { User } from '../schemas/user.schema';
import { RATE_RULES } from '../security/rate-limit-rules';
import { SecurityService, type RequestContext } from '../security/security.service';
import { GoogleOidc, GoogleTokenError } from './google-oidc';
import { codeChallenge, isBindingHash, safeReturnTo, secret, sha256 } from './google-rules';
import { OAuthFlow, UserIdentity, type GoogleErrorCode, type GoogleOutcome } from './google.schemas';

const MIN = 60_000;
const START_TTL = 10 * MIN;
const RESULT_TTL = 5 * MIN;
const TICKET_TTL = 2 * MIN;

const isDuplicate = (error: unknown) => (error as { code?: number })?.code === 11000;

/**
 * Continue with Google (issue #28).
 *
 * A browser keeps a random binding secret and sends only its hash to `start`; the one-time code
 * the callback hands back is useless without the secret itself, so a callback link opened in
 * someone else's browser signs nobody in (login CSRF). Linking is never decided by email alone:
 * an existing account is linked only from inside it (Settings), or after its password is given.
 * After Google, everything is the ordinary #27 session.
 */
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger('GoogleAuth');

  constructor(
    @InjectModel(OAuthFlow.name) private readonly flows: Model<OAuthFlow>,
    @InjectModel(UserIdentity.name) private readonly identities: Model<UserIdentity>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly oidc: GoogleOidc,
    private readonly auth: AuthService,
    private readonly security: SecurityService,
  ) {}

  get enabled(): boolean {
    return this.oidc.enabled && Boolean(this.config.webBaseUrl);
  }

  /** Lets a signed-in person start linking without putting their bearer token in a URL. */
  async linkTicket(userId: string): Promise<{ ticket: string }> {
    this.requireEnabled();
    const ticket = secret();
    await this.flows.create({ kind: 'link_ticket', keyHash: sha256(ticket), userId, expiresAt: new Date(Date.now() + TICKET_TTL) });
    return { ticket };
  }

  /** Returns where to send the browser: Google, or straight back to the web app with an error. */
  async start(
    input: { binding?: unknown; intent?: unknown; ticket?: unknown; returnTo?: unknown },
    ctx: RequestContext,
  ): Promise<string> {
    this.requireEnabled();
    await this.security.hit(RATE_RULES.googleByIp, ctx.ip, ctx);
    if (!isBindingHash(input.binding)) return this.webError('failed');
    const intent = input.intent === 'link' ? 'link' : 'signin';
    let userId: string | undefined;
    if (intent === 'link') {
      const ticket = typeof input.ticket === 'string' ? input.ticket : '';
      const row = ticket ? await this.flows.findOneAndDelete({ kind: 'link_ticket', keyHash: sha256(ticket), expiresAt: { $gt: new Date() } }).lean() : null;
      if (!row?.userId) return this.webError('expired');
      userId = row.userId;
    }

    const state = secret();
    const nonce = secret();
    const codeVerifier = secret(64);
    await this.flows.create({
      kind: 'start',
      keyHash: sha256(state),
      bindingHash: input.binding,
      codeVerifier,
      nonce,
      intent,
      userId,
      returnTo: safeReturnTo(input.returnTo),
      expiresAt: new Date(Date.now() + START_TTL),
    });
    return this.oidc.authorizationUrl({ state, nonce, codeChallenge: codeChallenge(codeVerifier) });
  }

  /** Google's redirect lands here. Returns where to send the browser next; never throws. */
  async callback(query: { code?: unknown; state?: unknown; error?: unknown }, ctx: RequestContext): Promise<string> {
    try {
      const state = typeof query.state === 'string' ? query.state : '';
      const flow = state
        ? await this.flows.findOneAndDelete({ kind: 'start', keyHash: sha256(state), expiresAt: { $gt: new Date() } }).lean()
        : null;
      if (!flow) return this.webError('expired');

      let outcome: GoogleOutcome;
      if (query.error !== undefined || typeof query.code !== 'string') {
        outcome = { kind: 'error', code: query.error === 'access_denied' ? 'cancelled' : 'failed' };
      } else {
        try {
          const claims = await this.oidc.exchange(query.code, flow.codeVerifier as string, flow.nonce as string);
          outcome = await this.decide(claims, flow.intent ?? 'signin', flow.userId);
        } catch (error) {
          if (!(error instanceof GoogleTokenError)) throw error;
          this.logger.warn(`Google sign-in refused: ${error.message}`);
          outcome = { kind: 'error', code: 'failed' };
        }
      }
      if (outcome.kind === 'error') await this.security.record('google_failed', ctx, flow.userId, outcome.code);

      const code = secret();
      await this.flows.create({
        kind: 'result',
        keyHash: sha256(code),
        bindingHash: flow.bindingHash,
        outcome,
        returnTo: flow.returnTo,
        expiresAt: new Date(Date.now() + RESULT_TTL),
      });
      return `${this.config.webBaseUrl}/auth/google#code=${code}`;
    } catch (error) {
      this.logger.error(`Google callback failed: ${(error as Error).name}`);
      return this.webError('failed');
    }
  }

  /** The web app trades the one-time code, plus the binding secret, for what happened. */
  async exchange(input: { code: string; binding: string }, device: string, ctx: RequestContext): Promise<GoogleExchangeResult> {
    await this.security.hit(RATE_RULES.googleByIp, ctx.ip, ctx);
    const row = await this.flows
      .findOneAndDelete({ kind: 'result', keyHash: sha256(input.code), bindingHash: sha256(input.binding), expiresAt: { $gt: new Date() } })
      .lean();
    if (!row?.outcome) throw expired();
    const outcome = row.outcome;
    const returnTo = row.returnTo ?? '/';

    switch (outcome.kind) {
      case 'signin': {
        await this.security.record('google_signin', ctx, outcome.userId);
        return { kind: 'session', session: await this.auth.startSession(outcome.userId, device), returnTo };
      }
      case 'linked':
        await this.security.record('google_linked', ctx, outcome.userId);
        return { kind: 'linked', returnTo };
      case 'needs_password':
      case 'needs_invite': {
        // The next step gets a fresh one-time ticket, bound to the same browser.
        const ticket = secret();
        await this.flows.create({
          kind: 'result',
          keyHash: sha256(ticket),
          bindingHash: row.bindingHash,
          outcome,
          returnTo,
          expiresAt: new Date(Date.now() + RESULT_TTL),
        });
        return { kind: outcome.kind, email: outcome.email, ticket };
      }
      case 'error':
        return { kind: 'error', code: outcome.code };
    }
  }

  /**
   * An account with Google's email already exists and has no Google link: its password proves
   * the person owns it. The ticket survives a wrong password (sign-in's limits apply), and is
   * spent only once the password matched.
   */
  async linkWithPassword(input: { ticket: string; binding: string; password: string }, device: string, ctx: RequestContext): Promise<GoogleExchangeResult> {
    const filter = { kind: 'result' as const, keyHash: sha256(input.ticket), bindingHash: sha256(input.binding), 'outcome.kind': 'needs_password' as const, expiresAt: { $gt: new Date() } };
    const pending = await this.flows.findOne(filter).lean();
    const outcome = pending?.outcome;
    if (!pending || outcome?.kind !== 'needs_password') throw expired();

    const user = await this.auth.authenticateCredentials({ email: outcome.email, password: input.password }, ctx);
    if (String(user._id) !== outcome.userId) throw expired();
    if (!(await this.flows.findOneAndDelete(filter))) throw expired();

    await this.link(outcome.userId, outcome.subject, outcome.email);
    await this.security.record('google_linked', ctx, outcome.userId, 'password');
    return { kind: 'session', session: await this.auth.startSession(outcome.userId, device), returnTo: pending.returnTo ?? '/' };
  }

  /** A new account through Google on a server whose sign-up needs an invite code. */
  async completeSignup(input: { ticket: string; binding: string; inviteCode?: string }, device: string, ctx: RequestContext): Promise<GoogleExchangeResult> {
    await this.security.hit(RATE_RULES.registerByIp, ctx.ip, ctx);
    const filter = { kind: 'result' as const, keyHash: sha256(input.ticket), bindingHash: sha256(input.binding), 'outcome.kind': 'needs_invite' as const, expiresAt: { $gt: new Date() } };
    const pending = await this.flows.findOne(filter).lean();
    const outcome = pending?.outcome;
    if (!pending || outcome?.kind !== 'needs_invite') throw expired();
    if (!this.auth.inviteAccepted(input.inviteCode)) throw new ForbiddenException('A valid invite code is required to register.');
    if (!(await this.flows.findOneAndDelete(filter))) throw expired();

    const session = await this.createAccount(outcome.subject, outcome.email, outcome.name, device, ctx);
    return { kind: 'session', session, returnTo: pending.returnTo ?? '/' };
  }

  async methods(userId: string): Promise<SignInMethods> {
    const [user, google] = await Promise.all([
      this.users.findById(userId).select('+passwordHash').lean<{ passwordHash?: string }>(),
      this.identities.findOne({ userId, provider: 'google' }).lean(),
    ]);
    return {
      password: Boolean(user?.passwordHash),
      google: google ? { email: google.email ?? '', linkedAt: google.linkedAt.toISOString() } : null,
      googleAvailable: this.enabled,
    };
  }

  /** Removes the Google link, unless it is the only way into the account. */
  async unlink(userId: string, ctx: RequestContext): Promise<SignInMethods> {
    const methods = await this.methods(userId);
    if (!methods.google) throw new NotFoundException('Google is not linked to this account.');
    if (!methods.password) {
      throw new ConflictException({
        code: 'LAST_SIGN_IN_METHOD',
        message: 'Google is the only way into this account. Add a password first ("Forgot password" on the sign-in page), then unlink Google.',
      });
    }
    await this.identities.deleteOne({ userId, provider: 'google' });
    await this.security.record('google_unlinked', ctx, userId);
    return { ...methods, google: null };
  }

  private async decide(claims: { sub: string; email: string; emailVerified: boolean; name?: string }, intent: 'signin' | 'link', userId?: string): Promise<GoogleOutcome> {
    if (!claims.emailVerified) return { kind: 'error', code: 'email_unverified' };
    const identity = await this.identities.findOne({ provider: 'google', subject: claims.sub }).lean();

    if (intent === 'link' && userId) {
      if (identity && identity.userId !== userId) return { kind: 'error', code: 'already_linked_elsewhere' };
      if (identity) return { kind: 'linked', userId };
      try {
        await this.link(userId, claims.sub, claims.email);
      } catch (error) {
        if (error instanceof ConflictException) return { kind: 'error', code: errorCode(error) };
        throw error;
      }
      return { kind: 'linked', userId };
    }

    if (identity) {
      await this.identities.updateOne({ _id: identity._id }, { $set: { lastUsedAt: new Date(), email: claims.email } });
      return { kind: 'signin', userId: identity.userId };
    }
    const existing = await this.users.findOne({ email: claims.email }).select('_id').lean<{ _id: unknown }>();
    if (existing) return { kind: 'needs_password', userId: String(existing._id), subject: claims.sub, email: claims.email };
    const name = claims.name ?? claims.email.split('@')[0] ?? 'Friend';
    if (this.auth.inviteRequired) return { kind: 'needs_invite', subject: claims.sub, email: claims.email, name };

    // Created here, at the callback, so a fresh browser exchange finds a ready account.
    const created = await this.auth.createPasswordless({ email: claims.email, name, emailVerifiedAt: new Date() }, {});
    await this.link(String(created._id), claims.sub, claims.email);
    return { kind: 'signin', userId: String(created._id) };
  }

  private async createAccount(subject: string, email: string, name: string, device: string, ctx: RequestContext): Promise<AuthSession> {
    if (await this.users.exists({ email })) {
      throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'An account with this email was just created. Start again to link Google to it.' });
    }
    const created = await this.auth.createPasswordless({ email, name, emailVerifiedAt: new Date() }, ctx);
    await this.link(String(created._id), subject, email);
    await this.security.record('google_signin', ctx, String(created._id), 'signup');
    return this.auth.startSession(String(created._id), device);
  }

  private async link(userId: string, subject: string, email: string): Promise<void> {
    const taken = await this.identities.findOne({ userId, provider: 'google' }).lean();
    if (taken && taken.subject !== subject) throw conflict('account_has_google');
    if (taken) return;
    try {
      await this.identities.create({ userId, provider: 'google', subject, email, linkedAt: new Date(), lastUsedAt: new Date() });
    } catch (error) {
      if (isDuplicate(error)) throw conflict('already_linked_elsewhere');
      throw error;
    }
  }

  private webError(code: GoogleErrorCode): string {
    return `${this.config.webBaseUrl}/auth/google#error=${code}`;
  }

  private requireEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException({ code: 'GOOGLE_UNAVAILABLE', message: "Continue with Google isn't set up on this Life Portal." });
    }
  }
}

const MESSAGES: Record<'account_has_google' | 'already_linked_elsewhere', string> = {
  account_has_google: 'This account is already linked to a different Google account.',
  already_linked_elsewhere: 'That Google account is already linked to a different Life Portal account.',
};

function conflict(code: keyof typeof MESSAGES): ConflictException {
  return new ConflictException({ code, message: MESSAGES[code] });
}

function errorCode(error: ConflictException): GoogleErrorCode {
  const code = (error.getResponse() as { code?: string }).code;
  return code === 'account_has_google' ? 'account_has_google' : 'already_linked_elsewhere';
}

function expired(): BadRequestException {
  return new BadRequestException({ code: 'GOOGLE_EXPIRED', message: 'This Google sign-in has expired. Start again.' });
}
