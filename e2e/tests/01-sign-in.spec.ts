import { account, expect, snap, test } from '../support';

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
