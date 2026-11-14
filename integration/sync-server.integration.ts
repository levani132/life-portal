/**
 * The server's half of the sync guarantees (specs 027–034), against a real MongoDB: unique
 * indexes, TTLs and concurrent requests behave here as they do in production, which the unit
 * tests' fake models cannot show. Issue #22.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { startApi, type Account, type TestApi } from './harness';

const id = () => new Types.ObjectId().toString();
const key = () => `int-${randomUUID()}`;
const today = () => new Date().toISOString().slice(0, 10);

let api: TestApi;
let exerciseId: string;

beforeAll(async () => {
  api = await startApi();
  const someone = await api.account('catalogue');
  const page = await api.call<{ items?: { id: string }[] } | { id: string }[]>(someone, 'GET', '/training/exercises');
  const items = Array.isArray(page.body) ? page.body : (page.body.items ?? []);
  exerciseId = items[0]?.id;
  if (!exerciseId) throw new Error(`no catalogue exercise: ${JSON.stringify(page.body).slice(0, 300)}`);
});
afterAll(() => api?.close());

/** Starts a workout with one exercise and one set, all with ids chosen by the "device". */
async function workoutWithSet(who: Account) {
  const sessionId = id();
  const weId = id();
  const setId = id();
  const started = await api.call(who, 'POST', '/training/sessions', { requestId: randomUUID(), day: today(), id: sessionId }, { 'Idempotency-Key': key() });
  expect(started.status).toBeLessThan(300);
  const added = await api.call(who, 'POST', `/training/sessions/${sessionId}/exercises`, { requestId: randomUUID(), exerciseId, id: weId }, { 'Idempotency-Key': key() });
  expect(added.status).toBeLessThan(300);
  const logged = await api.call(who, 'POST', `/training/sessions/${sessionId}/exercises/${weId}/sets`, { requestId: randomUUID(), id: setId, reps: 5, weightGrams: 60_000 }, { 'Idempotency-Key': key() });
  expect(logged.status).toBeLessThan(300);
  return { sessionId, weId, setId };
}

describe('two devices editing the same rows (spec 030)', () => {
  it('applies the first edit and refuses the second with the row as it is now', async () => {
    const me = await api.account();
    const { setId, sessionId } = await workoutWithSet(me);
    const phone = await api.call(me, 'PATCH', `/training/sets/${setId}`, { baseVersion: 0, reps: 6 }, { 'Idempotency-Key': key() });
    expect(phone.status).toBe(200);
    const laptop = await api.call<{ code: string; current: { set: { reps: number; version: number } } }>(me, 'PATCH', `/training/sets/${setId}`, { baseVersion: 0, reps: 8 }, { 'Idempotency-Key': key() });
    expect(laptop.status).toBe(409);
    expect(laptop.body.code).toBe('STALE_EDIT');
    expect(laptop.body.current.set).toMatchObject({ reps: 6, version: 1 });
    // "Keep mine": the same edit against the current version goes through.
    const kept = await api.call(me, 'PATCH', `/training/sets/${setId}`, { baseVersion: 1, reps: 8 }, { 'Idempotency-Key': key() });
    expect(kept.status).toBe(200);
    const stored = await api.db.collection('workout_sets').findOne({ _id: new Types.ObjectId(setId) });
    expect(stored).toMatchObject({ reps: 8, version: 2 });
    expect(sessionId).toBeDefined();
  });

  it('treats an edit of a row deleted elsewhere as a conflict, and a second delete as done', async () => {
    const me = await api.account();
    const { setId } = await workoutWithSet(me);
    expect((await api.call(me, 'DELETE', `/training/sets/${setId}`, undefined, { 'Idempotency-Key': key() })).status).toBeLessThan(300);
    const again = await api.call(me, 'DELETE', `/training/sets/${setId}`, undefined, { 'Idempotency-Key': key() });
    expect(again.status).toBeLessThan(300);
    const edit = await api.call<{ code: string }>(me, 'PATCH', `/training/sets/${setId}`, { baseVersion: 0, reps: 3 }, { 'Idempotency-Key': key() });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('ROW_DELETED');
  });

  it('never overwrites a weigh-in recorded for the same day on another device', async () => {
    const me = await api.account();
    const day = today();
    const first = await api.call(me, 'PUT', '/nutrition/weigh-ins', { day, weightGrams: 80_000, baseVersion: 0 }, { 'Idempotency-Key': key() });
    expect(first.status).toBeLessThan(300);
    const second = await api.call<{ code: string; current: { weightGrams: number } }>(me, 'PUT', '/nutrition/weigh-ins', { day, weightGrams: 81_000, baseVersion: 0 }, { 'Idempotency-Key': key() });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('STALE_EDIT');
    expect(second.body.current.weightGrams).toBe(80_000);
  });
});

