/** Spec 045: a page pins one of its posts; it opens the page's profile and is not repeated. */
import { randomUUID } from 'node:crypto';
import type { FoodPost, PageSummary, PostPage } from '@life-portal/shared-types';
import { startApi, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });

describe('a pinned post', () => {
  it('shows first on the page’s profile, once; one pin per page; pages only', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Pinny', username: `pinny-${randomUUID().slice(0, 6)}`, bio: '' })).body;
    const post = async (caption: string) => (await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption, audience: 'public' }, as(page.id))).body;
    const first = await post('First');
    const second = await post('Second');
    await post('Third');
    const profile = async () => (await api.call<PostPage>(beka, 'GET', `/posts?authorId=${page.id}`)).body.posts;

    expect((await profile()).map((row) => row.caption)).toEqual(['Third', 'Second', 'First']);
    expect((await api.call(ana, 'PUT', `/posts/${first.id}/pin`, {}, as(page.id))).status).toBe(200);
    const pinned = await profile();
    expect(pinned.map((row) => [row.caption, !!row.pinned])).toEqual([
      ['First', true],
      ['Third', false],
      ['Second', false],
    ]);
    // Pinning another replaces it.
    await api.call(ana, 'PUT', `/posts/${second.id}/pin`, {}, as(page.id));
    expect((await profile()).map((row) => row.caption)).toEqual(['Second', 'Third', 'First']);
    expect(await api.db.collection('food_posts').countDocuments({ userId: page.id, pinnedAt: { $exists: true } })).toBe(1);

    // A person cannot pin; nobody pins another account's post.
    const mine = (await api.call<FoodPost>(beka, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'Beka', audience: 'public' })).body;
    expect((await api.call<{ code?: string }>(beka, 'PUT', `/posts/${mine.id}/pin`, {})).body.code).toBe('PAGES_ONLY');
    expect((await api.call(ana, 'PUT', `/posts/${mine.id}/pin`, {}, as(page.id))).status).toBe(404);

    await api.call(ana, 'DELETE', `/posts/${second.id}/pin`, undefined, as(page.id));
    expect((await profile()).map((row) => row.caption)).toEqual(['Third', 'Second', 'First']);
  });
});
