import {
  SYNC_AGE_BUCKETS,
  type SyncAgeBucket,
  type SyncHealthCount,
  type SyncHealthRange,
  type SyncHealthReport,
  type SyncHealthTotals,
} from '@life-portal/shared-types';

/**
 * Sync health (issue #22). Pure: the server decides the day and passes rows in.
 *
 * Keys are bounded so a counter can never carry content: refusal codes come from this list
 * and anything else becomes `http_<status>`; ages are buckets, never the number sent.
 */
export const SYNC_REFUSAL_CODES = [
  'STALE_EDIT',
  'ROW_DELETED',
  'SESSION_CONFLICT',
  'CLIENT_TIME_TOO_OLD',
  'ID_TAKEN',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
  'PLAN_CHANGED',
  'EMPTY_SESSION',
  'FOOD_GONE',
  'MEAL_CHANGED',
  'MEDIA_GONE',
  'POST_GONE',
] as const;

const UPPER_BOUNDS_S: [SyncAgeBucket, number][] = [
  ['under1m', 60],
  ['under1h', 3600],
  ['under1d', 86_400],
  ['under7d', 7 * 86_400],
  ['under30d', 30 * 86_400],
];

/** The bucket for a waiting time in seconds, or none when the value is missing or not a time. */
export function syncAgeBucket(raw: string | number | undefined | null): SyncAgeBucket | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const seconds = typeof raw === 'number' ? raw : /^\d{1,12}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  for (const [bucket, bound] of UPPER_BOUNDS_S) if (seconds < bound) return bucket;
  return 'older';
}

/** The counter key for a refusal: a known code, else the status alone. */
export function syncRefusalKey(status: number, code?: unknown): string {
  return typeof code === 'string' && (SYNC_REFUSAL_CODES as readonly string[]).includes(code) ? code : `http_${status}`;
}

const empty = (): SyncHealthTotals => ({ writes: 0, replays: 0, refusals: {}, ages: {} });

function add(into: SyncHealthTotals, row: SyncHealthCount) {
  if (row.metric === 'writes') into.writes += row.count;
  else if (row.metric === 'replays') into.replays += row.count;
  else if (row.metric === 'refusals') into.refusals[row.key] = (into.refusals[row.key] ?? 0) + row.count;
  else if ((SYNC_AGE_BUCKETS as readonly string[]).includes(row.key)) {
    const bucket = row.key as SyncAgeBucket;
    into.ages[bucket] = (into.ages[bucket] ?? 0) + row.count;
  }
}

/** Rows between `from` and `to` (inclusive) folded into days, newest first, and totals. */
export function summariseSyncHealth(rows: SyncHealthCount[], range: SyncHealthRange, from: string, to: string): SyncHealthReport {
  const byDay = new Map<string, SyncHealthTotals>();
  const totals = empty();
  for (const row of rows) {
    if (row.day < from || row.day > to || !(row.count > 0)) continue;
    const day = byDay.get(row.day) ?? empty();
    add(day, row);
    add(totals, row);
    byDay.set(row.day, day);
  }
  const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([day, counts]) => ({ day, ...counts }));
  return { range, from, to, days, totals };
}
