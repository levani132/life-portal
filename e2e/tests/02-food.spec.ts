import { randomUUID } from 'node:crypto';
import { account, call, expect, signIn, snap, test, today } from '../support';

const food = (name: string, kcal: number, protein: number) => ({
  name,
  unit: 'g',
  servingSize: 100,
  entryMode: 'per_100',
  energyKcal: kcal,
  proteinMg: protein * 1000,
  fatMg: 5_000,
  carbMg: 20_000,
});

test('logs a recipe in portions and shows it as one row that opens to its foods', async ({ page }) => {
  const ana = await account('Ana');
  const rice = await call<{ id: string }>(ana, 'POST', '/nutrition/foods', food('E2E rice', 130, 3));
  const chicken = await call<{ id: string }>(ana, 'POST', '/nutrition/foods', food('E2E chicken', 165, 31));
  await call(ana, 'POST', '/nutrition/meals', {
    name: 'E2E rice bowl',
    servings: 2,
    defaultSlot: 'lunch',
    components: [
      { foodId: rice.id, amount: 300 },
      { foodId: chicken.id, amount: 300 },
    ],
  });
  // One plain food logged too, so the meal has a row of each kind.
  await call(ana, 'POST', '/nutrition/entries', { id: undefined, day: today(), slot: 'breakfast', foodId: rice.id, amount: 150 });

  await signIn(page, ana);
  await page.goto('/nutrition');
  await expect(page.getByRole('heading', { name: 'Breakfast' })).toBeVisible();
  await snap(page, '02-food-day');

  // Log it again → the recipe → one and a half servings.
  const row = page.locator('li', { hasText: 'E2E rice bowl' }).filter({ has: page.getByRole('button', { name: 'Log' }) });
  await row.scrollIntoViewIfNeeded();
  await row.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '1½' }).click();
  await snap(page, '02-recipe-sheet');
  await page.getByRole('button', { name: 'Log it' }).click();

  // One row for the recipe in Lunch; it opens to its two foods.
  const group = page.getByRole('button', { name: /E2E rice bowl/ }).first();
  await group.scrollIntoViewIfNeeded();
  await expect(group).toContainText('1½ servings');
  await expect(group).toContainText('2 foods');
  await group.click();
  await expect(page.getByText('E2E chicken').first()).toBeVisible();
  await snap(page, '02-recipe-row-open');
});

test('makes a recipe with a new food from inside the recipe editor', async ({ page }) => {
  const ana = await account('Ana');
  await signIn(page, ana);
  await page.goto('/nutrition');
  // The Foods view holds the recipes.
  await page.getByRole('tab', { name: 'Foods' }).click();
  await page.getByRole('button', { name: /new recipe/i }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Name').first().fill(`E2E soup ${randomUUID().slice(0, 4)}`);
  await snap(page, '02-recipe-editor');
});
