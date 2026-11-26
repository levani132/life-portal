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

test('Menu → Pages shows when the assistant will post', async ({ page }) => {
  const ana = await account('Ana');
  await call(ana, 'PUT', '/pages/assistant', { enabled: true });
  const { token } = await call<{ token: string }>(ana, 'POST', '/mcp/token');
  const tool = async (name: string, args: Record<string, unknown>) => {
    const response = await fetch('http://localhost:3333/api/mcp/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, tool: name, arguments: args }) });
    return (await response.json()) as { result: Record<string, unknown> };
  };
  const pageId = String((await tool('create_page', { name: 'E2E Robot Kitchen', username: `e2e-robot-${randomUUID().slice(0, 6)}` })).result['id']);
  const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
  await tool('create_page_post', { pageId, title: 'Greek yogurt and oat bowl', caption: 'A breakfast that keeps you full until lunch.', at: at(2) });
  await tool('create_page_post', { pageId, caption: 'Three mistakes people make with lentils, and the fix for each.', at: at(26) });
  await signIn(page, ana);
  await page.goto('/settings/pages');
  await expect(page.getByText('Coming up')).toBeVisible();
  await expect(page.getByText('Greek yogurt and oat bowl')).toBeVisible();
  await expect(page.getByText(/Three mistakes people make/)).toBeVisible();
  await page.getByText('Coming up').scrollIntoViewIfNeeded();
  await snap(page, '06-coming-up');
});

test('Menu starts with who you are, folded, and the menu right under it', async ({ page }) => {
  const ana = await account('Ana');
  await call(ana, 'POST', '/pages', { name: 'E2E Folded Page', username: `e2e-folded-${randomUUID().slice(0, 6)}`, bio: '' });
  await signIn(page, ana);
  await page.goto('/menu');
  const fold = page.getByRole('button', { name: /Using the app as/ });
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('E2E Folded Page')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Menu' })).toHaveCount(0);
  await snap(page, '06-menu-folded');
  await fold.click();
  await expect(page.getByText('E2E Folded Page').filter({ visible: true }).first()).toBeVisible();
});

test('a page’s insights show its posts with views and likes', async ({ page }) => {
  const ana = await account('Ana');
  const beka = await account('Beka');
  const made = await call<{ id: string }>(ana, 'POST', '/pages', { name: 'E2E Insights Kitchen', username: `e2e-ins-${randomUUID().slice(0, 6)}`, bio: '' });
  const post = await call<{ id: string }>(ana, 'POST', '/posts', { requestId: randomUUID(), title: 'Chicken and lentil bowl', caption: '', audience: 'public' }, { 'x-lp-act-as': made.id });
  await call(beka, 'POST', '/posts/views', { ids: [post.id] });
  await call(beka, 'PUT', `/posts/${post.id}/like`, {});
  await call(beka, 'PUT', `/follows/${made.id}`, {});
  await signIn(page, ana);
  await page.goto(`/settings/pages/${made.id}`);
  await expect(page.getByRole('heading', { name: 'Insights' })).toBeVisible();
  await expect(page.getByText('Chicken and lentil bowl')).toBeVisible();
  await expect(page.getByText('+1 new')).toBeVisible();
  await snap(page, '06-page-insights');
});

test('a co-manager is invited by username and accepts in Menu', async ({ page }) => {
  const ana = await account('Ana');
  const beka = await account('Beka');
  const bekaName = `beka-${randomUUID().slice(0, 6)}`;
  await call(beka, 'PUT', '/social/me', { username: bekaName, displayName: 'Beka', bio: '', discoverable: true });
  const made = await call<{ id: string }>(ana, 'POST', '/pages', { name: 'E2E Team Page', username: `e2e-team-${randomUUID().slice(0, 6)}`, bio: '' });

  await signIn(page, ana);
  await page.goto(`/settings/pages/${made.id}`);
  await page.getByLabel('Username to invite').fill(bekaName);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(page.getByText('Invited, waiting for an answer')).toBeVisible();
  await page.getByRole('heading', { name: 'Managers' }).scrollIntoViewIfNeeded();
  await snap(page, '06-page-managers');

  await signIn(page, beka);
  await page.goto('/menu');
  await expect(page.getByText('invited you to help run')).toBeVisible();
  await snap(page, '06-page-invite');
  await page.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByText('invited you to help run')).toHaveCount(0);
  await expect.poll(async () => (await call<{ pages: { id: string }[] }>(beka, 'GET', '/pages')).pages.map((row) => row.id)).toContain(made.id);
});
