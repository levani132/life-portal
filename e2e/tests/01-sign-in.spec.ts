import { account, db, expect, signIn, snap, test } from '../support';

test('signs in through the form and lands on Home', async ({ page }) => {
  const ana = await account('Ana');
  await page.goto('/login');
  await snap(page, '01-login');
  await page.getByLabel('Email').fill(ana.email);
  await page.getByLabel('Password').fill(ana.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/localhost:4200\/(\?.*)?$/);
  // The tab bar is the app's own chrome: if it shows, the shell loaded.
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await snap(page, '01-home');
});

test('onboarding shows no tab bar', async ({ page }) => {
  const ana = await account('Ana');
  // A new person who has not finished or skipped setup.
  await (await db()).collection('user_settings').updateOne({ userId: ana.id }, { $set: { setupDismissed: false } });
  await signIn(page, ana);
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
  await snap(page, '01-setup');
});
