import { randomUUID } from 'node:crypto';
import { account, call, expect, signIn, snap, test, today } from '../support';

test('training opens, and a workout started today shows its exercises', async ({ page }) => {
  const ana = await account('Ana');
  await signIn(page, ana);
  await page.goto('/training');
  await expect(page.locator('main').first()).toBeVisible();
  await snap(page, '04-training');

  const exercises = await call<{ items?: { id: string; name: string }[] } | { id: string; name: string }[]>(ana, 'GET', '/training/exercises');
  const list = Array.isArray(exercises) ? exercises : (exercises.items ?? []);
  const session = await call<{ id: string }>(ana, 'POST', '/training/sessions', { requestId: randomUUID(), day: today() });
  for (const exercise of list.slice(0, 2)) await call(ana, 'POST', `/training/sessions/${session.id}/exercises`, { exerciseId: exercise.id });
  await page.reload();
  await expect(page.getByText(list[0].name).first()).toBeVisible();
  await snap(page, '04-workout');
});
