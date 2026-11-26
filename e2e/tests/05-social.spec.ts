import { randomUUID } from 'node:crypto';
import { account, call, expect, signIn, snap, test, today } from '../support';

test('a post, a comment and a reply written under it', async ({ page }) => {
  const ana = await account('Ana');
  const beka = await account('Beka');
  const post = await call<{ id: string }>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'E2E: what is your go-to breakfast?', audience: 'public' });
  await call(beka, 'POST', `/posts/${post.id}/comments`, { text: 'Oats with yoghurt', requestId: randomUUID() });

  await signIn(page, ana);
  await page.goto(`/posts/${post.id}`);
  // The Home feed stays mounted behind the post page and may hold the same post: take the first.
  await expect(page.getByText('E2E: what is your go-to breakfast?').first()).toBeVisible();
  // Comments are folded until asked for.
  await page.getByText('1 comment').filter({ visible: true }).first().click();
  await expect(page.getByText('Oats with yoghurt').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  const box = page.getByPlaceholder('Write a reply…');
  await box.fill('Good one, with berries?');
  await page.getByRole('button', { name: 'Post reply' }).click();
  await expect(page.getByText('Good one, with berries?').first()).toBeVisible();
  await snap(page, '05-post-thread');
});

test('a comment can be liked, and the post has no title bar or frame', async ({ page }) => {
  const ana = await account('Ana');
  const beka = await account('Beka');
  const post = await call<{ id: string }>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'E2E: rate my lunch', audience: 'public' });
  await call(beka, 'POST', `/posts/${post.id}/comments`, { text: 'Looks great', requestId: randomUUID() });

  await signIn(page, ana);
  await page.goto(`/posts/${post.id}`);
  await expect(page.getByText('E2E: rate my lunch').first()).toBeVisible();
  // No "Post" heading; the way back is the arrow in the top bar.
  await expect(page.getByRole('heading', { name: 'Post', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await page.getByText('1 comment').filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Like comment' }).first().click();
  await expect(page.getByRole('button', { name: 'Unlike comment' }).first()).toContainText('1');
  // The like reached the server: a fresh read counts it for Ana.
  await expect
    .poll(async () => (await call<{ comments: { liked?: boolean; likeCount?: number }[] }>(ana, 'GET', `/posts/${post.id}/comments`)).comments[0])
    .toMatchObject({ liked: true, likeCount: 1 });
  await snap(page, '05-comment-like');
});

test('search starts with the box, no title', async ({ page }) => {
  const ana = await account('Ana');
  await signIn(page, ana);
  await page.goto('/search');
  await expect(page.getByRole('searchbox', { name: 'Search people' })).toBeVisible();
  await expect(page.getByText('Find your people')).toHaveCount(0);
  await snap(page, '05-search');
});

test('a portal address opens for a visitor, then asks them to join', async ({ page }) => {
  const ana = await account('Ana');
  const username = `e2e-${randomUUID().slice(0, 8)}`;
  await call(ana, 'PUT', '/social/me', { username, displayName: 'Ana Portal', bio: 'Lentils and lifts', discoverable: true });
  await call(ana, 'POST', '/posts', { requestId: randomUUID(), title: 'Lentil soup', caption: 'Warm and cheap.', audience: 'public' });
  await page.goto(`/@${username}`);
  await expect(page.getByRole('heading', { name: 'Ana Portal' })).toBeVisible();
  await expect(page.getByText('Lentil soup')).toBeVisible();
  await snap(page, '05-public-portal');
  await page.getByRole('tab', { name: 'Badges' }).click();
  await expect(page.getByRole('dialog', { name: /See more of Ana Portal/ })).toBeVisible();
  await snap(page, '05-public-portal-gate');
});

test('your portal shows Food as a large widget, and you can arrange it', async ({ page }) => {
  const ana = await account('Ana');
  const day = today();
  await call(ana, 'PUT', '/nutrition/profile', { sex: 'female', heightCm: 165, birthDate: '1992-01-01', goal: 'maintain', shareMeals: true, shareTargets: true });
  await call(ana, 'PUT', `/nutrition/weigh-ins?today=${day}`, { day, weightGrams: 62_000 });
  const food = await call<{ id: string }>(ana, 'POST', '/nutrition/foods', { name: 'E2E oats', unit: 'g', servingSize: 100, entryMode: 'per_100', energyKcal: 380, proteinMg: 13000, fatMg: 7000, carbMg: 60000 });
  await call(ana, 'POST', '/nutrition/entries', { foodId: food.id, amount: 150, slot: 'breakfast', day });
  await call(ana, 'PUT', '/portal', { moduleVisibility: { nutrition: 'friends' } });
  await signIn(page, ana);
  await page.goto('/profile');
  await expect(page.getByRole('tab', { name: 'Portal' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Open Food' }).filter({ visible: true }).first()).toBeVisible();
  await snap(page, '05-own-portal');
  // Opens like a folder, with the week.
  await page.getByRole('button', { name: 'Open Food' }).filter({ visible: true }).first().click();
  const folder = page.getByRole('dialog', { name: 'Food' });
  await expect(folder.getByText('This week', { exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await snap(page, '05-portal-folder');
  await folder.getByRole('button', { name: 'Close' }).last().click();
  await expect(folder).toHaveCount(0);
  // Hold to arrange; the size button opens the board of squares.
  const widget = page.getByRole('button', { name: 'Open Food' }).filter({ visible: true }).first();
  const box = await widget.boundingBox();
  if (!box) throw new Error('No widget');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  // The widgets jiggle while arranging, which a finger does not mind.
  await page.getByRole('button', { name: /Size of Food: 4 by 2/ }).click({ force: true });
  await expect(page.getByRole('dialog', { name: 'Widget size' })).toBeVisible();
  await page.waitForTimeout(300);
  await snap(page, '05-portal-size-picker');
  await page.getByRole('button', { name: '4 by 4' }).click();
  await expect(page.getByRole('button', { name: /Size of Food: 4 by 4/ })).toBeVisible();
  await expect.poll(async () => (await call<{ portalSizes?: Record<string, string> }>(ana, 'GET', '/settings')).portalSizes?.['nutrition']).toBe('4x4');
});
