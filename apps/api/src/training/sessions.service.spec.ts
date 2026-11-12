import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { CatalogueService } from './catalogue.service';
import { FakeModel } from './fake-model.testing';
import { SessionsService } from './sessions.service';

const ME = 'user-me';
const OTHER = 'user-other';
const T0 = Date.parse('2026-11-12T18:00:00.000Z');
const min = (n: number) => T0 + n * 60_000;

function fixture() {
  const exercises = new FakeModel();
  const sessions = new FakeModel([['userId', 'requestId'], ['userId', '?status=open']]);
  const workoutExercises = new FakeModel([['userId', 'requestId']]);
  const sets = new FakeModel([['userId', 'requestId']]);
  const catalogue = new CatalogueService(exercises as never);
  const service = new SessionsService(
    sessions as never,
    workoutExercises as never,
    sets as never,
    catalogue,
  );
  const bench = new Types.ObjectId();
  const pullUp = new Types.ObjectId();
  const secret = new Types.ObjectId();
  exercises.docs.push(
    { _id: bench, name: 'Barbell Bench Press', searchName: 'barbell bench press', primaryMuscles: ['chest'], secondaryMuscles: [], equipmentType: 'barbell', measure: 'weight_reps', seedKey: 'fedb:bench', archived: false, aliases: [] },
    { _id: pullUp, name: 'Pullups', searchName: 'pullups', primaryMuscles: ['lats'], secondaryMuscles: [], equipmentType: 'bodyweight', measure: 'bodyweight_reps', seedKey: 'fedb:pullups', archived: false, aliases: [] },
    { _id: secret, userId: OTHER, name: 'Their machine press', searchName: 'their machine press', primaryMuscles: ['chest'], secondaryMuscles: [], equipmentType: 'machine', measure: 'weight_reps', archived: false, aliases: [] },
  );
  return { service, exercises, sessions, workoutExercises, sets, bench: String(bench), pullUp: String(pullUp), secret: String(secret) };
}

async function startWithBench(f: ReturnType<typeof fixture>, at = T0) {
  const session = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, at);
  const exercise = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.bench });
  return { session, exercise };
}

describe('SessionsService: one open session', () => {
  it('resumes the open session instead of starting a second', async () => {
    const f = fixture();
    const first = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    const second = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, min(5));
    expect(second.id).toBe(first.id);
    expect(second.resumed).toBe(true);
    expect(f.sessions.docs).toHaveLength(1);
  });

  it('answers a lost race with the session that won, not a 500', async () => {
    const f = fixture();
    // Both devices pass the "is one open?" check before either has written.
    const [a, b] = await Promise.all([
      f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0),
      f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0),
    ]);
    expect(a.id).toBe(b.id);
    expect(f.sessions.docs).toHaveLength(1);
  });

  it('returns the same session for a retried requestId, even after it was finished', async () => {
    const f = fixture();
    const requestId = randomUUID();
    const { session, exercise } = await startWithBench(f);
    await f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), reps: 5, weightGrams: 60_000 }, min(1));
    await f.service.finish(ME, session.id, 'now', min(30));
    const fresh = await f.service.start(ME, { requestId, day: '2026-11-13' }, min(60 * 24));
    const retried = await f.service.start(ME, { requestId, day: '2026-11-13' }, min(60 * 24 + 1));
    expect(retried.id).toBe(fresh.id);
    expect(retried.resumed).toBeUndefined();
  });

  it('lets another person have their own open session', async () => {
    const f = fixture();
    await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    await f.service.start(OTHER, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    expect(f.sessions.docs).toHaveLength(2);
  });
});

