import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from './jwt.strategy';

/** Injects the authenticated user, or just their id with `@CurrentUser('userId')`. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return field ? request.user?.[field] : request.user;
  },
);

/** Marks a route as reachable without a token. Everything else is guarded by default. */
export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Marks a route that authenticates with its own credential instead of a JWT.
 *
 * Deliberately **not** `@Public()`. The ingest endpoint writes the collection holding every
 * payment the owner makes, so a reader grepping for public routes must not find it — it is
 * guarded, just not by a session a phone automation could never hold. The route still carries
 * its own `@UseGuards(...)`, and this only tells `JwtAuthGuard` to step aside.
 */
export const IS_TOKEN_AUTH = 'isTokenAuth';
export const TokenAuth = () => SetMetadata(IS_TOKEN_AUTH, true);
