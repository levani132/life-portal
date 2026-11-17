import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TrainingPublicationService } from './training-publication.service';

const ME = 'me';
const id = (char: string) => char.repeat(24);
const BENCH = id('a');
const MINE = id('b');
const PULLUP = id('c');

const rows = [
  { _id: BENCH, name: 'Bench press (renamed since)', primaryMuscles: ['chest'], equipmentType: 'barbell', measure: 'weight_reps', archived: false },
  {
    _id: MINE,
    userId: ME,
    name: 'My cable fly',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['shoulders'],
    equipmentType: 'cable',
    measure: 'weight_reps',
    instructions: ['Step in', 'Squeeze'],
    image: { key: 'training/me/exercises/fly.jpg', width: 800, height: 600 },
    archived: false,
  },
  { _id: PULLUP, name: 'Pull-up', primaryMuscles: ['lats'], equipmentType: 'bodyweight', measure: 'bodyweight_reps', archived: false },
  { _id: id('d'), userId: 'someone-else', name: 'Theirs', primaryMuscles: [], equipmentType: 'other', measure: 'weight_reps', archived: false },
];

const session = (overrides: Record<string, unknown> = {}) => ({
  id: id('1'),
  day: '2026-11-16',
  status: 'finished',
  durationSeconds: 3600,
  plan: { workoutName: 'Push day' },
  exercises: [
    {
      exerciseId: BENCH,
      snapshot: { name: 'Bench press', primaryMuscles: ['chest'], equipmentType: 'barbell', measure: 'weight_reps' },
      restSeconds: 120,
      sets: [
        { id: 's1', type: 'warmup', reps: 10, weightGrams: 40_000 },
        { id: 's2', type: 'working', reps: 5, weightGrams: 100_000, records: ['heaviest'] },
      ],
    },
    {
      exerciseId: PULLUP,
      snapshot: { name: 'Pull-up', primaryMuscles: ['lats'], equipmentType: 'bodyweight', measure: 'bodyweight_reps' },
      sets: [{ id: 's3', type: 'working', reps: 8, records: ['heaviest'], effectiveLoad: { grams: 82_000, bodyWeightDay: '2026-11-10' } }],
    },
    { exerciseId: MINE, snapshot: { name: 'My cable fly', primaryMuscles: ['chest'], equipmentType: 'cable', measure: 'weight_reps' }, sets: [] },
  ],
  ...overrides,
});

const plan = {
  _id: id('9'),
  userId: ME,
  name: 'PPL',
  description: 'Six days',
  archived: false,
  workouts: [
    { id: 'w1', name: 'Push', exercises: [{ id: 'e1', exerciseId: BENCH, restSeconds: 90, targets: [{ type: 'working', reps: 8, weightGrams: 60_000 }] }, { id: 'e2', exerciseId: MINE, note: 'slow', targets: [{ type: 'working', reps: 12 }] }] },
    { id: 'w2', name: 'Pull', exercises: [{ id: 'e3', exerciseId: PULLUP, targets: [{ type: 'working', reps: 6 }] }] },
    { id: 'w3', name: 'Legs', exercises: [{ id: 'e4', exerciseId: BENCH, targets: [{ type: 'working', reps: 5 }] }] },
  ],
};

function fixture(overrides: { session?: unknown; plan?: unknown } = {}) {
  const copied: string[] = [];
  const deleted: string[] = [];
  const media = {
    signKey: jest.fn(async (key: string) => `https://signed.test/${key}`),
    copyStored: jest.fn(async (from: string, prefix: string) => {
      if (from.includes('broken')) throw new Error('storage down');
      const key = `${prefix}${copied.length}.jpg`;
      copied.push(key);
      return key;
    }),
    deleteKey: jest.fn(async (key?: string) => void (key && deleted.push(key))),
  };
  const sessions = { detail: jest.fn(async () => overrides.session ?? session()) };
  // The copier's side: what they already hold, and what a copy creates.
  const imported = new Map<string, string>();
  const made = { plans: [] as { input: { name: string; workouts: unknown[]; description?: string }; source: unknown }[], days: [] as { planId: string; day: { name: string }; source: unknown }[] };
  const discarded: string[] = [];
  let copyOf: { planId: string; planWorkoutId?: string } | undefined;
  const plans = {
    readable: jest.fn(async () => overrides.plan ?? plan),
    copyOfPost: jest.fn(async () => copyOf),
    importFromPost: jest.fn(async (_userId: string, input: { name: string; workouts: unknown[] }, source: unknown) => {
      if (input.name === 'boom') throw new Error('plan limit');
      made.plans.push({ input, source });
      copyOf = { planId: 'new-plan' };
      return 'new-plan';
    }),
    importDayFromPost: jest.fn(async (_userId: string, planId: string, day: { name: string }, source: unknown) => {
      made.days.push({ planId, day, source });
      copyOf = { planId, planWorkoutId: 'post-1' };
    }),
  };
  const catalogue = {
    publishable: jest.fn(async (userId: string, ids: string[]) => rows.filter((row) => ids.includes(row._id) && (!row.userId || row.userId === userId))),
    importedFrom: jest.fn(async (_userId: string, keys: string[]) => keys.filter((key) => imported.has(key)).map((key) => ({ key, id: imported.get(key) as string }))),
    importFromPost: jest.fn(async (_userId: string, key: string) => {
      if (imported.has(key)) return { id: imported.get(key) as string, created: false };
      imported.set(key, `copy-of-${key}`);
      return { id: `copy-of-${key}`, created: true };
    }),
    discardImported: jest.fn(async (_userId: string, ids: string[]) => void discarded.push(...ids)),
  };
  const service = new TrainingPublicationService(sessions as never, plans as never, catalogue as never, media as never);
  return { service, media, copied, deleted, plans, catalogue, made, imported, discarded };
}

