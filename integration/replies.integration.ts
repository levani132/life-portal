/**
 * Replies to comments, through the real API and Mongo: one level deep, a reply to a reply
 * lands under the same top-level comment, and a removed comment takes its replies with it.
 */
import { randomUUID } from 'node:crypto';
import type { FoodPost, PostComment, PostCommentsPage } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const say = (who: Account, postId: string, text: string, parentId?: string) =>
  api.call<PostComment & { code?: string }>(who, 'POST', `/posts/${postId}/comments`, { text, requestId: randomUUID(), ...(parentId ? { parentId } : {}) });
const comments = async (who: Account, postId: string) => (await api.call<PostCommentsPage>(who, 'GET', `/posts/${postId}/comments`)).body.comments;

describe('replies to comments', () => {
  it('sit one level deep under the comment they answer', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const gio = await api.account('gio');
    const post = await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'Talk here', audience: 'public' });
    expect(post.status).toBe(201);
    const id = post.body.id;

    const top = await say(beka, id, 'First');
    expect(top.status).toBeLessThan(300);
    expect(top.body.parentId).toBeUndefined();
    const reply = await say(gio, id, 'Answering Beka', top.body.id);
    expect(reply.body.parentId).toBe(top.body.id);
    // Answering a reply stays under the same top-level comment.
    const nested = await say(beka, id, 'Answering Gio', reply.body.id);
    expect(nested.body.parentId).toBe(top.body.id);
    const stored = await api.db.collection('post_comments').findOne({ text: 'Answering Gio' });
    expect(stored).toMatchObject({ parentId: top.body.id, parentUserId: gio.id });

    const seen = await comments(ana, id);
    expect(seen.map((row) => [row.text, row.parentId])).toEqual(expect.arrayContaining([['First', undefined], ['Answering Beka', top.body.id], ['Answering Gio', top.body.id]]));
    expect(seen).toHaveLength(3);

    // A comment from another post, or one that does not exist, cannot be answered here.
    const other = await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'Elsewhere', audience: 'public' });
    const elsewhere = await say(beka, other.body.id, 'Over there');
    expect((await say(gio, id, 'Wrong thread', elsewhere.body.id)).status).toBe(404);
    expect((await say(gio, id, 'Nobody', '0123456789abcdef01234567')).body.code).toBe('COMMENT_GONE');
    expect((await api.call(gio, 'POST', `/posts/${id}/comments`, { text: 'Bad id', requestId: randomUUID(), parentId: 'nope' })).status).toBe(400);
  });

  it('go with the comment they answer when it is removed', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const gio = await api.account('gio');
    const post = await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'Short lived', audience: 'public' });
    const id = post.body.id;
    const top = await say(beka, id, 'To be removed');
    const reply = await say(gio, id, 'A reply', top.body.id);
    const stays = await say(gio, id, 'On its own');

    // Removing a reply leaves the rest.
    expect((await api.call(gio, 'DELETE', `/posts/${id}/comments/${reply.body.id}`)).status).toBeLessThan(300);
    expect((await comments(ana, id)).map((row) => row.text).sort()).toEqual(['On its own', 'To be removed']);

    const second = await say(gio, id, 'Another reply', top.body.id);
    expect(second.status).toBeLessThan(300);
    expect((await api.call(beka, 'DELETE', `/posts/${id}/comments/${top.body.id}`)).status).toBeLessThan(300);
    expect((await comments(ana, id)).map((row) => row.id)).toEqual([stays.body.id]);
    expect((await say(gio, id, 'Too late', top.body.id)).status).toBe(404);
    const stats = await api.call<{ commentCount: number }>(ana, 'GET', `/posts/${id}/engagement`);
    expect(stats.body.commentCount).toBe(1);
  });

  it('are refused across a block', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const gio = await api.account('gio');
    const post = await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'Blocked thread', audience: 'public' });
    const top = await say(beka, post.body.id, 'From Beka');
    await api.call(beka, 'GET', '/social/me');
    await api.call(gio, 'GET', '/social/me');
    expect((await api.call(beka, 'PUT', `/social/connections/${gio.id}`, { action: 'block' })).status).toBe(200);
    expect((await say(gio, post.body.id, 'Can you hear me', top.body.id)).status).toBe(404);
  });
});
