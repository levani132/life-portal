import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import type { AuthSession, AuthTokens, JwtPayload, User as UserDto } from '@life-portal/shared-types';
import { CONFIG, type AppConfig } from '../config/configuration';
import { User, type UserDocument } from './schemas/user.schema';
import type { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async register(dto: RegisterDto): Promise<AuthSession> {
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
    });

    return this.issueSession(created);
  }

  async login(dto: LoginDto): Promise<AuthSession> {
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
    return this.issueSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, { secret: this.config.jwtSecret });
    } catch {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('That token cannot be used to refresh a session.');
    }

    const user = await this.userModel.findById(payload.sub).select('+refreshTokenHash');
    if (!user?.refreshTokenHash) {
      throw new UnauthorizedException('Your session has been signed out.');
    }
    // Comparing against the stored hash makes logout and password changes actually revoke
    // outstanding refresh tokens.
    if (!(await bcrypt.compare(refreshToken, user.refreshTokenHash))) {
      throw new UnauthorizedException('Your session has been signed out.');
    }

    const session = await this.issueSession(user);
    return { accessToken: session.accessToken, refreshToken: session.refreshToken, expiresIn: session.expiresIn };
  }

  async logout(userId: string): Promise<{ success: true }> {
    await this.userModel.findByIdAndUpdate(userId, { $unset: { refreshTokenHash: 1 } });
    return { success: true };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ success: true }> {
    const user = await this.userModel.findById(userId).select('+passwordHash');
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Your current password is incorrect.');
    }
    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    // Changing the password signs every other session out.
    user.refreshTokenHash = undefined;
    await user.save();
    return { success: true };
  }

  async findById(userId: string): Promise<UserDto> {
    const user = await this.userModel.findById(userId);
    if (!user) throw new UnauthorizedException('Account not found.');
    return user.toJSON() as unknown as UserDto;
  }

  private async issueSession(user: UserDocument): Promise<AuthSession> {
    const base = { sub: String(user._id), email: user.email, roles: user.roles };

    const accessToken = await this.jwt.signAsync(
      { ...base, typ: 'access' } satisfies Omit<JwtPayload, 'iat' | 'exp'>,
      { secret: this.config.jwtSecret, expiresIn: this.config.accessTokenTtlSeconds },
    );
    const refreshToken = await this.jwt.signAsync(
      { ...base, typ: 'refresh' } satisfies Omit<JwtPayload, 'iat' | 'exp'>,
      { secret: this.config.jwtSecret, expiresIn: this.config.refreshTokenTtlSeconds },
    );

    await this.userModel.findByIdAndUpdate(user._id, {
      refreshTokenHash: await bcrypt.hash(refreshToken, BCRYPT_ROUNDS),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.accessTokenTtlSeconds,
      user: user.toJSON() as unknown as UserDto,
    };
  }
}
