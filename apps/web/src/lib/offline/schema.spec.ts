import { CACHE_TTL_MS, OfflineCache } from './cache';
import { memoryDb } from './memory-store';
import { Outbox } from './outbox';
import { OUTBOX_SCHEMA, readOutboxRecord } from './schema';
import type { OutboxItem } from './types';

const record = (over: Record<string, unknown> = {}) => ({
  id: 'a',
  seq: 1,
  kind: 'training.set.add',
  method: 'POST',
  path: '/training/x',
  body: { reps: 5 },
  state: 'pending',
  attempts: 0,
  nextAttemptAt: 0,
  createdAt: 1,
  ...over,
});

describe('stored shapes are versioned (spec 034)', () => {
  it('reads a record from before versions as schema 1, and its own version as is', () => {
    expect(readOutboxRecord(record())).toMatchObject({ id: 'a', state: 'pending', schema: OUTBOX_SCHEMA, body: { reps: 5 } });
    expect(readOutboxRecord(record({ schema: 1 })).state).toBe('pending');
  });

  it('migrates an older shape step by step', () => {
    const migrations = {
      1: (r: Record<string, unknown>) => ({ ...r, path: `/v2${r['path']}` }),
      2: (r: Record<string, unknown>) => ({ ...r, label: 'migrated' }),
    };
    expect(readOutboxRecord(record(), 3, migrations)).toMatchObject({ path: '/v2/training/x', label: 'migrated', schema: 3, state: 'pending' });
  });

  it('marks as incompatible what it cannot read: a newer shape, a broken one, a failed migration', () => {
    expect(readOutboxRecord(record({ schema: 9, label: 'Bench · 5 reps' }))).toMatchObject({ id: 'a', state: 'incompatible', label: 'Bench · 5 reps', schema: 9 });
    expect(readOutboxRecord(record({ method: 'GET' })).state).toBe('incompatible');
    expect(readOutboxRecord({ id: 'z' })).toMatchObject({ id: 'z', state: 'incompatible', kind: 'unknown' });
    const throwing = { 1: () => { throw new Error('bad'); } };
    expect(readOutboxRecord(record(), 2, throwing).state).toBe('incompatible');
    expect(readOutboxRecord(record(), 2, {}).state).toBe('incompatible');
  });

  it('never sends or rewrites an incompatible write, keeps what waits on it, and discards it only when asked', async () => {
    const db = memoryDb();
    const raw = record({ id: 'future', schema: 9, body: { secret: 'kept' } });
    await db.outbox.put(raw as unknown as OutboxItem);
    await db.outbox.put(record({ id: 'after', seq: 2, dependsOn: ['future'] }) as unknown as OutboxItem);
    const sent: string[] = [];
    const outbox = new Outbox({ store: db.outbox, send: async (item) => void sent.push(item.id), now: () => 10, setTimer: () => undefined });
    await outbox.drain();
    await outbox.retry('future');
    await outbox.retryAll();
    await outbox.drain();
    expect(sent).toEqual([]);
    expect(outbox.getSnapshot().items.map((item) => `${item.id}:${item.state}`)).toEqual(['future:incompatible', 'after:pending']);
    expect(db.outboxRows.get('future')).toEqual(raw);
    expect(outbox.count()).toBe(2);
    await outbox.discard('future');
    expect(db.outboxRows.size).toBe(0);
  });

  it('writes the current schema on every new write', async () => {
    const db = memoryDb();
    const outbox = new Outbox({ store: db.outbox, send: async () => { throw new Error('offline'); }, setTimer: () => undefined });
    await outbox.enqueue({ id: 'n', kind: 'training.set.add', method: 'POST', path: '/x' });
    expect(db.outboxRows.get('n')).toMatchObject({ schema: OUTBOX_SCHEMA });
  });

  it('drops a cached read in another shape instead of using it', async () => {
    const db = memoryDb();
    const cache = new OfflineCache(db.cache, () => 100);
    await cache.put('training:plans', ['kept']);
    expect(await cache.get('training:plans')).toEqual(['kept']);
    await db.cache.put({ key: 'training:profile', value: { old: true }, touchedAt: 100, schema: 7 });
    expect(await cache.get('training:profile')).toBeUndefined();
    expect(await db.cache.get('training:profile')).toBeUndefined();
    expect(CACHE_TTL_MS).toBeGreaterThan(0);
  });
});