describe('SessionsService: snapshots', () => {
  it('freezes the exercise as it was when added', async () => {
    const f = fixture();
    const { session, exercise } = await startWithBench(f);
    expect(exercise.snapshot).toEqual({
      name: 'Barbell Bench Press',
      equipmentType: 'barbell',
      measure: 'weight_reps',
      primaryMuscles: ['chest'],
      machineName: undefined,
      machineBrand: undefined,
    });
    const row = f.exercises.docs.find((doc) => String(doc._id) === f.bench);
    if (row) row['name'] = 'Renamed press';
    const detail = await f.service.detail(ME, session.id, min(1));
    expect(detail.exercises[0].snapshot.name).toBe('Barbell Bench Press');
  });

  it('refuses another person’s private exercise as if it did not exist', async () => {
    const f = fixture();
    const session = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    await expect(
      f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.secret }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the original exercise for a retried requestId', async () => {
    const f = fixture();
    const session = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    const requestId = randomUUID();
    const a = await f.service.addExercise(ME, session.id, { requestId, exerciseId: f.bench });
    const b = await f.service.addExercise(ME, session.id, { requestId, exerciseId: f.bench });
    expect(b.id).toBe(a.id);
    expect(f.workoutExercises.docs).toHaveLength(1);
  });
});

describe('SessionsService: sets', () => {
  it('logs a set and returns it once for a retried requestId', async () => {
    const f = fixture();
    const { session, exercise } = await startWithBench(f);
    const requestId = randomUUID();
    const a = await f.service.addSet(ME, session.id, exercise.id, { requestId, reps: 8, weightGrams: 80_000 }, min(2));
    const b = await f.service.addSet(ME, session.id, exercise.id, { requestId, reps: 8, weightGrams: 80_000 }, min(3));
    expect(b.set.id).toBe(a.set.id);
    expect(f.sets.docs).toHaveLength(1);
    expect(a.set).toMatchObject({ reps: 8, weightGrams: 80_000, type: 'working', order: 0, exerciseId: f.bench });
  });

  it('rejects fields the measure does not use, missing fields and bad RPE', async () => {
    const f = fixture();
    const { session, exercise } = await startWithBench(f);
    const add = (input: Record<string, unknown>) =>
      f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), ...input }, min(1));
    await expect(add({ reps: 8 })).rejects.toThrow('Weight is required.');
    await expect(add({ reps: 8, weightGrams: 80_000, distanceMeters: 5 })).rejects.toThrow(
      'Distance does not apply to this exercise.',
    );
    await expect(add({ reps: 8, weightGrams: 80_000, rpe: 8.3 })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.sets.docs).toHaveLength(0);
  });

  it('corrects values without touching the snapshot, and clears an optional field with null', async () => {
    const f = fixture();
    const session = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    const pull = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.pullUp });
    const { set } = await f.service.addSet(ME, session.id, pull.id, { requestId: randomUUID(), reps: 10, weightGrams: 10_000 }, min(1));
    const corrected = await f.service.updateSet(ME, set.id, { reps: 12, weightGrams: null });
    expect(corrected.set.reps).toBe(12);
    expect(corrected.set.weightGrams).toBeUndefined();
    await expect(f.service.updateSet(ME, set.id, { reps: null })).rejects.toThrow('Reps is required.');
    const detail = await f.service.detail(ME, session.id, min(2));
    expect(detail.exercises[0].snapshot.measure).toBe('bodyweight_reps');
  });

  it('keeps sets from two devices in the same session', async () => {
    const f = fixture();
    const { session, exercise } = await startWithBench(f);
    await Promise.all([
      f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), reps: 8, weightGrams: 80_000 }, min(2)),
      f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), reps: 8, weightGrams: 80_000 }, min(2)),
    ]);
    expect(f.sets.docs).toHaveLength(2);
  });
});

