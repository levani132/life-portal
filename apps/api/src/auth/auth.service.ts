import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { AuthSession, AuthTokens, JwtPayload, RefreshRefusal, User as UserDto } from '@life-portal/shared-types';
import { CONFIG, type AppConfig } from '../config/configuration';
import { User, type UserDocument } from './schemas/user.schema';
import { SessionsService } from './sessions.service';
import { tokenHash } from './session-rules';
import type { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionsService,
  ) {}

  async register(dto: RegisterDto, device = 'Unknown device'): Promise<AuthSession> {
    // When an invite code is configured, registration is closed without it. This is what
    // keeps a publicly deployed instance from accepting strangers.
    if (this.config.registrationInviteCode && dto.inviteCode !== this.config.registrationInviteCode) {
      throw new ForbiddenException('A valid invite code is required to register.');
    }

    const email = dto.email.toLowerCase().trim();
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

    return this.issueSession(created, device);
  }

  async login(dto: LoginDto, device = 'Unknown device'): Promise<AuthSession> {
    return this.issueSession(await this.authenticateCredentials(dto), device);
  }

  /** Verify an OAuth sign-in without rotating the dashboard session. */
  async authenticateCredentials(dto: LoginDto): Promise<UserDocument> {
    const user = await this.userModel
      .findOne({ email: dto.email.toLowerCase().trim() })
      .select('+passwordHash');

    // Same message and roughly the same work either way, so the response cannot be used to
    // discover which emails exist.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const matches = await bcrypt.compare(dto.password, hash);
    if (!user || !matches) {
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
  async refresh(refreshToken: string): Promise<AuthTokens> {
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
  async logout(userId: string, sessionId: string): Promise<{ success: true }> {
    await this.sessions.revoke(userId, sessionId, 'logout');
    return { success: true };
  }

  /** Signs every device out, this one included. */
  async logoutAll(userId: string): Promise<{ success: true; ended: number }> {
    const ended = await this.sessions.revokeAll(userId, 'logout_all');
    return { success: true, ended };
  }

  /** Changing the password keeps this session and signs every other one out. */
  async changePassword(userId: string, sessionId: string, dto: ChangePasswordDto): Promise<{ success: true }> {
    const user = await this.userModel.findById(userId).select('+passwordHash');
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Your current password is incorrect.');
    }
    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await user.save();
    await this.sessions.revokeAll(userId, 'password_change', sessionId);
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
