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
