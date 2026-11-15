/**
 * #25: finishing a workout, through the real API and Mongo. The weigh-in a finish sheet saves
 * works for an account with Training and without Food, uses Food's one-per-day rows, and never
 * replaces a weigh-in the device did not see. The recap is the server's, as of the workout.
 */
import { randomUUID } from 'node:crypto';
import type { ExerciseListItem, RecentWeighIns, WorkoutRecap } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

async function trainingOnly(): Promise<Account> {
  const me = await api.account('lifter');
  await api.db.collection('users').updateOne({ email: me.email }, { $set: { featureOverrides: { nutrition: false } } });
  return me;
}

describe('the weigh-in, for Training without Food', () => {
  it('saves and reads body weight while Food routes stay closed', async () => {
    const me = await trainingOnly();
    expect((await api.call(me, 'GET', '/nutrition/weigh-ins')).status).toBe(403);

    const saved = await api.call(me, 'PUT', '/training/weigh-in', { day: today, weightGrams: 81_200, baseVersion: 0 });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ day: today, weightGrams: 81_200, version: 1 });

    const recent = await api.call<RecentWeighIns>(me, 'GET', '/training/weigh-ins/recent');
    expect(recent.body.weighIns).toEqual([expect.objectContaining({ day: today, weightGrams: 81_200, version: 1 })]);
    // The same rows Food reads: one per day.
    expect(await api.db.collection('weigh_ins').countDocuments({ userId: me.id })).toBe(1);
  });

  it("never replaces today's weigh-in blindly, and a retried save is one write", async () => {
    const me = await api.account('both');
    // A morning weigh-in from Food, with body fat.
    expect((await api.call(me, 'PUT', '/nutrition/weigh-ins', { day: today, weightGrams: 80_000, bodyFatPct: 0.18 })).status).toBe(200);

    // A finish sheet that never saw it.
    const blind = await api.call<{ code: string }>(me, 'PUT', '/training/weigh-in', { day: today, weightGrams: 81_500, baseVersion: 0 });
    expect(blind.status).toBe(409);
    expect(blind.body.code).toBe('STALE_EDIT');

    // One that saw it and the person chose to replace it, sent twice with one idempotency key.
    const key = randomUUID();
    const body = { day: today, weightGrams: 81_500, baseVersion: 1 };
    const first = await api.call(me, 'PUT', '/training/weigh-in', body, { 'Idempotency-Key': key });
    const again = await api.call(me, 'PUT', '/training/weigh-in', body, { 'Idempotency-Key': key });
    expect(first.body).toMatchObject({ weightGrams: 81_500, bodyFatPct: 0.18, version: 2 });
    expect(again.body).toMatchObject({ weightGrams: 81_500, version: 2 });
    const rows = await api.db.collection('weigh_ins').find({ userId: me.id }).toArray();
    expect(rows).toHaveLength(1);
  });

  it('refuses a weigh-in without a version or out of range', async () => {
    const me = await trainingOnly();
    expect((await api.call(me, 'PUT', '/training/weigh-in', { day: today, weightGrams: 80_000 })).status).toBe(400);
    expect((await api.call(me, 'PUT', '/training/weigh-in', { day: today, weightGrams: 5_000, baseVersion: 0 })).status).toBe(400);
  });
});

