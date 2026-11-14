import { movedToToday, tooOldStart } from './too-old';
import type { OutboxItem } from './types';

const base = (over: Partial<OutboxItem>): OutboxItem => ({
  id: 'x',
  seq: 1,
  kind: 'training.start',
  method: 'POST',
  path: '/training/sessions',
  state: 'pending',
  attempts: 0,
  nextAttemptAt: 0,
  createdAt: 0,
  ...over,
});

const start = base({
  id: 'start',
  state: 'error',
  lastErrorCode: 'CLIENT_TIME_TOO_OLD',
  body: { requestId: 'r', day: '2026-10-01', id: 'w1', startedAt: '2026-10-01T10:00:00.000Z' },
  meta: { op: 'start', sessionId: 'w1', day: '2026-10-01', startedAt: '2026-10-01T10:00:00.000Z', rows: [] },
});
const set = base({
  id: 'set',
  kind: 'training.set.add',
  body: { requestId: 's', id: 's1', loggedAt: '2026-10-01T10:30:00.000Z', reps: 5 },
  meta: { op: 'set.add', sessionId: 'w1', setId: 's1', loggedAt: '2026-10-01T10:30:00.000Z' },
  dependsOn: ['start'],
});
const finish = base({
  id: 'finish',
  kind: 'training.session.finish',
  body: { endedAt: '2026-10-01T11:00:00.000Z' },
  meta: { op: 'session.finish', sessionId: 'w1', endedAt: '2026-10-01T11:00:00.000Z' },
});
const other = base({ id: 'other', kind: 'training.set.add', body: { loggedAt: '2026-10-01T10:30:00.000Z' }, meta: { op: 'set.add', sessionId: 'w2' } });

describe('a workout recorded more than 14 days ago (spec 034)', () => {
  it('recognises only a refused start, with the time as recorded', () => {
    expect(tooOldStart(start)).toEqual({ recordedAt: '2026-10-01T10:00:00.000Z' });
    expect(tooOldStart({ ...start, state: 'pending' })).toBeUndefined();
    expect(tooOldStart({ ...start, lastErrorCode: 'SESSION_CONFLICT' })).toBeUndefined();
  });

  it('moves the whole workout so it ends now, keeping its spacing, start last', () => {
    const moved = movedToToday([start, set, finish, other], start, '2026-11-20T18:00:00.000Z', '2026-11-20');
    expect(moved?.startedAt).toBe('2026-11-20T17:00:00.000Z');
    expect(moved?.writes.map((write) => write.id)).toEqual(['set', 'finish', 'start']);
    expect(moved?.writes[0]).toMatchObject({ body: { loggedAt: '2026-11-20T17:30:00.000Z', reps: 5 }, meta: { loggedAt: '2026-11-20T17:30:00.000Z' } });
    expect(moved?.writes[1]).toMatchObject({ body: { endedAt: '2026-11-20T18:00:00.000Z' } });
    expect(moved?.writes[2]).toMatchObject({
      body: { requestId: 'r', id: 'w1', startedAt: '2026-11-20T17:00:00.000Z', day: '2026-11-20' },
      meta: { startedAt: '2026-11-20T17:00:00.000Z', day: '2026-11-20' },
    });
  });

  it('moves a workout with no sets to start now', () => {
    expect(movedToToday([start], start, '2026-11-20T18:00:00.000Z', '2026-11-20')?.startedAt).toBe('2026-11-20T18:00:00.000Z');
  });
});