describe('SessionsService: finishing, history and deletion', () => {
  it('refuses to finish an empty workout', async () => {
    const f = fixture();
    const session = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    await expect(f.service.finish(ME, session.id, 'now', min(10))).rejects.toBeInstanceOf(ConflictException);
  });

  it('finishes at the last set when asked, and reports duration and staleness', async () => {
    const f = fixture();
    const { session, exercise } = await startWithBench(f);
    await f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), reps: 5, weightGrams: 60_000 }, min(40));
    const stale = await f.service.detail(ME, session.id, min(40 + 12 * 60 + 1));
    expect(stale.isStale).toBe(true);
    expect(stale.durationSeconds).toBe(40 * 60);
    const finished = await f.service.finish(ME, session.id, 'lastSet', min(40 + 13 * 60));
    expect(finished.status).toBe('finished');
    expect(finished.endedAt).toBe(new Date(min(40)).toISOString());
    expect(finished.isStale).toBe(false);
  });

  it('shows the previous session’s sets of the same exercise', async () => {
    const f = fixture();
    const first = await startWithBench(f, T0);
    await f.service.addSet(ME, first.session.id, first.exercise.id, { requestId: randomUUID(), reps: 8, weightGrams: 80_000 }, min(5));
    await f.service.finish(ME, first.session.id, 'now', min(30));
    const second = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-14' }, min(2 * 24 * 60));
    await f.service.addExercise(ME, second.id, { requestId: randomUUID(), exerciseId: f.bench });
    const detail = await f.service.detail(ME, second.id, min(2 * 24 * 60 + 1));
    expect(detail.exercises[0].previous).toMatchObject({ sessionId: first.session.id, day: '2026-11-12' });
    expect(detail.exercises[0].previous?.sets.map((set) => set.weightGrams)).toEqual([80_000]);
  });

  it('pages the history newest day first', async () => {
    const f = fixture();
    for (let day = 1; day <= 22; day++) {
      const s = await f.service.start(ME, { requestId: randomUUID(), day: `2026-10-${String(day).padStart(2, '0')}` }, T0 + day * 86_400_000);
      const we = await f.service.addExercise(ME, s.id, { requestId: randomUUID(), exerciseId: f.bench });
      await f.service.addSet(ME, s.id, we.id, { requestId: randomUUID(), reps: 5, weightGrams: 50_000 }, T0 + day * 86_400_000 + 60_000);
      await f.service.finish(ME, s.id, 'now', T0 + day * 86_400_000 + 120_000);
    }
    const page1 = await f.service.list(ME);
    expect(page1.sessions).toHaveLength(20);
    expect(page1.sessions[0]).toMatchObject({ day: '2026-10-22', setCount: 1, exerciseNames: ['Barbell Bench Press'] });
    const page2 = await f.service.list(ME, page1.nextCursor);
    expect(page2.sessions.map((s) => s.day)).toEqual(['2026-10-02', '2026-10-01']);
    expect(page2.nextCursor).toBeUndefined();
    await expect(f.service.list(ME, 'not-a-cursor')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes a session with its exercises and sets', async () => {
    const f = fixture();
    const { session, exercise } = await startWithBench(f);
    await f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), reps: 5, weightGrams: 60_000 }, min(1));
    await f.service.remove(ME, session.id);
    expect([f.sessions.docs, f.workoutExercises.docs, f.sets.docs].map((docs) => docs.length)).toEqual([0, 0, 0]);
  });

  it('answers 404 for another person’s session, exercise and set', async () => {
    const f = fixture();
    const { session, exercise } = await startWithBench(f);
    const { set } = await f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), reps: 5, weightGrams: 60_000 }, min(1));
    await expect(f.service.detail(OTHER, session.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.remove(OTHER, session.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      f.service.addSet(OTHER, session.id, exercise.id, { requestId: randomUUID(), reps: 5, weightGrams: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.updateSet(OTHER, set.id, { reps: 1 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.removeSet(OTHER, set.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.detail(ME, 'not-an-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(f.sets.docs).toHaveLength(1);
  });

  it('reorders only with the complete set of ids', async () => {
    const f = fixture();
    const { session, exercise } = await startWithBench(f);
    const pull = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.pullUp });
    await expect(f.service.reorderExercises(ME, session.id, [pull.id])).rejects.toBeInstanceOf(BadRequestException);
    await f.service.reorderExercises(ME, session.id, [pull.id, exercise.id]);
    const detail = await f.service.detail(ME, session.id, min(1));
    expect(detail.exercises.map((e) => e.snapshot.name)).toEqual(['Pullups', 'Barbell Bench Press']);
  });
});
