import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload } from '@life-portal/shared-types';
import { CONFIG, type AppConfig } from '../config/configuration';

/** What every guarded controller receives from `@CurrentUser()`. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(CONFIG) config: AppConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.jwtSecret,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    // A refresh token must not open data routes, so the token type is checked here rather
    // than trusting that only access tokens reach the Authorization header.
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('A refresh token cannot be used to call the API.');
    }
    return { userId: payload.sub, email: payload.email, roles: payload.roles ?? [] };
  }
}
