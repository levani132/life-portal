import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { CatalogueService } from './catalogue.service';
import { FakeModel, fakeMedia } from './fake-model.testing';
import { PlanDayUpdateService } from './plan-day-update.service';
import { PlansService } from './plans.service';
import { ProgressService } from './progress.service';
import { SessionsService } from './sessions.service';

const ME = 'user-me';
const OTHER = 'user-other';
const T0 = Date.parse('2026-11-12T18:00:00.000Z');
const min = (n: number) => T0 + n * 60_000;

type PlanDoc = { workouts: { id: string; name: string; revision?: number; exercises: { id: string; exerciseId: string; restSeconds?: number; targets: unknown[] }[] }[] };

function fixture({ own = true } = {}) {
  const exercises = new FakeModel();
  const sessions = new FakeModel([['userId', 'requestId'], ['userId', '?status=open']]);
  const workoutExercises = new FakeModel([['userId', 'requestId']]);
  const sets = new FakeModel([['userId', 'requestId']]);
  const plansModel = new FakeModel([['userId', 'requestId']]);
  const catalogue = new CatalogueService(exercises as never, workoutExercises as never, sets as never, fakeMedia() as never);
  const nutrition = { weighInsUpTo: async () => [] };
  const progress = new ProgressService(sessions as never, workoutExercises as never, sets as never, catalogue, nutrition as never);
  const plans = new PlansService(plansModel as never, exercises as never, sessions as never);
  const service = new SessionsService(sessions as never, workoutExercises as never, sets as never, catalogue, progress, plans);
  const updates = new PlanDayUpdateService(sessions as never, workoutExercises as never, sets as never, exercises as never, plans);
  const ids = { bench: new Types.ObjectId(), row: new Types.ObjectId(), dip: new Types.ObjectId(), plank: new Types.ObjectId() };
  const exercise = (_id: Types.ObjectId, name: string, measure: string) => ({
    _id, name, searchName: name.toLowerCase(), primaryMuscles: ['chest'], secondaryMuscles: [], equipmentType: 'barbell', measure, archived: false, aliases: [],
  });
  exercises.docs.push(
    exercise(ids.bench, 'Bench Press', 'weight_reps'),
    exercise(ids.row, 'Barbell Row', 'weight_reps'),
    exercise(ids.dip, 'Dip', 'bodyweight_reps'),
    exercise(ids.plank, 'Plank', 'duration'),
  );
  const planId = new Types.ObjectId();
  const [bench, row, dip, plank] = [ids.bench, ids.row, ids.dip, ids.plank].map(String);
  plansModel.docs.push({
    _id: planId,
    ...(own ? { userId: ME } : { seedKey: 'plan:ul' }),
    name: 'Upper / Lower',
    archived: false,
    updatedAt: new Date(T0 - 86_400_000),
    workouts: [
      {
        id: 'upper',
        name: 'Upper',
        exercises: [
          { id: 'u0', exerciseId: bench, restSeconds: 120, targets: [{ type: 'working', reps: 5, weightGrams: 80_000 }, { type: 'working', reps: 5, weightGrams: 80_000 }] },
          { id: 'u1', exerciseId: row, restSeconds: 90, targets: [{ type: 'working', reps: 8 }] },
          { id: 'u2', exerciseId: plank, targets: [{ type: 'working', durationSeconds: 45 }] },
        ],
      },
      { id: 'lower', name: 'Lower', exercises: [{ id: 'l0', exerciseId: plank, targets: [{ type: 'working', durationSeconds: 60 }] }] },
    ],
  });
  const plan = () => plansModel.docs.find((doc) => String(doc._id) === String(planId)) as unknown as PlanDoc;

  /** Start the plan's day, log one set on every planned exercise unless told otherwise. */
  const start = async (planWorkoutId = 'upper', at = T0) =>
    service.start(ME, { requestId: randomUUID(), day: '2026-11-12', planId: String(planId), planWorkoutId }, at);
  const log = (sessionId: string, weId: string, values: Record<string, number>, at = min(1)) =>
    service.addSet(ME, sessionId, weId, { requestId: randomUUID(), ...values }, at);
  const finish = (sessionId: string) => service.finish(ME, sessionId, 'now', min(60));
  const preview = (sessionId: string) => updates.preview(ME, sessionId);
  const apply = async (sessionId: string, requestId = randomUUID()) => {
    const shown = await preview(sessionId);
    return updates.apply(ME, sessionId, { requestId, revision: shown.revision ?? 0 });
  };

  /** A workout done exactly as planned. */
  const asPlanned = async (planWorkoutId = 'upper') => {
    const session = await start(planWorkoutId);
    for (const exercise of session.exercises) {
      await log(session.id, exercise.id, exercise.snapshot.measure === 'duration' ? { durationSeconds: 50 } : { reps: 6, weightGrams: 90_000 });
    }
    return session;
  };

  return { service, updates, plans, plansModel, sessions, workoutExercises, sets, planId: String(planId), plan, bench, row, dip, plank, start, log, finish, preview, apply, asPlanned };
}

