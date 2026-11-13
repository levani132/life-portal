import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { FoodPost } from '@life-portal/shared-types';
import { postTopics } from '@life-portal/shared-domain';
import { FakeModel } from '../training/fake-model.testing';
import { FOR_YOU_SESSION_MS, ForYouService } from './for-you.service';

const ME = 'me';
const NOW = new Date('2026-11-13T12:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function fixture(options: { ranking?: boolean } = {}) {
  const posts = new FakeModel();
  const likes = new FakeModel();
  const comments = new FakeModel();
  const sessions = new FakeModel();
  const prefs = new FakeModel();
  const notInterested = new Set<string>();
  const hidden = new Set<string>();
  const unreadable = new Set<string>();
  const feed = {
    forYou: jest.fn(async () => ({ posts: [], plain: true })),
    forYouGate: jest.fn(async () => undefined),
    forYouFilter: jest.fn(async () => ({ graphHidden: hidden, notInterested, excluded: [ME, ...hidden] })),
    // The real query also excludes authors with $nin; the eligibility check below covers that here.
    forYouQuery: () => ({ audience: 'public', deleted: { $ne: true }, repostOf: { $exists: false } }),
    forYouEligible: jest.fn(async (_u: string, rows: { _id: Types.ObjectId; userId: string }[], f: { excluded: string[]; notInterested: Set<string> }) =>
      rows.filter((row) => !f.excluded.includes(row.userId) && !f.notInterested.has(String(row._id)) && !unreadable.has(String(row._id))),
    ),
    forYouCard: jest.fn(async (_u: string, row: { _id: Types.ObjectId; userId: string; caption: string }) =>
      ({ id: String(row._id), author: { displayName: row.userId }, topics: postTopics({ caption: row.caption }) }) as unknown as FoodPost,
    ),
  };
  const access = { forUser: jest.fn(async () => ({ access: { forYouRanking: options.ranking ?? true } })) };
  const service = new ForYouService(
    posts as never,
    likes as never,
    comments as never,
    sessions as never,
    prefs as never,
    feed as never,
    access as never,
    { jwtSecret: 'test-secret' } as never,
  );
  const add = (userId: string, caption = '', ageMinutes = 60, extra: Record<string, unknown> = {}) => {
    const _id = new Types.ObjectId();
    posts.docs.push({ _id, userId, caption, audience: 'public', deleted: false, createdAt: minutesAgo(ageMinutes), ...extra });
    return String(_id);
  };
  const like = (userId: string, postId: string, ageMinutes = 10) =>
    likes.docs.push({ _id: new Types.ObjectId(), userId, postId, createdAt: minutesAgo(ageMinutes) });
  return { service, posts, likes, comments, sessions, prefs, feed, access, notInterested, hidden, unreadable, add, like };
}

it('serves the plain newest-first feed without forYouRanking', async () => {
  const f = fixture({ ranking: false });
  expect(await f.service.page(ME, {}, NOW)).toEqual({ posts: [], plain: true });
  expect(f.feed.forYou).toHaveBeenCalled();
  expect(f.sessions.docs).toHaveLength(0);
});

it('ranks by the viewer’s own likes and explains why, truthfully', async () => {
  const f = fixture();
  // Friends-only: they are the viewer's signals, not For You candidates.
  for (let i = 0; i < 3; i++) f.like(ME, f.add(`liked${i}`, 'so good #pasta', 600, { audience: 'friends' }));
  const cake = f.add('baker', 'fresh #cake', 5);
  const pasta = f.add('cook', 'dinner #pasta', 120);
  const page = await f.service.page(ME, {}, NOW);
  const position = (id: string) => page.posts.findIndex((p) => p.id === id);
  expect(position(pasta)).toBeLessThan(position(cake)); // the fresher post loses to the topic
  expect(page.posts[position(pasta)].reasons?.[0]).toEqual({
    code: 'topic',
    topicId: 'tag:pasta',
    text: 'Because you engaged with posts tagged #pasta',
  });
  expect(page.posts.find((p) => p.id === cake)?.reasons?.some((r) => r.code === 'topic')).toBe(false);
  expect(f.sessions.docs).toHaveLength(1);
});

it('falls back to newest first, with no reasons, when the viewer has too few signals', async () => {
  const f = fixture();
  const old = f.add('a', '#pasta', 300);
  const recent = f.add('b', '#cake', 5);
  const page = await f.service.page(ME, {}, NOW);
  expect(page.posts.map((p) => p.id)).toEqual([recent, old]);
  expect(page.posts.every((p) => (p.reasons ?? []).length === 0)).toBe(true);
});

