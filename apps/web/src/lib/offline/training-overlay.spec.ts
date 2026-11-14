import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import type { SessionDetail, SessionListItem } from '@life-portal/shared-types';
import { newObjectId, plannedRowId } from './planned-row-id';
import {
  createdIds,
  localSession,
  overlayCurrent,
  overlayHistory,
  overlaySession,
  type OfflineRow,
  type TrainingWriteMeta,
} from './training-overlay';

const S = 'a'.repeat(24);
const BENCH: OfflineRow = {
  id: 'b'.repeat(24),
  exerciseId: 'e1',
  snapshot: { name: 'Bench', equipmentType: 'barbell', measure: 'weight_reps', primaryMuscles: ['chest'] },
  planned: { planExerciseId: 'p0', targets: [{ type: 'working', reps: 5 }, { type: 'working', reps: 5 }] },
};
const ROW: OfflineRow = {
  id: 'c'.repeat(24),
  exerciseId: 'e2',
  snapshot: { name: 'Curl', equipmentType: 'dumbbell', measure: 'weight_reps', primaryMuscles: ['biceps'] },
};
const T = '2026-11-14T10:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(T) + minutes * 60_000).toISOString();

const start: TrainingWriteMeta = {
  op: 'start',
  sessionId: S,
  day: '2026-11-14',
  startedAt: T,
  plan: { planId: 'plan', planWorkoutId: 'push', planName: 'PPL', workoutName: 'Push' },
  rows: [BENCH],
};
const set = (setId: string, minutes: number, weightGrams = 60_000): TrainingWriteMeta => ({
  op: 'set.add',
  sessionId: S,
  workoutExerciseId: BENCH.id,
  setId,
  loggedAt: at(minutes),
  value: { reps: 5, weightGrams },
});

describe('training overlay (spec 028)', () => {
  it('builds a plan workout started offline, with sets, targets used up and duration', () => {
    const session = overlayCurrent(null, [start, set('s1', 5), set('s2', 9)]) as SessionDetail;
    expect(session.id).toBe(S);
    expect(session.plan?.workoutName).toBe('Push');
    expect(session.exercises[0].sets.map((item) => item.id)).toEqual(['s1', 's2']);
    expect(session.exercises[0].openTargets).toEqual([]);
    expect(session.lastSetAt).toBe(at(9));
    expect(session.durationSeconds).toBe(9 * 60);
  });

  it('gives the same workout after a "reload" and when applied twice (idempotent)', () => {
    const writes = [start, set('s1', 5), { op: 'exercise.add', sessionId: S, row: ROW } as TrainingWriteMeta];
    const once = overlayCurrent(null, writes);
    expect(overlayCurrent(null, writes)).toEqual(once);
    // An acknowledged write is still applied over the refetched copy that already has it.
    expect(overlaySession(once, writes)).toEqual(once);
  });

  it('edits, unticks, reorders, skips and swaps', () => {
    const writes: TrainingWriteMeta[] = [
      start,
      set('s1', 5),
      { op: 'set.patch', sessionId: S, setId: 's1', patch: { reps: 6, rpe: null } },
      set('s2', 6),
      { op: 'set.remove', sessionId: S, setId: 's2' },
      { op: 'exercise.add', sessionId: S, row: ROW },
      { op: 'exercise.order', sessionId: S, ids: [ROW.id, BENCH.id] },
      { op: 'exercise.patch', sessionId: S, workoutExerciseId: BENCH.id, patch: { restSeconds: 120, superset: null } },
    ];
    const session = overlayCurrent(null, writes) as SessionDetail;
    expect(session.exercises.map((item) => item.id)).toEqual([ROW.id, BENCH.id]);
    expect(session.exercises[1].sets).toHaveLength(1);
    expect(session.exercises[1].sets[0].reps).toBe(6);
    expect(session.exercises[1].restSeconds).toBe(120);
    const swapped = overlaySession(session, [
      { op: 'exercise.swap', sessionId: S, fromId: ROW.id, row: { ...ROW, id: 'd'.repeat(24), exerciseId: 'e3' } },
    ]) as SessionDetail;
    expect(swapped.exercises[0].exerciseId).toBe('e3');
    expect(swapped.exercises[0].order).toBe(0);
  });

  it('finishing leaves the open slot and drops unlogged planned exercises; history shows it at the top', () => {
    const writes: TrainingWriteMeta[] = [
      { ...start, rows: [BENCH, { ...ROW, planned: { planExerciseId: 'p1', targets: [{ type: 'working' }] } }] },
      set('s1', 5),
      { op: 'session.finish', sessionId: S, endedAt: at(40) },
    ];
    expect(overlayCurrent(null, writes)).toBeNull();
    const finished = localSession(S, writes) as SessionDetail;
    expect(finished.status).toBe('finished');
    expect(finished.exercises.map((item) => item.id)).toEqual([BENCH.id]);
    expect(finished.durationSeconds).toBe(40 * 60);
    const older: SessionListItem = { id: 'old', day: '2026-11-10', status: 'finished', startedAt: T, durationSeconds: 1, exerciseNames: [], setCount: 1 };
    const history = overlayHistory([older], writes);
    expect(history.map((item) => item.id)).toEqual([S, 'old']);
    expect(history[0]).toMatchObject({ setCount: 1, plan: { workoutName: 'Push' } });
    expect(overlayHistory([older], [{ op: 'session.remove', sessionId: 'old' }])).toEqual([]);
  });

  it('an offline start takes the slot from a stale open workout; writes for other workouts are ignored', () => {
    const other = overlayCurrent(null, [{ ...start, sessionId: 'f'.repeat(24), rows: [] }]) as SessionDetail;
    expect(overlayCurrent(other, [start])?.id).toBe(S);
    expect(overlayCurrent(other, [set('s1', 1)])).toBe(other);
  });

  it('lists the ids a write creates, for later writes to wait on', () => {
    expect(createdIds(start)).toEqual([S, BENCH.id]);
    expect(createdIds(set('s9', 1))).toEqual(['s9']);
    expect(createdIds({ op: 'set.remove', sessionId: S, setId: 's9' })).toEqual([]);
  });
});

describe('client ids (spec 028)', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
    Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
  });

  it('derives a plan start’s row ids exactly as the API does', async () => {
    // The same vector as apps/api/src/training/sessions.service.spec.ts.
    await expect(plannedRowId('7f1c9e5a-3b2d-4c8e-9f00-1a2b3c4d5e6f', 'pp:push:0')).resolves.toBe('e80ee18e8ffbaeb4f40ef02d');
  });

  it('makes ObjectId-shaped ids', () => {
    const id = newObjectId(Date.parse(T));
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(id.slice(0, 8)).toBe(Math.floor(Date.parse(T) / 1000).toString(16));
    expect(newObjectId()).not.toBe(newObjectId());
  });
});
