import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { PlanInput } from '@life-portal/shared-types';
import { FakeModel } from './fake-model.testing';
import { PlansService } from './plans.service';

const ME = 'user-me';
const OTHER = 'user-other';

function fixture() {
  const exercises = new FakeModel();
  const plans = new FakeModel([['userId', 'requestId']]);
  const sessions = new FakeModel();
  const service = new PlansService(plans as never, exercises as never, sessions as never);
  const bench = new Types.ObjectId();
  const plank = new Types.ObjectId();
  const mine = new Types.ObjectId();
  const theirs = new Types.ObjectId();
  exercises.docs.push(
    { _id: bench, name: 'Bench Press', measure: 'weight_reps', equipmentType: 'barbell', archived: false },
    { _id: plank, name: 'Plank', measure: 'duration', equipmentType: 'bodyweight', archived: false },
    { _id: mine, userId: ME, name: 'My row', measure: 'weight_reps', equipmentType: 'machine', archived: true },
    { _id: theirs, userId: OTHER, name: 'Their press', measure: 'weight_reps', equipmentType: 'machine', archived: false },
  );
  const shared = new Types.ObjectId();
  plans.docs.push({
    _id: shared,
    name: 'Full body',
    description: 'Three days',
    seedKey: 'plan:full-body',
    archived: false,
    workouts: [
      { id: 'fb:a', name: 'A', exercises: [{ id: 'fb:a:0', exerciseId: String(bench), restSeconds: 120, targets: [{ type: 'working', reps: 8 }] }] },
      { id: 'fb:b', name: 'B', exercises: [{ id: 'fb:b:0', exerciseId: String(plank), targets: [{ type: 'working', durationSeconds: 30 }] }] },
    ],
  });
  const input = (): PlanInput => ({
    name: '  My plan ',
    workouts: [
      {
        name: 'Day 1',
        exercises: [
          { exerciseId: String(bench), restSeconds: 90, note: ' slow ', targets: [{ type: 'warmup', reps: 10 }, { type: 'working', reps: 6, repsMax: 8 }] },
          { exerciseId: String(plank), targets: [{ type: 'working', durationSeconds: 45 }] },
        ],
      },
      { name: 'Day 2', exercises: [] },
    ],
  });
  return {
    service,
    plans,
    sessions,
    input,
    bench: String(bench),
    plank: String(plank),
    mine: String(mine),
    theirs: String(theirs),
    shared: String(shared),
  };
}

const message = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as BadRequestException).getResponse();
  }
  throw new Error('expected a rejection');
};

