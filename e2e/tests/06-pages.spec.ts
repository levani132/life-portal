import { randomUUID } from 'node:crypto';
import { account, call, expect, signIn, snap, test } from '../support';

test('a person sees their pages and can open one’s library', async ({ page }) => {
  const ana = await account('Ana');
  const made = await call<{ id: string; name: string }>(ana, 'POST', '/pages', { name: 'E2E Kitchen', username: `e2e-kitchen-${randomUUID().slice(0, 6)}`, bio: 'Recipes to save.' });
  await call(ana, 'POST', '/nutrition/foods', { name: 'E2E page food', unit: 'g', servingSize: 100, entryMode: 'per_100', energyKcal: 100, proteinMg: 5000, fatMg: 1000, carbMg: 10_000 }, { 'x-lp-act-as': made.id });

  await signIn(page, ana);
  await page.goto('/settings/pages');
  await expect(page.getByText('E2E Kitchen').first()).toBeVisible();
  await snap(page, '06-pages');
});

test('holding the profile tab opens "Using the app as"', async ({ page }) => {
  const ana = await account('Ana');
  await call<{ id: string }>(ana, 'POST', '/pages', { name: 'E2E Bakery', username: `e2e-bakery-${randomUUID().slice(0, 6)}`, bio: '' });
  await signIn(page, ana);
  await page.goto('/');
  const tab = page.getByRole('navigation').getByRole('link', { name: /profile/i });
  const box = await tab.boundingBox();
  if (!box) throw new Error('No profile tab');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  const sheet = page.getByRole('dialog', { name: 'Using the app as' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('E2E Bakery').first()).toBeVisible();
  // The tab did not open: the long press only opened the sheet.
  await expect(page).toHaveURL(/localhost:4200\/(\?.*)?$/);
  await snap(page, '06-identity-sheet');
});
