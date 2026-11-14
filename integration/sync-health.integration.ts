/**
 * Sync-health counters (issue #22) against a real MongoDB: what is counted, that nothing personal
 * is stored, and that only the developer can read them.
 */
import { randomUUID } from 'node:crypto';
import { startApi, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const today = () => new Date().toISOString().slice(0, 10);
/** Counting is never awaited by the write; give it a moment to land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

it('counts writes, replays, refusals by code and waiting time, and nothing that identifies anyone', async () => {
  const me = await api.account();
  const header = { 'Idempotency-Key': `int-${randomUUID()}`, 'X-Queued-Age': '7200' };
  const body = { day: today(), weightGrams: 72_345, note: 'private note' };
  await api.call(me, 'PUT', '/nutrition/weigh-ins', body, header);
  await api.call(me, 'PUT', '/nutrition/weigh-ins', body, header); // replayed
  await api.call(me, 'PUT', '/nutrition/weigh-ins', { ...body, weightGrams: 1, baseVersion: 0 }, { 'Idempotency-Key': `int-${randomUUID()}` }); // invalid: 400
  const stale = await api.call<{ code: string }>(me, 'PUT', '/nutrition/weigh-ins', { day: today(), weightGrams: 73_000, baseVersion: 0 }, { 'Idempotency-Key': `int-${randomUUID()}`, 'X-Queued-Age': 'not a number' });
  expect(stale.body.code).toBe('STALE_EDIT');
  await api.call(me, 'PUT', '/nutrition/weigh-ins', { day: today(), weightGrams: 74_000 }); // no key: not counted
  await settle();

  const rows = await api.db.collection('sync_health_daily').find().toArray();
  const counts = Object.fromEntries(rows.map((row) => [`${row['metric']}:${row['key']}`, row['count']]));
  // Two of the four carried a readable age (7,200 s), and one was refused before validation passed.
  expect(counts).toEqual({ 'writes:all': 4, 'replays:all': 1, 'refusals:http_400': 1, 'refusals:STALE_EDIT': 1, 'age:under1d': 2 });

  // Nothing in any row is an account, a value from a body, or free text.
  const stored = JSON.stringify(rows);
  for (const secret of [me.id, me.email, '72345', '72_345', 'private note', 'weigh-ins']) expect(stored).not.toContain(secret);
  for (const row of rows) expect(Object.keys(row).sort()).toEqual(['_id', 'count', 'day', 'expiresAt', 'key', 'metric']);
});

it('shows the report to the developer only', async () => {
  const someone = await api.account();
  const developer = await api.account('developer');
  expect((await api.call(someone, 'GET', '/sync-health?range=7')).status).toBe(403);
  const { CONFIG } = await import('../apps/api/src/config/configuration');
  api.app.get<{ developerUserId?: string }>(CONFIG).developerUserId = developer.id;
  try {
    const report = await api.call<{ range: number; totals: { writes: number } }>(developer, 'GET', '/sync-health?range=30');
    expect(report.status).toBe(200);
    expect(report.body.range).toBe(30);
    expect(report.body.totals.writes).toBeGreaterThan(0);
    expect((await api.call(developer, 'GET', '/sync-health?range=12')).status).toBe(400);
    expect((await api.call(someone, 'GET', '/sync-health?range=30')).status).toBe(403);
  } finally {
    api.app.get<{ developerUserId?: string }>(CONFIG).developerUserId = undefined;
  }
});
