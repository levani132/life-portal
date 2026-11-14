import { ApiError, NetworkError } from '../api';
import { CACHE_TTL_MS, OfflineCache } from './cache';
import { memoryDb } from './memory-store';
import { backoff, classify, Outbox, type EnqueueInput } from './outbox';
import type { OutboxItem } from './types';

/** A server that records what it got and answers from a script. */
function fixture() {
  const db = memoryDb();
  let now = 1_000_000;
  const timers: { at: number; fn: () => void }[] = [];
  const received: string[] = [];
  const done: string[] = [];
  let answer: (item: OutboxItem) => unknown = () => ({ ok: true });
  const outbox = new Outbox({
    store: db.outbox,
    send: async (item) => {
      received.push(item.id);
      const result = answer(item);
      if (result instanceof Error) throw result;
      return result;
    },
    now: () => now,
    random: () => 1,
    setTimer: (fn, ms) => {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      const index = timers.indexOf(handle as (typeof timers)[number]);
      if (index >= 0) timers.splice(index, 1);
    },
    onDone: (item) => done.push(item.id),
  });
  const write = (id: string, extra: Partial<EnqueueInput> = {}): EnqueueInput => ({
    id,
    kind: 'training.set',
    method: 'POST',
    path: `/training/x/${id}`,
    body: { id },
    ...extra,
  });
  /** Moves the clock and fires due timers. */
  const advance = async (ms: number) => {
    now += ms;
    for (const timer of timers.filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.fn();
    }
    await outbox.drain();
  };
  return {
    db,
    outbox,
    write,
    received,
    done,
    advance,
    timers,
    setAnswer: (fn: (item: OutboxItem) => unknown) => (answer = fn),
    reopen: () =>
      new Outbox({ store: db.outbox, send: async (item) => {
        received.push(item.id);
        return answer(item);
      }, now: () => now, random: () => 1 }),
  };
}

const states = (outbox: Outbox) => outbox.getSnapshot().items.map((item) => `${item.id}:${item.state}`);

describe('classify', () => {
  it.each([
    [new NetworkError(), 'transient'],
    [new TypeError('fetch failed'), 'transient'],
    [new ApiError('down', 503), 'transient'],
    [new ApiError('slow', 408), 'transient'],
    [new ApiError('busy', 429), 'transient'],
    [new ApiError('running', 409, undefined, 'IDEMPOTENCY_IN_PROGRESS'), 'transient'],
    [new ApiError('changed', 409, undefined, 'PLAN_CHANGED'), 'conflict'],
    [new ApiError('expired', 401), 'auth'],
    [new ApiError('bad', 400), 'error'],
    [new ApiError('gone', 404), 'error'],
  ])('%s → %s', (error, expected) => {
    expect(classify(error)).toBe(expected);
  });

  it('backs off 1 s, 2 s, 4 s … up to a minute, with jitter', () => {
    expect([1, 2, 3, 7, 20].map((n) => backoff(n, 1))).toEqual([1000, 2000, 4000, 60_000, 60_000]);
    expect(backoff(1, 0)).toBe(500);
  });
});

