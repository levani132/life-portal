import type { PostComment, PostEngagement } from '@life-portal/shared-types';
import { cancelledBy, overlayComments, overlayEngagement, type SocialWrite } from './social-overlay';

const base: PostEngagement = { likeCount: 3, commentCount: 1, liked: false, reposted: false, repostCount: 0 };
const like = (on: boolean, settled = false, postId = 'p1'): SocialWrite => ({ meta: { op: 'like', postId, on }, settled });

describe('likes, reposts and comments made offline (spec 031)', () => {
  it('shows a waiting like at once, marked not sent, and only for its post', () => {
    expect(overlayEngagement(base, 'p1', [like(true)])).toMatchObject({ liked: true, likeCount: 4, unsent: true });
    expect(overlayEngagement(base, 'p2', [like(true)])).toBe(base);
  });

  it('lets the last toggle win, and never counts below zero or twice', () => {
    expect(overlayEngagement(base, 'p1', [like(true), like(false)])).toMatchObject({ liked: false, likeCount: 3 });
    expect(overlayEngagement({ ...base, liked: true }, 'p1', [like(true)])).toMatchObject({ liked: true, likeCount: 3 });
    expect(overlayEngagement({ ...base, likeCount: 0, liked: true }, 'p1', [like(false)])).toMatchObject({ likeCount: 0 });
  });

  it('leaves an acknowledged write to the refetched figures', () => {
    expect(overlayEngagement({ ...base, liked: true, likeCount: 4 }, 'p1', [like(true, true)])).toMatchObject({ liked: true, likeCount: 4 });
    expect(overlayEngagement(base, 'p1', [like(true, true)]).unsent).toBeUndefined();
  });

  it('counts reposts and comments the same way', () => {
    const shown = overlayEngagement(base, 'p1', [
      { meta: { op: 'repost', postId: 'p1', on: true } },
      { meta: { op: 'comment', postId: 'p1', commentId: 'c2', text: 'Nice', createdAt: '2026-11-14T10:00:00Z' } },
      { meta: { op: 'comment.remove', postId: 'p1', commentId: 'c1' } },
    ]);
    expect(shown).toMatchObject({ reposted: true, repostCount: 1, commentCount: 1, unsent: true });
  });

  it('adds a waiting comment as yours and not sent, and hides one being removed', () => {
    const saved = { id: 'c1', text: 'First', createdAt: '', canDelete: true, author: { userId: 'u2', displayName: 'Ana', username: 'ana' } } as PostComment;
    const me = { userId: 'u1', displayName: 'You', username: '' };
    const shown = overlayComments([saved], 'p1', [
      { meta: { op: 'comment', postId: 'p1', commentId: 'c2', text: 'Nice', createdAt: '2026-11-14T10:00:00Z' } },
      { meta: { op: 'comment.remove', postId: 'p1', commentId: 'c1' } },
    ], me);
    expect(shown).toEqual([{ id: 'c2', author: me, text: 'Nice', createdAt: '2026-11-14T10:00:00Z', canDelete: true, unsent: true }]);
  });

  it('cancels a waiting opposite toggle only if it never left the device', () => {
    const items = [
      { id: 'a', state: 'pending', meta: { op: 'like', postId: 'p1', on: true } },
      { id: 'b', state: 'pending', maybeSent: true, meta: { op: 'like', postId: 'p2', on: true } },
      { id: 'c', state: 'error', meta: { op: 'like', postId: 'p3', on: true } },
      { id: 'd', state: 'pending', meta: { op: 'repost', postId: 'p1', on: true } },
    ];
    expect(cancelledBy(items, { op: 'like', postId: 'p1', on: false })).toEqual(['a']);
    expect(cancelledBy(items, { op: 'like', postId: 'p2', on: false })).toEqual([]);
    expect(cancelledBy(items, { op: 'like', postId: 'p3', on: false })).toEqual([]);
    expect(cancelledBy(items, { op: 'like', postId: 'p1', on: true })).toEqual([]);
  });
});
