/**
 * The device's half of the sync guarantees (specs 027–034): the web app's own outbox and send
 * function, unchanged, driven against the real API and a real MongoDB. A memory store stands in
 * for IndexedDB (the outbox is tested against both behind one interface), and the clock is ours,
 * so backoff is stepped through rather than waited for. Issue #22.
 */
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { startApi, type Account, type TestApi } from './harness';
import type { OutboxItem } from '../apps/web/src/lib/offline/types';

type Web = {
  api: typeof import('../apps/web/src/lib/api');
  outbox: typeof import('../apps/web/src/lib/offline/outbox');
  memory: typeof import('../apps/web/src/lib/offline/memory-store');
  send: typeof import('../apps/web/src/lib/offline/send');
};

const oid = () => new Types.ObjectId().toString();
const today = () => new Date().toISOString().slice(0, 10);

let api: TestApi;
let web: Web;
let exerciseId: string;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
}

beforeAll(async () => {
  api = await startApi();
  // The web modules read these when loaded: the API's address and the browser's storage.
  process.env['NEXT_PUBLIC_API_URL'] = api.url;
  (globalThis as { window?: unknown }).window = { localStorage: memoryStorage() };
  web = {
    api: await import('../apps/web/src/lib/api'),
    outbox: await import('../apps/web/src/lib/offline/outbox'),
    memory: await import('../apps/web/src/lib/offline/memory-store'),
    send: await import('../apps/web/src/lib/offline/send'),
  };
  const someone = await api.account('catalogue');
  const page = await api.call<{ items?: { id: string }[] } | { id: string }[]>(someone, 'GET', '/training/exercises');
  exerciseId = (Array.isArray(page.body) ? page.body : (page.body.items ?? []))[0].id;
});
afterAll(async () => {
  delete (globalThis as { window?: unknown }).window;
  await api?.close();
});

/** One device: its own store, the real send function for `owner`, and a clock we move. */
function device(owner: Account, wrap?: (send: (item: OutboxItem, save: (body: unknown) => Promise<void>) => Promise<unknown>) => typeof send) {
  let clock = Date.now();
  const db = web.memory.memoryDb();
  const real = web.send.sendAs(owner.id);
  const send = wrap ? wrap(real) : real;
  const outbox = new web.outbox.Outbox({ store: db.outbox, send, now: () => clock, random: () => 0, setTimer: () => undefined });
  return {
    outbox,
    async items(): Promise<OutboxItem[]> {
      return db.outbox.all();
    },
    /** Lets backoff expire and runs the queue once. */
    async sync() {
      clock += 10 * 60_000;
      await outbox.drain();
    },
  };
}

const signIn = (who: Account) => web.api.tokens.set({ accessToken: who.accessToken, refreshToken: who.refreshToken });

/** A workout, an exercise in it and a set on it: three writes, each waiting on the one before. */
async function queueWorkout(outbox: InstanceType<Web['outbox']['Outbox']>) {
  const sessionId = oid();
  const weId = oid();
  const setId = oid();
  const ids = { start: randomUUID(), exercise: randomUUID(), set: randomUUID() };
  // Enqueued in the order a person makes them; each later write depends on the earlier one.
  await outbox.enqueue({ id: ids.start, kind: 'training.start', method: 'POST', path: '/training/sessions', body: { requestId: randomUUID(), day: today(), id: sessionId } });
  await outbox.enqueue({ id: ids.exercise, kind: 'training.exercise.add', method: 'POST', path: `/training/sessions/${sessionId}/exercises`, body: { requestId: randomUUID(), exerciseId, id: weId }, dependsOn: [ids.start] });
  await outbox.enqueue({ id: ids.set, kind: 'training.set.add', method: 'POST', path: `/training/sessions/${sessionId}/exercises/${weId}/sets`, body: { requestId: randomUUID(), id: setId, reps: 5, weightGrams: 50_000 }, dependsOn: [ids.exercise] });
  return { sessionId, weId, setId, ids };
}

const count = (collection: string, filter: Record<string, unknown>) => api.db.collection(collection).countDocuments(filter);

