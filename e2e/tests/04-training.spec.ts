import { randomUUID } from 'node:crypto';
import { account, call, expect, signIn, snap, test, today } from '../support';

test('training opens, and a workout started today shows its exercises', async ({ page }) => {
  const ana = await account('Ana');
  await signIn(page, ana);
  await page.goto('/training');
  await expect(page.locator('main').first()).toBeVisible();
  await snap(page, '04-training');

  // A fresh database has no catalogue: the account makes its own exercises.
  const names = ['E2E bench press', 'E2E row'];
  const list: { id: string; name: string }[] = [];
  for (const name of names)
    list.push(await call<{ id: string; name: string }>(ana, 'POST', '/training/exercises', { name, primaryMuscles: ['chest'], equipmentType: 'barbell', measure: 'weight_reps' }));
  const session = await call<{ id: string }>(ana, 'POST', '/training/sessions', { requestId: randomUUID(), day: today() });
  for (const exercise of list) await call(ana, 'POST', `/training/sessions/${session.id}/exercises`, { requestId: randomUUID(), exerciseId: exercise.id });
  await page.reload();
  await expect(page.getByText(list[0].name).first()).toBeVisible();
  await snap(page, '04-workout');
});
