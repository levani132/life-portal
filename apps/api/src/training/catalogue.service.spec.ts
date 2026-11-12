import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { CatalogueService, rankExercises, searchNameFor } from './catalogue.service';
import { FakeModel, fakeMedia } from './fake-model.testing';
import { MachinesService } from './machines.service';
import { SessionsService } from './sessions.service';

const ME = 'user-me';
const OTHER = 'user-other';
const NOW = Date.parse('2026-11-12T18:00:00.000Z');
const DAY = 86_400_000;
const PHOTO = new Types.ObjectId().toHexString();
const BAD_PHOTO = 'bad'.padEnd(24, '0');

function fixture() {
  const exercises = new FakeModel();
  const workoutExercises = new FakeModel([['userId', 'requestId']]);
  const sets = new FakeModel([['userId', 'requestId']]);
  const machineRows = new FakeModel();
  const media = fakeMedia();
  const catalogue = new CatalogueService(exercises as never, workoutExercises as never, sets as never, media as never);
  const machines = new MachinesService(machineRows as never, workoutExercises as never, catalogue, media as never);
  const sessions = new SessionsService(
    new FakeModel([['userId', 'requestId'], ['userId', '?status=open']]) as never,
    workoutExercises as never,
    sets as never,
    catalogue,
    machines,
  );
  const shared = (name: string, extra: Record<string, unknown> = {}) => {
    const _id = new Types.ObjectId();
    exercises.docs.push({
      _id, name, searchName: searchNameFor(name), aliases: [], primaryMuscles: ['chest'], secondaryMuscles: [],
      equipmentType: 'barbell', measure: 'weight_reps', seedKey: `fedb:${name}`, archived: false, ...extra,
    });
    return String(_id);
  };
  return { catalogue, machines, sessions, exercises, workoutExercises, sets, machineRows, media, shared };
}

const own = {
  name: 'Iso row',
  primaryMuscles: ['middle_back' as const],
  equipmentType: 'machine' as const,
  measure: 'weight_reps' as const,
};

