import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { CatalogueService } from './catalogue.service';
import { FakeModel, fakeMedia } from './fake-model.testing';
import { ProgressService } from './progress.service';
import { PlansService } from './plans.service';
import { MAX_CLIENT_BACKDATE_MS, SessionsService, clientTime } from './sessions.service';
import { plannedRowId } from './planned-row-id';

const ME = 'user-me';
const OTHER = 'user-other';
const T0 = Date.parse('2026-11-12T18:00:00.000Z');
const min = (n: number) => T0 + n * 60_000;

function fixture() {
  const exercises = new FakeModel();
  const sessions = new FakeModel([['userId', 'requestId'], ['userId', '?status=open']]);
  const workoutExercises = new FakeModel([['userId', 'requestId']]);
  const sets = new FakeModel([['userId', 'requestId']]);
  const media = fakeMedia();
  const catalogue = new CatalogueService(exercises as never, workoutExercises as never, sets as never, media as never);
  const weighIns: { day: string; weightGrams: number }[] = [];
  const nutrition = { weighInsUpTo: async (_userId: string, day: string) => weighIns.filter((w) => w.day <= day) };
  const progress = new ProgressService(sessions as never, workoutExercises as never, sets as never, catalogue, nutrition as never);
  const service = new SessionsService(
    sessions as never,
    workoutExercises as never,
    sets as never,
    catalogue,
    progress,
  );
  const bench = new Types.ObjectId();
  const pullUp = new Types.ObjectId();
  const secret = new Types.ObjectId();
  exercises.docs.push(
    { _id: bench, name: 'Barbell Bench Press', searchName: 'barbell bench press', primaryMuscles: ['chest'], secondaryMuscles: [], equipmentType: 'barbell', measure: 'weight_reps', seedKey: 'fedb:bench', archived: false, aliases: [] },
    { _id: pullUp, name: 'Pullups', searchName: 'pullups', primaryMuscles: ['lats'], secondaryMuscles: [], equipmentType: 'bodyweight', measure: 'bodyweight_reps', seedKey: 'fedb:pullups', archived: false, aliases: [] },
    { _id: secret, userId: OTHER, name: 'Their machine press', searchName: 'their machine press', primaryMuscles: ['chest'], secondaryMuscles: [], equipmentType: 'machine', measure: 'weight_reps', archived: false, aliases: [] },
  );
  return { service, progress, weighIns, exercises, sessions, workoutExercises, sets, bench: String(bench), pullUp: String(pullUp), secret: String(secret) };
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
    // Spec 030: a delete of a row that is not the caller's is a no-op answered like "already gone".
    await expect(f.service.remove(OTHER, session.id)).resolves.toEqual({ id: session.id, deleted: true });
    await expect(
      f.service.addSet(OTHER, session.id, exercise.id, { requestId: randomUUID(), reps: 5, weightGrams: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.updateSet(OTHER, set.id, { reps: 1 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.removeSet(OTHER, set.id)).resolves.toEqual({ id: set.id, deleted: true });
    await expect(f.service.detail(ME, 'not-an-id')).rejects.toBeInstanceOf(NotFoundException);
    expect(f.sets.docs).toHaveLength(1);
    expect(f.sessions.docs).toHaveLength(1);
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

describe('ProgressService: records and history', () => {
  const DAY = 24 * 60 * 60_000;

  async function workout(f: ReturnType<typeof fixture>, day: number, sets: { reps: number; weightGrams: number; type?: 'warmup' }[]) {
    const at = T0 + day * DAY;
    const session = await f.service.start(ME, { requestId: randomUUID(), day: new Date(Date.UTC(2026, 10, 12 + day)).toISOString().slice(0, 10) }, at);
    const exercise = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.bench });
    const results = [];
    for (const [index, values] of sets.entries()) {
      results.push(await f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), ...values }, at + index * 60_000));
    }
    await f.service.finish(ME, session.id, 'now', at + 3_600_000);
    return { session, exercise, results };
  }

  it('marks a record in the set response and in the session, and labels the estimate', async () => {
    const f = fixture();
    const first = await workout(f, 0, [{ reps: 5, weightGrams: 100_000 }]);
    expect(first.results[0].records).toEqual([]);
    const second = await workout(f, 1, [{ reps: 10, weightGrams: 60_000, type: 'warmup' }, { reps: 5, weightGrams: 105_000 }]);
    expect(second.results[0].records).toEqual([]);
    expect(second.results[1].records).toEqual(['heaviest', 'best_1rm']);
    const detail = await f.service.detail(ME, second.session.id);
    expect(detail.exercises[0].sets[1].records).toEqual(['heaviest', 'best_1rm']);
    expect(detail.exercises[0].oneRepMax).toEqual({
      valueGrams: 122_500,
      basis: { formula: 'epley', fromSetId: second.results[1].set.id, weightGrams: 105_000, reps: 5 },
    });
  });

  it('builds history newest first with best set and working volume, and records over all sets', async () => {
    const f = fixture();
    await workout(f, 0, [{ reps: 5, weightGrams: 100_000 }]);
    const second = await workout(f, 1, [{ reps: 10, weightGrams: 60_000, type: 'warmup' }, { reps: 8, weightGrams: 90_000 }, { reps: 3, weightGrams: 110_000 }]);
    const history = await f.progress.history(ME, f.bench);
    expect(history.sessions.map((s) => s.day)).toEqual(['2026-11-13', '2026-11-12']);
    expect(history.sessions[0].volumeGrams).toBe(90_000 * 8 + 110_000 * 3);
    expect(history.sessions[0].bestSetId).toBe(second.results[2].set.id); // 121 000 vs 114 000
    expect(history.records.find((r) => r.kind === 'heaviest')).toMatchObject({ value: 110_000, day: '2026-11-13' });
    expect(history.nextCursor).toBeUndefined();
  });

  it('moves the record back when the record set is deleted or lowered', async () => {
    const f = fixture();
    await workout(f, 0, [{ reps: 5, weightGrams: 100_000 }]);
    const second = await workout(f, 1, [{ reps: 5, weightGrams: 120_000 }]);
    const third = await workout(f, 2, [{ reps: 5, weightGrams: 110_000 }]);
    expect(third.results[0].records).toEqual([]);
    const lowered = await f.service.updateSet(ME, second.results[0].set.id, { weightGrams: 101_000 });
    expect(lowered.records).toContain('heaviest');
    expect((await f.progress.history(ME, f.bench)).records.find((r) => r.kind === 'heaviest')?.value).toBe(110_000);
    await f.service.removeSet(ME, second.results[0].set.id);
    const detail = await f.service.detail(ME, third.session.id);
    expect(detail.exercises[0].sets[0].records).toContain('heaviest');
  });

  it('uses the weigh-in on or before the day for bodyweight loads', async () => {
    const f = fixture();
    f.weighIns.push({ day: '2026-11-01', weightGrams: 80_000 }, { day: '2026-11-20', weightGrams: 70_000 });
    const session = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    const exercise = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.pullUp });
    await f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), reps: 6, weightGrams: 10_000 }, T0);
    const history = await f.progress.history(ME, f.pullUp);
    expect(history.sessions[0].volumeGrams).toBe(90_000 * 6);
    expect(history.sessions[0].oneRepMax?.basis).toMatchObject({ weightGrams: 90_000, bodyWeightDay: '2026-11-01' });
    expect(history.sessions[0].sets[0].effectiveLoad).toEqual({ grams: 90_000, bodyWeightDay: '2026-11-01' });
  });

  it('labels a set’s effective load with its weigh-in, and invents none without one (US5)', async () => {
    const f = fixture();
    const session = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    const pull = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.pullUp });
    const bare = await f.service.addSet(ME, session.id, pull.id, { requestId: randomUUID(), reps: 6 }, T0);
    expect(bare.set.effectiveLoad).toBeUndefined();
    f.weighIns.push({ day: '2026-11-01', weightGrams: 80_000 });
    const loaded = await f.service.addSet(ME, session.id, pull.id, { requestId: randomUUID(), reps: 6, weightGrams: 5_000 }, T0);
    expect(loaded.set.effectiveLoad).toEqual({ grams: 85_000, bodyWeightDay: '2026-11-01' });
    const bench = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.bench });
    const plain = await f.service.addSet(ME, session.id, bench.id, { requestId: randomUUID(), reps: 5, weightGrams: 60_000 }, T0);
    expect(plain.set.effectiveLoad).toBeUndefined();
    const detail = await f.service.detail(ME, session.id);
    expect(detail.exercises[0].sets.map((set) => set.effectiveLoad?.grams)).toEqual([80_000, 85_000]);
  });

  it('pages history 20 sessions at a time and never shows another person’s sets', async () => {
    const f = fixture();
    for (let day = 0; day < 21; day++) await workout(f, day, [{ reps: 5, weightGrams: 100_000 + day }]);
    const page = await f.progress.history(ME, f.bench);
    expect(page.sessions).toHaveLength(20);
    const next = await f.progress.history(ME, f.bench, page.nextCursor);
    expect(next.sessions.map((s) => s.day)).toEqual(['2026-11-12']);
    expect(next.nextCursor).toBeUndefined();
    expect((await f.progress.history(OTHER, f.bench)).sessions).toEqual([]);
    await expect(f.progress.history(ME, f.bench, 'nonsense')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('charts one point per session in the range, up to today, with the next record (issue #6)', async () => {
    const f = fixture();
    await workout(f, -120, [{ reps: 5, weightGrams: 70_000 }]);
    await workout(f, 0, [{ reps: 10, weightGrams: 40_000, type: 'warmup' }, { reps: 5, weightGrams: 100_000 }]);
    await workout(f, 1, [{ reps: 5, weightGrams: 90_000 }]);
    const view = await f.progress.progressView(ME, f.bench, '3m', '2026-11-12');
    expect(view.metrics[0]).toBe('one_rep_max');
    expect(view.points.map((p) => p.day)).toEqual(['2026-11-12']); // the 13th is after today; July is out of range
    expect(view.points[0].values).toMatchObject({ heaviest: 100_000, one_rep_max: 116_667, volume: 500_000 });
    expect(view).toMatchObject({ sessionsInRange: 1, totalSessions: 2, lastDay: '2026-11-12' });
    expect(view.nextRecord).toEqual({ kind: 'best_1rm', current: 116_667, target: 120_000, suggestion: { loadGrams: 100_000, reps: 6 } });
    expect((await f.progress.progressView(ME, f.bench, 'all', '2026-11-13')).points).toHaveLength(3);
    expect((await f.progress.progressView(OTHER, f.bench, 'all', '2026-11-13')).points).toEqual([]);
  });
});

// ------------------------------------------------------------------ spec 023: starting from a plan

describe('SessionsService: plan workouts (spec 023)', () => {
  function planFixture() {
    const f = fixture();
    const plansModel = new FakeModel([['userId', 'requestId']]);
    const plans = new PlansService(plansModel as never, f.exercises as never);
    const service = new SessionsService(
      f.sessions as never,
      f.workoutExercises as never,
      f.sets as never,
      new CatalogueService(f.exercises as never, f.workoutExercises as never, f.sets as never, fakeMedia() as never),
      f.progress,
      plans,
    );
    const planId = new Types.ObjectId();
    plansModel.docs.push({
      _id: planId,
      name: 'Push / Pull',
      seedKey: 'plan:pp',
      archived: false,
      workouts: [
        {
          id: 'pp:push',
          name: 'Push',
          exercises: [
            { id: 'pp:push:0', exerciseId: f.bench, restSeconds: 150, targets: [{ type: 'warmup', reps: 10 }, { type: 'working', reps: 6, repsMax: 8 }, { type: 'working', reps: 6, repsMax: 8 }] },
            { id: 'pp:push:1', exerciseId: f.pullUp, restSeconds: 90, superset: 'ss1', targets: [{ type: 'working', reps: 8 }, { type: 'working', reps: 8 }] },
          ],
        },
        { id: 'pp:empty', name: 'Empty', exercises: [] },
      ],
    });
    const start = (requestId = randomUUID(), planWorkoutId = 'pp:push') =>
      service.start(ME, { requestId, day: '2026-11-12', planId: String(planId), planWorkoutId }, T0);
    return { ...f, service, plansModel, planId: String(planId), start };
  }

  it('copies the workout’s exercises and targets onto the session, in order', async () => {
    const f = planFixture();
    const session = await f.start();
    expect(session.plan).toEqual({ planId: f.planId, planWorkoutId: 'pp:push', planName: 'Push / Pull', workoutName: 'Push' });
    expect(session.exercises.map((e) => e.snapshot.name)).toEqual(['Barbell Bench Press', 'Pullups']);
    expect(session.exercises[0].planned).toEqual({
      planExerciseId: 'pp:push:0',
      restSeconds: 150,
      targets: [{ type: 'warmup', reps: 10 }, { type: 'working', reps: 6, repsMax: 8 }, { type: 'working', reps: 6, repsMax: 8 }],
    });
    expect(session.exercises[0].openTargets).toHaveLength(3);
    expect(session.exercises[0].skipped).toBe(false);
  });

  it('gives each planned row the id derived from the start’s requestId (spec 028)', async () => {
    const f = planFixture();
    const requestId = randomUUID();
    const session = await f.start(requestId);
    expect(session.exercises.map((e) => e.id)).toEqual([plannedRowId(requestId, 'pp:push:0'), plannedRowId(requestId, 'pp:push:1')]);
  });

  it('never doubles the exercises when the start is retried', async () => {
    const f = planFixture();
    const requestId = randomUUID();
    const first = await f.start(requestId);
    const again = await f.start(requestId);
    expect(again.id).toBe(first.id);
    expect(f.workoutExercises.docs).toHaveLength(2);
  });

  it('fills in a retried start whose first attempt added no exercises', async () => {
    const f = planFixture();
    const requestId = randomUUID();
    const first = await f.start(requestId);
    f.workoutExercises.docs.splice(0);
    const again = await f.start(requestId);
    expect(again.id).toBe(first.id);
    expect(again.exercises).toHaveLength(2);
  });

  it('resumes an open workout instead, adding nothing', async () => {
    const f = planFixture();
    const open = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    const second = await f.start();
    expect(second.id).toBe(open.id);
    expect(second.resumed).toBe(true);
    expect(second.exercises).toEqual([]);
    expect(f.sessions.docs).toHaveLength(1);
  });

  it('answers 404 for unknown plans and workouts, someone else’s plan, and 400 for an empty workout', async () => {
    const f = planFixture();
    await expect(f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12', planId: String(new Types.ObjectId()), planWorkoutId: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.start(randomUUID(), 'nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.start(randomUUID(), 'pp:empty')).rejects.toBeInstanceOf(BadRequestException);
    f.plansModel.docs[0]['userId'] = OTHER;
    await expect(f.start()).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12', planId: f.planId })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.sessions.docs).toHaveLength(0);
  });

  it('keeps the suggestions and names when the plan is edited or deleted', async () => {
    const f = planFixture();
    const session = await f.start();
    const plan = f.plansModel.docs[0] as unknown as Record<string, unknown> & { workouts: { name: string; exercises: { targets: unknown[] }[] }[] };
    plan['name'] = 'Renamed';
    plan.workouts[0].name = 'Renamed push';
    plan.workouts[0].exercises[0].targets = [{ type: 'working', reps: 1 }];
    let detail = await f.service.detail(ME, session.id, T0);
    expect(detail.plan?.planName).toBe('Push / Pull');
    expect(detail.plan?.workoutName).toBe('Push');
    expect(detail.exercises[0].planned?.targets).toHaveLength(3);
    f.plansModel.docs.splice(0);
    detail = await f.service.detail(ME, session.id, T0);
    expect(detail.exercises[0].openTargets).toHaveLength(3);
  });

  it('uses targets up as sets are logged, and gives them back when a set is deleted', async () => {
    const f = planFixture();
    const session = await f.start();
    const bench = session.exercises[0];
    const { set } = await f.service.addSet(ME, session.id, bench.id, { requestId: randomUUID(), type: 'warmup', reps: 10, weightGrams: 40_000 }, min(1));
    let detail = await f.service.detail(ME, session.id, min(2));
    expect(detail.exercises[0].openTargets).toEqual([{ type: 'working', reps: 6, repsMax: 8 }, { type: 'working', reps: 6, repsMax: 8 }]);
    await f.service.removeSet(ME, set.id);
    detail = await f.service.detail(ME, session.id, min(3));
    expect(detail.exercises[0].openTargets).toHaveLength(3);
  });

  it('skips and un-skips a planned exercise, and refuses skipping one added by hand', async () => {
    const f = planFixture();
    const session = await f.start();
    const skipped = await f.service.updateExercise(ME, session.id, session.exercises[1].id, { skipped: true });
    expect(skipped.skipped).toBe(true);
    expect(skipped.openTargets).toEqual([]);
    const back = await f.service.updateExercise(ME, session.id, session.exercises[1].id, { skipped: false });
    expect(back.openTargets).toHaveLength(2);
    const added = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.bench });
    await expect(f.service.updateExercise(ME, session.id, added.id, { skipped: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('swaps an exercise with no sets in place, carrying targets when the measure matches', async () => {
    const f = planFixture();
    const press = new Types.ObjectId();
    const plank = new Types.ObjectId();
    f.exercises.docs.push(
      { _id: press, name: 'Machine Press', searchName: 'machine press', primaryMuscles: ['chest'], secondaryMuscles: [], equipmentType: 'machine', measure: 'weight_reps', seedKey: 'fedb:mp', archived: false, aliases: [] },
      { _id: plank, name: 'Plank', searchName: 'plank', primaryMuscles: ['abdominals'], secondaryMuscles: [], equipmentType: 'bodyweight', measure: 'duration', seedKey: 'fedb:plank', archived: false, aliases: [] },
    );
    const session = await f.start();
    const requestId = randomUUID();
    const swapped = await f.service.swapExercise(ME, session.id, session.exercises[0].id, { requestId, exerciseId: String(press) });
    expect(swapped.snapshot.name).toBe('Machine Press');
    expect(swapped.order).toBe(0);
    expect(swapped.planned?.targets).toHaveLength(3);
    expect(swapped.planned?.targets[1]).toEqual({ type: 'working', reps: 6, repsMax: 8 });
    const retried = await f.service.swapExercise(ME, session.id, session.exercises[0].id, { requestId, exerciseId: String(press) });
    expect(retried.id).toBe(swapped.id);
    const toPlank = await f.service.swapExercise(ME, session.id, session.exercises[1].id, { requestId: randomUUID(), exerciseId: String(plank) });
    expect(toPlank.planned?.targets).toEqual([{ type: 'working' }, { type: 'working' }]);
    const detail = await f.service.detail(ME, session.id, T0);
    expect(detail.exercises.map((e) => e.snapshot.name)).toEqual(['Machine Press', 'Plank']);
  });

  it('refuses to swap an exercise that has sets', async () => {
    const f = planFixture();
    const session = await f.start();
    await f.service.addSet(ME, session.id, session.exercises[0].id, { requestId: randomUUID(), reps: 8, weightGrams: 60_000 }, min(1));
    await expect(
      f.service.swapExercise(ME, session.id, session.exercises[0].id, { requestId: randomUUID(), exerciseId: f.pullUp }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps only what was logged on finish, and still refuses an empty finish', async () => {
    const f = planFixture();
    const session = await f.start();
    await expect(f.service.finish(ME, session.id, 'now', min(5))).rejects.toBeInstanceOf(ConflictException);
    expect(f.workoutExercises.docs).toHaveLength(2);
    await f.service.addSet(ME, session.id, session.exercises[0].id, { requestId: randomUUID(), reps: 8, weightGrams: 60_000 }, min(1));
    const byHand = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.pullUp });
    const done = await f.service.finish(ME, session.id, 'now', min(30));
    expect(done.exercises.map((e) => e.id)).toEqual([session.exercises[0].id, byHand.id]);
    const list = await f.service.list(ME);
    expect(list.sessions[0].plan).toEqual({ planName: 'Push / Pull', workoutName: 'Push' });
  });

  it('spec 025: copies the superset, and lets rest and superset change for this workout only', async () => {
    const f = planFixture();
    const session = await f.start();
    expect(session.exercises[1].superset).toBe('ss1');
    expect(session.exercises[0].superset).toBeUndefined();
    const bench = session.exercises[0];
    const changed = await f.service.updateExercise(ME, session.id, bench.id, { restSeconds: 45, superset: 'ss1' });
    expect(changed.restSeconds).toBe(45);
    expect(changed.superset).toBe('ss1');
    // The plan's copy is untouched: it is what the plan said.
    expect(changed.planned?.restSeconds).toBe(150);
    const cleared = await f.service.updateExercise(ME, session.id, bench.id, { restSeconds: null, superset: null });
    expect(cleared.restSeconds).toBeUndefined();
    expect(cleared.superset).toBeUndefined();
    const plan = f.plansModel.docs[0] as unknown as { workouts: { exercises: { restSeconds?: number }[] }[] };
    expect(plan.workouts[0].exercises[0].restSeconds).toBe(150);
  });

  it('spec 025: a swap keeps the rest chosen and the superset', async () => {
    const f = planFixture();
    const session = await f.start();
    await f.service.updateExercise(ME, session.id, session.exercises[1].id, { restSeconds: 30 });
    const swapped = await f.service.swapExercise(ME, session.id, session.exercises[1].id, { requestId: randomUUID(), exerciseId: f.pullUp });
    expect(swapped).toMatchObject({ restSeconds: 30, superset: 'ss1' });
  });

  it('starting an empty workout is unchanged', async () => {
    const f = planFixture();
    const session = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    expect(session.plan).toBeUndefined();
    expect(session.exercises).toEqual([]);
  });
});

describe('Body weight with a signed external load (#5)', () => {
  it('logs, reads and edits added weight, assistance and zero added load on a body-weight exercise', async () => {
    const f = fixture();
    f.weighIns.push({ day: '2026-11-01', weightGrams: 80_000 });
    const session = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    const pull = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.pullUp });
    const add = (input: Record<string, unknown>) => f.service.addSet(ME, session.id, pull.id, { requestId: randomUUID(), ...input }, T0);
    expect((await add({ reps: 5, weightGrams: 20_000 })).set.effectiveLoad?.grams).toBe(100_000);
    const assisted = await add({ reps: 8, assistGrams: 30_000 });
    expect(assisted.set).toMatchObject({ assistGrams: 30_000, effectiveLoad: { grams: 50_000 } });
    expect((await add({ reps: 3, weightGrams: 0 })).set.effectiveLoad?.grams).toBe(80_000);
    await expect(add({ reps: 3, weightGrams: 5_000, assistGrams: 5_000 })).rejects.toThrow('Use added weight or assistance, not both.');
    // Switching an assisted set to added weight needs the assistance cleared in the same edit.
    await expect(f.service.updateSet(ME, assisted.set.id, { weightGrams: 10_000 })).rejects.toThrow('not both');
    const switched = await f.service.updateSet(ME, assisted.set.id, { weightGrams: 10_000, assistGrams: null });
    expect(switched.set).toMatchObject({ weightGrams: 10_000, effectiveLoad: { grams: 90_000 } });
    expect(switched.set.assistGrams).toBeUndefined();
  });

  it('keeps sets logged as weight only before the measure changed: unchanged, editable as before, counted apart', async () => {
    const f = fixture();
    f.weighIns.push({ day: '2026-11-01', weightGrams: 80_000 });
    const weighted = new Types.ObjectId();
    f.exercises.docs.push({ _id: weighted, name: 'Weighted Pull Ups', searchName: 'weighted pull ups', primaryMuscles: ['lats'], secondaryMuscles: [], equipmentType: 'other', measure: 'weight_reps', seedKey: 'fedb:Weighted_Pull_Ups', archived: false, aliases: [] });
    const id = String(weighted);
    const old = await f.service.start(ME, { requestId: randomUUID(), day: '2026-10-01' }, T0);
    const oldEx = await f.service.addExercise(ME, old.id, { requestId: randomUUID(), exerciseId: id });
    const legacy = await f.service.addSet(ME, old.id, oldEx.id, { requestId: randomUUID(), reps: 5, weightGrams: 20_000 }, T0);
    await f.service.finish(ME, old.id, 'now', min(30));

    // Catalogue v2: the shared row becomes body weight plus a signed load.
    (f.exercises.docs.find((doc) => String(doc['_id']) === id) as Record<string, unknown>)['measure'] = 'bodyweight_reps';

    const fresh = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, min(60));
    const freshEx = await f.service.addExercise(ME, fresh.id, { requestId: randomUUID(), exerciseId: id });
    const now = await f.service.addSet(ME, fresh.id, freshEx.id, { requestId: randomUUID(), reps: 5, weightGrams: 20_000 }, min(61));
    expect(now.set.effectiveLoad?.grams).toBe(100_000);

    // The old set reads and edits exactly as logged: weight only, no body weight, no assistance.
    const oldDetail = await f.service.detail(ME, old.id);
    expect(oldDetail.exercises[0].snapshot.measure).toBe('weight_reps');
    expect(oldDetail.exercises[0].sets[0]).toMatchObject({ weightGrams: 20_000 });
    expect(oldDetail.exercises[0].sets[0].effectiveLoad).toBeUndefined();
    await expect(f.service.updateSet(ME, legacy.set.id, { assistGrams: 5_000 })).rejects.toThrow('does not apply');
    expect((await f.service.updateSet(ME, legacy.set.id, { reps: 6 })).set).toMatchObject({ reps: 6, weightGrams: 20_000 });

    // History, records and the progress view count the new measure only, and say how many were left out.
    const history = await f.progress.history(ME, id);
    expect(history.sessions.map((s) => s.sessionId)).toEqual([fresh.id]);
    const view = await f.progress.progressView(ME, id, 'all', '2026-11-13');
    expect(view).toMatchObject({ totalSessions: 1, earlierMeasureSets: 1 });
    expect((await f.progress.progressView(ME, f.pullUp, 'all', '2026-11-13')).earlierMeasureSets).toBeUndefined();
  });
});


describe('SessionsService: work done offline (spec 028)', () => {
  const id = () => String(new Types.ObjectId());

  it('keeps the ids the client chose, and returns the same rows for a retry', async () => {
    const f = fixture();
    const [sessionId, rowId, setId] = [id(), id(), id()];
    const startInput = { requestId: randomUUID(), day: '2026-11-12', id: sessionId };
    const session = await f.service.start(ME, startInput, T0);
    expect(session.id).toBe(sessionId);
    expect((await f.service.start(ME, startInput, min(1))).id).toBe(sessionId);
    const addInput = { requestId: randomUUID(), exerciseId: f.bench, id: rowId };
    expect((await f.service.addExercise(ME, sessionId, addInput)).id).toBe(rowId);
    expect((await f.service.addExercise(ME, sessionId, addInput)).id).toBe(rowId);
    const setInput = { requestId: randomUUID(), reps: 5, weightGrams: 60_000, id: setId };
    expect((await f.service.addSet(ME, sessionId, rowId, setInput, min(2))).set.id).toBe(setId);
    expect((await f.service.addSet(ME, sessionId, rowId, setInput, min(3))).set.id).toBe(setId);
    expect(f.sets.docs).toHaveLength(1);
  });

  it('refuses an id another row already has, whoever owns it', async () => {
    const f = fixture();
    const theirs = await f.service.start(OTHER, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    await expect(f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12', id: theirs.id }, T0)).rejects.toMatchObject({
      response: { code: 'ID_TAKEN' },
    });
    const { session, exercise } = await startWithBench(f);
    await expect(
      f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), reps: 5, weightGrams: 1000, id: exercise.id }, min(1)),
    ).resolves.toBeDefined(); // a set id may equal a row in another collection
    await expect(
      f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.bench, id: exercise.id }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('never folds a workout made offline into another open one: it is a conflict', async () => {
    const f = fixture();
    const open = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    await expect(f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12', id: id() }, min(5))).rejects.toMatchObject({
      response: { code: 'SESSION_CONFLICT', openSessionId: open.id },
    });
    // Without an id (an online start), the open one is still resumed as before.
    expect((await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, min(6))).resumed).toBe(true);
  });

  it('keeps the times work was really done, clamped to the workout and to now', async () => {
    const f = fixture();
    const sessionId = id();
    const now = min(600);
    const session = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12', id: sessionId, startedAt: new Date(T0).toISOString() }, now);
    expect(session.startedAt).toBe(new Date(T0).toISOString());
    const row = await f.service.addExercise(ME, sessionId, { requestId: randomUUID(), exerciseId: f.bench });
    const early = await f.service.addSet(ME, sessionId, row.id, { requestId: randomUUID(), reps: 5, weightGrams: 1000, loggedAt: new Date(T0 - 60_000).toISOString() }, now);
    expect(early.set.loggedAt).toBe(new Date(T0).toISOString());
    const set = await f.service.addSet(ME, sessionId, row.id, { requestId: randomUUID(), reps: 5, weightGrams: 1000, loggedAt: new Date(min(20)).toISOString() }, now);
    expect(set.set.loggedAt).toBe(new Date(min(20)).toISOString());
    const future = await f.service.addSet(ME, sessionId, row.id, { requestId: randomUUID(), reps: 5, weightGrams: 1000, loggedAt: new Date(now + 3_600_000).toISOString() }, now);
    expect(future.set.loggedAt).toBe(new Date(now).toISOString());
    await f.sets.deleteOne({ _id: future.set.id });
    const finished = await f.service.finish(ME, sessionId, 'now', now, new Date(min(10)).toISOString());
    // Never before its last set.
    expect(finished.endedAt).toBe(new Date(min(20)).toISOString());
  });

  it('clamps a start to the last 48 hours', () => {
    const now = T0;
    expect(clientTime(new Date(now - MAX_CLIENT_BACKDATE_MS - 1).toISOString(), now - MAX_CLIENT_BACKDATE_MS, now).getTime()).toBe(now - MAX_CLIENT_BACKDATE_MS);
    expect(clientTime('nonsense', 0, now).getTime()).toBe(now);
  });

  it('derives a plan start’s rows from its requestId, the same value the browser computes', () => {
    // The browser's `planned-row-id.ts` test uses this vector too.
    expect(plannedRowId('7f1c9e5a-3b2d-4c8e-9f00-1a2b3c4d5e6f', 'pp:push:0')).toBe(PLANNED_VECTOR);
    expect(plannedRowId('7f1c9e5a-3b2d-4c8e-9f00-1a2b3c4d5e6f', 'pp:push:1')).not.toBe(PLANNED_VECTOR);
  });
});

