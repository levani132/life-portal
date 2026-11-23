/**
 * Spec 042: programmes through the real API and Mongo. A programme pairs a meal plan with a
 * training plan, holds only their ids, follows the plans as they change, and is posted as one
 * post with both. For a person and for a page.
 */
import { randomUUID } from 'node:crypto';
import type { FoodPost, MealPlan, PageSummary, PostPreview, Programme } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });

async function plans(who: Account, headers?: Record<string, string>) {
  const food = (await api.call<{ id: string }>(who, 'POST', '/nutrition/foods', { name: 'Programme rice', unit: 'g', servingSize: 100, entryMode: 'per_100', energyKcal: 130, proteinMg: 3_000, fatMg: 0, carbMg: 28_000 }, headers)).body.id;
  const meal = await api.call<MealPlan>(who, 'POST', '/nutrition/meal-plans', { name: 'Eat', days: [{ name: 'Every day', entries: [{ slot: 'lunch', foodId: food, amount: 200 }] }] }, headers);
  expect(meal.status).toBeLessThan(300);
  const exercise = await api.call<{ id: string }>(who, 'POST', '/training/exercises', { name: `Programme press ${randomUUID().slice(0, 4)}`, primaryMuscles: ['chest'], equipmentType: 'barbell', measure: 'weight_reps' }, headers);
  const training = await api.call<{ id: string }>(
    who,
    'POST',
    '/training/plans',
    { requestId: randomUUID(), name: 'Lift', workouts: [{ name: 'A', exercises: [{ exerciseId: exercise.body.id, targets: [{ type: 'working', reps: 8 }] }] }] },
    headers,
  );
  expect(training.status).toBeLessThan(300);
  return { mealPlanId: meal.body.id, trainingPlanId: training.body.id };
}

describe('programmes', () => {
  it('pair a meal plan and a training plan by id, and follow them as they change', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const ids = await plans(ana);
    const made = await api.call<Programme>(ana, 'POST', '/programmes', { name: 'Lean bulk', description: 'Twelve weeks.', ...ids });
    expect(made.status).toBeLessThan(300);
    expect(made.body).toMatchObject({
      name: 'Lean bulk',
      mealPlan: { id: ids.mealPlanId, name: 'Eat', dayCount: 1, dailyKcal: 260, complete: true },
      trainingPlan: { id: ids.trainingPlanId, name: 'Lift', workoutCount: 1, exerciseCount: 1, isOwn: true },
      gone: [],
    });
    // Only the two ids are stored.
    const stored = await api.db.collection('programmes').findOne({ userId: ana.id });
    expect(Object.keys(stored ?? {}).sort()).toEqual(['_id', 'createdAt', 'description', 'mealPlanId', 'name', 'trainingPlanId', 'updatedAt', 'userId']);

    // Refused: nothing in it, or someone else's plans.
    expect((await api.call(ana, 'POST', '/programmes', { name: 'Empty' })).status).toBe(400);
    expect((await api.call(beka, 'POST', '/programmes', { name: 'Not mine', mealPlanId: ids.mealPlanId })).status).toBe(400);
    expect((await api.call(beka, 'POST', '/programmes', { name: 'Not mine', trainingPlanId: ids.trainingPlanId })).status).toBe(400);
    expect((await api.call<Programme[]>(beka, 'GET', '/programmes')).body).toEqual([]);

    // Starting it is using its meal plan; the programme shows that.
    await api.call(ana, 'PUT', '/nutrition/meal-plans/active', { planId: ids.mealPlanId, today: '2026-03-02' });
    expect((await api.call<Programme[]>(ana, 'GET', '/programmes')).body[0].mealPlan).toMatchObject({ activeSince: '2026-03-02' });

    // One half only; then a deleted plan is reported, not hidden.
    const half = await api.call<Programme>(ana, 'PUT', `/programmes/${made.body.id}`, { name: 'Lean bulk', mealPlanId: ids.mealPlanId });
    expect(half.body.trainingPlan).toBeUndefined();
    expect((await api.db.collection('programmes').findOne({ userId: ana.id }))?.['trainingPlanId']).toBeUndefined();
    await api.call(ana, 'DELETE', `/nutrition/meal-plans/${ids.mealPlanId}`);
    expect((await api.call<Programme[]>(ana, 'GET', '/programmes')).body[0]).toMatchObject({ gone: ['mealPlan'] });

    // Deleting the programme leaves the plans alone.
    expect((await api.call(ana, 'DELETE', `/programmes/${made.body.id}`)).status).toBe(200);
    expect(await api.db.collection('programmes').countDocuments({ userId: ana.id })).toBe(0);
    expect((await api.call(ana, 'GET', `/training/plans/${ids.trainingPlanId}`)).status).toBe(200);
  });

  it('are kept by a page and posted as one post with both plans', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Coach', username: `coach-${randomUUID().slice(0, 6)}`, bio: '' })).body;
    const ids = await plans(ana, as(page.id));
    const made = await api.call<Programme>(ana, 'POST', '/programmes', { name: 'Page programme', ...ids }, as(page.id));
    expect(made.status).toBeLessThan(300);
    // The page's programmes are not its manager's.
    expect((await api.call<Programme[]>(ana, 'GET', '/programmes')).body).toEqual([]);

    const source = { kind: 'mealPlan', mealPlanId: ids.mealPlanId };
    const training = { kind: 'plan', planId: ids.trainingPlanId };
    // Each half is previewed on its own, as the composer does.
    const preview = await api.call<PostPreview>(ana, 'POST', '/posts/preview', { source }, as(page.id));
    const trainingPreview = await api.call<{ trainingHash: string }>(ana, 'POST', '/posts/preview', { training }, as(page.id));
    expect([preview.status, trainingPreview.status].every((status) => status < 300)).toBe(true);
    const posted = await api.call<FoodPost>(
      ana,
      'POST',
      '/posts',
      { requestId: randomUUID(), title: 'Page programme', caption: '', audience: 'public', source, previewHash: preview.body.previewHash, training, trainingHash: trainingPreview.body.trainingHash, allowCopy: true },
      as(page.id),
    );
    expect(posted.status).toBe(201);
    const read = await api.call<FoodPost>(beka, 'GET', `/posts/${posted.body.id}`);
    expect(read.body).toMatchObject({ kind: 'mealPlan', days: ['Every day'] });
    expect(read.body.training).toBeTruthy();
  });
});
