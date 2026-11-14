import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { CatalogueService } from './catalogue.service';
import { FakeModel, fakeMedia } from './fake-model.testing';
import { ProgressService } from './progress.service';
import { SessionsService } from './sessions.service';
import { TrainingProfileService } from './profile.service';
import { TrainingSummaryService } from './summary.service';

const ME = 'user-me';
/** Thursday 12 Nov 2026; that week starts Monday 9 Nov. */
const TODAY = '2026-11-12';
const at = (day: string, hour: number, minute = 0) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);

function fixture() {
  const exercises = new FakeModel();
  const sessions = new FakeModel([['userId', 'requestId'], ['userId', '?status=open']]);
  const workoutExercises = new FakeModel([['userId', 'requestId']]);
  const sets = new FakeModel([['userId', 'requestId']]);
  const media = fakeMedia();
  const catalogue = new CatalogueService(exercises as never, workoutExercises as never, sets as never, media as never);
  const nutrition = { weighInsUpTo: async () => [] };
  const progress = new ProgressService(sessions as never, workoutExercises as never, sets as never, catalogue, nutrition as never);
  const service = new SessionsService(sessions as never, workoutExercises as never, sets as never, catalogue, progress);
  const profileRows = new FakeModel();
  // The plan pick itself is `PlansService.nextUp`, tested in plans.service.spec.ts.
  const plans = { nextUp: jest.fn().mockResolvedValue(undefined) };
  const summary = new TrainingSummaryService(
    sessions as never,
    workoutExercises as never,
    sets as never,
    progress,
    new TrainingProfileService(profileRows as never),
    plans as never,
  );
  const bench = new Types.ObjectId();
  exercises.docs.push({
    _id: bench, name: 'Barbell Bench Press', searchName: 'barbell bench press', primaryMuscles: ['chest'], secondaryMuscles: [],
    equipmentType: 'barbell', measure: 'weight_reps', seedKey: 'fedb:bench', archived: false, aliases: [],
  });
  /** One bench session on `day`, sets a minute apart from 18:00, finished 30 minutes in unless `open`. */
  const workout = async (day: string, weights: number[], open = false) => {
    const session = await service.start(ME, { requestId: randomUUID(), day }, at(day, 18));
    const exercise = await service.addExercise(ME, session.id, { requestId: randomUUID(), exerciseId: String(bench) });
    for (const [index, weightGrams] of weights.entries()) {
      await service.addSet(ME, session.id, exercise.id, { requestId: randomUUID(), reps: 5, weightGrams }, at(day, 18, index + 1));
    }
    if (!open) await service.finish(ME, session.id, 'now', at(day, 18, 30));
    return session.id;
  };
  return { summary, workout, profileRows, plans };
}

describe('TrainingSummaryService (spec 020 US4)', () => {
  it('is empty for someone who has never trained', async () => {
    const f = fixture();
    expect(await f.summary.summary(ME, TODAY)).toEqual({ workoutsThisWeek: 0, secondsThisWeek: 0, weightUnit: 'kg' });
    expect(f.profileRows.docs).toHaveLength(0); // reading the unit creates no profile
  });

  it('names the plan’s next workout for Play, only while nothing is open (issue #7)', async () => {
    const f = fixture();
    const next = { planId: 'p1', planName: 'Full body', planWorkoutId: 'fb:b', workoutName: 'Workout B' };
    f.plans.nextUp.mockResolvedValue(next);
    expect((await f.summary.summary(ME, TODAY)).nextPlanWorkout).toEqual(next);
    expect(f.plans.nextUp).toHaveBeenCalledWith(ME, TODAY);

    f.plans.nextUp.mockClear();
    await f.workout(TODAY, [60_000], true);
    const open = await f.summary.summary(ME, TODAY);
    expect(open.openSessionId).toBeDefined();
    expect(open.nextPlanWorkout).toBeUndefined();
    expect(f.plans.nextUp).not.toHaveBeenCalled();
  });

  it('carries the person’s weight unit for the card', async () => {
    const f = fixture();
    f.profileRows.docs.push({ _id: new Types.ObjectId(), userId: ME, weightUnit: 'lb', defaultRestSeconds: 90 });
    expect((await f.summary.summary(ME, TODAY)).weightUnit).toBe('lb');
  });

  it('counts this week only, and shows a record set in the last 14 days', async () => {
    const f = fixture();
    await f.workout('2026-11-01', [60_000]); // two weeks back: the baseline
    await f.workout('2026-11-06', [60_000]); // last week: counts for nothing new
    await f.workout('2026-11-10', [80_000]); // this week: beats 60 kg
    const result = await f.summary.summary(ME, TODAY);
    expect(result.workoutsThisWeek).toBe(1);
    expect(result.secondsThisWeek).toBe(30 * 60);
    expect(result.latestRecord).toMatchObject({ kind: 'heaviest', value: 80_000, day: '2026-11-10', exerciseName: 'Barbell Bench Press' });
    expect(result.daysSinceLast).toBeUndefined();
  });

  it('falls back to days since the last workout when no record is recent', async () => {
    const f = fixture();
    await f.workout('2026-10-20', [60_000]);
    await f.workout('2026-10-25', [80_000]);
    const result = await f.summary.summary(ME, TODAY);
    expect(result.latestRecord).toBeUndefined();
    expect(result.daysSinceLast).toBe(18);
    expect(result.workoutsThisWeek).toBe(0);
  });

  it('names the open session, timed to its last set', async () => {
    const f = fixture();
    const id = await f.workout(TODAY, [60_000, 60_000, 60_000], true);
    const result = await f.summary.summary(ME, TODAY);
    expect(result.openSessionId).toBe(id);
    expect(result.workoutsThisWeek).toBe(1);
    expect(result.secondsThisWeek).toBe(3 * 60);
  });
});
