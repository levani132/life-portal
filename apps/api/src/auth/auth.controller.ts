import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Ip, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONFIG, type AppConfig } from '../config/configuration';
import { SessionCookies } from './session-cookie';
import type { AuthCapabilities, AuthSession, AuthSessionInfo, AuthTokens, User } from '@life-portal/shared-types';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  ResetTokenDto,
  SuspendDto,
} from './dto/auth.dto';
import { PasswordResetService } from './password-reset.service';
import { EmailVerificationService } from './email-verification.service';
import { GoogleAuthService } from './google/google-auth.service';
import { CurrentUser, Public } from './current-user.decorator';
import { deviceLabel } from './session-rules';
import { SessionsService } from './sessions.service';
import { SecurityService } from './security/security.service';
import { AccessService } from '../access/access.module';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly security: SecurityService,
    private readonly resets: PasswordResetService,
    private readonly verification: EmailVerificationService,
    private readonly google: GoogleAuthService,
    private readonly access: AccessService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.cookies = new SessionCookies(config.corsOrigins, config.refreshTokenTtlSeconds);
  }

  /** Issue #29: the web app's refresh token travels as an HttpOnly cookie. */
  private readonly cookies: SessionCookies;

  /** What this server can do by email, so the web app shows only what works (issue #27). */
  @Public()
  @Get('capabilities')
  capabilities(): AuthCapabilities {
    return {
      passwordReset: this.resets.available,
      emailVerification: this.verification.available,
      google: this.google.enabled,
    };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  forgotPassword(@Body() dto: ForgotPasswordDto, @Ip() ip: string) {
    return this.resets.request(dto.email, { ip });
  }

  @Public()
  @Post('reset-password/check')
  @HttpCode(200)
  checkReset(@Body() dto: ResetTokenDto, @Ip() ip: string) {
    return this.resets.check(dto.token, { ip });
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Body() dto: ResetPasswordDto, @Ip() ip: string) {
    return this.resets.reset(dto.token, dto.password, { ip });
  }

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSession> {
    return this.cookies.deliver(req, res, await this.auth.register(dto, deviceLabel(userAgent), { ip }));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthSession> {
    return this.cookies.deliver(req, res, await this.auth.login(dto, deviceLabel(userAgent), { ip }));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() dto: RefreshDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    // A refused refresh token is useless: drop the cookie so the browser stops sending it.
    let fromCookie = false;
    try {
      const sent = this.cookies.refreshTokenOf(req, dto.refreshToken);
      fromCookie = sent.fromCookie;
      return this.cookies.deliver(req, res, await this.auth.refresh(sent.token, { ip }));
    } catch (error) {
      if (fromCookie || !dto.refreshToken) this.cookies.clear(req, res);
      throw error;
    }
  }

  /** Signs this device out. */
  @Post('logout')
  @HttpCode(200)
  logout(
    @CurrentUser('userId') userId: string,
    @CurrentUser('sessionId') sessionId: string,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.cookies.clear(req, res);
    return this.auth.logout(userId, sessionId, { ip });
  }

  /** Signs every device out, this one included. */
  @Post('logout-all')
  @HttpCode(200)
  logoutAll(
    @CurrentUser('userId') userId: string,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.cookies.clear(req, res);
    return this.auth.logoutAll(userId, { ip });
  }

  @Get('me')
  me(@CurrentUser('userId') userId: string): Promise<User> {
    return this.auth.findById(userId);
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @CurrentUser('userId') userId: string,
    @CurrentUser('sessionId') sessionId: string,
    @Body() dto: ChangePasswordDto,
    @Ip() ip: string,
  ) {
    return this.auth.changePassword(userId, sessionId, dto, { ip });
  }

  /** Emails a link confirming the signed-in person's address (issue #27 S5). */
  @Post('verify-email/send')
  @HttpCode(200)
  sendVerification(@CurrentUser('userId') userId: string, @Ip() ip: string) {
    return this.verification.send(userId, { ip });
  }

  /** Public: the link may be opened on a device that is not signed in. */
  @Public()
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Body() dto: ResetTokenDto, @Ip() ip: string) {
    return this.verification.confirm(dto.token, { ip });
  }

  /** The devices signed in to this account. */
  @Get('sessions')
  listSessions(
    @CurrentUser('userId') userId: string,
    @CurrentUser('sessionId') sessionId: string,
  ): Promise<AuthSessionInfo[]> {
    return this.sessions.list(userId, sessionId);
  }

  /** Signs every other device out and keeps this one. */
  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(
    @CurrentUser('userId') userId: string,
    @CurrentUser('sessionId') sessionId: string,
    @Ip() ip: string,
  ) {
    const ended = await this.sessions.revokeAll(userId, 'revoked', sessionId);
    await this.security.record('sessions_revoked_others', { ip }, userId);
    return { success: true, ended };
  }

  /** Spec 039: the reviewer suspends an account, or restores it. Developer only. */
  @Post('accounts/:id/suspend')
  @HttpCode(200)
  suspend(@CurrentUser('userId') userId: string, @Param('id') id: string, @Body() dto: SuspendDto, @Ip() ip: string) {
    this.access.requireDeveloper(userId);
    return this.auth.suspend(id, dto.reason ?? '', { ip });
  }

  @Post('accounts/:id/unsuspend')
  @HttpCode(200)
  unsuspend(@CurrentUser('userId') userId: string, @Param('id') id: string, @Ip() ip: string) {
    this.access.requireDeveloper(userId);
    return this.auth.unsuspend(id, { ip });
  }

  @Delete('sessions/:id')
  async revokeSession(@CurrentUser('userId') userId: string, @Param('id') id: string, @Ip() ip: string) {
    await this.sessions.revokeOwn(userId, id);
    await this.security.record('session_revoked', { ip }, userId);
    return { success: true };
  }
}
