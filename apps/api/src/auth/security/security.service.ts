import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac } from 'node:crypto';
import { Model } from 'mongoose';
import { CONFIG, type AppConfig } from '../../config/configuration';
import { overLimit, retryAfterSeconds, windowStart, type RateRule } from './rate-limit-rules';
import { RateLimitCounter, SecurityEvent, type SecurityEventType } from './security.schemas';

const EVENT_TTL_MS = 90 * 86_400_000;

/** 429 with a generic message, the same for every subject, so it reveals nothing. */
export class RateLimited extends HttpException {
  constructor(readonly retryAfter: number) {
    super(
      { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a little while.', retryAfter },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export interface RequestContext {
  ip?: string;
}

/**
 * Rate limits and the security event log for sign-in (issue #27 S2). Subjects are HMAC-hashed
 * with a key derived from `JWT_SECRET` before they reach Mongo, so neither collection holds an
 * email or an IP.
 */
@Injectable()
export class SecurityService {
  private readonly logger = new Logger('Security');
  private readonly key: Buffer;

  constructor(
    @InjectModel(RateLimitCounter.name) private readonly counters: Model<RateLimitCounter>,
    @InjectModel(SecurityEvent.name) private readonly events: Model<SecurityEvent>,
    @Inject(CONFIG) config: AppConfig,
  ) {
    this.key = createHmac('sha256', config.jwtSecret).update('auth-security-v1').digest();
  }

  /** Short keyed hash of an IP, email or id. Normalised so "A@x" and "a@x " count together. */
  hash(subject: string): string {
    return createHmac('sha256', this.key).update(subject.trim().toLowerCase()).digest('hex').slice(0, 32);
  }

  /**
   * Counts one hit against `rule` for `subject` and throws `RateLimited` once it is over. A
   * missing subject (no IP) is not counted rather than lumped together with everyone else's.
   */
  async hit(rule: RateRule, subject: string | undefined, ctx: RequestContext = {}, now = Date.now()): Promise<void> {
    if (!subject) return;
    const start = windowStart(now, rule.windowMs);
    const key = `${rule.bucket}:${this.hash(subject)}:${start}`;
    const row = await this.counters.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(start + rule.windowMs) } },
      { upsert: true, new: true, projection: { count: 1 } },
    );
    if (row && overLimit(row.count, rule)) {
      await this.record('rate_limited', ctx, undefined, rule.bucket);
      throw new RateLimited(retryAfterSeconds(now, rule.windowMs));
    }
  }

  /** Records an event. Never throws: a full log must not fail a sign-in. */
  async record(type: SecurityEventType, ctx: RequestContext, userId?: string, detail?: string): Promise<void> {
    const at = new Date();
    try {
      await this.events.create({
        type,
        userId,
        ipHash: ctx.ip ? this.hash(ctx.ip) : undefined,
        detail: detail?.slice(0, 40),
        at,
        expiresAt: new Date(at.getTime() + EVENT_TTL_MS),
      });
    } catch (error) {
      this.logger.warn(`Could not record ${type}: ${(error as Error).name}`);
    }
  }
}