const conflict = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    return (error as ConflictException).getResponse();
  }
  throw new Error('expected a conflict');
};

describe('PlanDayUpdateService (issue #15)', () => {
  it('is never offered for an ad-hoc workout, nor while a plan workout is open', async () => {
    const f = fixture();
    const adHoc = await f.service.start(ME, { requestId: randomUUID(), day: '2026-11-12' }, T0);
    expect((await f.preview(adHoc.id)).status).toBe('not_from_plan');
    await f.service.remove(ME, adHoc.id);
    const open = await f.start();
    expect((await f.preview(open.id)).status).toBe('open');
    await expect(f.apply(open.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('finds nothing to change for a workout done as planned, whatever weights and reps were done', async () => {
    const f = fixture();
    const session = await f.asPlanned();
    await f.finish(session.id);
    const shown = await f.preview(session.id);
    expect(shown.status).toBe('no_changes');
    expect(shown.changes).toEqual([]);
    await expect(f.apply(session.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps a skipped or not-done exercise in the plan', async () => {
    const f = fixture();
    const session = await f.start();
    await f.service.updateExercise(ME, session.id, session.exercises[1].id, { skipped: true });
    await f.log(session.id, session.exercises[0].id, { reps: 5, weightGrams: 80_000 });
    await f.finish(session.id);
    expect((await f.preview(session.id)).status).toBe('no_changes');
  });

  it('applies additions, removals, a reorder and a rest change to that day only, once', async () => {
    const f = fixture();
    const session = await f.start();
    const [bench, row, plank] = session.exercises;
    await f.service.removeExercise(ME, session.id, row.id);
    const dip = await f.service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: f.dip });
    await f.log(session.id, plank.id, { durationSeconds: 40 });
    await f.log(session.id, bench.id, { reps: 5, weightGrams: 85_000 });
    await f.log(session.id, dip.id, { reps: 12, weightGrams: 10_000 });
    await f.log(session.id, dip.id, { reps: 10, weightGrams: 10_000 });
    await f.service.updateExercise(ME, session.id, bench.id, { restSeconds: 180 });
    // Done in this order: plank, bench, dip.
    await f.service.reorderExercises(ME, session.id, [plank.id, bench.id, dip.id]);
    await f.finish(session.id);
    const exercisesBefore = JSON.stringify(f.workoutExercises.docs);
    const setsBefore = JSON.stringify(f.sets.docs);
    const lowerBefore = JSON.stringify(f.plan().workouts[1]);

    const shown = await f.preview(session.id);
    expect(shown.status).toBe('available');
    expect(shown.shared).toBeUndefined();
    expect(shown.changes.map((change) => change.kind).sort()).toEqual(['added', 'moved', 'removed', 'rest']);
    expect(shown.before.map((line) => line.name)).toEqual(['Bench Press', 'Barbell Row', 'Plank']);
    expect(shown.after.map((line) => line.name)).toEqual(['Plank', 'Bench Press', 'Dip']);

    const requestId = randomUUID();
    const result = await f.updates.apply(ME, session.id, { requestId, revision: shown.revision ?? 0 });
    expect(result).toEqual({ planId: f.planId, planWorkoutId: 'upper', copied: false });
    const upper = f.plan().workouts[0];
    expect(upper.revision).toBe(1);
    expect(upper.exercises.map((exercise) => exercise.exerciseId)).toEqual([f.plank, f.bench, f.dip]);
    expect(upper.exercises[1]).toMatchObject({ id: 'u0', restSeconds: 180, targets: [{ type: 'working', reps: 5, weightGrams: 80_000 }, { type: 'working', reps: 5, weightGrams: 80_000 }] });
    // A new exercise is prescribed from logged sets, without the weight.
    expect(upper.exercises[2].targets).toEqual([{ type: 'working', reps: 12 }, { type: 'working', reps: 10 }]);
    expect(JSON.stringify(f.plan().workouts[1])).toBe(lowerBefore);

    // History is untouched: the workout's rows and sets are exactly as they were.
    expect(JSON.stringify(f.workoutExercises.docs)).toBe(exercisesBefore);
    expect(JSON.stringify(f.sets.docs)).toBe(setsBefore);

    // Repeated: the same request, or another one, returns the first result and changes nothing.
    expect(await f.updates.apply(ME, session.id, { requestId, revision: 0 })).toEqual(result);
    expect(await f.updates.apply(ME, session.id, { requestId: randomUUID(), revision: 1 })).toEqual(result);
    expect(f.plan().workouts[0].revision).toBe(1);
    expect((await f.preview(session.id)).status).toBe('applied');
  });

  it('refuses a stale review, then offers the changes against the newer day and says it was edited', async () => {
    const f = fixture();
    const session = await f.asPlanned();
    await f.service.updateExercise(ME, session.id, session.exercises[0].id, { restSeconds: 200 });
    await f.finish(session.id);
    const shown = await f.preview(session.id);
    expect(shown.editedSince).toBeUndefined();
    // The plan is edited elsewhere in between.
    const detail = await f.plans.detail(ME, f.planId);
    await f.plans.replace(ME, f.planId, {
      name: detail.name,
      workouts: detail.workouts.map((workout) => ({
        id: workout.id,
        revision: workout.revision,
        name: workout.name,
        exercises: workout.exercises.map(({ id, exerciseId, restSeconds, targets }, index) => ({
          id,
          exerciseId,
          ...(restSeconds != null ? { restSeconds } : {}),
          targets: workout.id === 'upper' && index === 1 ? [{ type: 'working' as const, reps: 10 }] : targets,
        })),
      })),
    });
    expect(await conflict(f.updates.apply(ME, session.id, { requestId: randomUUID(), revision: shown.revision ?? 0 }))).toMatchObject({ code: 'PLAN_CHANGED' });
    const again = await f.preview(session.id);
    expect(again).toMatchObject({ status: 'available', revision: 1, editedSince: true });
    await f.updates.apply(ME, session.id, { requestId: randomUUID(), revision: 1 });
    // The newer edit survives; only the rest the workout changed is applied.
    expect(f.plan().workouts[0].exercises[1].targets).toEqual([{ type: 'working', reps: 10 }]);
    expect(f.plan().workouts[0].exercises[0].restSeconds).toBe(200);
  });

  it('explains a deleted plan or day, and offers nothing', async () => {
    const f = fixture();
    const session = await f.asPlanned();
    await f.service.updateExercise(ME, session.id, session.exercises[0].id, { restSeconds: 200 });
    await f.finish(session.id);
    f.plan().workouts.splice(0, 1);
    expect(await f.preview(session.id)).toMatchObject({ status: 'missing', message: 'Upper is no longer in Upper / Lower.' });
    await f.plans.remove(ME, f.planId);
    expect(await f.preview(session.id)).toMatchObject({ status: 'missing', message: 'That plan no longer exists.' });
    await expect(f.apply(session.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates several days, each from its own workout', async () => {
    const f = fixture();
    const upper = await f.asPlanned('upper');
    await f.service.updateExercise(ME, upper.id, upper.exercises[0].id, { restSeconds: 150 });
    await f.finish(upper.id);
    await f.apply(upper.id);
    const lower = await f.asPlanned('lower');
    await f.service.updateExercise(ME, lower.id, lower.exercises[0].id, { restSeconds: 30 });
    await f.finish(lower.id);
    await f.apply(lower.id);
    expect(f.plan().workouts.map((workout) => [workout.revision, workout.exercises[0].restSeconds])).toEqual([[1, 150], [1, 30]]);
  });

  it('saves a ready-made plan as an own copy with the day updated, once, and leaves the original alone', async () => {
    const f = fixture({ own: false });
    const session = await f.start();
    await f.service.removeExercise(ME, session.id, session.exercises[2].id);
    for (const exercise of session.exercises.slice(0, 2)) await f.log(session.id, exercise.id, { reps: 5, weightGrams: 60_000 });
    await f.finish(session.id);
    const original = JSON.stringify(f.plan());
    const shown = await f.preview(session.id);
    expect(shown).toMatchObject({ status: 'available', shared: true });
    const requestId = randomUUID();
    const result = await f.updates.apply(ME, session.id, { requestId, revision: shown.revision ?? 0 });
    expect(result.copied).toBe(true);
    expect(JSON.stringify(f.plan())).toBe(original);
    const copy = await f.plans.detail(ME, result.planId);
    expect(copy.isOwn).toBe(true);
    expect(copy.workouts[0].exercises.map((exercise) => exercise.exerciseId)).toEqual([f.bench, f.row]);
    expect(copy.workouts[1].exercises).toHaveLength(1);
    expect(await f.updates.apply(ME, session.id, { requestId, revision: 0 })).toEqual(result);
    expect(f.plansModel.docs.filter((doc) => doc['userId'] === ME)).toHaveLength(1);
  });

  it('answers 404 for someone else’s workout', async () => {
    const f = fixture();
    const session = await f.asPlanned();
    await f.finish(session.id);
    await expect(f.updates.preview(OTHER, session.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(f.updates.apply(OTHER, session.id, { requestId: randomUUID(), revision: 0 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
