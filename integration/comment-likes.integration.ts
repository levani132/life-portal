/**
 * Likes on comments and replies, through the real API and Mongo: counted on every comment,
 * idempotent both ways, never your own notification, refused across a block, and gone with the
 * account that wrote the comment.
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
  api.call<PostComment>(who, 'POST', `/posts/${postId}/comments`, { text, requestId: randomUUID(), ...(parentId ? { parentId } : {}) });
const like = (who: Account, postId: string, commentId: string, on = true) =>
  api.call<{ likeCount: number; liked: boolean; code?: string }>(who, on ? 'PUT' : 'DELETE', `/posts/${postId}/comments/${commentId}/like`, on ? {} : undefined);
const listed = async (who: Account, postId: string) => (await api.call<PostCommentsPage>(who, 'GET', `/posts/${postId}/comments`)).body.comments;

describe('comment likes', () => {
  it('counts likes on comments and replies, for each viewer', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const gio = await api.account('gio');
    const post = (await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'Talk here', audience: 'public' })).body;
    const top = (await say(beka, post.id, 'First')).body;
    const reply = (await say(gio, post.id, 'A reply', top.id)).body;

    expect((await like(ana, post.id, top.id)).body).toEqual({ likeCount: 1, liked: true });
    // Liking twice is still one like.
    expect((await like(ana, post.id, top.id)).body).toEqual({ likeCount: 1, liked: true });
    expect((await like(gio, post.id, top.id)).body).toEqual({ likeCount: 2, liked: true });
    expect((await like(beka, post.id, reply.id)).body).toEqual({ likeCount: 1, liked: true });

    const seenByAna = await listed(ana, post.id);
    expect(seenByAna[0]).toMatchObject({ id: top.id, likeCount: 2, liked: true });
    expect(seenByAna[0].replies?.[0]).toMatchObject({ id: reply.id, likeCount: 1, liked: false });
    const seenByBeka = await listed(beka, post.id);
    expect(seenByBeka[0]).toMatchObject({ likeCount: 2, liked: false });
    expect(seenByBeka[0].replies?.[0]).toMatchObject({ likeCount: 1, liked: true });

    // Unliking is idempotent too.
    expect((await like(ana, post.id, top.id, false)).body).toEqual({ likeCount: 1, liked: false });
    expect((await like(ana, post.id, top.id, false)).body).toEqual({ likeCount: 1, liked: false });

    // The comment's author hears about it in Activity, grouped per comment; liking your own is silent.
    await like(beka, post.id, top.id);
    const { PostEngagementService } = await import('../apps/api/src/posts/post-engagement.service');
    const rows = await api.app.get(PostEngagementService).activity(beka.id, new Date(Date.now() - 60_000), undefined, 50);
    const mine = rows.filter((row) => row.type === 'commentLike');
    expect(mine.map((row) => [row.actorId, row.targetId])).toEqual([[gio.id, top.id]]);
    expect(mine[0].url).toBe(`/posts/${post.id}?comment=${top.id}`);
  });

  it('is refused for a removed comment and across a block, and leaves with the account', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const post = (await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'Open', audience: 'public' })).body;
    const mine = (await say(ana, post.id, 'Mine')).body;
    const removed = (await say(ana, post.id, 'Gone soon')).body;
    await api.call(ana, 'DELETE', `/posts/${post.id}/comments/${removed.id}`);
    expect((await like(beka, post.id, removed.id)).body.code).toBe('COMMENT_GONE');
    // Unliking something already gone is done, so a retried unlike never sticks.
    expect((await like(beka, post.id, removed.id, false)).status).toBe(200);
    expect((await like(beka, post.id, 'not-an-id')).status).toBe(404);

    expect((await like(beka, post.id, mine.id)).status).toBe(200);
    const bekaComment = (await say(beka, post.id, 'From Beka')).body;
    expect((await like(ana, post.id, bekaComment.id)).status).toBe(200);
    // Ana blocks Beka: Beka can no longer see the post or like her comments.
    expect((await api.call(ana, 'PUT', `/social/connections/${beka.id}`, { action: 'block' })).status).toBe(200);
    expect((await like(beka, post.id, mine.id)).status).toBe(404);

    // Beka leaves: their likes, and the likes on their comment, go too.
    expect(await api.db.collection('post_comment_likes').countDocuments({ $or: [{ userId: beka.id }, { commentId: bekaComment.id }] })).toBe(2);
    const { AccountService } = await import('../apps/api/src/account/account.service');
    await api.app.get(AccountService).erase(beka.id);
    expect(await api.db.collection('post_comment_likes').countDocuments({ $or: [{ userId: beka.id }, { commentId: bekaComment.id }] })).toBe(0);
  });
});
