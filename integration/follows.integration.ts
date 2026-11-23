/**
 * Spec 040, slice 2: following a page through the real API and Mongo. A follow puts the page's
 * public posts in the follower's Following feed; unfollowing, a block and deleting either side
 * end it; nobody follows a person.
 */
import { randomUUID } from 'node:crypto';
import type { FoodPost, PageSummary, PostPage, SocialProfile, SuggestedPage } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });
const text = (caption: string, audience = 'public') => ({ requestId: randomUUID(), title: '', caption, audience });
const today = new Date().toISOString().slice(0, 10);

async function pageOf(owner: Account, name: string): Promise<PageSummary> {
  const made = await api.call<PageSummary>(owner, 'POST', '/pages', { name, username: `${name}-${randomUUID().slice(0, 6)}`.toLowerCase(), bio: 'About' });
  expect(made.status).toBe(201);
  return made.body;
}
const following = async (viewer: Account, headers?: Record<string, string>) =>
  (await api.call<PostPage>(viewer, 'GET', '/posts?preview=normal', undefined, headers)).body.posts.map((post) => post.id);
const profile = async (viewer: Account, id: string) => (await api.call<SocialProfile>(viewer, 'GET', `/social/profiles/${id}?today=${today}`)).body;

describe('following a page', () => {
  it('puts its public posts in Following, and unfollowing takes them out', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = await pageOf(ana, 'kitchen');
    const open = await api.call<FoodPost>(ana, 'POST', '/posts', text('For everyone'), as(page.id));
    const closed = await api.call<FoodPost>(ana, 'POST', '/posts', text('Not shared', 'private'), as(page.id));
    expect([open.status, closed.status]).toEqual([201, 201]);

    expect(await following(beka)).not.toContain(open.body.id);
    expect(await profile(beka, page.id)).toMatchObject({ isPage: true, followerCount: 0, following: false });

    expect((await api.call(beka, 'PUT', `/follows/${page.id}`, {})).status).toBe(200);
    // Twice is still once.
    expect((await api.call(beka, 'PUT', `/follows/${page.id}`, {})).status).toBe(200);
    expect(await api.db.collection('follows').countDocuments({ pageId: page.id })).toBe(1);

    const feed = await following(beka);
    expect(feed).toContain(open.body.id);
    expect(feed).not.toContain(closed.body.id);
    expect(await profile(beka, page.id)).toMatchObject({ followerCount: 1, following: true });
    // The follower list is not shown; the page's manager is still named nowhere.
    expect(JSON.stringify(await profile(beka, page.id))).not.toContain(ana.id);

    expect((await api.call(beka, 'DELETE', `/follows/${page.id}`)).status).toBe(200);
    expect(await following(beka)).not.toContain(open.body.id);
    expect(await profile(beka, page.id)).toMatchObject({ followerCount: 0, following: false });
  });

  it('is for pages only, and a page can follow a page', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const mine = await pageOf(ana, 'mine');
    const theirs = await pageOf(beka, 'theirs');
    // A person does not follow a person, a page does not follow itself, and nonsense is not found.
    expect((await api.call(ana, 'PUT', `/follows/${beka.id}`, {})).status).toBe(404);
    // A page may follow a person: their public posts, and only those, reach its Following feed.
    const open = await api.call<FoodPost>(beka, 'POST', '/posts', text('Beka in public'));
    const friendsOnly = await api.call<FoodPost>(beka, 'POST', '/posts', text('Beka to friends', 'friends'));
    expect((await api.call(ana, 'PUT', `/follows/${beka.id}`, {}, as(mine.id))).status).toBe(200);
    const pageFeed = await following(ana, as(mine.id));
    expect(pageFeed).toContain(open.body.id);
    expect(pageFeed).not.toContain(friendsOnly.body.id);
    await api.call(beka, 'GET', '/social/me');
    expect((await api.call<SocialProfile>(ana, 'GET', `/social/profiles/${beka.id}?today=${today}`, undefined, as(mine.id))).body).toMatchObject({ following: true });
    // The person is shown no follower count, and their own profile says nothing of it.
    const own = (await api.call<SocialProfile>(beka, 'GET', `/social/me?today=${today}`)).body;
    expect(own.followerCount).toBeUndefined();
    expect(own.following).toBeUndefined();
    expect((await api.call(ana, 'DELETE', `/follows/${beka.id}`, undefined, as(mine.id))).status).toBe(200);
    expect(await following(ana, as(mine.id))).not.toContain(open.body.id);
    expect((await api.call(ana, 'PUT', `/follows/${mine.id}`, {}, as(mine.id))).status).toBe(409);
    expect((await api.call(ana, 'PUT', '/follows/not-an-id', {})).status).toBe(404);

    const post = await api.call<FoodPost>(beka, 'POST', '/posts', text('From theirs'), as(theirs.id));
    expect((await api.call(ana, 'PUT', `/follows/${theirs.id}`, {}, as(mine.id))).status).toBe(200);
    expect(await following(ana, as(mine.id))).toContain(post.body.id);
    // The page follows it; the person behind the page does not.
    expect(await following(ana)).not.toContain(post.body.id);
    expect(await api.db.collection('follows').countDocuments({ followerId: mine.id, pageId: theirs.id })).toBe(1);
    expect(await api.db.collection('follows').countDocuments({ followerId: ana.id })).toBe(0);
  });

  it('offers pages to follow, official first, and never one already followed or your own', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const gio = await api.account('gio');
    const plain = await pageOf(ana, 'plain');
    const official = await pageOf(ana, 'official');
    await api.call(gio, 'PUT', `/follows/${plain.id}`, {});
    await api.db.collection('users').updateOne({ kind: 'page', createdBy: ana.id, name: 'official' }, { $set: { official: true } });
    await api.db.collection('social_profiles').updateOne({ userId: official.id }, { $set: { official: true } });

    const offered = (await api.call<SuggestedPage[]>(beka, 'GET', '/follows/suggested')).body;
    const ids = offered.map((row) => row.userId);
    expect(ids.indexOf(official.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(official.id)).toBeLessThan(ids.indexOf(plain.id));
    expect(offered.find((row) => row.userId === official.id)).toMatchObject({ official: true, followerCount: 0 });
    expect(offered.find((row) => row.userId === plain.id)).toMatchObject({ followerCount: 1 });

    await api.call(beka, 'PUT', `/follows/${plain.id}`, {});
    const after = (await api.call<SuggestedPage[]>(beka, 'GET', '/follows/suggested')).body.map((row) => row.userId);
    expect(after).not.toContain(plain.id);
    // A manager is not offered their own pages.
    const own = (await api.call<SuggestedPage[]>(ana, 'GET', '/follows/suggested')).body.map((row) => row.userId);
    expect(own).not.toContain(plain.id);
    expect(own).not.toContain(official.id);

    // Marking a page official is the owner's alone.
    expect((await api.call(ana, 'PUT', `/pages/${plain.id}/official`, { official: true })).status).toBe(403);
  });

  it('ends with a block, and leaves nothing when either side is deleted', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const gio = await api.account('gio');
    const page = await pageOf(ana, 'blocky');
    const post = await api.call<FoodPost>(ana, 'POST', '/posts', text('Seen until blocked'), as(page.id));
    await api.call(beka, 'PUT', `/follows/${page.id}`, {});
    await api.call(gio, 'PUT', `/follows/${page.id}`, {});

    // A follower blocks the page: the follow ends and cannot be made again while the block stands.
    expect((await api.call(beka, 'PUT', `/social/connections/${page.id}`, { action: 'block' })).status).toBe(200);
    expect(await api.db.collection('follows').countDocuments({ followerId: beka.id, pageId: page.id })).toBe(0);
    expect(await following(beka)).not.toContain(post.body.id);
    expect((await api.call(beka, 'PUT', `/follows/${page.id}`, {})).status).toBe(404);

    expect(await api.db.collection('follows').countDocuments({ pageId: page.id })).toBe(1);
    expect((await api.call(ana, 'DELETE', `/pages/${page.id}`)).status).toBe(200);
    expect(await api.db.collection('follows').countDocuments({ pageId: page.id })).toBe(0);

    // A follower who deletes their account takes their follows with them.
    const second = await pageOf(ana, 'second');
    await api.call(gio, 'PUT', `/follows/${second.id}`, {});
    await api.db.collection('users').updateOne({ email: gio.email }, { $unset: { passwordHash: 1 } });
    expect((await api.call(gio, 'POST', '/account/delete', { confirmEmail: gio.email })).status).toBe(200);
    expect(await api.db.collection('follows').countDocuments({ followerId: gio.id })).toBe(0);
  });
});