describe('TrainingPublicationService.snapshot (spec 036)', () => {
  describe('a workout', () => {
    it('shares names, set counts and duration, and no weight, reps, record or body weight by default', async () => {
      const publication = await fixture().service.snapshot(ME, { kind: 'workout', sessionId: id('1') });
      expect(publication).toMatchObject({ kind: 'workout', label: 'Push day', workout: { name: 'Push day', day: '2026-11-16', durationSeconds: 3600 } });
      // Exercises with no sets are left out; names are the workout's own, not the catalogue's now.
      expect(publication.exercises.map((exercise) => exercise.name)).toEqual(['Bench press', 'Pull-up']);
      expect(publication.workout?.exercises).toEqual([
        { key: '0', setTypes: ['warmup', 'working'], restSeconds: 120 },
        { key: '1', setTypes: ['working'] },
      ]);
      const text = JSON.stringify(publication);
      for (const secret of ['weightGrams', '"reps":', '100000', '82000', 'effectiveLoad', 'bodyWeight', 'records', 'heaviest']) {
        expect(text).not.toContain(secret);
      }
    });

    it('shares the logged sets only when asked, and never the effective load', async () => {
      const publication = await fixture().service.snapshot(ME, { kind: 'workout', sessionId: id('1'), includeSets: true });
      expect(publication.workout?.exercises[0].logged).toEqual([
        { type: 'warmup', reps: 10, weightGrams: 40_000 },
        { type: 'working', reps: 5, weightGrams: 100_000 },
      ]);
      expect(publication.workout?.exercises[1].logged).toEqual([{ type: 'working', reps: 8 }]);
      expect(JSON.stringify(publication)).not.toMatch(/82000|effectiveLoad|bodyWeight/);
      expect(publication.workout?.records).toBeUndefined();
    });

    it('shares records only when asked, and never one that depends on a weigh-in', async () => {
      const publication = await fixture().service.snapshot(ME, { kind: 'workout', sessionId: id('1'), showRecords: true });
      // The bench record is shared; the pull-up one is a bodyweight load and is not.
      expect(publication.workout?.records).toEqual([{ key: '0', kind: 'heaviest', value: 100_000 }]);
      expect(publication.workout?.exercises[0].logged).toBeUndefined();
      expect(JSON.stringify(publication)).not.toMatch(/82000|bodyWeight/);
    });

    it('refuses an open workout and one with nothing logged', async () => {
      await expect(fixture({ session: session({ status: 'open' }) }).service.snapshot(ME, { kind: 'workout', sessionId: id('1') })).rejects.toBeInstanceOf(BadRequestException);
      await expect(fixture({ session: session({ exercises: [] }) }).service.snapshot(ME, { kind: 'workout', sessionId: id('1') })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('a plan', () => {
    it('shares the whole plan, with an own exercise\'s details and a catalogue one by reference', async () => {
      const publication = await fixture().service.snapshot(ME, { kind: 'plan', planId: id('9') });
      expect(publication.plan).toMatchObject({ name: 'PPL', description: 'Six days', includedWorkouts: 3, totalWorkouts: 3 });
      expect(publication.plan?.workouts.map((workout) => workout.name)).toEqual(['Push', 'Pull', 'Legs']);
      const [bench, mine] = publication.exercises;
      expect(bench).toMatchObject({ key: '0', exerciseId: BENCH });
      expect(bench.own).toBeUndefined();
      expect(mine).toMatchObject({ key: '1', own: true, sourceId: MINE, instructions: ['Step in', 'Squeeze'], image: { key: 'training/me/exercises/fly.jpg' } });
      expect(mine.exerciseId).toBeUndefined();
      // The plan's own targets are part of what the author publishes.
      expect(publication.plan?.workouts[0].exercises[0]).toEqual({ key: '0', restSeconds: 90, targets: [{ type: 'working', reps: 8, weightGrams: 60_000 }] });
    });

    it('shares only the chosen workouts, in plan order, and says how many of how many', async () => {
      const publication = await fixture().service.snapshot(ME, { kind: 'plan', planId: id('9'), workoutIds: ['w3', 'w1'] });
      expect(publication.plan).toMatchObject({ includedWorkouts: 2, totalWorkouts: 3 });
      expect(publication.plan?.workouts.map((workout) => workout.name)).toEqual(['Push', 'Legs']);
      // Nothing of the workout left out, not even its name.
      expect(JSON.stringify(publication)).not.toContain('Pull');
    });

    it('refuses a workout that is not in the plan, a ready-made plan and someone else\'s', async () => {
      await expect(fixture().service.snapshot(ME, { kind: 'plan', planId: id('9'), workoutIds: ['w1', 'gone'] })).rejects.toBeInstanceOf(BadRequestException);
      await expect(fixture({ plan: { ...plan, userId: undefined } }).service.snapshot(ME, { kind: 'plan', planId: id('9') })).rejects.toBeInstanceOf(NotFoundException);
      await expect(fixture({ plan: { ...plan, userId: 'someone-else' } }).service.snapshot(ME, { kind: 'plan', planId: id('9') })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('an exercise', () => {
    it('shares an own exercise\'s details and photo, and refuses a catalogue one', async () => {
      const publication = await fixture().service.snapshot(ME, { kind: 'exercise', exerciseId: MINE });
      expect(publication).toMatchObject({ kind: 'exercise', label: 'My cable fly', exercise: { key: '0' } });
      expect(publication.exercises[0]).toMatchObject({ own: true, secondaryMuscles: ['shoulders'] });
      await expect(fixture().service.snapshot(ME, { kind: 'exercise', exerciseId: BENCH })).rejects.toBeInstanceOf(NotFoundException);
      await expect(fixture().service.snapshot(ME, { kind: 'exercise', exerciseId: id('d') })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('refuses a malformed selection', async () => {
    await expect(fixture().service.snapshot(ME, { kind: 'workout', sessionId: 'nope' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('photos', () => {
  it('gives a viewer a signed link and never a storage key', async () => {
    const f = fixture();
    const attachment = await f.service.attachment(await f.service.snapshot(ME, { kind: 'exercise', exerciseId: MINE }));
    expect(attachment.exercises[0].image).toEqual({ url: 'https://signed.test/training/me/exercises/fly.jpg', width: 800, height: 600 });
    expect(JSON.stringify(attachment)).not.toContain('"key":"training/');
  });

  it('gives the post its own copy, and the hash does not depend on which copy', async () => {
    const f = fixture();
    const publication = await f.service.snapshot(ME, { kind: 'exercise', exerciseId: MINE });
    const owned = await f.service.withOwnPhotos(ME, publication);
    expect(owned.exercises[0].image?.key).toBe('posts/me/training/0.jpg');
    expect(publication.exercises[0].image?.key).toBe('training/me/exercises/fly.jpg');
  });

  it('removes the copies it made when one cannot be copied', async () => {
    const f = fixture();
    const publication = await f.service.snapshot(ME, { kind: 'exercise', exerciseId: MINE });
    const two = { ...publication, exercises: [publication.exercises[0], { ...publication.exercises[0], key: '1', image: { key: 'broken', width: 1, height: 1 } }] };
    await expect(f.service.withOwnPhotos(ME, two)).rejects.toThrow('storage down');
    expect(f.deleted).toEqual(['posts/me/training/0.jpg']);
  });
});

describe('TrainingPublicationService.copy (spec 036)', () => {
  const VIEWER = 'viewer';
  const POST = { id: 'post-1', authorId: ME, authorName: 'Ana' };
  const sharedBy = { label: 'Shared by Ana', postId: 'post-1', authorId: ME };
  const KEY = `${ME}:${MINE}`;

  it('copies a whole plan as a new plan of the copier\'s, with their own copy of the author\'s exercise', async () => {
    const f = fixture();
    const publication = await f.service.snapshot(ME, { kind: 'plan', planId: id('9') });
    const preview = await f.service.copyPreview(VIEWER, POST.id, POST.authorId, publication);
    expect(preview).toEqual({ kind: 'plan', needsPlanChoice: false, newExercises: ['My cable fly'] });

    const result = await f.service.copy(VIEWER, POST, publication, { requestId: 'r1' });
    expect(result).toEqual({ kind: 'plan', planId: 'new-plan', reused: false });
    const [{ input, source }] = f.made.plans;
    expect(input).toMatchObject({ name: 'PPL', description: 'Six days', requestId: 'r1' });
    expect(source).toEqual({ postId: 'post-1', sharedBy });
    // A catalogue exercise is used as it is; the author's own one becomes the copier's.
    const push = (input.workouts as { exercises: { exerciseId: string }[] }[])[0];
    expect(push.exercises.map((row) => row.exerciseId)).toEqual([BENCH, `copy-of-${KEY}`]);
    expect(f.catalogue.importFromPost).toHaveBeenCalledWith(VIEWER, KEY, expect.objectContaining({ name: 'My cable fly' }), sharedBy);
  });

  it('returns the copy already made instead of making a second one', async () => {
    const f = fixture();
    const publication = await f.service.snapshot(ME, { kind: 'plan', planId: id('9') });
    await f.service.copy(VIEWER, POST, publication, { requestId: 'r1' });
    expect(await f.service.copy(VIEWER, POST, publication, { requestId: 'r2' })).toEqual({ kind: 'plan', planId: 'new-plan', reused: true });
    expect(f.made.plans).toHaveLength(1);
    expect((await f.service.copyPreview(VIEWER, POST.id, POST.authorId, publication)).existing).toEqual({ kind: 'plan', planId: 'new-plan', reused: true });
  });

  it('puts a single workout into the plan the copier chose, or a new one they name, never both or neither', async () => {
    const f = fixture();
    const publication = await f.service.snapshot(ME, { kind: 'workout', sessionId: id('1') });
    expect((await f.service.copyPreview(VIEWER, POST.id, POST.authorId, publication)).needsPlanChoice).toBe(true);
    await expect(f.service.copy(VIEWER, POST, publication, { requestId: 'r1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(f.service.copy(VIEWER, POST, publication, { requestId: 'r1', planId: id('7'), planName: 'New' })).rejects.toBeInstanceOf(BadRequestException);

    expect(await f.service.copy(VIEWER, POST, publication, { requestId: 'r1', planId: id('7') })).toEqual({ kind: 'workout', planId: id('7'), planWorkoutId: 'post-1', reused: false });
    const [{ day }] = f.made.days as unknown as { day: { name: string; exercises: { targets: unknown[] }[] } }[];
    expect(day.name).toBe('Push day');
    // The author's sets were not shared: the copy has their number and type, and no weight.
    expect(day.exercises[0].targets).toEqual([{ type: 'warmup', reps: 10 }, { type: 'working', reps: 10 }]);
    expect(JSON.stringify(f.made.days)).not.toMatch(/weightGrams|100000/);

    const named = fixture();
    await named.service.copy(VIEWER, POST, publication, { requestId: 'r1', planName: '  From Ana ' });
    expect(named.made.plans[0].input.name).toBe('From Ana');
  });

  it('refuses a plan choice for a whole plan', async () => {
    const f = fixture();
    const publication = await f.service.snapshot(ME, { kind: 'plan', planId: id('9') });
    await expect(f.service.copy(VIEWER, POST, publication, { requestId: 'r1', planName: 'Mine' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('copies an exercise once per copier and source, however many posts carry it', async () => {
    const f = fixture();
    const publication = await f.service.snapshot(ME, { kind: 'exercise', exerciseId: MINE });
    expect(await f.service.copy(VIEWER, POST, publication, { requestId: 'r1' })).toEqual({ kind: 'exercise', exerciseId: `copy-of-${KEY}`, reused: false });
    expect(await f.service.copy(VIEWER, { ...POST, id: 'post-2' }, publication, { requestId: 'r2' })).toEqual({ kind: 'exercise', exerciseId: `copy-of-${KEY}`, reused: true });
    expect(f.catalogue.importFromPost).toHaveBeenCalledTimes(1);
  });

  it('leaves nothing behind when the plan cannot be made', async () => {
    const f = fixture({ plan: { ...plan, name: 'boom' } });
    const publication = await f.service.snapshot(ME, { kind: 'plan', planId: id('9') });
    await expect(f.service.copy(VIEWER, POST, publication, { requestId: 'r1' })).rejects.toThrow('plan limit');
    expect(f.discarded).toEqual([`copy-of-${KEY}`]);
    expect(f.made.plans).toHaveLength(0);
  });
});
