/**
 * #23: the selectorised chest press is found by the words people type, online through the real
 * search (seeded catalogue, Mongo regex, ranking, limit) and offline through the device copy.
 */
import { randomUUID } from 'node:crypto';
import { matchesExerciseSearch } from '@life-portal/shared-domain';
import type { ExerciseListItem } from '@life-portal/shared-types';
import { startApi, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const TERMS = ['chest press', 'machine chest press', 'seated chest press', 'machine bench press'];

it.each(TERMS)('the picker’s search puts it first for "%s"', async (q) => {
  const me = await api.account();
  const found = await api.call<ExerciseListItem[]>(me, 'GET', `/training/exercises?${new URLSearchParams({ q, limit: '50' })}`);
  expect(found.status).toBe(200);
  expect(found.body[0]).toMatchObject({ name: 'Seated Chest Press (Machine)', equipmentType: 'machine' });
  if (q === 'chest press') expect(found.body.map((item) => item.name)).toContain('Leverage Chest Press');
});

it('is one row, and offline search finds it by any of those words once it is on the device', async () => {
  const me = await api.account();
  const [machine] = (await api.call<ExerciseListItem[]>(me, 'GET', '/training/exercises?q=seated%20chest%20press')).body;
  const rows = await api.db.collection('exercises').find({ seedKey: 'fedb:Machine_Bench_Press' }).toArray();
  expect(rows).toHaveLength(1);
  expect(String(rows[0]['_id'])).toBe(machine.id);

  // Used in a workout, so it is kept on the device.
  const day = new Date().toISOString().slice(0, 10);
  const session = await api.call<{ id: string }>(me, 'POST', '/training/sessions', { requestId: randomUUID(), day });
  const added = await api.call<{ id: string }>(me, 'POST', `/training/sessions/${session.body.id}/exercises`, { requestId: randomUUID(), exerciseId: machine.id });
  expect((await api.call(me, 'POST', `/training/sessions/${session.body.id}/exercises/${added.body.id}/sets`, { requestId: randomUUID(), reps: 10, weightGrams: 40_000 })).status).toBeLessThan(300);

  const saved = await api.call<ExerciseListItem[]>(me, 'GET', '/training/exercises/offline');
  const copy = saved.body.find((item) => item.id === machine.id);
  expect(copy?.searchName).toContain('machine bench press');
  for (const q of TERMS) expect(matchesExerciseSearch(copy?.searchName ?? '', q)).toBe(true);
});
