/**
 * Spec 041, slice 1: a page's library through the real API and Mongo. A page keeps foods,
 * recipes and exercises, posts them, and a person saves or copies them; a page still cannot
 * log anything.
 */
import { randomUUID } from 'node:crypto';
import type { FoodPost, PageSummary, PostPreview } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });

async function pageOf(owner: Account, name: string): Promise<PageSummary> {
  const made = await api.call<PageSummary>(owner, 'POST', '/pages', { name, username: `${name}-${randomUUID().slice(0, 6)}`, bio: '' });
  expect(made.status).toBe(201);
  return made.body;
}
const food = (name: string) => ({ name, unit: 'g', servingSize: 100, energyKcal: 250, proteinMg: 20_000, fatMg: 10_000, carbMg: 15_000 });

describe('a page’s library', () => {
  it('holds foods and recipes of its own, apart from its manager’s', async () => {
    const ana = await api.account('ana');
    const page = await pageOf(ana, 'kitchen');
    const oats = await api.call<{ id: string }>(ana, 'POST', '/nutrition/foods', food('Page oats'), as(page.id));
    expect(oats.status).toBeLessThan(300);
    const milk = await api.call<{ id: string }>(ana, 'POST', '/nutrition/foods', food('Page milk'), as(page.id));
    const recipe = await api.call<{ id: string }>(ana, 'POST', '/nutrition/meals', { name: 'Porridge', components: [{ foodId: oats.body.id, amount: 60 }, { foodId: milk.body.id, amount: 200 }] }, as(page.id));
    expect(recipe.status).toBeLessThan(300);

    const pageFoods = await api.call<{ id: string }[]>(ana, 'GET', '/nutrition/foods', undefined, as(page.id));
    expect(pageFoods.body.map((row) => row.id).sort()).toEqual([oats.body.id, milk.body.id].sort());
    expect((await api.call<{ id: string }[]>(ana, 'GET', '/nutrition/meals', undefined, as(page.id))).body.map((row) => row.id)).toEqual([recipe.body.id]);
    // The manager's own foods are theirs: nothing of the page's is in them.
    expect((await api.call<{ id: string }[]>(ana, 'GET', '/nutrition/foods')).body.map((row) => row.id)).not.toContain(oats.body.id);
    // A recipe can be kept, never logged.
    const today = new Date().toISOString().slice(0, 10);
    expect((await api.call(ana, 'POST', `/nutrition/meals/${recipe.body.id}/log`, { day: today, slot: 'breakfast' }, as(page.id))).status).toBe(403);
  });

  it('posts a food and a recipe that a person saves into their own foods', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = await pageOf(ana, 'deli');
    const made = await api.call<{ id: string }>(ana, 'POST', '/nutrition/foods', food('Deli soup'), as(page.id));
    const source = { kind: 'food', foodId: made.body.id };
    const preview = await api.call<PostPreview>(ana, 'POST', '/posts/preview', { source }, as(page.id));
    expect(preview.status).toBeLessThan(300);
    const posted = await api.call<FoodPost>(
      ana,
      'POST',
      '/posts',
      { requestId: randomUUID(), title: 'Soup', caption: '', audience: 'public', source, previewHash: preview.body.previewHash },
      as(page.id),
    );
    expect(posted.status).toBe(201);
    expect(posted.body.author).toMatchObject({ userId: page.id, isPage: true });

    const read = await api.call<FoodPost>(beka, 'GET', `/posts/${posted.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.items.length).toBe(1);
    const saved = await api.call(beka, 'POST', `/posts/${posted.body.id}/import`, { itemKeys: [read.body.items[0].key], duplicatePolicy: 'skip', saveAsMeal: false });
    expect(saved.status).toBeLessThan(300);
    const mine = await api.call<{ name: string }[]>(beka, 'GET', '/nutrition/foods');
    expect(mine.body.map((row) => row.name)).toContain('Deli soup');
    // Saving logs nothing for the person.
    expect(await api.db.collection('meal_entries').countDocuments({ userId: beka.id })).toBe(0);
    expect(JSON.stringify(read.body)).not.toContain(ana.id);
  });

  it('keeps exercises and posts one', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = await pageOf(ana, 'gym');
    const exercise = await api.call<{ id: string }>(
      ana,
      'POST',
      '/training/exercises',
      { name: `Page press ${randomUUID().slice(0, 4)}`, primaryMuscles: ['chest'], equipmentType: 'barbell', measure: 'weight_reps' },
      as(page.id),
    );
    expect(exercise.status).toBeLessThan(300);
    const training = { kind: 'exercise', exerciseId: exercise.body.id };
    const preview = await api.call<{ trainingHash: string }>(ana, 'POST', '/posts/preview', { training }, as(page.id));
    expect(preview.status).toBeLessThan(300);
    const posted = await api.call<FoodPost>(
      ana,
      'POST',
      '/posts',
      { requestId: randomUUID(), title: 'Press', caption: '', audience: 'public', training, trainingHash: preview.body.trainingHash, allowCopy: true },
      as(page.id),
    );
    expect(posted.status).toBe(201);
    const copied = await api.call(beka, 'POST', `/posts/${posted.body.id}/training-copy`, { requestId: randomUUID() });
    expect(copied.status).toBeLessThan(300);
    // A page has a library, never a workout.
    expect((await api.call(ana, 'POST', '/training/sessions', {}, as(page.id))).status).toBe(403);
  });

  it('lets one post carry food and training together, for a person and for a page (spec 042)', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = await pageOf(ana, 'both');
    for (const headers of [undefined, as(page.id)]) {
      const made = await api.call<{ id: string }>(ana, 'POST', '/nutrition/foods', food(`Together ${headers ? 'page' : 'person'}`), headers);
      const exercise = await api.call<{ id: string }>(
        ana,
        'POST',
        '/training/exercises',
        { name: `Together move ${randomUUID().slice(0, 4)}`, primaryMuscles: ['chest'], equipmentType: 'barbell', measure: 'weight_reps' },
        headers,
      );
      const source = { kind: 'food', foodId: made.body.id };
      const training = { kind: 'exercise', exerciseId: exercise.body.id };
      const foodPreview = await api.call<PostPreview>(ana, 'POST', '/posts/preview', { source }, headers);
      const trainingPreview = await api.call<{ trainingHash: string }>(ana, 'POST', '/posts/preview', { training }, headers);
      const posted = await api.call<FoodPost>(
        ana,
        'POST',
        '/posts',
        { requestId: randomUUID(), title: 'Eat and train', caption: '', audience: 'public', source, previewHash: foodPreview.body.previewHash, training, trainingHash: trainingPreview.body.trainingHash, allowCopy: true },
        headers,
      );
      expect(posted.status).toBe(201);

      // The reader gets both, and saves or copies each on its own.
      const read = await api.call<FoodPost>(beka, 'GET', `/posts/${posted.body.id}`);
      expect(read.body.items).toHaveLength(1);
      expect(read.body.training).toBeTruthy();
      expect((await api.call(beka, 'POST', `/posts/${posted.body.id}/import`, { itemKeys: [read.body.items[0].key], duplicatePolicy: 'skip', saveAsMeal: false })).status).toBeLessThan(300);
      expect((await api.call(beka, 'POST', `/posts/${posted.body.id}/training-copy`, { requestId: randomUUID() })).status).toBeLessThan(300);
    }
  });
});