describe('retries (spec 027)', () => {
  it('answers a retry after a lost response with the first answer, writing once', async () => {
    const me = await api.account();
    const sessionId = id();
    const body = { requestId: randomUUID(), day: today(), id: sessionId };
    const header = { 'Idempotency-Key': key() };
    const first = await api.call(me, 'POST', '/training/sessions', body, header);
    // The response "never arrived"; the device sends the same write again, three times.
    const replies = [];
    for (let attempt = 0; attempt < 3; attempt++) replies.push(await api.call(me, 'POST', '/training/sessions', body, header));
    for (const reply of replies) {
      expect(reply.status).toBe(first.status);
      expect(reply.body).toEqual(first.body);
    }
    expect(await api.db.collection('workout_sessions').countDocuments({ _id: new Types.ObjectId(sessionId) })).toBe(1);
  });

  it('runs a write once when the same retry arrives several times at once', async () => {
    const me = await api.account();
    const sessionId = id();
    const body = { requestId: randomUUID(), day: today(), id: sessionId };
    const header = { 'Idempotency-Key': key() };
    const replies = await Promise.all(Array.from({ length: 5 }, () => api.call(me, 'POST', '/training/sessions', body, header)));
    // Each is either the answer or "still running, try again" — never a second workout.
    for (const reply of replies) expect([200, 201, 409]).toContain(reply.status);
    expect(replies.filter((reply) => reply.status < 300).length).toBeGreaterThanOrEqual(1);
    expect(await api.db.collection('workout_sessions').countDocuments({ userId: me.id })).toBe(1);
  });

  it('refuses the same key for a different write', async () => {
    const me = await api.account();
    const header = { 'Idempotency-Key': key() };
    await api.call(me, 'PUT', '/nutrition/weigh-ins', { day: today(), weightGrams: 70_000 }, header);
    const reused = await api.call<{ code: string }>(me, 'PUT', '/nutrition/weigh-ins', { day: today(), weightGrams: 71_000 }, header);
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('keeps keys per account: another person sending the same key runs their own write', async () => {
    const alice = await api.account('alice');
    const bob = await api.account('bob');
    const header = { 'Idempotency-Key': key() };
    expect((await api.call(alice, 'PUT', '/nutrition/weigh-ins', { day: today(), weightGrams: 60_000 }, header)).status).toBeLessThan(300);
    const theirs = await api.call(bob, 'PUT', '/nutrition/weigh-ins', { day: today(), weightGrams: 90_000 }, header);
    expect(theirs.status).toBeLessThan(300);
    const rows = await api.db.collection('weigh_ins').find({ userId: { $in: [alice.id, bob.id] } }).toArray();
    expect(rows.map((row) => row['weightGrams']).sort()).toEqual([60_000, 90_000]);
  });
});

describe('ids chosen on the device, and refusals (specs 028, 034)', () => {
  it('refuses an id another account already has', async () => {
    const alice = await api.account('alice');
    const bob = await api.account('bob');
    const sessionId = id();
    expect((await api.call(alice, 'POST', '/training/sessions', { requestId: randomUUID(), day: today(), id: sessionId })).status).toBeLessThan(300);
    const taken = await api.call<{ code: string }>(bob, 'POST', '/training/sessions', { requestId: randomUUID(), day: today(), id: sessionId });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('ID_TAKEN');
  });

  it('refuses a second open workout until the first is closed', async () => {
    const me = await api.account();
    const first = id();
    const second = id();
    expect((await api.call(me, 'POST', '/training/sessions', { requestId: randomUUID(), day: today(), id: first })).status).toBeLessThan(300);
    const header = { 'Idempotency-Key': key() };
    const body = { requestId: randomUUID(), day: today(), id: second };
    const refused = await api.call<{ code: string }>(me, 'POST', '/training/sessions', body, header);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('SESSION_CONFLICT');
    // An empty workout cannot be finished (`EMPTY_SESSION`); the person discards it instead.
    expect((await api.call(me, 'DELETE', `/training/sessions/${first}`)).status).toBeLessThan(300);
    // A 409 is released, not replayed: the same write with the same key now goes through.
    expect((await api.call(me, 'POST', '/training/sessions', body, header)).status).toBeLessThan(300);
  });

  it('refuses a workout recorded more than 14 days ago, and keeps refusing on retry', async () => {
    const me = await api.account();
    const startedAt = new Date(Date.now() - 15 * 86_400_000).toISOString();
    const body = { requestId: randomUUID(), day: startedAt.slice(0, 10), id: id(), startedAt };
    const header = { 'Idempotency-Key': key() };
    const refused = await api.call<{ code: string; recordedAt: string }>(me, 'POST', '/training/sessions', body, header);
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'CLIENT_TIME_TOO_OLD', recordedAt: startedAt });
    expect((await api.call(me, 'POST', '/training/sessions', body, header)).status).toBe(422);
    expect(await api.db.collection('workout_sessions').countDocuments({ userId: me.id })).toBe(0);
  });

  it('never lets one account touch another account’s rows', async () => {
    const alice = await api.account('alice');
    const mallory = await api.account('mallory');
    const { setId } = await workoutWithSet(alice);
    const edit = await api.call(mallory, 'PATCH', `/training/sets/${setId}`, { reps: 1 });
    expect([404, 409]).toContain(edit.status);
    const stored = await api.db.collection('workout_sets').findOne({ _id: new Types.ObjectId(setId) });
    expect(stored?.['reps']).toBe(5);
  });
});
