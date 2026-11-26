/**
 * Spec 045: a page's insights through the real API and Mongo. A view counts once per person, post
 * and day, only for pages' public posts, never from the page's managers or another page, and
 * nothing names the viewer.
 */
import { randomUUID } from 'node:crypto';
import type { FoodPost, PageInsights, PageSummary } from '@life-portal/shared-types';
import { startApi, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });

describe('page insights', () => {
  it('counts views, likes, comments, reposts and follows for the page’s managers only', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const gio = await api.account('gio');
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Kitchen', username: `kitchen-${randomUUID().slice(0, 6)}`, bio: '' })).body;
    const other = (await api.call<PageSummary>(gio, 'POST', '/pages', { name: 'Other', username: `other-${randomUUID().slice(0, 6)}`, bio: '' })).body;
    const post = (await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: 'Lentil soup', caption: '', audience: 'public', }, as(page.id))).body;
    const hidden = (await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: 'Draft', caption: '', audience: 'private' }, as(page.id))).body;
    const persons = (await api.call<FoodPost>(beka, 'POST', '/posts', { requestId: randomUUID(), title: 'Mine', caption: '', audience: 'public' })).body;

    // Beka sees it twice today: one view. Gio sees it once. Ana (a manager) and another page do not count.
    expect((await api.call<{ counted: number }>(beka, 'POST', '/posts/views', { ids: [post.id, hidden.id, persons.id] })).body.counted).toBe(1);
    expect((await api.call<{ counted: number }>(beka, 'POST', '/posts/views', { ids: [post.id] })).body.counted).toBe(0);
    expect((await api.call<{ counted: number }>(gio, 'POST', '/posts/views', { ids: [post.id] })).body.counted).toBe(1);
    expect((await api.call<{ counted: number }>(ana, 'POST', '/posts/views', { ids: [post.id] })).body.counted).toBe(0);
    expect((await api.call<{ counted: number }>(gio, 'POST', '/posts/views', { ids: [post.id] }, as(other.id))).body.counted).toBe(0);
    // Nothing stored names a viewer.
    const stored = JSON.stringify([...(await api.db.collection('post_view_keys').find().toArray()), ...(await api.db.collection('post_views_daily').find().toArray())]);
    for (const id of [beka.id, gio.id]) expect(stored).not.toContain(id);

    await api.call(beka, 'PUT', `/posts/${post.id}/like`, {});
    await api.call(gio, 'POST', `/posts/${post.id}/comments`, { text: 'Recipe?', requestId: randomUUID() });
    await api.call(gio, 'PUT', `/posts/${post.id}/repost`, {});
    await api.call(beka, 'PUT', `/follows/${page.id}`, {});

    const insights = await api.call<PageInsights>(ana, 'GET', `/page-insights/${page.id}`);
    expect(insights.status).toBe(200);
    expect(insights.body).toMatchObject({ days: 28, followers: 1, totals: { views: 2, likes: 1, comments: 1, reposts: 1, newFollowers: 1 } });
    expect(insights.body.newFollowersByDay).toHaveLength(28);
    expect(insights.body.newFollowersByDay[27].count).toBe(1);
    expect(insights.body.posts.find((row) => row.id === post.id)).toMatchObject({ label: 'Lentil soup', views: 2, likes: 1, comments: 1, reposts: 1, saves: 0 });
    // As the page too (its assistant reads them this way), and never for anyone else.
    expect((await api.call(ana, 'GET', `/page-insights/${page.id}`, undefined, as(page.id))).status).toBe(200);
    expect((await api.call(beka, 'GET', `/page-insights/${page.id}`)).status).toBe(403);
    expect((await api.call(gio, 'GET', `/page-insights/${page.id}`, undefined, as(other.id))).status).toBe(403);
  });
});
