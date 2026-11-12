import { Types } from 'mongoose';
import { catalogueMeasure, type CatalogueEntry } from '@life-portal/shared-domain';
import catalogueFile from './catalogue/free-exercise-db.json';
import plansFile from './catalogue/plans.json';
import { seedKeyFor } from './catalogue.seeder';
import { FakeModel } from './fake-model.testing';
import { PlanSeeder, planProblem, type PlansFile } from './plan.seeder';

const realPlans = plansFile as PlansFile;
const catalogue = (catalogueFile as { exercises: CatalogueEntry[] }).exercises;

describe('plans.json against the vendored catalogue', () => {
  const bySeedKey = new Map(catalogue.map((entry) => [seedKeyFor(entry), { measure: catalogueMeasure(entry), entry }]));

  it('names only catalogue exercises, with targets their measure allows', () => {
    for (const plan of realPlans.plans) expect(planProblem(plan, bySeedKey)).toBeUndefined();
  });

  it('has the four kinds of plan the spec asks for, one needing no equipment', () => {
    expect(realPlans.plans.length).toBeGreaterThanOrEqual(4);
    const equipmentFree = realPlans.plans.filter((plan) =>
      plan.workouts.every((workout) =>
        workout.exercises.every((exercise) => {
          const equipment = bySeedKey.get(exercise.exercise)?.entry.equipment;
          return equipment === 'body only' || equipment === null;
        }),
      ),
    );
    expect(equipmentFree.length).toBeGreaterThanOrEqual(1);
  });

  it('has unique plan keys and workout keys', () => {
    const planKeys = realPlans.plans.map((plan) => plan.seedKey);
    const workoutKeys = realPlans.plans.flatMap((plan) => plan.workouts.map((workout) => workout.key));
    expect(new Set(planKeys).size).toBe(planKeys.length);
    expect(new Set(workoutKeys).size).toBe(workoutKeys.length);
  });
});

describe('PlanSeeder', () => {
  const file: PlansFile = {
    version: 1,
    plans: [
      {
        seedKey: 'plan:a',
        name: 'A',
        workouts: [{ key: 'a:1', name: 'One', exercises: [{ exercise: 'fedb:Squat', restSeconds: 90, targets: [{ type: 'working', reps: 5 }] }] }],
      },
      {
        seedKey: 'plan:b',
        name: 'B',
        workouts: [{ key: 'b:1', name: 'One', exercises: [{ exercise: 'fedb:Plank', targets: [{ type: 'working', durationSeconds: 45 }] }] }],
      },
    ],
  };

  function fixture() {
    const plans = new FakeModel();
    const exercises = new FakeModel();
    const squat = new Types.ObjectId();
    exercises.docs.push(
      { _id: squat, seedKey: 'fedb:Squat', measure: 'weight_reps', name: 'Squat' },
      { _id: new Types.ObjectId(), seedKey: 'fedb:Plank', measure: 'duration', name: 'Plank' },
      { _id: new Types.ObjectId(), userId: 'u', seedKey: 'fedb:Squat', measure: 'duration', name: 'Fake' },
    );
    return { plans, exercises, squat: String(squat), seeder: new PlanSeeder(plans as never, exercises as never) };
  }

  it('writes once, with stable workout and exercise ids, then does nothing at the same version', async () => {
    const f = fixture();
    expect(await f.seeder.seed(file)).toEqual({ written: 2, skipped: [], upToDate: false });
    expect(await f.seeder.seed(file)).toEqual({ written: 0, skipped: [], upToDate: true });
    expect(f.plans.docs).toHaveLength(2);
    expect(f.plans.docs[0]).toMatchObject({
      seedKey: 'plan:a',
      seedVersion: 1,
      archived: false,
      workouts: [{ id: 'a:1', name: 'One', exercises: [{ id: 'a:1:0', exerciseId: f.squat, restSeconds: 90 }] }],
    });
    expect(f.plans.docs[0]['userId']).toBeUndefined();
  });

  it('skips a plan naming a missing exercise and still seeds the rest', async () => {
    const f = fixture();
    const broken: PlansFile = {
      ...file,
      plans: [...file.plans, { seedKey: 'plan:c', name: 'C', workouts: [{ key: 'c:1', name: 'X', exercises: [{ exercise: 'fedb:Nope', targets: [{ type: 'working', reps: 5 }] }] }] }],
    };
    const result = await f.seeder.seed(broken);
    expect(result.skipped).toEqual(['plan:c']);
    expect(f.plans.docs.map((doc) => doc['seedKey'])).toEqual(['plan:a', 'plan:b']);
  });

  it('skips a plan whose target does not fit the exercise', async () => {
    const f = fixture();
    const wrong: PlansFile = { ...file, plans: [{ ...file.plans[1], workouts: [{ key: 'b:1', name: 'One', exercises: [{ exercise: 'fedb:Plank', targets: [{ type: 'working', reps: 10 }] }] }] }] };
    expect((await f.seeder.seed(wrong)).skipped).toEqual(['plan:b']);
  });

  it('archives a shared plan dropped from the file and leaves own plans alone', async () => {
    const f = fixture();
    await f.seeder.seed(file);
    const own = { _id: new Types.ObjectId(), userId: 'u', name: 'Mine', workouts: [], archived: false };
    f.plans.docs.push({ ...own });
    await f.seeder.seed({ version: 2, plans: [file.plans[0]] });
    expect(f.plans.docs.find((doc) => doc['seedKey'] === 'plan:b')?.['archived']).toBe(true);
    expect(f.plans.docs.find((doc) => doc['seedKey'] === 'plan:a')).toMatchObject({ archived: false, seedVersion: 2 });
    expect(f.plans.docs.find((doc) => doc['userId'] === 'u')).toEqual(own);
  });
});
