import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { AuthSession, AuthTokens, JwtPayload, RefreshRefusal, User as UserDto } from '@life-portal/shared-types';
import { CONFIG, type AppConfig } from '../config/configuration';
import { User, type UserDocument } from './schemas/user.schema';
import { SessionsService } from './sessions.service';
import { tokenHash } from './session-rules';
import type { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { RATE_RULES } from './security/rate-limit-rules';
import { PASSWORD_MESSAGES, passwordProblem } from './security/password-policy';
import { SecurityService, type RequestContext } from './security/security.service';

const BCRYPT_ROUNDS = 12;

/**
 * A real bcrypt hash of a random secret, made once. An unknown email is checked against it so the
 * answer takes as long as for a known one. (The string used before #27 was not a valid hash, so
 * bcrypt gave up at once: about 1 ms against 280 ms, which revealed which emails exist.)
 */
let dummyHash: Promise<string> | undefined;
function timingDummy(): Promise<string> {
  dummyHash ??= bcrypt.hash(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
  return dummyHash;
}

/** Throws a 400 with a readable message when `password` breaks the policy. */
export function assertPasswordPolicy(password: string, email?: string): void {
  const problem = passwordProblem(password, email);
  if (problem) throw new BadRequestException({ code: 'WEAK_PASSWORD', reason: problem, message: PASSWORD_MESSAGES[problem] });
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionsService,
    private readonly security: SecurityService,
  ) {
    void timingDummy();
  }

  async register(dto: RegisterDto, device = 'Unknown device', ctx: RequestContext = {}): Promise<AuthSession> {
    await this.security.hit(RATE_RULES.registerByIp, ctx.ip, ctx);
    // When an invite code is configured, registration is closed without it. This is what
    // keeps a publicly deployed instance from accepting strangers.
    if (this.config.registrationInviteCode && dto.inviteCode !== this.config.registrationInviteCode) {
      throw new ForbiddenException('A valid invite code is required to register.');
    }

    const email = dto.email.toLowerCase().trim();
    assertPasswordPolicy(dto.password, email);
    // Accepted for now (#27): registration is invite-only, and a clear answer helps invitees.
    // Make it generic before sign-up is opened to the public.
    if (await this.userModel.exists({ email })) {
      throw new ConflictException('That email is already registered.');
    }

    const created = await this.userModel.create({
      email,
      name: dto.name.trim(),
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      roles: ['owner'],
      cohort: 'production',
    });

    await this.security.record('register', ctx, String(created._id));
    return this.issueSession(created, device);
  }

  async login(dto: LoginDto, device = 'Unknown device', ctx: RequestContext = {}): Promise<AuthSession> {
    await this.security.hit(RATE_RULES.loginByIp, ctx.ip, ctx);
    const user = await this.authenticateCredentials(dto, ctx);
    await this.security.record('login_succeeded', ctx, String(user._id));
    return this.issueSession(user, device);
  }

  /**
   * Checks an email and password. Used by sign-in and by the MCP OAuth page, so both share the
   * per-account limit. The answer and the work are the same whether or not the email exists.
   */
  async authenticateCredentials(dto: LoginDto, ctx: RequestContext = {}): Promise<UserDocument> {
    const email = dto.email.toLowerCase().trim();
    await this.security.hit(RATE_RULES.loginByAccount, email, ctx);
    const user = await this.userModel.findOne({ email }).select('+passwordHash');

    const hash = user?.passwordHash ?? (await timingDummy());
    const matches = await bcrypt.compare(dto.password, hash);
    if (!user || !matches) {
      await this.security.record('login_failed', ctx, user ? String(user._id) : undefined);
      throw new UnauthorizedException('Incorrect email or password.');
    }

    user.lastLoginAt = new Date();
    await user.save();
    return user;
  }

  /**
   * Rotates a refresh token (issue #27). The token must belong to a live session and be that
   * session's current token; see `SessionsService.rotate` for how a race differs from a replay.
   * A token from before sessions existed (no `sid`) is refused: those could not be revoked.
   */
  async refresh(refreshToken: string, ctx: RequestContext = {}): Promise<AuthTokens> {
    await this.security.hit(RATE_RULES.refreshByIp, ctx.ip, ctx);
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, { secret: this.config.jwtSecret });
    } catch {
      throw refused('SESSION_ENDED', 'Your session has expired. Please sign in again.');
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('That token cannot be used to refresh a session.');
    }
    if (!payload.sid) {
      throw refused('LEGACY_SESSION', 'Sign-in was upgraded for security. Please sign in again.');
    }

    const user = await this.userModel.findById(payload.sub);
    if (!user) throw refused('SESSION_ENDED', 'Your session has been signed out.');

    const next = await this.signTokens(user, payload.sid);
    const refusal = await this.sessions.rotate({
      id: payload.sid,
      userId: String(user._id),
      presentedHash: tokenHash(refreshToken),
      nextHash: tokenHash(next.refreshToken),
      expiresAt: this.sessionExpiry(),
    });
    if (refusal) {
      if (refusal === 'REFRESH_REUSED') await this.security.record('refresh_replay', ctx, String(user._id));
      if (refusal === 'REFRESH_SUPERSEDED') {
        throw new ConflictException({
          code: refusal,
          message: 'This session was just refreshed elsewhere on this device.',
        });
      }
      throw refused(refusal, 'Your session has been signed out.');
    }
    return next;
  }

  /** Signs this device out. Other devices stay signed in. */
  async logout(userId: string, sessionId: string, ctx: RequestContext = {}): Promise<{ success: true }> {
    await this.sessions.revoke(userId, sessionId, 'logout');
    await this.security.record('logout', ctx, userId);
    return { success: true };
  }

  /** Signs every device out, this one included. */
  async logoutAll(userId: string, ctx: RequestContext = {}): Promise<{ success: true; ended: number }> {
    const ended = await this.sessions.revokeAll(userId, 'logout_all');
    await this.security.record('logout_all', ctx, userId);
    return { success: true, ended };
  }

  /** Changing the password keeps this session and signs every other one out. */
  async changePassword(
    userId: string,
    sessionId: string,
    dto: ChangePasswordDto,
    ctx: RequestContext = {},
  ): Promise<{ success: true }> {
    await this.security.hit(RATE_RULES.changePasswordByUser, userId, ctx);
    const user = await this.userModel.findById(userId).select('+passwordHash');
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      await this.security.record('password_change_failed', ctx, userId);
      throw new UnauthorizedException('Your current password is incorrect.');
    }
    assertPasswordPolicy(dto.newPassword, user.email);
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException({ code: 'SAME_PASSWORD', message: 'Choose a password different from your current one.' });
    }
    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await user.save();
    await this.sessions.revokeAll(userId, 'password_change', sessionId);
    await this.security.record('password_changed', ctx, userId);
    return { success: true };
  }

  async findById(userId: string): Promise<UserDto> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new UnauthorizedException('Account not found.');
    return user.toJSON() as unknown as UserDto;
  }

  private async issueSession(user: UserDocument, device: string): Promise<AuthSession> {
    const sessionId = new Types.ObjectId();
    const tokens = await this.signTokens(user, String(sessionId));
    await this.sessions.create({
      id: sessionId,
      userId: String(user._id),
      tokenHash: tokenHash(tokens.refreshToken),
      device,
      expiresAt: this.sessionExpiry(),
    });
    // The single pre-#27 refresh hash is dead weight now; drop it when its owner signs in.
    await this.userModel.updateOne({ _id: user._id, refreshTokenHash: { $exists: true } }, { $unset: { refreshTokenHash: 1 } });

    return { ...tokens, user: user.toJSON() as unknown as UserDto };
  }

  private async signTokens(user: UserDocument, sid: string): Promise<AuthTokens> {
    const base = { sub: String(user._id), email: user.email, roles: user.roles, sid };
    const accessToken = await this.jwt.signAsync(
      { ...base, typ: 'access' } satisfies Omit<JwtPayload, 'iat' | 'exp'>,
      { secret: this.config.jwtSecret, expiresIn: this.config.accessTokenTtlSeconds },
    );
    // `jti` makes every refresh token unique, so its hash identifies exactly one token.
    const refreshToken = await this.jwt.signAsync(
      { ...base, typ: 'refresh', jti: randomUUID() } satisfies Omit<JwtPayload, 'iat' | 'exp'>,
      { secret: this.config.jwtSecret, expiresIn: this.config.refreshTokenTtlSeconds },
    );
    return { accessToken, refreshToken, expiresIn: this.config.accessTokenTtlSeconds };
  }

  private sessionExpiry(): Date {
    return new Date(Date.now() + this.config.refreshTokenTtlSeconds * 1000);
  }
}

function refused(code: RefreshRefusal, message: string): UnauthorizedException {
  return new UnauthorizedException({ code, message });
}
