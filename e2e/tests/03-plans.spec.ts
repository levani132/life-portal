import { account, call, expect, signIn, snap, test, today } from '../support';

test('a followed plan of rules shows on the tiles and in each meal', async ({ page }) => {
  const ana = await account('Ana');
  const egg = await call<{ id: string }>(ana, 'POST', '/nutrition/foods', {
    name: 'E2E eggs',
    unit: 'g',
    servingSize: 100,
    entryMode: 'per_100',
    energyKcal: 143,
    proteinMg: 13_000,
    fatMg: 10_000,
    carbMg: 1_000,
  });
  const plan = await call<{ id: string }>(ana, 'POST', '/nutrition/meal-plans', {
    name: 'E2E high protein',
    rules: [
      { metric: 'protein', scope: 'day', kind: 'atLeast', basis: 'amount', value: 150_000 },
      { metric: 'energy', scope: 'day', kind: 'atMost', basis: 'amount', value: 2200 },
      { metric: 'protein', scope: 'breakfast', kind: 'atLeast', basis: 'amount', value: 30_000 },
    ],
    days: [{ name: 'Every day', entries: [{ slot: 'lunch', foodId: egg.id, amount: 200, options: [{ foodId: egg.id, amount: 150 }] }] }],
  });
  await call(ana, 'PUT', `/nutrition/meal-plans/${plan.id}/follow`, { today: today() });
  await call(ana, 'POST', '/nutrition/entries', { day: today(), slot: 'breakfast', foodId: egg.id, amount: 100 });

  await signIn(page, ana);
  await page.goto('/nutrition');
  // The daily rules replace the targets on the tiles, with their limits.
  await expect(page.getByText('≥ 150').first()).toBeVisible();
  await expect(page.getByText('≤ 2,200').first()).toBeVisible();
  // The plan is followed, and Breakfast carries its rule.
  await expect(page.getByRole('button', { name: 'E2E high protein' })).toBeVisible();
  await expect(page.getByLabel('Plan rules for this meal').first()).toBeVisible();
  await snap(page, '03-plan-tiles');

  // Lunch has the planned food, with its "or" option, each with Log.
  const planned = page.getByLabel('Planned').first();
  await planned.scrollIntoViewIfNeeded();
  await expect(planned.getByText('or', { exact: true }).first()).toBeVisible();
  await snap(page, '03-plan-planned-lines');

  // Food → You lists where the targets come from.
  await page.getByRole('tab', { name: 'You' }).click();
  await expect(page.getByText('From plans you follow')).toBeVisible();
  await snap(page, '03-plan-you');
});

test('the plan editor writes rules as sentences', async ({ page }) => {
  const ana = await account('Ana');
  await signIn(page, ana);
  await page.goto('/nutrition');
  await page.getByRole('tab', { name: 'Foods' }).click();
  await page.getByRole('button', { name: /new meal plan/i }).click();
  await page.getByRole('button', { name: '+ Protein per kg' }).click();
  await expect(page.getByText('At least 1.8 g protein per kg a day')).toBeVisible();
  await snap(page, '03-plan-editor');
});
