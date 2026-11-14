import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { normaliseSearch } from '@life-portal/shared-domain';
import catalogueFile from './catalogue/free-exercise-db.json';
import { catalogueRow, type CatalogueFile } from './catalogue.seeder';
import { CatalogueService, rankExercises, searchNameFor } from './catalogue.service';
import { FakeModel, fakeMedia } from './fake-model.testing';
import { ProgressService } from './progress.service';
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
  const media = fakeMedia();
  const plans = new FakeModel();
  const catalogue = new CatalogueService(exercises as never, workoutExercises as never, sets as never, media as never, plans as never);
  const sessionRows = new FakeModel([['userId', 'requestId'], ['userId', '?status=open']]);
  const progress = new ProgressService(sessionRows as never, workoutExercises as never, sets as never, catalogue, { weighInsUpTo: async () => [] } as never);
  const sessions = new SessionsService(sessionRows as never, workoutExercises as never, sets as never, catalogue, progress);
  const shared = (name: string, extra: Record<string, unknown> = {}) => {
    const _id = new Types.ObjectId();
    exercises.docs.push({
      _id, name, searchName: searchNameFor(name), aliases: [], primaryMuscles: ['chest'], secondaryMuscles: [],
      equipmentType: 'barbell', measure: 'weight_reps', seedKey: `fedb:${name}`, archived: false, ...extra,
    });
    return String(_id);
  };
  return { catalogue, sessions, plans, exercises, workoutExercises, sets, media, shared };
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

  it('archives an exercise one of the person’s own plans uses, so the plan keeps working', async () => {
    const f = fixture();
    const planned = await f.catalogue.create(ME, own);
    const exercise = { id: 'e1', exerciseId: planned.id, targets: [{ type: 'working', reps: 8 }] };
    f.plans.docs.push({ _id: new Types.ObjectId(), userId: ME, name: 'Mine', archived: false, workouts: [{ id: 'w1', name: 'A', exercises: [exercise] }] });
    expect(await f.catalogue.remove(ME, planned.id)).toEqual({ id: planned.id, archived: true });
    // Someone else's plan naming it would not count (it could not, but the filter is the owner's).
    const other = await f.catalogue.create(ME, own);
    f.plans.docs.push({ _id: new Types.ObjectId(), userId: OTHER, name: 'Theirs', archived: false, workouts: [{ id: 'w1', name: 'A', exercises: [{ ...exercise, exerciseId: other.id }] }] });
    expect(await f.catalogue.remove(ME, other.id)).toEqual({ id: other.id, deleted: true });
  });
});

describe('SessionsService: no machine step (#14)', () => {
  it('adds an exercise with no machine part in its snapshot', async () => {
    const f = fixture();
    const press = f.shared('Butterfly (Machine)', { equipmentType: 'machine', aliases: ['Butterfly'] });
    const session = await f.sessions.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, NOW);
    const added = await f.sessions.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: press });
    expect(added.machineId).toBeUndefined();
    expect(added.snapshot).toEqual({ name: 'Butterfly (Machine)', equipmentType: 'machine', measure: 'weight_reps', primaryMuscles: ['chest'] });
  });

  it('keeps a workout logged on a machine before #14 as it was, and a PATCH leaves it alone', async () => {
    const f = fixture();
    const bench = f.shared('Bench press');
    const session = await f.sessions.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, NOW);
    const added = await f.sessions.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: bench });
    // A row as the old picker wrote it: the machine id and its frozen name and brand.
    const row = f.workoutExercises.docs.find((doc) => String(doc['_id']) === added.id) as Record<string, unknown>;
    row['machineId'] = new Types.ObjectId().toHexString();
    row['snapshot'] = { ...(row['snapshot'] as object), machineName: 'Chest press', machineBrand: 'Technogym' };

    const patched = await f.sessions.updateExercise(ME, session.id, added.id, { notes: 'felt good' });
    expect(patched).toMatchObject({
      exerciseId: bench,
      machineId: row['machineId'],
      notes: 'felt good',
      snapshot: { name: 'Bench press', machineName: 'Chest press', machineBrand: 'Technogym' },
    });
  });

  it('finds a renamed catalogue exercise by its dataset name', async () => {
    const f = fixture();
    f.shared('Butterfly (Machine)', { equipmentType: 'machine', aliases: ['Butterfly'], searchName: searchNameFor('Butterfly (Machine)', ['Butterfly']) });
    f.shared('Dumbbell Flyes', { equipmentType: 'dumbbell' });
    const found = await f.catalogue.list(ME, { q: 'butterfly' }, NOW);
    expect(found.map((e) => [e.name, e.equipmentType])).toEqual([['Butterfly (Machine)', 'machine']]);
  });
});

describe('finding the seated chest press machine in the real catalogue (#23)', () => {
  const file = catalogueFile as CatalogueFile;
  const rows = file.exercises.map((entry) => {
    const row = catalogueRow(entry, file.version);
    return { id: row.seedKey, name: row.name, searchName: row.searchName };
  });
  /** What the server does: Mongo's contains-match on `searchName`, then `rankExercises`. */
  const search = (q: string) => {
    const needle = normaliseSearch(q);
    return rankExercises(rows.filter((row) => row.searchName.includes(needle)), needle, new Set()).map((row) => row.id);
  };

  it.each(['chest press', 'Chest press', 'machine chest press', 'seated chest press', 'machine bench press', 'chest press machine'])(
    'puts it first for "%s"',
    (q) => {
      expect(search(q)[0]).toBe('fedb:Machine_Bench_Press');
    },
  );

  it('keeps the plate-loaded machine as its own row, found by "chest press" too', () => {
    const found = search('chest press');
    expect(found).toContain('fedb:Leverage_Chest_Press');
    expect(found).toContain('fedb:Cable_Chest_Press');
    expect(rows.filter((row) => row.name === 'Seated Chest Press (Machine)')).toHaveLength(1);
    expect(search('plate loaded chest press')[0]).toBe('fedb:Leverage_Chest_Press');
  });
});

describe('CatalogueService.offlineList (spec 028)', () => {
  it('keeps own, recently used and planned exercises, and not the rest of the catalogue', async () => {
    const f = fixture();
    const planned = f.shared('Planned press');
    const theirPlan = f.shared('Their plan row');
    const used = f.shared('Used curl');
    f.shared('Never touched');
    const mine = await f.catalogue.create(ME, own);
    f.plans.docs.push(
      { _id: new Types.ObjectId(), userId: ME, archived: false, workouts: [{ id: 'd', exercises: [{ exerciseId: planned }] }] },
      { _id: new Types.ObjectId(), userId: OTHER, archived: false, workouts: [{ id: 'd', exercises: [{ exerciseId: theirPlan }] }] },
    );
    const session = await f.sessions.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, NOW - DAY);
    const row = await f.sessions.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: used });
    await f.sessions.addSet(ME, session.id, row.id, { requestId: randomUUID(), reps: 5, weightGrams: 1000 }, NOW - DAY);
    const list = await f.catalogue.offlineList(ME, NOW);
    expect(list.map((item) => item.name).sort()).toEqual(['Iso row', 'Planned press', 'Used curl']);
    expect(list.find((item) => item.id === used)?.recent).toBe(true);
    expect(list.find((item) => item.id === mine.id)?.isOwn).toBe(true);
    // #23: the device copy carries what the server searches, so aliases work offline too.
    for (const item of list) expect(typeof item.searchName).toBe('string');
  });
});
