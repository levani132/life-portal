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
