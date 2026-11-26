/**
 * Spec 046, slice 3: Training on a portal. Nothing until a switch is on; each switch adds only
 * its own part; body weight is never in the answer.
 */
import { randomUUID } from 'node:crypto';
import type { PublicPortal, SharedWidget } from '@life-portal/shared-types';
import { startApi, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const today = new Date().toISOString().slice(0, 10);

describe('Training on a portal', () => {
  it('shows each part only behind its own switch, and never body weight', async () => {
    const ana = await api.account('ana');
    const username = `t${randomUUID().slice(0, 8)}`;
    await api.call(ana, 'PUT', '/social/me', { username, displayName: 'Ana', bio: '', discoverable: true });
    await api.call(ana, 'PUT', `/nutrition/weigh-ins?today=${today}`, { day: today, weightGrams: 71_300 });
    const exercise = (await api.call<{ id: string }>(ana, 'POST', '/training/exercises', { name: 'Portal press', primaryMuscles: ['chest'], equipmentType: 'barbell', measure: 'weight_reps' })).body;
    // Two workouts: an earlier, lighter one, then today's heavier set, which is a record.
    const workout = async (weightGrams: number) => {
      const session = (await api.call<{ id: string }>(ana, 'POST', '/training/sessions', { requestId: randomUUID(), day: today })).body;
      const added = (await api.call<{ id: string }>(ana, 'POST', `/training/sessions/${session.id}/exercises`, { requestId: randomUUID(), exerciseId: exercise.id })).body;
      await api.call(ana, 'POST', `/training/sessions/${session.id}/exercises/${added.id}/sets`, { requestId: randomUUID(), reps: 8, weightGrams });
      expect((await api.call(ana, 'POST', `/training/sessions/${session.id}/finish`, { endedAt: new Date().toISOString() })).status).toBe(200);
    };
    await workout(60_000);
    await workout(70_000);
    expect((await api.call(ana, 'PUT', '/portal', { moduleVisibility: { training: 'public' } })).status).toBe(200);

    const widget = async (): Promise<SharedWidget | undefined> =>
      (await api.call<PublicPortal>(null, 'GET', `/public/portals/${username}?today=${today}`)).body.widgets.find((row) => row.module === 'training');
    // Public, but every switch off: nothing.
    expect(await widget()).toBeUndefined();

    await api.call(ana, 'PUT', '/training/profile', { shareWorkouts: true });
    const workouts = await widget();
    expect(workouts?.training?.workouts).toMatchObject({ thisWeek: 2, streakWeeks: 1 });
    expect(workouts?.training?.workouts?.recent).toHaveLength(2);
    expect(workouts?.training?.records).toBeUndefined();
    expect(workouts?.training?.level).toBeUndefined();

    await api.call(ana, 'PUT', '/training/profile', { shareWorkouts: false, shareRecords: true });
    const records = await widget();
    expect(records?.training?.workouts).toBeUndefined();
    expect(records?.training?.records?.[0]).toMatchObject({ exerciseName: 'Portal press' });

    // Whatever is on, body weight never leaves: not in grams, not in kg.
    await api.call(ana, 'PUT', '/training/profile', { shareWorkouts: true, shareRecords: true, shareLevel: true, shareRanks: true });
    const all = JSON.stringify(await widget());
    expect(all).not.toContain('71300');
    expect(all).not.toContain('71.3');
  });
});
