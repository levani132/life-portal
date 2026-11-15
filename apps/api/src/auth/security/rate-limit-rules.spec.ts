import { overLimit, RATE_RULES, retryAfterSeconds, windowStart } from './rate-limit-rules';

describe('rate-limit windows', () => {
  const windowMs = 15 * 60_000;

  it('aligns hits to a fixed window', () => {
    const start = 1_800_000_000_000 - (1_800_000_000_000 % windowMs);
    expect(windowStart(start + 1, windowMs)).toBe(start);
    expect(windowStart(start + windowMs, windowMs)).toBe(start + windowMs);
  });

  it('says how long until the window ends, never less than a second', () => {
    const start = windowStart(1_800_000_000_000, windowMs);
    expect(retryAfterSeconds(start, windowMs)).toBe(900);
    expect(retryAfterSeconds(start + windowMs - 1, windowMs)).toBe(1);
  });

  it('allows exactly the limit and refuses the hit after it', () => {
    const rule = RATE_RULES.loginByAccount;
    expect(overLimit(rule.limit, rule)).toBe(false);
    expect(overLimit(rule.limit + 1, rule)).toBe(true);
  });
});
