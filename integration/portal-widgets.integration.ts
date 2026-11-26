/**
 * Spec 046, slice 2: Food on a portal, each part only behind its own switch, with the week; and
 * the portal's own arrangement, separate from Home's.
 */
import { randomUUID } from 'node:crypto';
import type { PublicPortal } from '@life-portal/shared-types';
import { startApi, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const today = new Date().toISOString().slice(0, 10);

describe('a portal’s widgets', () => {
  it('shows Food part by part, as shared, and keeps its own arrangement', async () => {
    const ana = await api.account('ana');
    const username = `w${randomUUID().slice(0, 8)}`;
    await api.call(ana, 'PUT', '/social/me', { username, displayName: 'Ana', bio: '', discoverable: true });
    await api.call(ana, 'PUT', '/nutrition/profile', { sex: 'female', heightCm: 165, birthDate: '1992-01-01', goal: 'maintain' });
    await api.call(ana, 'PUT', `/nutrition/weigh-ins?today=${today}`, { day: today, weightGrams: 62_000 });
    const food = await api.call<{ id: string }>(ana, 'POST', '/nutrition/foods', { name: 'Oats', unit: 'g', servingSize: 100, entryMode: 'per_100', energyKcal: 380, proteinMg: 13000, fatMg: 7000, carbMg: 60000 });
    expect((await api.call(ana, 'POST', '/nutrition/entries', { foodId: food.body.id, amount: 100, slot: 'breakfast', day: today })).status).toBeLessThan(300);
    expect((await api.call(ana, 'PUT', '/portal', { moduleVisibility: { nutrition: 'public' } })).status).toBe(200);

    const portal = async () => (await api.call<PublicPortal>(null, 'GET', `/public/portals/${username}?today=${today}`)).body;
    // Nothing shared inside Food yet: no Food widget at all.
    expect((await portal()).widgets).toEqual([]);

    // Meals only: today's totals and the week, no targets.
    await api.call(ana, 'PUT', '/nutrition/profile', { shareMeals: true });
    const meals = (await portal()).widgets.find((widget) => widget.module === 'nutrition');
    expect(meals?.food?.today).toMatchObject({ eatenKcal: 380, proteinG: 13 });
    expect(meals?.food?.week).toMatchObject({ daysLogged: 1, avgKcal: 380 });
    expect(meals?.food?.week?.days).toHaveLength(7);
    expect(meals?.food?.targets).toBeUndefined();
    expect(meals?.size).toBe('large');

    // Targets only: targets, and nothing about what was eaten.
    await api.call(ana, 'PUT', '/nutrition/profile', { shareMeals: false, shareTargets: true });
    const targets = (await portal()).widgets.find((widget) => widget.module === 'nutrition');
    expect(targets?.food?.targets?.kcal).toBeGreaterThan(0);
    expect(targets?.food?.today).toBeUndefined();
    expect(targets?.food?.week).toBeUndefined();

    // The portal's own arrangement: sizes are the portal's, not Home's.
    expect((await api.call(ana, 'PUT', '/portal/arrangement', { order: ['nutrition'], sizes: { nutrition: 'small' } })).status).toBe(200);
    expect((await portal()).widgets[0].size).toBe('small');
    const home = await api.call<{ widgetSizes?: Record<string, string>; portalSizes?: Record<string, string> }>(ana, 'GET', '/settings');
    expect(home.body.widgetSizes?.['nutrition']).toBeUndefined();
    expect((await api.call(ana, 'PUT', '/portal/arrangement', { order: ['nutrition'], sizes: { nutrition: 'huge' } })).status).toBe(400);
  });
});
