import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { IngestTokenService } from './ingest-token.service';

/** Accepted submissions per token per hour. Generous for a person, useless for a flood. */
const LIMIT_PER_HOUR = 60;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Header authentication for the one route a phone automation calls.
 *
 * The global `JwtAuthGuard` cannot serve here — a Shortcut has no way to hold a session — and
 * making the route `@Public()` would leave the collection of every payment the owner makes open
 * to anyone who found the URL. So it carries its own credential instead, and the route is neither
 * public nor JWT-guarded.
 *
 * The rate limit is a fixed window held in memory rather than `@nestjs/throttler`: the
 * constitution asks a new dependency to justify itself, and one endpoint for one person cannot.
 * Its weakness is honest — a free host that sleeps the process resets the window, making this
 * "60 an hour per process lifetime" — which still bounds what a leaked token can do, at no cost.
 */
@Injectable()
export class IngestTokenGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly tokens: IngestTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { ingest?: unknown }>();
    const header = request.headers['x-ingest-token'];
    const presented = Array.isArray(header) ? header[0] : header;
    if (!presented) throw new UnauthorizedException('Missing ingest token');

    // The token's own validity is judged against the server's day; the *payment's* day comes from
    // the phone's clock, which is a different question and handled in the service.
    const today = new Date().toISOString().slice(0, 10);
    const verified = await this.tokens.verify(presented, today);
    if (!verified) throw new UnauthorizedException('Invalid, expired or revoked ingest token');

    this.consume(verified.tokenId);

    // Handed to the controller so it never has to re-verify or trust anything in the body.
    request.ingest = verified;
    return true;
  }

  private consume(tokenId: string): void {
    const now = Date.now();
    const entry = this.hits.get(tokenId);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(tokenId, { count: 1, resetAt: now + WINDOW_MS });
      return;
    }
    if (entry.count >= LIMIT_PER_HOUR) {
      throw new HttpException('Too many submissions', HttpStatus.TOO_MANY_REQUESTS);
    }
    entry.count += 1;
  }
}

/** The verified owner, attached to the request by the guard. */
export interface IngestContext {
  userId: string;
  tokenId: string;
}
