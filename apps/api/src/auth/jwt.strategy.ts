import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '@life-portal/shared-types';
import { CONFIG, type AppConfig } from '../config/configuration';
import { SessionsService } from './sessions.service';

/** What every guarded controller receives from `@CurrentUser()`. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  roles: string[];
  /** The `auth_sessions` row the access token belongs to (issue #27). */
  sessionId: string;
  /**
   * The signed-in person. The same as `userId`, except while acting as a page (spec 040), when
   * `userId` is the page and this is the person behind it. Absent on token-authenticated routes.
   */
  actorId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(CONFIG) config: AppConfig,
    private readonly sessions: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // A refresh token must not open data routes, so the token type is checked here rather
    // than trusting that only access tokens reach the Authorization header.
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('A refresh token cannot be used to call the API.');
    }
    // Issue #27: a signed token is not enough on its own. Its session must still be signed in,
    // so logout, "sign out everywhere" and a password change take effect at once rather than
    // when the access token expires. A token without a session predates them and is refused.
    if (!payload.sid || !(await this.sessions.isLive(payload.sub, payload.sid))) {
      throw new UnauthorizedException('Your session has been signed out.');
    }
    return { userId: payload.sub, email: payload.email, roles: payload.roles ?? [], sessionId: payload.sid, actorId: payload.sub };
  }
}
