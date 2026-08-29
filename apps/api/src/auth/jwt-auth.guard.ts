import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC, IS_TOKEN_AUTH } from './current-user.decorator';

/**
 * Registered globally, so **every** route requires a valid access token unless it is
 * explicitly marked `@Public()`. Guarding by default rather than by annotation means a new
 * controller cannot accidentally ship unauthenticated (constitution: Auth).
 *
 * `@TokenAuth()` also steps this guard aside, but means something different: that route carries
 * its own credential and its own guard. It is not public, and the two markers are kept separate
 * so that grepping for unauthenticated routes never turns up one that writes financial records.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const bypass = [IS_PUBLIC, IS_TOKEN_AUTH].some((key) =>
      this.reflector.getAllAndOverride<boolean>(key, [context.getHandler(), context.getClass()]),
    );
    return bypass ? true : super.canActivate(context);
  }
}
