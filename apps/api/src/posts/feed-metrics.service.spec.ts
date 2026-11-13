import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FakeModel } from '../training/fake-model.testing';
import { FeedMetricsService } from './feed-metrics.service';

const ME = 'me';
const NOW = new Date('2026-11-13T12:00:00.000Z');
const DAY = 86_400_000;

function fixture(options: { enabled?: boolean } = {}) {
  const keys = new FakeModel();
  const daily = new FakeModel();
  const prefs = new FakeModel();
  const posts = new FakeModel();
  const likes = new FakeModel();
  const comments = new FakeModel();
  const notInterested = new Set<string>();
  const unreadable = new Set<string>();
  const feed = {
    forYouGate: jest.fn(async () => undefined),
    forYouFilter: jest.fn(async () => ({ graphHidden: new Set(), notInterested, excluded: [ME] })),
    // As the real check: original posts only, excluded authors and Not interested left out.
    forYouEligible: jest.fn(async (_u: string, rows: { _id: Types.ObjectId; userId: string; repostOf?: string }[], f: { excluded: string[]; notInterested: Set<string> }) =>
      rows.filter((row) => !row.repostOf && !f.excluded.includes(row.userId) && !f.notInterested.has(String(row._id)) && !unreadable.has(String(row._id))),
    ),
  };
  const access = {
    forUser: jest.fn(async () => ({ access: { forYouMetrics: options.enabled ?? true } })),
    requireDeveloper: jest.fn((userId: string) => {
      if (userId !== 'dev') throw new ForbiddenException();
    }),
  };
  const service = new FeedMetricsService(
    keys as never,
    daily as never,
    prefs as never,
    posts as never,
    likes as never,
    comments as never,
    feed as never,
    access as never,
    { jwtSecret: 'x'.repeat(32) } as never,
  );
  const add = (userId = 'author', extra: Record<string, unknown> = {}) => {
    const _id = new Types.ObjectId();
    posts.docs.push({ _id, userId, audience: 'public', deleted: false, ...extra });
    return String(_id);
  };
  const totals = (day = '2026-11-13') => daily.docs.find((row) => row.day === day && row.postId === '');
  return { service, keys, daily, prefs, posts, likes, comments, notInterested, unreadable, add, totals };
}

it('records nothing while forYouMetrics is off, and nothing after opting out', async () => {
  const off = fixture({ enabled: false });
  const post = off.add();
  expect(await off.service.record(ME, { events: [{ postId: post, type: 'impression' }], visit: true }, NOW)).toEqual({ accepted: 0, dropped: 1 });
  expect(off.daily.docs).toHaveLength(0);
  expect(off.keys.docs).toHaveLength(0);

  const f = fixture();
  const id = f.add();
  await f.service.record(ME, { events: [{ postId: id, type: 'impression' }], visit: true }, NOW);
  expect(f.keys.docs.length).toBeGreaterThan(0);
  expect(await f.service.setOptOut(ME, true, NOW)).toEqual({ enabled: true, optedOut: true, active: false });
  // Opting out deletes the account's keys at once; the aggregates hold no account.
  expect(f.keys.docs).toHaveLength(0);
  const second = f.add();
  expect((await f.service.record(ME, { events: [{ postId: second, type: 'impression' }], visit: true }, NOW)).accepted).toBe(0);
  expect(f.totals()?.['visitors']).toBe(1);
});

it('counts aggregates only, keyed by an HMAC that never contains the account id', async () => {
  const f = fixture();
  const post = f.add();
  expect(await f.service.record(ME, { events: [{ postId: post, type: 'impression' }, { postId: post, type: 'videoStart' }] }, NOW)).toEqual({ accepted: 2, dropped: 0 });
  expect(f.totals()?.['counts']).toEqual({ impression: 1, videoStart: 1 });
  expect(f.daily.docs.find((row) => row.postId === post)?.['counts']).toEqual({ impression: 1, videoStart: 1 });
  for (const row of [...f.daily.docs, ...f.keys.docs]) expect(JSON.stringify(row)).not.toContain(ME + '"');
  expect(f.keys.docs.every((row) => /^[A-Za-z0-9_-]{43}$/.test(String(row['key'])))).toBe(true);
  // Keys expire within days; aggregates after 90.
  expect(Math.max(...f.keys.docs.map((row) => (row['expiresAt'] as Date).getTime()))).toBe(NOW.getTime() + 2 * DAY);
  expect((f.totals()?.['expiresAt'] as Date).getTime()).toBe(NOW.getTime() + 90 * DAY);
});

