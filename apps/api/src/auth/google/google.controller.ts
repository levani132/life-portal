import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Ip, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CONFIG, type AppConfig } from '../../config/configuration';
import { SessionCookies } from '../session-cookie';
import type { GoogleExchangeResult, SignInMethods } from '@life-portal/shared-types';
import { CurrentUser, Public } from '../current-user.decorator';
import { GoogleExchangeDto, GoogleLinkPasswordDto, GoogleSignupDto } from '../dto/auth.dto';
import { deviceLabel } from '../session-rules';
import { GoogleAuthService } from './google-auth.service';

/** Continue with Google (issue #28). See docs/modules/auth-and-dashboard.md. */
@Controller('auth')
export class GoogleController {
  /** Issue #29: a session from Google reaches the web app the same way as any other. */
  private readonly cookies: SessionCookies;

  constructor(
    private readonly google: GoogleAuthService,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.cookies = new SessionCookies(config.corsOrigins, config.refreshTokenTtlSeconds);
  }

  private deliver(req: Request, res: Response, result: GoogleExchangeResult): GoogleExchangeResult {
    return result.kind === 'session' ? { ...result, session: this.cookies.deliver(req, res, result.session) } : result;
  }

  /** Top-level navigation from the web app. Sends the browser on to Google. */
  @Public()
  @Get('google/start')
  async start(
    @Query() query: Record<string, unknown>,
    @Ip() ip: string,
    @Res() res: Response,
  ): Promise<void> {
    const target = await this.google.start(
      { binding: query['binding'], intent: query['intent'], ticket: query['ticket'], returnTo: query['returnTo'] },
      { ip },
    );
    redirect(res, target);
  }

  /** Google's redirect URI. Always answers with a redirect to the web app. */
  @Public()
  @Get('google/callback')
  async callback(@Query() query: Record<string, unknown>, @Ip() ip: string, @Res() res: Response): Promise<void> {
    redirect(res, await this.google.callback({ code: query['code'], state: query['state'], error: query['error'] }, { ip }));
  }

  @Public()
  @Post('google/exchange')
  @HttpCode(200)
  async exchange(
    @Body() dto: GoogleExchangeDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<GoogleExchangeResult> {
    return this.deliver(req, res, await this.google.exchange(dto, deviceLabel(userAgent), { ip }));
  }

  @Public()
  @Post('google/link-with-password')
  @HttpCode(200)
  async linkWithPassword(
    @Body() dto: GoogleLinkPasswordDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<GoogleExchangeResult> {
    return this.deliver(req, res, await this.google.linkWithPassword(dto, deviceLabel(userAgent), { ip }));
  }

  @Public()
  @Post('google/complete-signup')
  @HttpCode(200)
  async completeSignup(
    @Body() dto: GoogleSignupDto,
    @Ip() ip: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ): Promise<GoogleExchangeResult> {
    return this.deliver(req, res, await this.google.completeSignup(dto, deviceLabel(userAgent), { ip }));
  }

  /** Signed in: a two-minute ticket to start linking Google to this account. */
  @Post('google/link-ticket')
  @HttpCode(200)
  linkTicket(@CurrentUser('userId') userId: string): Promise<{ ticket: string }> {
    return this.google.linkTicket(userId);
  }

  @Get('methods')
  methods(@CurrentUser('userId') userId: string): Promise<SignInMethods> {
    return this.google.methods(userId);
  }

  @Delete('google')
  unlink(@CurrentUser('userId') userId: string, @Ip() ip: string): Promise<SignInMethods> {
    return this.google.unlink(userId, { ip });
  }
}

/** A redirect that is never cached and never leaks this URL (it carries `code` and `state`). */
function redirect(res: Response, target: string): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(302, target);
}
