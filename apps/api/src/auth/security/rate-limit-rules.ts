/**
 * Fixed-window rate limits for the auth routes (issue #27 S2). Pure, with "now" passed in.
 *
 * Each rule counts hits per subject (an IP, an account or an email, always hashed before it is
 * stored) inside a window. A fixed window lets one Mongo upsert per hit do the counting, and the
 * worst case of 2× the limit across a window boundary is fine for slowing guessing down.
 */
export interface RateRule {
  /** Short and stable: it is part of the stored key. */
  bucket: string;
  limit: number;
  windowMs: number;
}

const MIN = 60_000;

export const RATE_RULES = {
  loginByIp: { bucket: 'login:ip', limit: 30, windowMs: 15 * MIN },
  loginByAccount: { bucket: 'login:acct', limit: 10, windowMs: 15 * MIN },
  registerByIp: { bucket: 'register:ip', limit: 10, windowMs: 60 * MIN },
  refreshByIp: { bucket: 'refresh:ip', limit: 300, windowMs: 15 * MIN },
  changePasswordByUser: { bucket: 'pwchange:user', limit: 10, windowMs: 60 * MIN },
  forgotByIp: { bucket: 'forgot:ip', limit: 10, windowMs: 60 * MIN },
  forgotByAccount: { bucket: 'forgot:acct', limit: 3, windowMs: 60 * MIN },
  resetByIp: { bucket: 'reset:ip', limit: 20, windowMs: 60 * MIN },
  verifyByUser: { bucket: 'verify:user', limit: 5, windowMs: 60 * MIN },
} as const satisfies Record<string, RateRule>;

/** The start of the window `now` falls in. */
export function windowStart(now: number, windowMs: number): number {
  return Math.floor(now / windowMs) * windowMs;
}

/** Whole seconds until the window ends, at least 1, for `Retry-After`. */
export function retryAfterSeconds(now: number, windowMs: number): number {
  return Math.max(1, Math.ceil((windowStart(now, windowMs) + windowMs - now) / 1000));
}

/** Whether a hit that brought the window's count to `count` is over the limit. */
export function overLimit(count: number, rule: RateRule): boolean {
  return count > rule.limit;
}
