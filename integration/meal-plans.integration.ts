/**
 * Spec 042: meal plans through the real API and Mongo. A person builds a plan from foods and a
 * recipe, sees its totals, logs a day and shares it; a reader saves it as their own; a page keeps
 * and posts plans and can never log one.
 */
import { randomUUID } from 'node:crypto';
import type { ActiveMealPlan, FoodPost, MealPlan, PageSummary, PostImportResult, PostPreview } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });
const food = (name: string, kcal: number) => ({ name, unit: 'g', servingSize: 100, entryMode: 'per_100', energyKcal: kcal, proteinMg: 10_000, fatMg: 5_000, carbMg: 20_000 });
const today = new Date().toISOString().slice(0, 10);

async function library(who: Account, headers?: Record<string, string>) {
  const oats = (await api.call<{ id: string }>(who, 'POST', '/nutrition/foods', food('Plan oats', 400), headers)).body.id;
  const rice = (await api.call<{ id: string }>(who, 'POST', '/nutrition/foods', food('Plan rice', 130), headers)).body.id;
  const recipe = (await api.call<{ id: string }>(who, 'POST', '/nutrition/meals', { name: 'Plan porridge', components: [{ foodId: oats, amount: 50 }] }, headers)).body.id;
  return { oats, rice, recipe };
}
const planOf = (ids: { oats: string; rice: string; recipe: string }) => ({
  name: 'Lean week',
  description: 'Two kinds of day.',
  days: [
    { name: 'Training day', entries: [{ slot: 'breakfast', savedMealId: ids.recipe }, { slot: 'lunch', foodId: ids.rice, amount: 200 }] },
    { name: 'Rest day', entries: [{ slot: 'dinner', foodId: ids.rice, amount: 100 }] },
  ],
});