describe('rankExercises', () => {
  const rows = [
    { id: 'a', name: 'Incline press', searchName: 'incline press' },
    { id: 'b', name: 'Press around', searchName: 'press around' },
    { id: 'c', name: 'Bench press', searchName: 'bench press' },
    { id: 'd', name: 'Push press', searchName: 'push press | jerk press' },
  ];

  it('puts names that start with the query before names that contain it', () => {
    expect(rankExercises(rows, 'press', new Set()).map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('puts recently used exercises first within each group', () => {
    expect(rankExercises(rows, 'press', new Set(['d', 'a'])).map((r) => r.id)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('puts a word that starts with the query before a match inside a word', () => {
    const words = [
      { id: 't', name: 'Ball throw', searchName: 'ball throw' },
      { id: 'r', name: 'Bent over row', searchName: 'bent over row' },
      { id: 'p', name: 'Rowing', searchName: 'rowing' },
    ];
    expect(rankExercises(words, 'row', new Set(['t'])).map((r) => r.id)).toEqual(['p', 'r', 't']);
  });

  it('counts an alias that starts with the query as a prefix match', () => {
    expect(rankExercises(rows, 'jerk', new Set()).map((r) => r.id)[0]).toBe('d');
  });

  it('without a query, ranks by recent use, then name', () => {
    expect(rankExercises(rows, '', new Set(['c'])).map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });
});

describe('CatalogueService: search', () => {
  it('ranks prefix before contains, recent first, and filters by muscle and equipment', async () => {
    const f = fixture();
    const bench = f.shared('Bench press');
    f.shared('Press around');
    const incline = f.shared('Incline press', { primaryMuscles: ['shoulders'] });
    f.shared('Dumbbell press', { equipmentType: 'dumbbell' });
    f.sets.docs.push(
      { _id: new Types.ObjectId(), userId: ME, exerciseId: incline, loggedAt: new Date(NOW - 10 * DAY) },
      // Too old to count, and someone else's use never counts.
      { _id: new Types.ObjectId(), userId: ME, exerciseId: bench, loggedAt: new Date(NOW - 91 * DAY) },
      { _id: new Types.ObjectId(), userId: OTHER, exerciseId: bench, loggedAt: new Date(NOW - DAY) },
    );
    const found = await f.catalogue.list(ME, { q: 'press' }, NOW);
    expect(found.map((e) => e.name)).toEqual(['Press around', 'Incline press', 'Bench press', 'Dumbbell press']);
    expect(found[1].recent).toBe(true);
    expect(found[2].recent).toBeUndefined();

    expect((await f.catalogue.list(ME, { q: 'press', muscle: 'shoulders' }, NOW)).map((e) => e.name)).toEqual(['Incline press']);
    expect((await f.catalogue.list(ME, { equipment: 'dumbbell' }, NOW)).map((e) => e.name)).toEqual(['Dumbbell press']);
    expect((await f.catalogue.list(ME, { q: 'press', limit: 1, skip: 1 }, NOW)).map((e) => e.name)).toEqual(['Incline press']);
  });

  it('matches a private exercise by its alias', async () => {
    const f = fixture();
    await f.catalogue.create(ME, { ...own, aliases: ['Hammer row'] });
    expect((await f.catalogue.list(ME, { q: 'hammer' }, NOW)).map((e) => e.name)).toEqual(['Iso row']);
  });

  it('never shows one person’s private exercise to another', async () => {
    const f = fixture();
    const mine = await f.catalogue.create(ME, own);
    expect(await f.catalogue.list(OTHER, { q: 'iso' }, NOW)).toEqual([]);
    await expect(f.catalogue.get(OTHER, mine.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CatalogueService: own exercises', () => {
  it('creates a private exercise with a signed photo and no storage key', async () => {
    const f = fixture();
    const created = await f.catalogue.create(ME, { ...own, imageMediaId: PHOTO, instructions: [' Pull ', ''] });
    expect(created).toMatchObject({ isOwn: true, instructions: ['Pull'], archived: false });
    expect(created.image?.url).toMatch(/^https:\/\/signed\.test\//);
    expect(JSON.stringify(created)).not.toContain('"key"');
    expect(f.exercises.docs[0]).toMatchObject({ userId: ME, image: { width: 800 } });
  });

  it('removes the half-made row when the photo cannot be used', async () => {
    const f = fixture();
    await expect(f.catalogue.create(ME, { ...own, imageMediaId: BAD_PHOTO })).rejects.toThrow('photo');
    expect(f.exercises.docs).toHaveLength(0);
  });

  it('cannot change or delete a shared row, or anyone else’s', async () => {
    const f = fixture();
    const shared = f.shared('Bench press');
    const theirs = await f.catalogue.create(OTHER, own);
    await expect(f.catalogue.update(ME, shared, { name: 'Mine now' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.catalogue.remove(ME, shared)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.catalogue.update(ME, theirs.id, { name: 'Mine now' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.catalogue.remove(ME, theirs.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(f.exercises.docs.map((doc) => doc['name'])).toEqual(['Bench press', 'Iso row']);
  });

  it('renames, rebuilds search, swaps the photo and deletes the old file', async () => {
    const f = fixture();
    const created = await f.catalogue.create(ME, { ...own, imageMediaId: PHOTO });
    const oldKey = (f.exercises.docs[0]['image'] as { key: string }).key;
    const updated = await f.catalogue.update(ME, created.id, { name: 'Seated row', aliases: ['Cable row'], removeImage: true });
    expect(updated.name).toBe('Seated row');
    expect(updated.image).toBeUndefined();
    expect(f.exercises.docs[0]['searchName']).toBe('seated row | cable row');
    expect(f.media.deleted).toEqual([oldKey]);
  });

  it('refuses to change the measure once the exercise is in a workout', async () => {
    const f = fixture();
    const created = await f.catalogue.create(ME, own);
    expect((await f.catalogue.update(ME, created.id, { measure: 'duration' })).measure).toBe('duration');
    await f.catalogue.update(ME, created.id, { measure: 'weight_reps' });
    const session = await f.sessions.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, NOW);
    await f.sessions.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: created.id });
    await expect(f.catalogue.update(ME, created.id, { measure: 'duration' })).rejects.toBeInstanceOf(ConflictException);
    // Anything else may still change.
    expect((await f.catalogue.update(ME, created.id, { name: 'Row' })).name).toBe('Row');
  });

  it('deletes an unused exercise and archives a logged one', async () => {
    const f = fixture();
    const unused = await f.catalogue.create(ME, own);
    expect(await f.catalogue.remove(ME, unused.id)).toEqual({ id: unused.id, deleted: true });

    const logged = await f.catalogue.create(ME, own);
    const session = await f.sessions.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, NOW);
    await f.sessions.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: logged.id });
    expect(await f.catalogue.remove(ME, logged.id)).toEqual({ id: logged.id, archived: true });
    // Archived: gone from search, still readable for the workouts that name it.
    expect(await f.catalogue.list(ME, { q: 'iso' }, NOW)).toEqual([]);
    expect((await f.catalogue.get(ME, logged.id)).archived).toBe(true);
  });
});

describe('MachinesService', () => {
  it('keeps machines private and checks the exercises they serve', async () => {
    const f = fixture();
    const bench = f.shared('Bench press');
    const theirs = await f.catalogue.create(OTHER, own);
    await expect(f.machines.create(ME, { name: 'Chest press', equipmentType: 'machine', exerciseIds: [theirs.id] }))
      .rejects.toBeInstanceOf(NotFoundException);
    const machine = await f.machines.create(ME, { name: 'Chest press', brand: ' Technogym ', equipmentType: 'machine', exerciseIds: [bench, bench] });
    expect(machine).toMatchObject({ brand: 'Technogym', exerciseIds: [bench] });
    expect(await f.machines.list(OTHER)).toEqual([]);
    expect((await f.machines.list(ME, bench)).map((m) => m.name)).toEqual(['Chest press']);
    await expect(f.machines.update(OTHER, machine.id, { name: 'Mine' })).rejects.toBeInstanceOf(NotFoundException);
    expect((await f.machines.update(ME, machine.id, { brand: '' })).brand).toBeUndefined();
  });

  it('deletes an unused machine and archives one a workout names', async () => {
    const f = fixture();
    const bench = f.shared('Bench press');
    const unused = await f.machines.create(ME, { name: 'A', equipmentType: 'machine' });
    expect(await f.machines.remove(ME, unused.id)).toEqual({ id: unused.id, deleted: true });

    const used = await f.machines.create(ME, { name: 'B', equipmentType: 'machine' });
    const session = await f.sessions.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, NOW);
    await f.sessions.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: bench, machineId: used.id });
    expect(await f.machines.remove(ME, used.id)).toEqual({ id: used.id, archived: true });
    expect(await f.machines.list(ME)).toEqual([]);
  });
});

describe('SessionsService: machines in a workout', () => {
  it('names the machine in the snapshot, and only a PATCH of the machine changes that part', async () => {
    const f = fixture();
    const bench = f.shared('Bench press');
    const a = await f.machines.create(ME, { name: 'Chest press', brand: 'Technogym', equipmentType: 'machine' });
    const b = await f.machines.create(ME, { name: 'Plate press', equipmentType: 'machine' });
    const session = await f.sessions.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, NOW);
    const added = await f.sessions.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: bench, machineId: a.id });
    expect(added).toMatchObject({ machineId: a.id, snapshot: { name: 'Bench press', machineName: 'Chest press', machineBrand: 'Technogym' } });

    // Renaming the machine later does not rewrite the workout.
    await f.machines.update(ME, a.id, { name: 'Renamed' });
    const switched = await f.sessions.updateExercise(ME, session.id, added.id, { machineId: b.id });
    expect(switched.snapshot).toMatchObject({ name: 'Bench press', machineName: 'Plate press' });
    expect(switched.snapshot.machineBrand).toBeUndefined();

    const cleared = await f.sessions.updateExercise(ME, session.id, added.id, { machineId: null });
    expect(cleared.machineId).toBeUndefined();
    expect(cleared.snapshot.machineName).toBeUndefined();
  });

  it('rejects someone else’s machine', async () => {
    const f = fixture();
    const bench = f.shared('Bench press');
    const theirs = await f.machines.create(OTHER, { name: 'Theirs', equipmentType: 'machine' });
    const session = await f.sessions.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, NOW);
    await expect(
      f.sessions.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: bench, machineId: theirs.id }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
