import { randomUUID } from 'node:crypto';
import { account, call, expect, signIn, snap, test } from '../support';

test('a post, a comment and a reply written under it', async ({ page }) => {
  const ana = await account('Ana');
  const beka = await account('Beka');
  const post = await call<{ id: string }>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'E2E: what is your go-to breakfast?', audience: 'public' });
  await call(beka, 'POST', `/posts/${post.id}/comments`, { text: 'Oats with yoghurt', requestId: randomUUID() });

  await signIn(page, ana);
  await page.goto(`/posts/${post.id}`);
  await expect(page.getByText('E2E: what is your go-to breakfast?')).toBeVisible();
  // Comments are folded until asked for.
  await page.getByText('1 comment').click();
  await expect(page.getByText('Oats with yoghurt')).toBeVisible();
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  const box = page.getByPlaceholder('Write a reply…');
  await box.fill('Good one, with berries?');
  await page.getByRole('button', { name: 'Post reply' }).click();
  await expect(page.getByText('Good one, with berries?')).toBeVisible();
  await snap(page, '05-post-thread');
});