describe('Outbox (spec 027)', () => {
  it('sends in order and removes an item only once acknowledged', async () => {
    const f = fixture();
    await f.outbox.enqueue(f.write('a'));
    await f.outbox.enqueue(f.write('b'));
    await f.outbox.drain();
    expect(f.received).toEqual(['a', 'b']);
    expect(f.done).toEqual(['a', 'b']);
    expect(f.db.outboxRows.size).toBe(0);
    expect(f.outbox.getSnapshot().lastSyncedAt).toBeDefined();
  });

  it('ignores a second enqueue with the same id', async () => {
    const f = fixture();
    f.setAnswer(() => new NetworkError());
    await f.outbox.enqueue(f.write('a'));
    await f.outbox.enqueue(f.write('a'));
    expect(f.db.outboxRows.size).toBe(1);
  });

  it('keeps writes through a "reload" and sends them once the connection is back', async () => {
    const f = fixture();
    f.setAnswer(() => new NetworkError());
    await f.outbox.enqueue(f.write('a'));
    await f.outbox.enqueue(f.write('b'));
    await f.outbox.drain();
    expect(f.outbox.getSnapshot().offline).toBe(true);
    // Only "a" was tried: "b" never overtakes it.
    expect(f.received.every((id) => id === 'a')).toBe(true);

    const reloaded = f.reopen();
    await reloaded.load();
    expect(reloaded.getSnapshot().items.map((item) => item.id)).toEqual(['a', 'b']);
    f.setAnswer(() => ({ ok: true }));
    f.received.length = 0;
    await reloaded.retryAll();
    expect(f.received).toEqual(['a', 'b']);
    expect(f.db.outboxRows.size).toBe(0);
  });

  it('retries a transient failure with backoff, then succeeds', async () => {
    const f = fixture();
    let calls = 0;
    f.setAnswer(() => (++calls < 3 ? new ApiError('down', 503) : { ok: true }));
    await f.outbox.enqueue(f.write('a'));
    await f.outbox.drain();
    expect(f.outbox.getSnapshot().items[0]).toMatchObject({ attempts: 1, state: 'pending' });
    await f.advance(999);
    expect(calls).toBe(1);
    await f.advance(1);
    expect(calls).toBe(2);
    await f.advance(2000);
    expect(calls).toBe(3);
    expect(f.db.outboxRows.size).toBe(0);
  });

  it('marks a refusal as error and a 409 as conflict, keeps both, and carries on with the rest', async () => {
    const f = fixture();
    f.setAnswer((item) =>
      item.id === 'a' ? new ApiError('Reps are required.', 400) : item.id === 'b' ? new ApiError('changed', 409, undefined, 'PLAN_CHANGED') : { ok: true },
    );
    await f.outbox.enqueue(f.write('a'));
    await f.outbox.enqueue(f.write('b'));
    await f.outbox.enqueue(f.write('c'));
    await f.outbox.drain();
    expect(states(f.outbox)).toEqual(['a:error', 'b:conflict']);
    expect(f.outbox.getSnapshot().items[0].lastError).toBe('Reps are required.');
  });

  it('holds an item whose dependency failed, and discarding the dependency discards it too', async () => {
    const f = fixture();
    f.setAnswer((item) => (item.id === 'workout' ? new ApiError('nope', 400) : { ok: true }));
    await f.outbox.enqueue(f.write('workout'));
    await f.outbox.enqueue(f.write('set', { dependsOn: ['workout'] }));
    await f.outbox.enqueue(f.write('other'));
    await f.outbox.drain();
    expect(f.received).toEqual(['workout', 'other']);
    expect(states(f.outbox)).toEqual(['workout:error', 'set:pending']);
    await f.outbox.discard('workout');
    expect(f.db.outboxRows.size).toBe(0);
  });

  it('sends a dependent item after its dependency is acknowledged', async () => {
    const f = fixture();
    await f.outbox.enqueue(f.write('set', { dependsOn: ['workout'] }));
    await f.outbox.drain();
    expect(f.received).toEqual(['set']); // "workout" is not in the outbox: already acknowledged.
  });

  it('pauses everything on 401 until the account signs in again', async () => {
    const f = fixture();
    f.setAnswer(() => new ApiError('expired', 401));
    await f.outbox.enqueue(f.write('a'));
    await f.outbox.enqueue(f.write('b'));
    await f.outbox.drain();
    expect(states(f.outbox)).toEqual(['a:auth', 'b:pending']);
    expect(f.received).toEqual(['a']);
    f.setAnswer(() => ({ ok: true }));
    await f.outbox.drain();
    expect(f.received).toEqual(['a']);
    await f.outbox.resumeAuth();
    expect(f.received).toEqual(['a', 'a', 'b']);
    expect(f.db.outboxRows.size).toBe(0);
  });

  it('retries an error item on request', async () => {
    const f = fixture();
    let fail = true;
    f.setAnswer(() => (fail ? new ApiError('bad', 400) : { ok: true }));
    await f.outbox.enqueue(f.write('a'));
    await f.outbox.drain();
    fail = false;
    await f.outbox.retry('a');
    await f.outbox.drain();
    expect(f.db.outboxRows.size).toBe(0);
  });

  it('shares one run between concurrent drains, so nothing is sent twice at once', async () => {
    const f = fixture();
    await f.outbox.enqueue(f.write('a'));
    await Promise.all([f.outbox.drain(), f.outbox.drain(), f.outbox.drain()]);
    expect(f.received).toEqual(['a']);
  });

  it('refuses a write for a module that must stay online-only', async () => {
    const f = fixture();
    await expect(f.outbox.enqueue(f.write('a', { kind: 'loans.payment' }))).rejects.toThrow('may not be stored');
    await expect(f.outbox.enqueue(f.write('b', { kind: 'spending.ingest' }))).rejects.toThrow('may not be stored');
    expect(f.db.outboxRows.size).toBe(0);
  });
});

describe('OfflineCache (spec 027)', () => {
  it('stores only the allowed modules and never money data', async () => {
    const db = memoryDb();
    const cache = new OfflineCache(db.cache, () => 0);
    await cache.put('training:plans', [1]);
    expect(await cache.get('training:plans')).toEqual([1]);
    for (const key of ['loans:list', 'cashflow:x', 'stocks:lots', 'spending:payments', 'items:all', 'boards:work', 'settings:x']) {
      await expect(cache.put(key, 1)).rejects.toThrow('may not be stored');
    }
    expect(db.cacheRows.size).toBe(1);
  });

  it("allows the shell's portal state by exact key only", async () => {
    const cache = new OfflineCache(memoryDb().cache, () => 0);
    await cache.put('shell:portal', { access: {} });
    await expect(cache.put('shell:loans', 1)).rejects.toThrow('may not be stored');
  });

  it('drops entries unused for 30 days, and reading refreshes one', async () => {
    let now = 0;
    const db = memoryDb();
    const cache = new OfflineCache(db.cache, () => now);
    await cache.put('nutrition:foods', ['a']);
    await cache.put('social:drafts', ['b']);
    now = CACHE_TTL_MS - 1;
    await cache.get('nutrition:foods');
    now = CACHE_TTL_MS + 10;
    expect(await cache.prune()).toBe(1);
    expect(await cache.get('nutrition:foods')).toEqual(['a']);
    expect(await cache.get('social:drafts')).toBeUndefined();
  });
});
