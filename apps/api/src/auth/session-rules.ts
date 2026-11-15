import { createHash } from 'node:crypto';
import type { RefreshRefusal } from '@life-portal/shared-types';

/**
 * How long after a rotation the token it replaced is treated as a benign race rather than a
 * replay. Two tabs refreshing with the same token land within a few hundred milliseconds of each
 * other; a stolen token used after the owner refreshed does not, except by bad luck.
 */
export const REFRESH_GRACE_MS = 30_000;

/** SHA-256 hex of a refresh token. Tokens carry a random `jti`, so no salt or KDF is needed. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** What the refresh found when the atomic rotation matched nothing. */
export interface SessionState {
  revokedAt?: Date | null;
  expiresAt: Date;
  previousHash?: string | null;
  rotatedAt?: Date | null;
}

/**
 * Why a refresh that did not rotate failed, and whether the session must be revoked.
 *
 * - No session, or one that already ended: `SESSION_ENDED`.
 * - The token rotated just before, by another tab: `REFRESH_SUPERSEDED`, and nothing is revoked,
 *   so a race between two tabs never signs anyone out.
 * - Anything else is a token this session no longer issues (an old one, or the previous one
 *   after the grace window): `REFRESH_REUSED`, and the whole session is revoked, because one of
 *   the two holders is not the owner.
 */
export function refreshFailure(
  session: SessionState | null,
  presentedHash: string,
  now: Date,
): { code: RefreshRefusal; revoke: boolean } {
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
    return { code: 'SESSION_ENDED', revoke: false };
  }
  if (
    session.previousHash === presentedHash &&
    session.rotatedAt &&
    now.getTime() - session.rotatedAt.getTime() <= REFRESH_GRACE_MS
  ) {
    return { code: 'REFRESH_SUPERSEDED', revoke: false };
  }
  return { code: 'REFRESH_REUSED', revoke: true };
}

/** "Safari on iPhone" from a user-agent. Coarse on purpose: a label, not a fingerprint. */
export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS/.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'Unknown device';
}