describe('the recap', () => {
  async function workout(me: Account, exerciseId: string, startedAt: Date, sets: { reps: number; weightGrams: number }[]) {
    const day = startedAt.toISOString().slice(0, 10);
    const session = await api.call<{ id: string }>(me, 'POST', '/training/sessions', { requestId: randomUUID(), day, startedAt: startedAt.toISOString() });
    const added = await api.call<{ id: string }>(me, 'POST', `/training/sessions/${session.body.id}/exercises`, { requestId: randomUUID(), exerciseId });
    for (const [index, set] of sets.entries()) {
      const loggedAt = new Date(startedAt.getTime() + (index + 1) * 5 * 60_000).toISOString();
      await api.call(me, 'POST', `/training/sessions/${session.body.id}/exercises/${added.body.id}/sets`, { requestId: randomUUID(), ...set, loggedAt });
    }
    const endedAt = new Date(startedAt.getTime() + (sets.length + 1) * 5 * 60_000).toISOString();
    expect((await api.call(me, 'POST', `/training/sessions/${session.body.id}/finish`, { endedAt })).status).toBe(200);
    return session.body.id;
  }

  it('shows records, a real rank-up and the level, worked out without and with the workout', async () => {
    const me = await api.account('recap');
    await api.call(me, 'PUT', '/training/profile', { rankStandards: 'men' });
    await api.call(me, 'PUT', '/nutrition/weigh-ins', { day: daysAgo(5).toISOString().slice(0, 10), weightGrams: 80_000 });
    const [bench] = (await api.call<ExerciseListItem[]>(me, 'GET', '/training/exercises?q=barbell%20bench%20press')).body;

    await workout(me, bench.id, daysAgo(3), [{ reps: 5, weightGrams: 50_000 }, { reps: 5, weightGrams: 50_000 }, { reps: 5, weightGrams: 50_000 }]);
    const id = await workout(me, bench.id, new Date(Date.now() - 40 * 60_000), [
      { reps: 5, weightGrams: 110_000 },
      { reps: 5, weightGrams: 110_000 },
      { reps: 5, weightGrams: 110_000 },
    ]);

    const recap = await api.call<WorkoutRecap>(me, 'GET', `/training/sessions/${id}/recap`);
    expect(recap.status).toBe(200);
    expect(recap.body.totals).toMatchObject({ exercises: 1, sets: 3, workingSets: 3, reps: 15, volumeGrams: 110_000 * 15 });
    expect(recap.body.records.map((record) => record.kind)).toEqual(expect.arrayContaining(['heaviest', 'best_1rm']));
    expect(recap.body.rankUps).toHaveLength(1);
    const [up] = recap.body.rankUps ?? [];
    expect(up.to.milestone).toBeGreaterThan(up.from?.milestone ?? -1);
    expect(recap.body.level).toMatchObject({ xpGained: expect.any(Number) });
    expect(recap.body.level?.xpGained).toBeGreaterThan(0);
    expect(recap.body.achievements).toBe(true);

    // Recomputed as of that workout: a later, lighter one does not take its rank-up away.
    await workout(me, bench.id, new Date(Date.now() - 15 * 60_000), [{ reps: 5, weightGrams: 40_000 }]);
    const again = await api.call<WorkoutRecap>(me, 'GET', `/training/sessions/${id}/recap`);
    expect(again.body.rankUps).toEqual(recap.body.rankUps);
  });

  it('leaves ranks and levels out when those features are off, and is only numbers while open', async () => {
    const me = await api.account('flags');
    await api.db.collection('users').updateOne({ email: me.email }, { $set: { featureOverrides: { trainingRanks: false, trainingLevels: false } } });
    const [bench] = (await api.call<ExerciseListItem[]>(me, 'GET', '/training/exercises?q=barbell%20bench%20press')).body;
    const id = await workout(me, bench.id, new Date(Date.now() - 30 * 60_000), [{ reps: 5, weightGrams: 60_000 }]);
    const recap = await api.call<WorkoutRecap>(me, 'GET', `/training/sessions/${id}/recap`);
    expect(recap.body.rankUps).toBeUndefined();
    expect(recap.body.level).toBeUndefined();
    expect(recap.body.achievements).toBe(false); // a first workout has no records

    const open = await api.call<{ id: string }>(me, 'POST', '/training/sessions', { requestId: randomUUID(), day: today });
    const openRecap = await api.call<WorkoutRecap>(me, 'GET', `/training/sessions/${open.body.id}/recap`);
    expect(openRecap.body).toMatchObject({ status: 'open', records: [], achievements: false });
  });
});
