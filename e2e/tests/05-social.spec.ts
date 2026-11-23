import { randomUUID } from 'node:crypto';
import { account, call, expect, signIn, snap, test } from '../support';

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
  await page.getByText('1 comment').first().click();
  await expect(page.getByText('Oats with yoghurt').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  const box = page.getByPlaceholder('Write a reply…');
  await box.fill('Good one, with berries?');
  await page.getByRole('button', { name: 'Post reply' }).click();
  await expect(page.getByText('Good one, with berries?').first()).toBeVisible();
  await snap(page, '05-post-thread');
});
