import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import type { AuthSession, AuthSessionInfo, AuthTokens, User } from '@life-portal/shared-types';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import { CurrentUser, Public } from './current-user.decorator';
import { deviceLabel } from './session-rules';
import { SessionsService } from './sessions.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Headers('user-agent') userAgent?: string): Promise<AuthSession> {
    return this.auth.register(dto, deviceLabel(userAgent));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Headers('user-agent') userAgent?: string): Promise<AuthSession> {
    return this.auth.login(dto, deviceLabel(userAgent));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  /** Signs this device out. */
  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser('userId') userId: string, @CurrentUser('sessionId') sessionId: string) {
    return this.auth.logout(userId, sessionId);
  }

  /** Signs every device out, this one included. */
  @Post('logout-all')
  @HttpCode(200)
  logoutAll(@CurrentUser('userId') userId: string) {
    return this.auth.logoutAll(userId);
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
  ) {
    return this.auth.changePassword(userId, sessionId, dto);
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
  async revokeOthers(@CurrentUser('userId') userId: string, @CurrentUser('sessionId') sessionId: string) {
    const ended = await this.sessions.revokeAll(userId, 'revoked', sessionId);
    return { success: true, ended };
  }

  @Delete('sessions/:id')
  async revokeSession(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    await this.sessions.revokeOwn(userId, id);
    return { success: true };
  }
}
