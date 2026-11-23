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

  it('are followed several at a time: days run in order, a pick re-anchors them, and the diary is matched on read', async () => {
    const ana = await api.account('ana');
    const ids = await library(ana);
    const plan = (await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', planOf(ids))).body;
    const other = (await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', { ...planOf(ids), name: 'Other' })).body;
    type Following = { following: ActiveMealPlan[] };
    const list = async (day: string, today = '2026-03-02') => (await api.call<Following>(ana, 'GET', `/nutrition/meal-plans/following?today=${today}&day=${day}`)).body.following;
    const at = async (day: string, today = '2026-03-02') => (await list(day, today)).find((each) => each.planId === plan.id);
    expect(await list('2026-03-02')).toEqual([]);

    const started = await api.call<Following>(ana, 'PUT', `/nutrition/meal-plans/${plan.id}/follow`, { today: '2026-03-02' });
    expect(started.status).toBeLessThan(300);
    expect(started.body.following[0]).toMatchObject({ planId: plan.id, since: '2026-03-02', calendarDay: '2026-03-02', chosen: false, rules: [], day: { name: 'Training day', totals: { energyKcal: 460 } } });
    expect(started.body.following[0].recent.map((each) => each.day)).toEqual(['2026-02-24', '2026-02-25', '2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    // The order runs forwards and, for comparing, backwards from the start.
    expect([(await at('2026-03-03'))?.day.name, (await at('2026-03-04'))?.day.name, (await at('2026-03-01'))?.day.name]).toEqual(['Rest day', 'Training day', 'Rest day']);

    // Rice eaten the day before, logged by hand before the plan was followed, counts for that day.
    await api.call(ana, 'POST', '/nutrition/entries', { day: '2026-03-01', slot: 'dinner', foodId: ids.rice, amount: 120 });
    expect((await at('2026-03-01'))?.day.lines.map((each) => each.logged)).toEqual([true]);
    expect((await at('2026-03-02'))?.recent.find((each) => each.day === '2026-03-01')).toMatchObject({ dayName: 'Rest day', planned: 1, followed: 1, plannedKcal: 130, eatenKcal: 156 });

    // Today: the porridge from the plan's button; then the rice, logged by hand, also counts.
    const day = plan.days[0];
    await api.call(ana, 'POST', `/nutrition/meal-plans/${plan.id}/days/${day.id}/log`, { day: '2026-03-02', entryIds: [day.entries[0].id] });
    expect((await at('2026-03-02'))?.day.lines.map((each) => each.logged)).toEqual([true, false]);
    await api.call(ana, 'POST', '/nutrition/entries', { day: '2026-03-02', slot: 'lunch', foodId: ids.rice, amount: 180 });
    expect((await at('2026-03-02'))?.day.lines.map((each) => each.logged)).toEqual([true, true]);
    expect((await api.call<{ logged: number }>(ana, 'POST', `/nutrition/meal-plans/${plan.id}/days/${day.id}/log`, { day: '2026-03-02' })).body).toEqual({ logged: 0 });
    // A meal's origin is never taken from a request.
    expect((await api.call(ana, 'POST', '/nutrition/entries', { day: '2026-03-02', slot: 'lunch', foodId: ids.rice, amount: 10, planEntryId: 'x' })).status).toBe(400);

    // Picking a day re-anchors the order from there; earlier days keep theirs.
    const picked = await api.call<Following>(ana, 'PUT', `/nutrition/meal-plans/${plan.id}/day`, { day: '2026-03-03', dayId: plan.days[0].id });
    expect(picked.body.following[0]).toMatchObject({ calendarDay: '2026-03-03', chosen: true, day: { name: 'Training day' } });
    expect([(await at('2026-03-02'))?.day.name, (await at('2026-03-04'))?.day.name, (await at('2026-03-05'))?.day.name]).toEqual(['Training day', 'Rest day', 'Training day']);
    expect((await api.call(ana, 'PUT', `/nutrition/meal-plans/${plan.id}/day`, { day: '2026-03-02', dayId: 'nope' })).status).toBe(404);

    // Following another keeps the first; following one again keeps its start day.
    await api.call(ana, 'PUT', `/nutrition/meal-plans/${other.id}/follow`, { today: '2026-03-05' });
    await api.call(ana, 'PUT', `/nutrition/meal-plans/${other.id}/follow`, { today: '2026-03-09' });
    expect((await list('2026-03-09', '2026-03-09')).map((each) => [each.name, each.since])).toEqual([['Lean week', '2026-03-02'], ['Other', '2026-03-05']]);
    // Stopping one leaves it in the list, to follow again.
    expect((await api.call<Following>(ana, 'DELETE', `/nutrition/meal-plans/${plan.id}/follow?today=2026-03-09`)).body.following.map((each) => each.name)).toEqual(['Other']);
    const mine = (await api.call<MealPlan[]>(ana, 'GET', '/nutrition/meal-plans')).body;
    expect(mine.map((each) => [each.name, each.activeSince])).toEqual([['Lean week', undefined], ['Other', '2026-03-05']]);

    // A page has no diary, so it follows nothing.
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Using', username: `using-${randomUUID().slice(0, 6)}`, bio: '' })).body;
    expect((await api.call(ana, 'GET', '/nutrition/meal-plans/following?today=2026-03-09', undefined, as(page.id))).status).toBe(403);
    expect((await api.call(ana, 'PUT', `/nutrition/meal-plans/${plan.id}/follow`, { today: '2026-03-09' }, as(page.id))).status).toBe(403);
  });

  it('may be rules alone, rules for one day, shared and followed with who recommended them (spec 043)', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const ids = await library(ana);
    const protein = { metric: 'protein', scope: 'day', kind: 'atLeast', basis: 'perKgTarget', value: 1800 };
    const ceiling = { metric: 'energy', scope: 'day', kind: 'atMost', basis: 'amount', value: 2000 };
    const rulesOnly = await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', { name: 'High protein', rules: [protein, ceiling], days: [] });
    expect(rulesOnly.status).toBeLessThan(300);
    expect(rulesOnly.body).toMatchObject({ days: [], complete: true, rules: [{ ...protein }, { ...ceiling }] });
    expect(rulesOnly.body.rules.every((rule) => !!rule.id)).toBe(true);
    // Refused: a rule that means nothing, or a plan with nothing in it.
    expect((await api.call(ana, 'POST', '/nutrition/meal-plans', { name: 'Bad', rules: [{ ...protein, kind: 'between' }], days: [] })).status).toBe(400);
    expect((await api.call(ana, 'POST', '/nutrition/meal-plans', { name: 'Empty', rules: [], days: [] })).status).toBe(400);
    expect((await api.call(ana, 'POST', '/nutrition/meal-plans', { name: 'Odd', rules: [{ ...protein, metric: 'sugar' }], days: [] })).status).toBe(400);

    // A day may have its own rules, on top of the plan's.
    const dayRule = { metric: 'carb', scope: 'day', kind: 'atLeast', basis: 'amount', value: 250_000 };
    const mixed = (await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', { ...planOf(ids), rules: [ceiling], days: [{ ...planOf(ids).days[0], rules: [dayRule] }, planOf(ids).days[1]] })).body;
    await api.call(ana, 'PUT', `/nutrition/meal-plans/${mixed.id}/follow`, { today: '2026-05-01' });
    const followed = async (day: string) => (await api.call<{ following: ActiveMealPlan[] }>(ana, 'GET', `/nutrition/meal-plans/following?today=2026-05-01&day=${day}`)).body.following[0];
    expect((await followed('2026-05-01')).rules.map((rule) => rule.metric)).toEqual(['energy', 'carb']);
    expect((await followed('2026-05-02')).rules.map((rule) => rule.metric)).toEqual(['energy']);

    // Shared: a plan of rules alone travels as its rules, and the reader follows their copy.
    const source = { kind: 'mealPlan', mealPlanId: rulesOnly.body.id };
    const preview = await api.call<PostPreview>(ana, 'POST', '/posts/preview', { source });
    expect(preview.status).toBeLessThan(300);
    const posted = await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: 'High protein', caption: '', audience: 'public', source, previewHash: preview.body.previewHash });
    expect(posted.status).toBe(201);
    const read = await api.call<FoodPost>(beka, 'GET', `/posts/${posted.body.id}`);
    expect(read.body).toMatchObject({ kind: 'mealPlan', itemCount: 0, planRules: { plan: [{ ...protein }, { ...ceiling }], days: [] } });
    expect(JSON.stringify(read.body.planRules)).not.toContain(rulesOnly.body.rules[0].id);
    const saved = await api.call<PostImportResult>(beka, 'POST', `/posts/${posted.body.id}/import`, { itemKeys: [], duplicatePolicy: 'skip', saveAsMeal: false, savePlan: true });
    expect(saved.status).toBeLessThan(300);
    const copy = (await api.call<MealPlan[]>(beka, 'GET', '/nutrition/meal-plans')).body.find((each) => each.id === saved.body.mealPlanId);
    expect(copy).toMatchObject({ name: 'High protein', days: [], rules: [{ ...protein }, { ...ceiling }], source: { postId: posted.body.id, authorId: ana.id } });
    // A plan of rules alone is followed every day, with no plan day.
    await api.call(beka, 'PUT', `/nutrition/meal-plans/${saved.body.mealPlanId}/follow`, { today: '2026-05-01' });
    const theirs = (await api.call<{ following: ActiveMealPlan[] }>(beka, 'GET', '/nutrition/meal-plans/following?today=2026-05-01')).body.following[0];
    expect(theirs).toMatchObject({ days: [], day: { lines: [] }, source: { authorId: ana.id } });
    expect(theirs.rules).toHaveLength(2);
    // An empty selection is still refused for anything but a plan of rules.
    expect((await api.call(beka, 'POST', `/posts/${posted.body.id}/import`, { itemKeys: [], duplicatePolicy: 'skip', saveAsMeal: false })).status).toBe(400);
  });

  it('lets a line have options, any of which meets it, logged by choice and shared whole (spec 043)', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const ids = await library(ana);
    const pork = (await api.call<{ id: string }>(ana, 'POST', '/nutrition/foods', food('Plan pork', 200))).body.id;
    const made = await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', {
      name: 'Options',
      days: [{ name: 'Any day', entries: [{ slot: 'lunch', foodId: ids.rice, amount: 200, options: [{ foodId: pork, amount: 150 }, { savedMealId: ids.recipe }] }] }],
    });
    expect(made.status).toBeLessThan(300);
    const line = made.body.days[0].entries[0];
    expect([line.name, line.options?.map((option) => [option.name, option.totals.energyKcal])]).toEqual(['Plan rice', [['Plan pork', 300], ['Plan porridge', 200]]]);
    // The day counts the first option.
    expect(made.body.days[0].totals.energyKcal).toBe(260);
    // Someone else's food is refused as an option too.
    const others = await library(beka);
    expect((await api.call(ana, 'POST', '/nutrition/meal-plans', { name: 'X', days: [{ name: 'D', entries: [{ slot: 'lunch', foodId: ids.rice, amount: 1, options: [{ foodId: others.rice, amount: 1 }] }] }] })).status).toBe(400);

    // Logging the second option, then the line is met, and logging again adds nothing.
    await api.call(ana, 'PUT', `/nutrition/meal-plans/${made.body.id}/follow`, { today: '2026-06-01' });
    const log = (body: Record<string, unknown>) => api.call<{ logged: number }>(ana, 'POST', `/nutrition/meal-plans/${made.body.id}/days/${made.body.days[0].id}/log`, { day: '2026-06-01', entryIds: [line.id], ...body });
    expect((await log({ choice: 9 })).status).toBe(400);
    expect((await log({ choice: 1 })).body).toEqual({ logged: 1 });
    expect((await api.db.collection('meal_entries').findOne({ userId: ana.id, day: '2026-06-01' }))?.['foodId']).toBe(pork);
    const followed = (await api.call<{ following: ActiveMealPlan[] }>(ana, 'GET', '/nutrition/meal-plans/following?today=2026-06-01')).body.following[0];
    expect(followed.day.lines[0].logged).toBe(true);
    expect((await log({ choice: 2 })).body).toEqual({ logged: 0 });

    // Shared, the options travel and the reader's copy has them, a recipe option as their own recipe.
    const source = { kind: 'mealPlan', mealPlanId: made.body.id };
    const preview = await api.call<PostPreview>(ana, 'POST', '/posts/preview', { source });
    const posted = await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: 'Options', caption: '', audience: 'public', source, previewHash: preview.body.previewHash });
    const read = await api.call<FoodPost>(beka, 'GET', `/posts/${posted.body.id}`);
    expect(read.body.items.map((item) => [item.name, item.line, item.choice])).toEqual([['Plan rice', 0, 0], ['Plan pork', 0, 1], ['Plan oats', 0, 2]]);
    const saved = await api.call<PostImportResult>(beka, 'POST', `/posts/${posted.body.id}/import`, { itemKeys: read.body.items.map((item) => item.key), duplicatePolicy: 'copy', saveAsMeal: false, savePlan: true });
    expect(saved.status).toBeLessThan(300);
    const copy = (await api.call<MealPlan[]>(beka, 'GET', '/nutrition/meal-plans')).body.find((each) => each.id === saved.body.mealPlanId);
    expect(copy?.days[0].entries).toHaveLength(1);
    const copied = copy?.days[0].entries[0];
    expect([copied?.name, copied?.options?.map((option) => option.name)]).toEqual(['Plan rice', ['Plan pork', 'Plan porridge']]);
    expect(copied?.options?.[1].savedMealId).toBeTruthy();
  });

  it('lets followed plans’ daily rules replace the app’s targets everywhere (spec 043, slice 2)', async () => {
    const ana = await api.account('ana');
    // Enough for the app to work out its own targets.
    await api.call(ana, 'PUT', '/nutrition/profile', { sex: 'male', heightCm: 180, birthDate: '1990-01-01', goal: 'maintain' });
    await api.call(ana, 'PUT', '/nutrition/weigh-ins?today=2026-07-02', { day: '2026-07-01', weightGrams: 80_000 });
    type Targets = { targets: { energyKcal?: { value: number; recorded?: true; basis?: string }; proteinG?: { value: number }; carbG?: { value: number; basis?: string }; plan?: { rules: { metric: string; planNames: string[] }[]; app: { energyKcal?: number }; carbFromRest?: boolean } } };
    const targets = async () => (await api.call<Targets>(ana, 'GET', '/nutrition/profile?today=2026-07-02')).body.targets;
    const before = await targets();
    expect(before.plan).toBeUndefined();
    const appKcal = before.energyKcal?.value as number;
    expect(appKcal).toBeGreaterThan(0);

    const plan = (
      await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', {
        name: 'Cut',
        rules: [
          { metric: 'energy', scope: 'day', kind: 'atMost', basis: 'amount', value: 1900 },
          { metric: 'protein', scope: 'day', kind: 'atLeast', basis: 'perKg', value: 2000 },
          { metric: 'protein', scope: 'breakfast', kind: 'atLeast', basis: 'amount', value: 30_000 },
        ],
        days: [],
      })
    ).body;
    await api.call(ana, 'PUT', `/nutrition/meal-plans/${plan.id}/follow`, { today: '2026-07-02' });
    const after = await targets();
    expect(after.energyKcal).toEqual({ value: 1900, recorded: true });
    // 2 g per kg of the 80 kg weigh-in: an estimate, because it rests on the weigh-in.
    expect(after.proteinG?.value).toBe(160);
    expect(after.carbG?.basis).toMatch(/calories left/);
    expect(after.plan).toMatchObject({ app: { energyKcal: Math.round(appKcal) }, carbFromRest: true });
    expect(after.plan?.rules.map((rule) => [rule.metric, rule.planNames])).toEqual([['energy', ['Cut']], ['protein', ['Cut']]]);

    // The same numbers on Home and in Food.
    const summary = (await api.call<{ targetKcal?: number; proteinTargetG?: number; fromPlans?: string[] }>(ana, 'GET', '/nutrition/summary?today=2026-07-02')).body;
    expect(summary).toMatchObject({ targetKcal: 1900, proteinTargetG: 160, fromPlans: ['Cut'] });
    const overview = (await api.call<{ targets: { energyKcal?: { value: number } } }>(ana, 'GET', '/nutrition?today=2026-07-02')).body;
    expect(overview.targets.energyKcal?.value).toBe(1900);

    // Stopping goes back to the app's own.
    await api.call(ana, 'DELETE', `/nutrition/meal-plans/${plan.id}/follow?today=2026-07-02`);
    expect((await targets()).energyKcal?.value).toBe(appKcal);
  });

  it('keeps a target weight on the profile', async () => {
    const ana = await api.account('ana');
    expect((await api.call(ana, 'PUT', '/nutrition/profile', { targetWeightGrams: 75_000 })).status).toBeLessThan(300);
    expect((await api.call<{ profile: { targetWeightGrams?: number } }>(ana, 'GET', '/nutrition/profile')).body.profile.targetWeightGrams).toBe(75_000);
    expect((await api.call(ana, 'PUT', '/nutrition/profile', { targetWeightGrams: 5 })).status).toBe(400);
    await api.call(ana, 'PUT', '/nutrition/profile', { targetWeightGrams: null });
    expect((await api.call<{ profile: { targetWeightGrams?: number } }>(ana, 'GET', '/nutrition/profile')).body.profile.targetWeightGrams).toBeUndefined();
  });

  it('lets a reader use their own foods of the same name instead of copies', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const ids = await library(ana);
    const plan = (await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', planOf(ids))).body;
    const source = { kind: 'mealPlan', mealPlanId: plan.id };
    const preview = await api.call<PostPreview>(ana, 'POST', '/posts/preview', { source });
    const posted = await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: 'Mine', caption: '', audience: 'public', source, previewHash: preview.body.previewHash });
    // Beka already logs rice of their own, with other numbers.
    const own = (await api.call<{ id: string }>(beka, 'POST', '/nutrition/foods', food('plan RICE', 150))).body.id;
    const check = await api.call<{ items: { key: string; duplicateName?: string }[] }>(beka, 'GET', `/posts/${posted.body.id}/import`);
    expect(check.body.items.map((item) => item.duplicateName)).toEqual([undefined, 'plan RICE', 'plan RICE']);

    const keys = check.body.items.map((item) => item.key);
    const saved = await api.call<PostImportResult>(beka, 'POST', `/posts/${posted.body.id}/import`, { itemKeys: keys, duplicatePolicy: 'skip', saveAsMeal: false, savePlan: true });
    expect(saved.status).toBeLessThan(300);
    const mine = (await api.call<MealPlan[]>(beka, 'GET', '/nutrition/meal-plans')).body.find((each) => each.id === saved.body.mealPlanId);
    // Both rice lines are Beka's own rice, with Beka's numbers; only the oats were copied.
    expect(mine?.days.flatMap((day) => day.entries.map((entry) => entry.foodId)).filter((id) => id === own)).toHaveLength(2);
    expect(mine?.days.map((day) => day.totals.energyKcal)).toEqual([200 + 300, 150]);
    expect(await api.db.collection('foods').countDocuments({ userId: beka.id })).toBe(2);
  });

  it('lets a line be eaten at more than one meal, logged into the meal chosen', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const ids = await library(ana);
    const plan = await api.call<MealPlan>(ana, 'POST', '/nutrition/meal-plans', {
      name: 'Loose',
      days: [{ name: 'Any day', entries: [{ slot: 'lunch', slots: ['lunch', 'dinner'], foodId: ids.rice, amount: 200 }, { slot: 'snack', slots: ['breakfast', 'lunch', 'dinner', 'snack'], foodId: ids.oats, amount: 40 }] }],
    });
    expect(plan.status).toBeLessThan(300);
    const [rice, oats] = plan.body.days[0].entries;
    expect([rice.slot, rice.slots, oats.slot]).toEqual(['lunch', ['lunch', 'dinner'], 'breakfast']);
    const log = (body: Record<string, unknown>) => api.call<{ logged: number }>(ana, 'POST', `/nutrition/meal-plans/${plan.body.id}/days/${plan.body.days[0].id}/log`, { day: '2026-04-01', ...body });
    // Not a meal it is planned for.
    expect((await log({ entryIds: [rice.id], slot: 'breakfast' })).status).toBe(400);
    expect((await log({ entryIds: [rice.id], slot: 'dinner' })).body).toEqual({ logged: 1 });
    const entry = await api.db.collection('meal_entries').findOne({ userId: ana.id, day: '2026-04-01' });
    expect([entry?.['slot'], entry?.['planEntryId']]).toEqual(['dinner', rice.id]);

    // Shared, the choice of meals goes with it.
    const source = { kind: 'mealPlan', mealPlanId: plan.body.id };
    const preview = await api.call<PostPreview>(ana, 'POST', '/posts/preview', { source });
    const posted = await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: 'Loose', caption: '', audience: 'public', source, previewHash: preview.body.previewHash });
    const read = await api.call<FoodPost>(beka, 'GET', `/posts/${posted.body.id}`);
    expect(read.body.items.map((item) => item.slots)).toEqual([['lunch', 'dinner'], ['breakfast', 'lunch', 'dinner', 'snack']]);
    const saved = await api.call<PostImportResult>(beka, 'POST', `/posts/${posted.body.id}/import`, { itemKeys: read.body.items.map((item) => item.key), duplicatePolicy: 'copy', saveAsMeal: false, savePlan: true });
    const copy = (await api.call<MealPlan[]>(beka, 'GET', '/nutrition/meal-plans')).body.find((each) => each.id === saved.body.mealPlanId);
    expect(copy?.days[0].entries.map((each) => each.slots)).toEqual([['lunch', 'dinner'], ['breakfast', 'lunch', 'dinner', 'snack']]);
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