it('pages a stable session with no repeats or skips, and drops posts that become ineligible', async () => {
  const f = fixture();
  const ids = Array.from({ length: 25 }, (_, i) => f.add(`author${i}`, '', i + 1));
  const first = await f.service.page(ME, {}, NOW);
  expect(first.posts).toHaveLength(10);
  // Engagement moves and a post is marked Not interested mid-session.
  f.like('someone', ids[24]);
  f.like('else', ids[24]);
  const dropped = ids.find((id) => !first.posts.some((p) => p.id === id))!;
  f.notInterested.add(dropped);
  const second = await f.service.page(ME, { cursor: first.nextCursor }, NOW);
  const third = await f.service.page(ME, { cursor: second.nextCursor }, NOW);
  const seen = [...first.posts, ...second.posts, ...third.posts].map((p) => p.id);
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen).not.toContain(dropped);
  expect(seen.sort()).toEqual(ids.filter((id) => id !== dropped).sort());
  expect(third.nextCursor).toBeUndefined();
});

it('says a session expired instead of serving a stale or different order', async () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) f.add(`a${i}`);
  const first = await f.service.page(ME, {}, NOW);
  const later = new Date(NOW.getTime() + FOR_YOU_SESSION_MS + 1);
  expect(await f.service.page(ME, { cursor: first.nextCursor }, later)).toEqual({ posts: [], expired: true });
  // A new first page replaces the session; the old cursor is then unknown too.
  await f.service.page(ME, {}, NOW);
  expect(f.sessions.docs).toHaveLength(1);
  expect(await f.service.page(ME, { cursor: first.nextCursor }, NOW)).toEqual({ posts: [], expired: true });
  await expect(f.service.page(ME, { cursor: 'tampered' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
});

it('reads only the viewer’s likes, comments and reposts in the window, never deleted posts', async () => {
  const f = fixture();
  const liked = f.add('a', '#pasta');
  const commented = f.add('b', '#cake');
  const reposted = f.add('c', '#soup');
  const gone = f.add('d', '#gone', 60, { deleted: true });
  f.like(ME, liked);
  f.like(ME, gone);
  f.like(ME, commented, 200 * 24 * 60); // outside 90 days
  f.like('other', reposted);
  f.comments.docs.push({ _id: new Types.ObjectId(), userId: ME, postId: commented, deleted: false, createdAt: minutesAgo(5) });
  f.posts.docs.push({ _id: new Types.ObjectId(), userId: ME, repostOf: reposted, deleted: false, audience: 'public', caption: '', createdAt: minutesAgo(3) });
  const since = new Date(NOW.getTime() - 90 * 86_400_000).toISOString();
  const interactions = await f.service.interactions(ME, since);
  expect(interactions.map((i) => [i.kind, i.authorId, i.topicIds]).sort()).toEqual(
    [
      ['comment', 'b', ['tag:cake']],
      ['like', 'a', ['tag:pasta']],
      ['repost', 'c', ['tag:soup']],
    ].sort(),
  );
});

it('counts each engaged member once, never the author, the viewer or someone the viewer hid', async () => {
  const f = fixture();
  const post = f.add('author');
  f.like('fan', post);
  f.like('author', post);
  f.like(ME, post);
  f.like('blocked', post);
  f.comments.docs.push({ _id: new Types.ObjectId(), userId: 'fan', postId: post, deleted: false, createdAt: minutesAgo(1) });
  f.comments.docs.push({ _id: new Types.ObjectId(), userId: 'friend', postId: post, deleted: false, createdAt: minutesAgo(1) });
  const counts = await f.service.engagedMembers(f.posts.docs as never, ME, new Set(['blocked']));
  expect(counts.get(post)).toBe(2);
});

it('honours chosen interests and a reset, naming the interest in the reason (#10)', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) f.like(ME, f.add(`liked${i}`, '#pasta', 600, { audience: 'friends' }), 120);
  const bread = f.add('baker', 'sourdough #bread', 300);
  f.add('cook', '#pasta', 300);
  await f.service.setInterests(ME, ['baking']);
  await f.service.resetRecommendations(ME, minutesAgo(60));
  const page = await f.service.page(ME, {}, NOW);
  expect(page.posts[0].id).toBe(bread);
  expect(page.posts[0].reasons?.[0].text).toBe('Matches your interest: Baking');
  // The pasta likes were before the reset: nothing claims them.
  expect(page.posts.some((p) => p.reasons?.some((r) => r.code === 'topic'))).toBe(false);
});

it('stores only known interests, clears them, and resets by dropping the session', async () => {
  const f = fixture();
  await expect(f.service.setInterests(ME, ['baking', 'astrology'])).rejects.toBeInstanceOf(BadRequestException);
  expect(await f.service.setInterests(ME, ['vegan', 'baking', 'vegan'])).toEqual({ interests: ['baking', 'vegan'] });
  expect(await f.service.setInterests(ME, [])).toEqual({ interests: [] });
  f.add('a');
  await f.service.page(ME, {}, NOW);
  expect(f.sessions.docs).toHaveLength(1);
  const reset = await f.service.resetRecommendations(ME, NOW);
  expect(reset.recommendationsResetAt).toBe(NOW.toISOString());
  expect(f.sessions.docs).toHaveLength(0);
  expect(f.prefs.docs).toHaveLength(1);
  // A retired id left in storage is ignored on read.
  f.prefs.docs[0].interests = ['retired', 'baking'];
  expect((await f.service.getPreferences(ME)).interests).toEqual(['baking']);
  expect(f.feed.forYouGate).toHaveBeenCalledWith(ME);
});
