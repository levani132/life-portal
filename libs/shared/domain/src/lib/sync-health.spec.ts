import type { SyncHealthCount } from '@life-portal/shared-types';
import { summariseSyncHealth, syncAgeBucket, syncRefusalKey } from './sync-health';

describe('sync health (issue #22)', () => {
  it('buckets how long a write waited, and ignores anything that is not a time', () => {
    expect(syncAgeBucket('0')).toBe('under1m');
    expect(syncAgeBucket('59')).toBe('under1m');
    expect(syncAgeBucket('60')).toBe('under1h');
    expect(syncAgeBucket(86_399)).toBe('under1d');
    expect(syncAgeBucket(3 * 86_400)).toBe('under7d');
    expect(syncAgeBucket(29 * 86_400)).toBe('under30d');
    expect(syncAgeBucket(31 * 86_400)).toBe('older');
    for (const bad of [undefined, null, '', '-5', '1.5', 'soon', '1e9', -1, Number.NaN]) expect(syncAgeBucket(bad)).toBeUndefined();
  });

  it('keeps known refusal codes and reduces anything else to its status', () => {
    expect(syncRefusalKey(409, 'STALE_EDIT')).toBe('STALE_EDIT');
    expect(syncRefusalKey(422, 'CLIENT_TIME_TOO_OLD')).toBe('CLIENT_TIME_TOO_OLD');
    expect(syncRefusalKey(400, 'reps must be a number')).toBe('http_400');
    expect(syncRefusalKey(404)).toBe('http_404');
  });

  it('folds rows into days, newest first, within the range only', () => {
    const rows: SyncHealthCount[] = [
      { day: '2026-11-13', metric: 'writes', key: 'all', count: 4 },
      { day: '2026-11-13', metric: 'refusals', key: 'STALE_EDIT', count: 1 },
      { day: '2026-11-14', metric: 'writes', key: 'all', count: 2 },
      { day: '2026-11-14', metric: 'replays', key: 'all', count: 1 },
      { day: '2026-11-14', metric: 'age', key: 'under1h', count: 2 },
      { day: '2026-11-14', metric: 'age', key: 'bogus', count: 9 },
      { day: '2026-11-14', metric: 'refusals', key: 'STALE_EDIT', count: 2 },
      { day: '2026-11-01', metric: 'writes', key: 'all', count: 100 },
    ];
    const report = summariseSyncHealth(rows, 7, '2026-11-08', '2026-11-14');
    expect(report.days.map((day) => day.day)).toEqual(['2026-11-14', '2026-11-13']);
    expect(report.days[0]).toEqual({ day: '2026-11-14', writes: 2, replays: 1, refusals: { STALE_EDIT: 2 }, ages: { under1h: 2 } });
    expect(report.totals).toEqual({ writes: 6, replays: 1, refusals: { STALE_EDIT: 3 }, ages: { under1h: 2 } });
  });

  it('reports an empty range as no days and zero totals', () => {
    expect(summariseSyncHealth([], 30, '2026-10-16', '2026-11-14')).toEqual({
      range: 30,
      from: '2026-10-16',
      to: '2026-11-14',
      days: [],
      totals: { writes: 0, replays: 0, refusals: {}, ages: {} },
    });
  });
});