describe('PlansService: own plans', () => {
  it('creates a plan with new ids, trimmed text and the caller as owner', async () => {
    const f = fixture();
    const created = await f.service.create(ME, { requestId: randomUUID(), ...f.input() });
    expect(created).toMatchObject({ name: 'My plan', isOwn: true, archived: false });
    expect(created.workouts.map((w) => w.name)).toEqual(['Day 1', 'Day 2']);
    expect(created.workouts[0].exercises[0]).toMatchObject({ note: 'slow', restSeconds: 90, exercise: { name: 'Bench Press' } });
    const ids = created.workouts.flatMap((w) => [w.id, ...w.exercises.map((e) => e.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(f.plans.docs.find((doc) => String(doc._id) === created.id)?.userId).toBe(ME);
  });

  it('spec 025: keeps a superset through create and copy, and refuses a bad key', async () => {
    const f = fixture();
    const input = f.input();
    input.workouts[0].exercises[0].superset = 'pair1';
    input.workouts[0].exercises[1].superset = 'pair1';
    const created = await f.service.create(ME, { requestId: randomUUID(), ...input });
    expect(created.workouts[0].exercises.map((e) => e.superset)).toEqual(['pair1', 'pair1']);
    const copy = await f.service.copy(ME, created.id, randomUUID());
    expect(copy.workouts[0].exercises.map((e) => e.superset)).toEqual(['pair1', 'pair1']);
    const bad = f.input();
    bad.workouts[0].exercises[0].superset = 'not ok';
    const response = (await message(f.service.create(ME, { requestId: randomUUID(), ...bad }))) as { problems: { path: string }[] };
    expect(response.problems.map((p) => p.path)).toEqual(['workouts.0.exercises.0.superset']);
  });

  it('returns the original plan for a retried create', async () => {
    const f = fixture();
    const requestId = randomUUID();
    const first = await f.service.create(ME, { requestId, ...f.input() });
    const again = await f.service.create(ME, { requestId, ...f.input(), name: 'Changed' });
    expect(again.id).toBe(first.id);
    expect(again.name).toBe('My plan');
    expect(f.plans.docs).toHaveLength(2);
  });

  it('refuses an invalid plan, naming the field', async () => {
    const f = fixture();
    const input = f.input();
    input.workouts[0].exercises[1].targets = [{ type: 'working', reps: 10 }];
    const response = (await message(f.service.create(ME, { requestId: randomUUID(), ...input }))) as {
      problems: { path: string; message: string }[];
    };
    expect(response.problems).toEqual([
      { path: 'workouts.0.exercises.1.targets.0', message: 'Reps does not apply to this exercise.' },
    ]);
  });

  it('accepts the caller’s own (even archived) exercises and refuses someone else’s', async () => {
    const f = fixture();
    const input = f.input();
    input.workouts[1].exercises = [{ exerciseId: f.mine, targets: [{ type: 'working', reps: 12 }] }];
    await expect(f.service.create(ME, { requestId: randomUUID(), ...input })).resolves.toMatchObject({ isOwn: true });
    input.workouts[1].exercises = [{ exerciseId: f.theirs, targets: [{ type: 'working', reps: 12 }] }];
    const response = (await message(f.service.create(ME, { requestId: randomUUID(), ...input }))) as {
      problems: { path: string }[];
    };
    expect(response.problems.map((p) => p.path)).toEqual(['workouts.1.exercises.0.exerciseId']);
  });

  it('refuses the 101st plan', async () => {
    const f = fixture();
    for (let i = 0; i < 100; i++) f.plans.docs.push({ _id: new Types.ObjectId(), userId: ME, name: `P${i}`, archived: false, workouts: [] });
    await expect(f.service.create(ME, { requestId: randomUUID(), ...f.input() })).rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.copy(ME, f.shared, randomUUID())).rejects.toBeInstanceOf(ConflictException);
  });

  it('replaces a plan: keeps sent ids, adds new ones, drops left-out items', async () => {
    const f = fixture();
    const created = await f.service.create(ME, { requestId: randomUUID(), ...f.input() });
    const [day1, day2] = created.workouts;
    const replaced = await f.service.replace(ME, created.id, {
      name: 'Renamed',
      workouts: [
        { id: day2.id, name: 'Day 2', exercises: [{ exerciseId: f.bench, targets: [{ type: 'working', reps: 5 }] }] },
        {
          id: day1.id,
          name: 'Day 1',
          exercises: [{ id: day1.exercises[1].id, exerciseId: f.plank, targets: [{ type: 'working', durationSeconds: 60 }] }],
        },
      ],
    });
    expect(replaced.name).toBe('Renamed');
    expect(replaced.workouts.map((w) => w.id)).toEqual([day2.id, day1.id]);
    expect(replaced.workouts[1].exercises.map((e) => e.id)).toEqual([day1.exercises[1].id]);
    expect(replaced.workouts[0].exercises[0].id).not.toBe(day1.exercises[0].id);
    expect(replaced.workouts[1].exercises[0].targets).toEqual([{ type: 'working', durationSeconds: 60 }]);
  });

  it('refuses an id that is not in the plan, or sent twice', async () => {
    const f = fixture();
    const created = await f.service.create(ME, { requestId: randomUUID(), ...f.input() });
    const plan = (id: string) => ({ name: 'P', workouts: [{ id, name: 'W', exercises: [] }] });
    await expect(f.service.replace(ME, created.id, plan('made-up'))).rejects.toBeInstanceOf(BadRequestException);
    const twice = { name: 'P', workouts: [plan(created.workouts[0].id).workouts[0], plan(created.workouts[0].id).workouts[0]] };
    await expect(f.service.replace(ME, created.id, twice)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes the description when it is cleared', async () => {
    const f = fixture();
    const created = await f.service.create(ME, { requestId: randomUUID(), ...f.input(), description: 'Notes' });
    expect(created.description).toBe('Notes');
    const replaced = await f.service.replace(ME, created.id, { name: 'P', description: '  ', workouts: [] });
    expect(replaced.description).toBeUndefined();
  });

  it('never changes or deletes a shared plan or someone else’s', async () => {
    const f = fixture();
    const theirs = await f.service.create(OTHER, { requestId: randomUUID(), name: 'Theirs', workouts: [] });
    for (const id of [f.shared, theirs.id]) {
      await expect(f.service.replace(ME, id, { name: 'Mine now', workouts: [] })).rejects.toBeInstanceOf(NotFoundException);
      await expect(f.service.remove(ME, id)).rejects.toBeInstanceOf(NotFoundException);
    }
    await expect(f.service.copy(ME, theirs.id, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    expect(f.plans.docs).toHaveLength(2);
  });

  it('copies a ready-made plan as an own plan with new ids', async () => {
    const f = fixture();
    const requestId = randomUUID();
    const copy = await f.service.copy(ME, f.shared, requestId);
    expect(copy).toMatchObject({
      name: 'Full body (copy)',
      description: 'Three days',
      isOwn: true,
      copiedFrom: { planId: f.shared, name: 'Full body' },
    });
    expect(copy.workouts[0].id).not.toBe('fb:a');
    expect(copy.workouts[0].exercises[0]).toMatchObject({ exerciseId: f.bench, restSeconds: 120, targets: [{ type: 'working', reps: 8 }] });
    expect((await f.service.copy(ME, f.shared, requestId)).id).toBe(copy.id);
    expect((await f.service.list(ME)).own.map((p) => p.id)).toEqual([copy.id]);
  });

  it('keeps a copied name within 80 characters', async () => {
    const f = fixture();
    const long = await f.service.create(ME, { requestId: randomUUID(), name: 'x'.repeat(80), workouts: [] });
    const copy = await f.service.copy(ME, long.id, randomUUID());
    expect(copy.name).toHaveLength(80);
    expect(copy.name.endsWith(' (copy)')).toBe(true);
  });

  it('deletes an own plan', async () => {
    const f = fixture();
    const created = await f.service.create(ME, { requestId: randomUUID(), ...f.input() });
    expect(await f.service.remove(ME, created.id)).toEqual({ id: created.id, deleted: true });
    await expect(f.service.detail(ME, created.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PlansService: progress', () => {
  const T = Date.parse('2026-11-12T18:00:00.000Z');
  const session = (f: ReturnType<typeof fixture>, planId: string, planWorkoutId: string, day: string, userId = ME, status = 'finished') => {
    const _id = new Types.ObjectId();
    f.sessions.docs.push({ _id, userId, day, status, startedAt: new Date(T), plan: { planId, planWorkoutId, planName: 'x', workoutName: 'y' } });
    return _id;
  };

  it('shows the first workout as next before any session', async () => {
    const f = fixture();
    const [item] = (await f.service.list(ME)).shared;
    expect(item.lastDoneDay).toBeUndefined();
    expect(item.nextWorkout).toEqual({ id: 'fb:a', name: 'A' });
    const detail = await f.service.detail(ME, f.shared);
    expect(detail.workouts.map((w) => [w.lastDoneDay, w.isNext])).toEqual([[undefined, true], [undefined, false]]);
  });

  it('fills last done and next from the caller’s sessions only, open ones included', async () => {
    const f = fixture();
    session(f, f.shared, 'fb:a', '2026-11-10');
    session(f, f.shared, 'fb:b', '2026-11-11', OTHER);
    const [item] = (await f.service.list(ME)).shared;
    expect(item).toMatchObject({ lastDoneDay: '2026-11-10', nextWorkout: { id: 'fb:b', name: 'B' } });
    session(f, f.shared, 'fb:b', '2026-11-12', ME, 'open');
    const detail = await f.service.detail(ME, f.shared);
    expect(detail.workouts.map((w) => [w.lastDoneDay, w.isNext])).toEqual([['2026-11-10', true], ['2026-11-12', false]]);
  });

  it('stops counting a deleted session', async () => {
    const f = fixture();
    session(f, f.shared, 'fb:a', '2026-11-10');
    const id = session(f, f.shared, 'fb:b', '2026-11-11');
    expect((await f.service.list(ME)).shared[0].nextWorkout?.id).toBe('fb:a');
    f.sessions.docs.splice(f.sessions.docs.findIndex((doc) => doc._id === id), 1);
    expect((await f.service.list(ME)).shared[0].nextWorkout?.id).toBe('fb:b');
  });

  it('suggests recently used plans, leaving out old, deleted and other people’s', async () => {
    const f = fixture();
    expect(await f.service.suggested(ME, '2026-11-12')).toEqual([]);
    const mine = await f.service.create(ME, { requestId: randomUUID(), ...f.input() });
    const gone = await f.service.create(ME, { requestId: randomUUID(), name: 'Gone', workouts: [{ name: 'W', exercises: [] }] });
    session(f, f.shared, 'fb:a', '2026-10-15');
    session(f, mine.id, mine.workouts[0].id, '2026-11-11');
    session(f, gone.id, gone.workouts[0].id, '2026-11-12');
    session(f, f.shared, 'fb:a', '2026-11-12', OTHER);
    await f.service.remove(ME, gone.id);
    const suggested = await f.service.suggested(ME, '2026-11-12');
    expect(suggested.map((p) => p.name)).toEqual(['My plan']);
    expect(suggested[0].nextWorkout).toEqual({ id: mine.workouts[1].id, name: 'Day 2' });
    session(f, f.shared, 'fb:b', '2026-10-16');
    expect((await f.service.suggested(ME, '2026-11-12')).map((p) => p.name)).toEqual(['My plan', 'Full body']);
  });
});
