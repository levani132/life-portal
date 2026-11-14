import { memoryDb } from './memory-store';
import { Outbox } from './outbox';
import { clearMeta, lostWrites, mayReplayAs, otherAccountsPending, readMeta, tokenSubject, writeMeta } from './device-meta';

function storage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  };
}

const token = (sub: string) => `h.${btoa(JSON.stringify({ sub })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.s`;

describe('what the device remembers outside IndexedDB (spec 034)', () => {
  it('keeps counts and times only, per account', () => {
    const store = storage();
    writeMeta('a', 3, 100, store);
    expect(readMeta('a', store)).toEqual({ pending: 3, at: 100 });
    expect(store.getItem('lp.offline.meta:a')).toBe('{"pending":3,"at":100}');
    clearMeta('a', store);
    expect(readMeta('a', store)).toBeUndefined();
    store.setItem('lp.offline.meta:b', 'not json');
    expect(readMeta('b', store)).toBeUndefined();
  });

  it('reports writes that vanished, and nothing when there is nothing to compare with', () => {
    expect(lostWrites({ pending: 3, at: 1 }, 0)).toBe(3);
    expect(lostWrites({ pending: 3, at: 1 }, 3)).toBe(0);
    expect(lostWrites({ pending: 1, at: 1 }, 4)).toBe(0);
    expect(lostWrites(undefined, 0)).toBe(0);
  });

  it('counts other accounts’ writes without saying whose', () => {
    const store = storage();
    writeMeta('me', 2, 1, store);
    writeMeta('a', 3, 1, store);
    writeMeta('b', 1, 1, store);
    store.setItem('lp.accessToken', 'x');
    expect(otherAccountsPending('me', store)).toBe(4);
    expect(otherAccountsPending('a', store)).toBe(3);
  });

  it('never lets a write go out with another account’s token', () => {
    expect(tokenSubject(token('alice'))).toBe('alice');
    expect(mayReplayAs('alice', token('alice'))).toBe(true);
    expect(mayReplayAs('alice', token('bob'))).toBe(false);
    expect(mayReplayAs('alice', null)).toBe(true);
    expect(mayReplayAs('alice', 'garbage')).toBe(true);
  });

  it('is told the new count before a write leaves the store, so it never overstates by mistake', async () => {
    const db = memoryDb();
    const seen: string[] = [];
    const store = { ...db.outbox, remove: async (id: string) => { seen.push(`remove:${db.outboxRows.size}`); await db.outbox.remove(id); } };
    const outbox = new Outbox({ store, send: async () => ({ ok: true }), track: (count) => seen.push(`count:${count}`), setTimer: () => undefined });
    await outbox.enqueue({ id: 'a', kind: 'training.set.add', method: 'POST', path: '/x' });
    seen.length = 0;
    await outbox.drain();
    expect(seen.indexOf('count:0')).toBeLessThan(seen.indexOf('remove:1'));
  });
});
