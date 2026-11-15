import { deviceLabel, REFRESH_GRACE_MS, refreshFailure, tokenHash } from './session-rules';

const now = new Date('2026-11-15T12:00:00Z');
const later = new Date(now.getTime() + 86_400_000);

describe('refreshFailure', () => {
  it('ends when there is no session, or it was revoked or expired', () => {
    expect(refreshFailure(null, 'h', now)).toEqual({ code: 'SESSION_ENDED', revoke: false });
    expect(refreshFailure({ expiresAt: later, revokedAt: now }, 'h', now).code).toBe('SESSION_ENDED');
    expect(refreshFailure({ expiresAt: now }, 'h', now).code).toBe('SESSION_ENDED');
  });

  it('treats the previous token inside the grace window as a race, without revoking', () => {
    const rotatedAt = new Date(now.getTime() - 500);
    expect(refreshFailure({ expiresAt: later, previousHash: 'old', rotatedAt }, 'old', now)).toEqual({
      code: 'REFRESH_SUPERSEDED',
      revoke: false,
    });
  });

  it('treats the previous token after the grace window as a replay', () => {
    const rotatedAt = new Date(now.getTime() - REFRESH_GRACE_MS - 1);
    expect(refreshFailure({ expiresAt: later, previousHash: 'old', rotatedAt }, 'old', now)).toEqual({
      code: 'REFRESH_REUSED',
      revoke: true,
    });
  });

  it('treats any older token as a replay', () => {
    const rotatedAt = new Date(now.getTime() - 100);
    expect(refreshFailure({ expiresAt: later, previousHash: 'old', rotatedAt }, 'older', now).revoke).toBe(true);
  });
});

describe('tokenHash', () => {
  it('reads the whole token, unlike bcrypt', () => {
    const shared = 'x'.repeat(100);
    expect(tokenHash(`${shared}a`)).not.toBe(tokenHash(`${shared}b`));
  });
});

describe('deviceLabel', () => {
  it('names browser and system coarsely', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iPhone');
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      ),
    ).toBe('Chrome on Mac');
    expect(deviceLabel(undefined)).toBe('Unknown device');
  });
});
