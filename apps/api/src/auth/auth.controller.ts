import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { AuthSession, AuthTokens, User } from '@life-portal/shared-types';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import { CurrentUser, Public } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthSession> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto): Promise<AuthSession> {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@CurrentUser('userId') userId: string) {
    return this.auth.logout(userId);
  }

  @Get('me')
  me(@CurrentUser('userId') userId: string): Promise<User> {
    return this.auth.findById(userId);
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(@CurrentUser('userId') userId: string, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(userId, dto);
  }
}
