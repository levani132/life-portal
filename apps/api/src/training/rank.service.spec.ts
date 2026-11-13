import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FakeModel } from './fake-model.testing';
import { TrainingRankService } from './rank.service';

const ME = 'me';
const TODAY = '2026-11-13';
const BENCH = 'fedb:Barbell_Bench_Press_-_Medium_Grip';

function fixture(options: { standards?: 'men' | 'women'; seedKey?: string; own?: boolean } = {}) {
  const sessions = new FakeModel();
  const workoutExercises = new FakeModel();
  const sets = new FakeModel();
  const exerciseId = String(new Types.ObjectId());
  const catalogue = {
    readable: jest.fn(async () => ({
      _id: exerciseId,
      measure: 'weight_reps',
      ...(options.own ? { userId: ME } : {}),
      seedKey: options.seedKey ?? BENCH,
    })),
  };
  const weighIns: { day: string; weightGrams: number }[] = [{ day: '2026-11-01', weightGrams: 80_000 }];
  const nutrition = { weighInsUpTo: jest.fn(async () => weighIns) };
  const profiles = { read: jest.fn(async () => ({ weightUnit: 'kg', defaultRestSeconds: 90, ...(options.standards ? { rankStandards: options.standards } : {}) })) };
  const access = { require: jest.fn(async () => undefined) };
  const service = new TrainingRankService(
    sessions as never,
    workoutExercises as never,
    sets as never,
    catalogue as never,
    nutrition as never,
    profiles as never,
    access as never,
  );
  const workout = (day: string, weightKg: number, reps: number, extra: { status?: string; userId?: string; machineId?: string; type?: string } = {}) => {
    const sessionId = new Types.ObjectId();
    const userId = extra.userId ?? ME;
    sessions.docs.push({ _id: sessionId, userId, day, status: extra.status ?? 'finished', startedAt: new Date(`${day}T18:00:00Z`) });
    const weId = new Types.ObjectId();
    workoutExercises.docs.push({ _id: weId, userId, sessionId: String(sessionId), exerciseId, snapshot: { measure: 'weight_reps' }, ...(extra.machineId ? { machineId: extra.machineId } : {}) });
    sets.docs.push({ _id: new Types.ObjectId(), userId, sessionId: String(sessionId), workoutExerciseId: String(weId), exerciseId, order: 0, type: extra.type ?? 'working', reps, weightGrams: weightKg * 1000, loggedAt: new Date() });
  };
  return { service, access, workout, exerciseId, weighIns };
}

describe('TrainingRankService (issue #5b)', () => {
  it('needs the trainingRanks flag', async () => {
    const f = fixture({ standards: 'men' });
    f.access.require.mockRejectedValue(new ForbiddenException());
    await expect(f.service.rank(ME, f.exerciseId, TODAY)).rejects.toThrow(ForbiddenException);
  });

  it('ranks from the caller’s own finished sets, their weigh-in and chosen standards', async () => {
    const f = fixture({ standards: 'men' });
    f.workout('2026-11-10', 100, 1); // 1.25× at 80 kg → Veteran III
    f.workout('2026-11-12', 140, 1, { status: 'open' }); // not finished
    f.workout('2026-11-12', 150, 1, { userId: 'someone-else' });
    f.workout('2026-11-12', 130, 1, { machineId: 'm1' });
    f.workout('2026-11-12', 130, 1, { type: 'warmup' });
    const view = await f.service.rank(ME, f.exerciseId, TODAY);
    expect(f.access.require).toHaveBeenCalledWith(ME, 'trainingRanks');
    expect(view).toMatchObject({
      status: 'ranked',
      current: { tier: 'Veteran', division: 'III', score: 1250, basis: { bodyWeightGrams: 80_000, bodyWeightDay: '2026-11-01' } },
      excluded: { machine: 1 },
      benchmark: { version: 'v1-draft', draft: true, standards: 'men' },
    });
  });

  it('asks for standards, and never ranks a private exercise', async () => {
    const none = fixture();
    none.workout('2026-11-10', 100, 1);
    expect(await none.service.rank(ME, none.exerciseId, TODAY)).toMatchObject({ status: 'unranked', reason: 'needs_standards' });
    const own = fixture({ standards: 'men', own: true });
    own.workout('2026-11-10', 100, 1);
    expect(await own.service.rank(ME, own.exerciseId, TODAY)).toMatchObject({ status: 'unranked', reason: 'no_benchmark' });
  });

  it('reflects a corrected weigh-in at once: nothing is stored', async () => {
    const f = fixture({ standards: 'men' });
    f.workout('2026-11-10', 100, 1);
    f.weighIns[0] = { day: '2026-11-01', weightGrams: 100_000 };
    expect((await f.service.rank(ME, f.exerciseId, TODAY)).current?.score).toBe(1077);
  });
});
