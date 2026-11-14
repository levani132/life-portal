/**
 * Sync health (issue #22): daily counts of what offline writes met at the server, developer
 * only. Content-free by construction: a row is a day, a metric, a bounded key and a count — no
 * account, path, body, food, exercise or weight. See docs/modules/offline.md and
 * docs/runbooks/offline-sync.md.
 */

export const SYNC_HEALTH_RANGES = [7, 30, 90] as const;
export type SyncHealthRange = (typeof SYNC_HEALTH_RANGES)[number];

/** How long a write waited on the device before reaching the server. */
export const SYNC_AGE_BUCKETS = ['under1m', 'under1h', 'under1d', 'under7d', 'under30d', 'older'] as const;
export type SyncAgeBucket = (typeof SYNC_AGE_BUCKETS)[number];

/**
 * - `writes`: writes that carried an `Idempotency-Key` (key `all`);
 * - `replays`: answered from the stored result without running again (key `all`);
 * - `refusals`: refused, by code (an allowlisted code, else `http_<status>`);
 * - `age`: how long the write had waited, by bucket.
 */
export type SyncHealthMetric = 'writes' | 'replays' | 'refusals' | 'age';

export interface SyncHealthCount {
  day: string;
  metric: SyncHealthMetric;
  key: string;
  count: number;
}

export interface SyncHealthTotals {
  writes: number;
  replays: number;
  refusals: Record<string, number>;
  ages: Partial<Record<SyncAgeBucket, number>>;
}

export interface SyncHealthDay extends SyncHealthTotals {
  day: string;
}

/** `GET /sync-health?range=`. Days with nothing counted are left out. */
export interface SyncHealthReport {
  range: SyncHealthRange;
  from: string;
  to: string;
  days: SyncHealthDay[];
  totals: SyncHealthTotals;
}
