/**
 * What this device remembers about each account's offline writes outside IndexedDB (spec 034,
 * issue #21): how many are waiting, and when that was last written. Counts and times only — no
 * content, no labels — in localStorage, which a browser usually clears separately from
 * IndexedDB, or not at all.
 *
 * It serves two purposes:
 * - **Eviction.** If the account's database opens with fewer writes than this says, the browser
 *   deleted them: the person is told how many were lost. This is best effort. A browser that
 *   clears localStorage too (as iOS does when it evicts a site) leaves nothing to compare.
 * - **Other accounts.** Writes another account left on this device are counted, never shown.
 *
 * Pure apart from the `Storage` it is given.
 */

const PREFIX = 'lp.offline.meta:';

export interface DeviceMeta {
  pending: number;
  at: number;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function parse(raw: string | null): DeviceMeta | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<DeviceMeta>;
    return typeof value.pending === 'number' && value.pending >= 0 && typeof value.at === 'number'
      ? { pending: value.pending, at: value.at }
      : undefined;
  } catch {
    return undefined;
  }
}

export function readMeta(userId: string, storage: Store): DeviceMeta | undefined {
  try {
    return parse(storage.getItem(PREFIX + userId));
  } catch {
    return undefined;
  }
}

export function writeMeta(userId: string, pending: number, now: number, storage: Store): void {
  try {
    storage.setItem(PREFIX + userId, JSON.stringify({ pending, at: now }));
  } catch {
    // Storage blocked or full: eviction simply cannot be noticed.
  }
}

export function clearMeta(userId: string, storage: Store): void {
  try {
    storage.removeItem(PREFIX + userId);
  } catch {
    // nothing to do
  }
}

/** How many writes the remembered count says should be there but are not. */
export function lostWrites(meta: DeviceMeta | undefined, found: number): number {
  return meta ? Math.max(0, meta.pending - found) : 0;
}

/** Writes other accounts left on this device: a total, never which account or what. */
export function otherAccountsPending(userId: string, storage: Store): number {
  let total = 0;
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(PREFIX) || key === PREFIX + userId) continue;
      total += parse(storage.getItem(key))?.pending ?? 0;
    }
  } catch {
    return 0;
  }
  return total;
}

/** The account a token was issued for (`sub`), read without verifying it. */
export function tokenSubject(token: string | null | undefined): string | undefined {
  const payload = token?.split('.')[1];
  if (!payload) return undefined;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a write of `userId`'s may go out with this token: not when it was issued for another
 * account. A token that cannot be read is left to the server, which answers 401 if it is wrong.
 */
export function mayReplayAs(userId: string, token: string | null | undefined): boolean {
  const subject = tokenSubject(token);
  return !subject || subject === userId;
}
