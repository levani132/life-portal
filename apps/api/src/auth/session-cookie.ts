import { UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Issue #29: the web app's refresh token lives in an `HttpOnly` cookie, so no script on the page
 * can read it. Pure rules here; the controllers apply them.
 *
 * - **Opt-in, per request:** the web sends `x-lp-session: cookie`. A request without it (tests,
 *   an older app version) gets tokens in the body as before, and no cookie.
 * - **The header is also the CSRF barrier.** Another site's page cannot add a custom header without
 *   a CORS preflight, which this API refuses for origins it does not list. A refresh from the
 *   cookie also needs an `Origin` in `CORS_ORIGINS`.
 * - **The cookie is first-party** only because the web reaches the API through its own `/api`
 *   (`vercel.json`). `SameSite=Strict`, `Path=/api/auth`: sent to nothing else.
 */
export const SESSION_HEADER = 'x-lp-session';
export const REFRESH_COOKIE = 'lp_refresh';
const COOKIE_PATH = '/api/auth';

export const wantsCookie = (headers: Request['headers']): boolean => headers[SESSION_HEADER] === 'cookie';

/** One cookie's value from a `Cookie` header; undefined when absent or empty. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at < 0) continue;
    if (part.slice(0, at).trim() !== name) continue;
    const value = part.slice(at + 1).trim();
    try {
      return decodeURIComponent(value) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** `Set-Cookie` for the refresh token, or (`token` null) clearing it. */
export function refreshCookie(token: string | null, options: { secure: boolean; maxAgeSeconds: number }): string {
  const parts = [
    `${REFRESH_COOKIE}=${token ? encodeURIComponent(token) : ''}`,
    `Path=${COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${token ? options.maxAgeSeconds : 0}`,
  ];
  // Plain-http local development only: browsers drop a Secure cookie there.
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** Whether a cookie-authenticated request comes from one of this API's own web origins. */
export function fromOwnOrigin(headers: Request['headers'], allowedOrigins: readonly string[]): boolean {
  const origin = headers['origin'];
  return typeof origin === 'string' && allowedOrigins.includes(origin);
}

/** Applies the rules to one request; built per controller from config. */
export class SessionCookies {
  constructor(
    private readonly allowedOrigins: readonly string[],
    private readonly maxAgeSeconds: number,
  ) {}

  private secure(req: Request): boolean {
    const host = req.hostname;
    return req.secure || !(host === 'localhost' || host === '127.0.0.1' || host === '[::1]');
  }

  /**
   * A response carrying tokens: in cookie mode the refresh token goes into the cookie and out of
   * the body.
   */
  deliver<T extends { refreshToken?: string }>(req: Request, res: Response, tokens: T): T {
    if (!wantsCookie(req.headers) || !tokens.refreshToken) return tokens;
    res.append('Set-Cookie', refreshCookie(tokens.refreshToken, { secure: this.secure(req), maxAgeSeconds: this.maxAgeSeconds }));
    const { refreshToken: _kept, ...rest } = tokens;
    return rest as T;
  }

  clear(req: Request, res: Response): void {
    res.append('Set-Cookie', refreshCookie(null, { secure: this.secure(req), maxAgeSeconds: 0 }));
  }

  /**
   * The refresh token for `POST /auth/refresh`: the body's when sent (body mode, and the one-time
   * move from browser storage), else the cookie's, only from an own origin in cookie mode.
   */
  refreshTokenOf(req: Request, bodyToken: string | undefined): { token: string; fromCookie: boolean } {
    if (bodyToken) return { token: bodyToken, fromCookie: false };
    if (!wantsCookie(req.headers) || !fromOwnOrigin(req.headers, this.allowedOrigins)) {
      throw new UnauthorizedException('Sign in again.');
    }
    const token = readCookie(req.headers['cookie'], REFRESH_COOKIE);
    if (!token) throw new UnauthorizedException('Sign in again.');
    return { token, fromCookie: true };
  }
}