it('counts each account, post and event once a day', async () => {
  const f = fixture();
  const post = f.add();
  await f.service.record(ME, { events: [{ postId: post, type: 'impression' }] }, NOW);
  expect((await f.service.record(ME, { events: [{ postId: post, type: 'impression' }] }, NOW)).accepted).toBe(0);
  await f.service.record('other', { events: [{ postId: post, type: 'impression' }] }, NOW);
  expect(f.totals()?.['counts']).toEqual({ impression: 2 });
});

it('drops posts the viewer may not see in For You, and engagement that did not happen', async () => {
  const f = fixture();
  const ok = f.add();
  const hidden = f.add();
  f.unreadable.add(hidden);
  const own = f.add(ME);
  const repost = f.add('author', { repostOf: ok });
  const result = await f.service.record(
    ME,
    {
      events: [
        { postId: ok, type: 'like' },
        { postId: ok, type: 'comment' },
        { postId: hidden, type: 'impression' },
        { postId: own, type: 'impression' },
        { postId: repost, type: 'impression' },
        { postId: 'not-an-id', type: 'impression' },
      ],
    },
    NOW,
  );
  expect(result.accepted).toBe(0);
  f.likes.docs.push({ _id: new Types.ObjectId(), postId: ok, userId: ME });
  f.comments.docs.push({ _id: new Types.ObjectId(), postId: ok, userId: ME, deleted: false });
  f.posts.docs.push({ _id: new Types.ObjectId(), userId: ME, repostOf: ok, deleted: false });
  expect((await f.service.record(ME, { events: [{ postId: ok, type: 'like' }, { postId: ok, type: 'comment' }, { postId: ok, type: 'repost' }] }, NOW)).accepted).toBe(3);
});

it('counts Not interested only when the feedback exists', async () => {
  const f = fixture();
  const post = f.add();
  expect((await f.service.record(ME, { events: [{ postId: post, type: 'notInterested' }] }, NOW)).accepted).toBe(0);
  f.notInterested.add(post);
  expect((await f.service.record(ME, { events: [{ postId: post, type: 'notInterested' }] }, NOW)).accepted).toBe(1);
  // …and nothing else about a post the viewer dismissed.
  expect((await f.service.record(ME, { events: [{ postId: post, type: 'impression' }] }, NOW)).accepted).toBe(0);
});

it('stops at the daily cap', async () => {
  const f = fixture();
  const batch = () => ({ events: Array.from({ length: 20 }, () => ({ postId: f.add(), type: 'impression' as const })) });
  expect((await f.service.record(ME, batch(), NOW)).accepted).toBe(20);
  const quota = f.keys.docs.find((row) => row['count'] !== undefined);
  if (!quota) throw new Error('no quota row');
  quota['count'] = 1990;
  expect(await f.service.record(ME, batch(), NOW)).toEqual({ accepted: 10, dropped: 10 });
  expect(await f.service.record(ME, batch(), NOW)).toEqual({ accepted: 0, dropped: 20 });
  expect(f.totals()?.['counts']).toEqual({ impression: 30 });
});

it('counts a visitor once a day, and as returning after a visit in the last week', async () => {
  const f = fixture();
  await f.service.record(ME, { events: [], visit: true }, new Date(NOW.getTime() - 3 * DAY));
  await f.service.record(ME, { events: [], visit: true }, NOW);
  await f.service.record(ME, { events: [], visit: true }, NOW);
  await f.service.record('new', { events: [], visit: true }, NOW);
  expect(f.totals()).toMatchObject({ visitors: 2, returningVisitors: 1 });
});

it('reports aggregates to the developer only', async () => {
  const f = fixture();
  const post = f.add();
  await f.service.record(ME, { events: [{ postId: post, type: 'impression' }] }, NOW);
  await expect(f.service.report(ME, 7, NOW)).rejects.toThrow(ForbiddenException);
  const report = await f.service.report('dev', 7, NOW);
  expect(report).toMatchObject({ from: '2026-11-07', to: '2026-11-13', minDenominator: 30 });
  expect(report.posts).toEqual([{ postId: post, counts: { impression: 1 }, engagementRate: null, completionRate: null, quickSkipRate: null }]);
});
