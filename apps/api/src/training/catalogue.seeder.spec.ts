import { Types } from 'mongoose';
import catalogueFile from './catalogue/free-exercise-db.json';
import { CatalogueSeeder, catalogueRow, type CatalogueFile } from './catalogue.seeder';
import { CatalogueService } from './catalogue.service';
import { FakeModel, fakeMedia } from './fake-model.testing';

const file: CatalogueFile = {
  version: 1,
  source: 'test',
  exercises: [
    { id: 'Barbell_Squat', name: 'Barbell Squat', force: 'push', level: 'beginner', mechanic: 'compound', equipment: 'barbell', primaryMuscles: ['quadriceps'], secondaryMuscles: ['glutes', 'quadriceps'], category: 'strength' },
    { id: 'Plank', name: 'Plank', force: 'static', level: 'beginner', mechanic: null, equipment: 'body only', primaryMuscles: ['abdominals'], secondaryMuscles: [], category: 'strength' },
  ],
};

describe('CatalogueSeeder', () => {
  it('upserts once, then skips on the next boot', async () => {
    const exercises = new FakeModel();
    const seeder = new CatalogueSeeder(exercises as never);
    expect(await seeder.seed(file)).toEqual({ upserted: 2, skipped: false });
    expect(await seeder.seed(file)).toEqual({ upserted: 0, skipped: true });
    expect(exercises.docs).toHaveLength(2);
    expect(exercises.docs[0]).toMatchObject({ seedKey: 'fedb:Barbell_Squat', archived: false, measure: 'weight_reps' });
  });

  it('never touches a person’s own exercises', async () => {
    const exercises = new FakeModel();
    const own = { _id: new Types.ObjectId(), userId: 'u', name: 'Barbell Squat', archived: false };
    exercises.docs.push({ ...own });
    await new CatalogueSeeder(exercises as never).seed(file);
    expect(exercises.docs.find((doc) => doc['userId'] === 'u')).toEqual(own);
  });

  it('re-applies a newer catalogue version over existing rows', async () => {
    const exercises = new FakeModel();
    const seeder = new CatalogueSeeder(exercises as never);
    await seeder.seed(file);
    const renamed: CatalogueFile = { ...file, version: 2, exercises: [{ ...file.exercises[0], name: 'Back Squat' }, file.exercises[1]] };
    await seeder.seed(renamed);
    expect(exercises.docs).toHaveLength(2);
    expect(exercises.docs[0]).toMatchObject({ name: 'Back Squat', seedVersion: 2 });
  });

  it('moves weighted pull-ups and dips to body weight in catalogue v2, keeping the row (#5)', async () => {
    const exercises = new FakeModel();
    const seeder = new CatalogueSeeder(exercises as never);
    const pull = { id: 'Weighted_Pull_Ups', name: 'Weighted Pull Ups', force: 'pull', level: 'intermediate', mechanic: 'compound', equipment: 'other', primaryMuscles: ['lats'], secondaryMuscles: [], category: 'strength' };
    const sled = { ...pull, id: 'Sled_Row', name: 'Sled Row' };
    // A row as version 1 wrote it.
    exercises.docs.push({ _id: new Types.ObjectId(), seedKey: 'fedb:Weighted_Pull_Ups', seedVersion: 1, measure: 'weight_reps', archived: false });
    const id = exercises.docs[0]['_id'];
    await seeder.seed({ version: 2, source: 'test', exercises: [pull, sled] });
    expect(exercises.docs.find((doc) => doc['seedKey'] === 'fedb:Weighted_Pull_Ups')).toMatchObject({ _id: id, measure: 'bodyweight_reps', seedVersion: 2 });
    expect(exercises.docs.find((doc) => doc['seedKey'] === 'fedb:Sled_Row')).toMatchObject({ measure: 'weight_reps' });
    expect((catalogueFile as CatalogueFile).version).toBeGreaterThanOrEqual(2);
  });

  it('keeps facts only and drops duplicated muscles', () => {
    const row = catalogueRow(file.exercises[0], 1);
    expect(row).not.toHaveProperty('instructions');
    expect(row).not.toHaveProperty('image');
    expect(row.secondaryMuscles).toEqual(['glutes']);
    expect(catalogueRow(file.exercises[1], 1).measure).toBe('duration');
  });

  it('ships a vendored file with at least 500 exercises, unique ids and no prose or images', () => {
    const vendored = catalogueFile as CatalogueFile;
    expect(vendored.exercises.length).toBeGreaterThanOrEqual(500);
    expect(new Set(vendored.exercises.map((e) => e.id)).size).toBe(vendored.exercises.length);
    for (const entry of vendored.exercises) {
      expect(entry).not.toHaveProperty('instructions');
      expect(entry).not.toHaveProperty('images');
    }
  });
});

describe('CatalogueService', () => {
  it('lists shared and own rows only, by normalised name', async () => {
    const exercises = new FakeModel();
    await new CatalogueSeeder(exercises as never).seed(file);
    exercises.docs.push(
      { _id: new Types.ObjectId(), userId: 'me', name: 'My squat machine', searchName: 'my squat machine', primaryMuscles: ['quadriceps'], equipmentType: 'machine', measure: 'weight_reps', archived: false },
      { _id: new Types.ObjectId(), userId: 'them', name: 'Their squat', searchName: 'their squat', primaryMuscles: ['quadriceps'], equipmentType: 'machine', measure: 'weight_reps', archived: false },
      { _id: new Types.ObjectId(), userId: 'me', name: 'Old squat', searchName: 'old squat', primaryMuscles: ['quadriceps'], equipmentType: 'machine', measure: 'weight_reps', archived: true },
    );
    const service = new CatalogueService(exercises as never, new FakeModel() as never, new FakeModel() as never, fakeMedia() as never);
    const found = await service.list('me', { q: 'SQUAT' });
    expect(found.map((e) => [e.name, e.isOwn])).toEqual([
      ['Barbell Squat', false],
      ['My squat machine', true],
    ]);
    const shared = await service.get('me', found[0].id);
    expect(shared.attribution?.url).toContain('free-exercise-db');
  });
});