describe('meal plans', () => {
  it('are built from foods and recipes, totalled on read, and logged a day at a time', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const ids = await library(ana);
    const made = await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', planOf(ids));
    expect(made.status).toBeLessThan(300);
    // Porridge 50 g of 400 kcal = 200; rice 200 g of 130 = 260; rest day 130. Average 295.
    expect(made.body.days.map((day) => day.totals.energyKcal)).toEqual([460, 130]);
    expect(made.body).toMatchObject({ name: 'Lean week', complete: true, dailyAverage: { energyKcal: 295 } });
    expect(made.body.days[0].entries.map((entry) => entry.name)).toEqual(['Plan porridge', 'Plan rice']);
    // No total is stored: only ids and amounts.
    const stored = await api.db.collection('meal_plans').findOne({ userId: ana.id });
    expect(JSON.stringify(stored)).not.toContain('energyKcal');

    // Refused as sent: nothing in it, someone else's food, a line that is two things.
    expect((await api.call(ana, 'POST', '/nutrition/meal-plans', { name: 'Empty', days: [{ name: 'A', entries: [] }] })).status).toBe(400);
    const others = await library(beka);
    expect((await api.call(ana, 'POST', '/nutrition/meal-plans', planOf(others))).status).toBe(400);
    expect((await api.call(beka, 'GET', '/nutrition/meal-plans')).body).toEqual([]);

    // Logging a day writes ordinary diary entries, with the numbers frozen now.
    const day = made.body.days[0];
    const logged = await api.call<{ logged: number }>(ana, 'POST', `/nutrition/meal-plans/${made.body.id}/days/${day.id}/log`, { day: today });
    expect(logged.body).toEqual({ logged: 2 });
    const entries = await api.db.collection('meal_entries').find({ userId: ana.id, day: today }).toArray();
    expect(entries.map((entry) => entry['slot']).sort()).toEqual(['breakfast', 'lunch']);
    expect(entries.every((entry) => !!entry['facts'])).toBe(true);
    // A line already in today's diary is not logged twice; once its meal is deleted it can be again.
    const line = { day: today, entryIds: [day.entries[1].id] };
    expect((await api.call<{ logged: number }>(ana, 'POST', `/nutrition/meal-plans/${made.body.id}/days/${day.id}/log`, line)).body).toEqual({ logged: 0 });
    await api.db.collection('meal_entries').deleteOne({ userId: ana.id, day: today, slot: 'lunch' });
    expect((await api.call<{ logged: number }>(ana, 'POST', `/nutrition/meal-plans/${made.body.id}/days/${day.id}/log`, line)).body).toEqual({ logged: 1 });

    // Editing keeps the plan; a food edited later changes the totals, because none are stored.
    await api.call(ana, 'PATCH', `/nutrition/foods/${ids.rice}`, { energyKcal: 100 });
    const reread = (await api.call<MealPlan[]>(ana, 'GET', '/nutrition/meal-plans')).body[0];
    expect(reread.days.map((d) => d.totals.energyKcal)).toEqual([400, 100]);
    expect((await api.call(ana, 'DELETE', `/nutrition/meal-plans/${made.body.id}`)).status).toBe(200);
    expect(await api.db.collection('meal_plans').countDocuments({ userId: ana.id })).toBe(0);
  });

  it('are shared day by day, and a reader keeps a plan of their own', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const ids = await library(ana);
    const plan = (await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', planOf(ids))).body;
    const source = { kind: 'mealPlan', mealPlanId: plan.id };
    const preview = await api.call<PostPreview>(ana, 'POST', '/posts/preview', { source });
    expect(preview.status).toBeLessThan(300);
    const posted = await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: 'My week', caption: '', audience: 'public', source, previewHash: preview.body.previewHash });
    expect(posted.status).toBe(201);

    const read = await api.call<FoodPost>(beka, 'GET', `/posts/${posted.body.id}`);
    expect(read.body).toMatchObject({ kind: 'mealPlan', days: ['Training day', 'Rest day'], itemCount: 3 });
    expect(read.body.items.map((item) => [item.name, item.dayIndex, item.slot, item.amount, item.group])).toEqual([
      ['Plan oats', 0, 'breakfast', 50, 'Plan porridge'],
      ['Plan rice', 0, 'lunch', 200, undefined],
      ['Plan rice', 1, 'dinner', 100, undefined],
    ]);
    // Only foods, amounts, meals and day names leave: not the author's ids or the description.
    const text = JSON.stringify(read.body);
    for (const secret of [ids.oats, ids.rice, ids.recipe, plan.id, 'Two kinds of day']) expect(text).not.toContain(secret);

    const keys = read.body.items.map((item) => item.key);
    // A plan is copied whole.
    expect((await api.call(beka, 'POST', `/posts/${posted.body.id}/import`, { itemKeys: keys.slice(0, 1), duplicatePolicy: 'copy', saveAsMeal: false, savePlan: true })).status).toBe(400);
    const saved = await api.call<PostImportResult>(beka, 'POST', `/posts/${posted.body.id}/import`, { itemKeys: keys, duplicatePolicy: 'copy', saveAsMeal: false, savePlan: true });
    expect(saved.status).toBeLessThan(300);
    expect(saved.body.mealPlanId).toBeTruthy();
    // Saving again makes no second plan.
    await api.call(beka, 'POST', `/posts/${posted.body.id}/import`, { itemKeys: keys, duplicatePolicy: 'copy', saveAsMeal: false, savePlan: true });
    const mine = (await api.call<MealPlan[]>(beka, 'GET', '/nutrition/meal-plans')).body;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ name: 'My week', complete: true });
    expect(mine[0].days.map((day) => [day.name, day.totals.energyKcal])).toEqual([['Training day', 460], ['Rest day', 130]]);
    // Nothing was logged for the reader.
    expect(await api.db.collection('meal_entries').countDocuments({ userId: beka.id })).toBe(0);
  });

  it('one is in use at a time: today follows its days in order, and its lines are logged one by one', async () => {
    const ana = await api.account('ana');
    const ids = await library(ana);
    const plan = (await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', planOf(ids))).body;
    const other = (await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', { ...planOf(ids), name: 'Other' })).body;
    type Active = { active: ActiveMealPlan | null };
    expect((await api.call<Active>(ana, 'GET', '/nutrition/meal-plans/active?today=2026-03-02')).body).toEqual({ active: null });

    const started = await api.call<Active>(ana, 'PUT', '/nutrition/meal-plans/active', { planId: plan.id, today: '2026-03-02' });
    expect(started.status).toBeLessThan(300);
    expect(started.body.active).toMatchObject({ planId: plan.id, since: '2026-03-02', chosen: false, day: { name: 'Training day', totals: { energyKcal: 460 }, loggedTotals: { energyKcal: 0 } } });
    expect(started.body.active?.day.lines.map((each) => [each.name, each.logged])).toEqual([['Plan porridge', false], ['Plan rice', false]]);
    const at = async (today: string) => (await api.call<Active>(ana, 'GET', `/nutrition/meal-plans/active?today=${today}`)).body.active;
    // The next day is the plan's next day, and then it starts again.
    expect([(await at('2026-03-03'))?.day.name, (await at('2026-03-04'))?.day.name]).toEqual(['Rest day', 'Training day']);

    // One line is logged; the plan knows from the diary, and forgets when the meal is deleted.
    const day = plan.days[0];
    await api.call(ana, 'POST', `/nutrition/meal-plans/${plan.id}/days/${day.id}/log`, { day: '2026-03-02', entryIds: [day.entries[0].id] });
    const after = await at('2026-03-02');
    expect(after?.day.lines.map((each) => each.logged)).toEqual([true, false]);
    expect(after?.day.loggedTotals.energyKcal).toBe(200);
    // Done on one day says nothing about the next time that plan day comes round.
    expect((await at('2026-03-04'))?.day.lines.map((each) => each.logged)).toEqual([false, false]);
    await api.db.collection('meal_entries').deleteMany({ userId: ana.id, day: '2026-03-02' });
    expect((await at('2026-03-02'))?.day.lines.map((each) => each.logged)).toEqual([false, false]);
    // Where a meal came from is never taken from a request.
    await api.call(ana, 'POST', '/nutrition/entries', { day: '2026-03-02', slot: 'lunch', foodId: ids.rice, amount: 200, planEntryId: day.entries[1].id });
    expect((await at('2026-03-02'))?.day.lines.map((each) => each.logged)).toEqual([false, false]);

    // Another day can be picked for today only.
    const picked = await api.call<Active>(ana, 'PUT', '/nutrition/meal-plans/active/day', { today: '2026-03-02', dayId: plan.days[1].id });
    expect(picked.body.active).toMatchObject({ chosen: true, day: { name: 'Rest day' } });
    expect((await at('2026-03-03'))?.day.name).toBe('Rest day');
    expect((await at('2026-03-04'))?.day.name).toBe('Training day');
    expect((await api.call(ana, 'PUT', '/nutrition/meal-plans/active/day', { today: '2026-03-02', dayId: 'nope' })).status).toBe(404);

    // Using another plan stops the first; using the one in use keeps its start day.
    await api.call(ana, 'PUT', '/nutrition/meal-plans/active', { planId: other.id, today: '2026-03-05' });
    await api.call(ana, 'PUT', '/nutrition/meal-plans/active', { planId: other.id, today: '2026-03-09' });
    expect(await at('2026-03-09')).toMatchObject({ planId: other.id, since: '2026-03-05' });
    expect(await api.db.collection('meal_plans').countDocuments({ userId: ana.id, activeSince: { $exists: true } })).toBe(1);
    const mine = (await api.call<MealPlan[]>(ana, 'GET', '/nutrition/meal-plans')).body;
    expect(mine.map((each) => [each.name, each.activeSince])).toEqual([['Lean week', undefined], ['Other', '2026-03-05']]);
    // Stopping.
    expect((await api.call<Active>(ana, 'PUT', '/nutrition/meal-plans/active', { planId: null, today: '2026-03-09' })).body).toEqual({ active: null });

    // A page has no diary, so it has no plan in use.
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Using', username: `using-${randomUUID().slice(0, 6)}`, bio: '' })).body;
    expect((await api.call(ana, 'GET', '/nutrition/meal-plans/active?today=2026-03-09', undefined, as(page.id))).status).toBe(403);
    expect((await api.call(ana, 'PUT', '/nutrition/meal-plans/active', { planId: plan.id, today: '2026-03-09' }, as(page.id))).status).toBe(403);
  });

  it('are kept and posted by a page, which can never log one', async () => {
    const ana = await api.account('ana');
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Plans', username: `plans-${randomUUID().slice(0, 6)}`, bio: '' })).body;
    const ids = await library(ana, as(page.id));
    const plan = await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', planOf(ids), as(page.id));
    expect(plan.status).toBeLessThan(300);
    expect((await api.call<MealPlan[]>(ana, 'GET', '/nutrition/meal-plans', undefined, as(page.id))).body).toHaveLength(1);
    // The page's plans are not its manager's.
    expect((await api.call<MealPlan[]>(ana, 'GET', '/nutrition/meal-plans')).body).toEqual([]);
    const refused = await api.call<{ code?: string }>(ana, 'POST', `/nutrition/meal-plans/${plan.body.id}/days/${plan.body.days[0].id}/log`, { day: today }, as(page.id));
    expect([refused.status, refused.body.code]).toEqual([403, 'NOT_FOR_PAGES']);
    const source = { kind: 'mealPlan', mealPlanId: plan.body.id };
    const preview = await api.call<PostPreview>(ana, 'POST', '/posts/preview', { source }, as(page.id));
    const posted = await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: 'A week', caption: '', audience: 'public', source, previewHash: preview.body.previewHash }, as(page.id));
    expect(posted.status).toBe(201);
    expect(posted.body.author).toMatchObject({ userId: page.id, isPage: true });
  });
});