/** sha256('lp-planned:<requestId>:<planExerciseId>'), first 24 hex digits. Shared with the web test. */
const PLANNED_VECTOR = 'e80ee18e8ffbaeb4f40ef02d';

describe('SessionsService: edits from two devices (spec 030)', () => {
  async function withSet() {
    const f = fixture();
    const { session, exercise } = await startWithBench(f);
    const { set } = await f.service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), reps: 5, weightGrams: 60_000 }, min(1));
    return { f, session, exercise, set };
  }
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return 'ok';
    } catch (error) {
      return ((error as ConflictException).getResponse() as { code?: string }).code ?? (error as Error).constructor.name;
    }
  };

  it('bumps a set’s version on every edit, and refuses an edit made against an older one', async () => {
    const { f, set } = await withSet();
    expect(set.version).toBeUndefined();
    const first = await f.service.updateSet(ME, set.id, { reps: 6, baseVersion: 0 });
    expect(first.set).toMatchObject({ reps: 6, version: 1 });
    // The other device still thinks it is at version 0.
    const stale = f.service.updateSet(ME, set.id, { reps: 8, baseVersion: 0 });
    await expect(stale).rejects.toBeInstanceOf(ConflictException);
    try {
      await f.service.updateSet(ME, set.id, { reps: 8, baseVersion: 0 });
    } catch (error) {
      const body = (error as ConflictException).getResponse() as { code: string; current: { set: { reps: number; version: number } } };
      expect(body.code).toBe('STALE_EDIT');
      expect(body.current.set).toMatchObject({ reps: 6, version: 1 });
    }
    expect(f.sets.docs[0]['reps']).toBe(6);
    // Keeping mine: sent again against the version it now has.
    await expect(f.service.updateSet(ME, set.id, { reps: 8, baseVersion: 1 })).resolves.toMatchObject({ set: { reps: 8, version: 2 } });
  });

  it('still accepts an edit without a version, and still bumps it', async () => {
    const { f, set } = await withSet();
    await f.service.updateSet(ME, set.id, { reps: 7 });
    expect(f.sets.docs[0]['version']).toBe(1);
  });

  it('answers ROW_DELETED to a checked edit of a deleted row, and 404 to an unchecked one', async () => {
    const { f, session, exercise, set } = await withSet();
    await f.service.removeSet(ME, set.id);
    expect(await codeOf(f.service.updateSet(ME, set.id, { reps: 9, baseVersion: 0 }))).toBe('ROW_DELETED');
    expect(await codeOf(f.service.updateSet(ME, set.id, { reps: 9 }))).toBe('NotFoundException');
    await f.service.removeExercise(ME, session.id, exercise.id);
    expect(await codeOf(f.service.updateExercise(ME, session.id, exercise.id, { notes: 'x', baseVersion: 0 }))).toBe('ROW_DELETED');
    await f.service.remove(ME, session.id);
    expect(await codeOf(f.service.update(ME, session.id, { notes: 'x', baseVersion: 0 }))).toBe('ROW_DELETED');
  });

  it('counts deleting what is already gone as done', async () => {
    const { f, session, exercise, set } = await withSet();
    await f.service.removeSet(ME, set.id);
    await expect(f.service.removeSet(ME, set.id)).resolves.toEqual({ id: set.id, deleted: true });
    await f.service.removeExercise(ME, session.id, exercise.id);
    await expect(f.service.removeExercise(ME, session.id, exercise.id)).resolves.toEqual({ id: exercise.id, deleted: true });
    await f.service.remove(ME, session.id);
    await expect(f.service.remove(ME, session.id)).resolves.toEqual({ id: session.id, deleted: true });
  });

  it('checks exercise and workout notes the same way, with the current row in the refusal', async () => {
    const { f, session, exercise } = await withSet();
    await f.service.updateExercise(ME, session.id, exercise.id, { notes: 'Elbows in', baseVersion: 0 });
    try {
      await f.service.updateExercise(ME, session.id, exercise.id, { notes: 'Pause at the bottom', baseVersion: 0 });
      throw new Error('accepted a stale edit');
    } catch (error) {
      const body = (error as ConflictException).getResponse() as { code: string; current: { notes: string; version: number; sets: unknown[] } };
      expect(body).toMatchObject({ code: 'STALE_EDIT', current: { notes: 'Elbows in', version: 1 } });
      expect(body.current.sets).toHaveLength(1);
    }
    await f.service.update(ME, session.id, { notes: 'Felt strong', baseVersion: 0 });
    expect(await codeOf(f.service.update(ME, session.id, { notes: 'Tired', baseVersion: 0 }))).toBe('STALE_EDIT');
    await expect(f.service.update(ME, session.id, { notes: 'Tired', baseVersion: 1 })).resolves.toMatchObject({ notes: 'Tired', version: 2 });
  });

  it('does not let reordering or finishing turn an edit into a conflict', async () => {
    const { f, session, exercise, set } = await withSet();
    const pull = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.pullUp });
    await f.service.reorderExercises(ME, session.id, [pull.id, exercise.id]);
    await f.service.finish(ME, session.id, 'now', min(5));
    await expect(f.service.updateExercise(ME, session.id, exercise.id, { notes: 'ok', baseVersion: 0 })).resolves.toMatchObject({ version: 1 });
    await expect(f.service.update(ME, session.id, { notes: 'ok', baseVersion: 0 })).resolves.toMatchObject({ version: 1 });
    await expect(f.service.updateSet(ME, set.id, { reps: 4, baseVersion: 0 })).resolves.toBeDefined();
  });
});
