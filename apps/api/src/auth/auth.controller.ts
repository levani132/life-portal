import { Body, Controller, Delete, Get, Headers, HttpCode, Ip, Param, Post } from '@nestjs/common';
import type { AuthSession, AuthSessionInfo, AuthTokens, User } from '@life-portal/shared-types';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import { CurrentUser, Public } from './current-user.decorator';
import { deviceLabel } from './session-rules';
import { SessionsService } from './sessions.service';
import { SecurityService } from './security/security.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
    private readonly security: SecurityService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string): Promise<AuthSession> {
    return this.auth.register(dto, deviceLabel(userAgent), { ip });
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') userAgent?: string): Promise<AuthSession> {
    return this.auth.login(dto, deviceLabel(userAgent), { ip });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Ip() ip: string): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken, { ip });
  }

  /** Signs this device out. */
  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser('userId') userId: string, @CurrentUser('sessionId') sessionId: string, @Ip() ip: string) {
    return this.auth.logout(userId, sessionId, { ip });
  }

  /** Signs every device out, this one included. */
  @Post('logout-all')
  @HttpCode(200)
  logoutAll(@CurrentUser('userId') userId: string, @Ip() ip: string) {
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

  @Delete('sessions/:id')
  async revokeSession(@CurrentUser('userId') userId: string, @Param('id') id: string, @Ip() ip: string) {
    await this.sessions.revokeOwn(userId, id);
    await this.security.record('session_revoked', { ip }, userId);
    return { success: true };
  }
}