describe('a page blocking a person (spec 040)', () => {
  it('can block and unblock, and do nothing else with connections', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = await pageOf(ana, 'guard');
    await api.call(beka, 'PUT', `/follows/${page.id}`, {});

    expect((await api.call(ana, 'PUT', `/social/connections/${beka.id}`, { action: 'request' }, as(page.id))).status).toBe(409);
    expect((await api.call(ana, 'PUT', `/social/connections/${beka.id}`, { action: 'block' }, as(page.id))).status).toBe(200);
    // The follow is gone, the page is out of reach, and the block is the page's, not its manager's.
    expect(await api.db.collection('follows').countDocuments({ followerId: beka.id, pageId: page.id })).toBe(0);
    expect((await api.call(beka, 'PUT', `/follows/${page.id}`, {})).status).toBe(404);
    expect((await api.call(beka, 'GET', `/social/profiles/${page.id}?today=${today}`)).status).toBe(404);
    expect(await api.db.collection('social_connections').countDocuments({ $or: [{ lowId: ana.id }, { highId: ana.id }] })).toBe(0);

    const blocked = await api.call<{ people: { userId: string }[] }>(ana, 'GET', '/social/connections?kind=blocked&skip=0', undefined, as(page.id));
    expect(blocked.body.people.map((person) => person.userId)).toEqual([beka.id]);
    expect((await api.call<{ people: unknown[] }>(ana, 'GET', '/social/connections?kind=friends&skip=0', undefined, as(page.id))).body.people).toEqual([]);

    expect((await api.call(ana, 'PUT', `/social/connections/${beka.id}`, { action: 'unblock' }, as(page.id))).status).toBe(200);
    expect((await api.call(beka, 'PUT', `/follows/${page.id}`, {})).status).toBe(200);
  });
});