describe('the web outbox against the real API (issue #22)', () => {
  it('sends dependent writes in order and empties the queue only once each is acknowledged', async () => {
    const me = await api.account();
    signIn(me);
    const phone = device(me);
    const { sessionId, setId } = await queueWorkout(phone.outbox);
    await phone.sync();
    expect(await phone.items()).toEqual([]);
    expect(await count('workout_sessions', { _id: new Types.ObjectId(sessionId), userId: me.id })).toBe(1);
    expect(await count('workout_sets', { _id: new Types.ObjectId(setId) })).toBe(1);
  });

  it('replays a write whose answer was lost, repeatedly, and it happens once', async () => {
    const me = await api.account();
    signIn(me);
    let lost = 3;
    // The request reaches the server, but the answer never reaches the device — three times.
    const phone = device(me, (real) => async (item, save) => {
      const result = await real(item, save);
      if (lost-- > 0) throw new web.api.NetworkError();
      return result;
    });
    const { sessionId, setId } = await queueWorkout(phone.outbox);
    for (let attempt = 0; attempt < 6 && (await phone.items()).length; attempt++) await phone.sync();
    expect(await phone.items()).toEqual([]);
    expect(await count('workout_sessions', { userId: me.id })).toBe(1);
    expect(await count('workout_sets', { _id: new Types.ObjectId(setId) })).toBe(1);
    expect(sessionId).toBeDefined();
  });

  it('never sends one account’s writes while another is signed in', async () => {
    const alice = await api.account('alice');
    const bob = await api.account('bob');
    const alicesPhone = device(alice);
    // Alice's writes are still on the device when Bob signs in without Alice signing out.
    signIn(bob);
    const { sessionId } = await queueWorkout(alicesPhone.outbox);
    await alicesPhone.sync();
    const waiting = await alicesPhone.items();
    expect(waiting.length).toBe(3);
    expect(waiting[0].state).toBe('auth');
    expect(await count('workout_sessions', { _id: new Types.ObjectId(sessionId) })).toBe(0);

    signIn(alice); // Alice is back: her writes go out as her.
    await alicesPhone.outbox.resumeAuth();
    await alicesPhone.sync();
    expect(await alicesPhone.items()).toEqual([]);
    expect(await count('workout_sessions', { _id: new Types.ObjectId(sessionId), userId: alice.id })).toBe(1);
    expect(await count('workout_sessions', { userId: bob.id })).toBe(0);
  });

  it('keeps writes through a sign-out and sends them after signing in again', async () => {
    const me = await api.account();
    signIn(me);
    const phone = device(me);
    web.api.tokens.clear();
    const { sessionId } = await queueWorkout(phone.outbox);
    await phone.sync();
    expect((await phone.items()).map((item) => item.state)).toContain('auth');
    signIn(me);
    await phone.outbox.resumeAuth();
    await phone.sync();
    expect(await phone.items()).toEqual([]);
    expect(await count('workout_sessions', { _id: new Types.ObjectId(sessionId) })).toBe(1);
  });

  it('keeps a refused write, with what the server said, and holds back what depends on it', async () => {
    const owner = await api.account('owner');
    const me = await api.account();
    signIn(owner);
    const takenId = oid();
    expect((await api.call(owner, 'POST', '/training/sessions', { requestId: randomUUID(), day: today(), id: takenId })).status).toBeLessThan(300);

    signIn(me);
    const phone = device(me);
    const start = randomUUID();
    await phone.outbox.enqueue({ id: start, kind: 'training.start', method: 'POST', path: '/training/sessions', body: { requestId: randomUUID(), day: today(), id: takenId } });
    await phone.outbox.enqueue({ id: randomUUID(), kind: 'training.exercise.add', method: 'POST', path: `/training/sessions/${takenId}/exercises`, body: { requestId: randomUUID(), exerciseId, id: oid() }, dependsOn: [start] });
    await phone.sync();
    const [refused, waiting] = await phone.items();
    expect(refused).toMatchObject({ state: 'conflict', lastErrorCode: 'ID_TAKEN' });
    expect(waiting.state).toBe('pending');
    expect(waiting.attempts).toBe(0);
    expect(await count('workout_sessions', { userId: me.id })).toBe(0);
  });

  it('keeps a stale edit with the row as it is now, for the person to choose', async () => {
    const me = await api.account();
    signIn(me);
    const laptop = device(me);
    const { setId } = await queueWorkout(laptop.outbox);
    await laptop.sync();
    // The phone edits first, straight to the server.
    expect((await api.call(me, 'PATCH', `/training/sets/${setId}`, { baseVersion: 0, reps: 9 })).status).toBe(200);
    await laptop.outbox.enqueue({ id: randomUUID(), kind: 'training.set.update', method: 'PATCH', path: `/training/sets/${setId}`, body: { baseVersion: 0, reps: 7 } });
    await laptop.sync();
    const [stale] = await laptop.items();
    expect(stale).toMatchObject({ state: 'conflict', lastErrorCode: 'STALE_EDIT' });
    expect(stale.lastErrorCurrent).toMatchObject({ set: { reps: 9, version: 1 } });
    expect((await api.db.collection('workout_sets').findOne({ _id: new Types.ObjectId(setId) }))?.['reps']).toBe(9);
  });
});
