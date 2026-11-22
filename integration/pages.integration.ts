/**
 * Spec 040, slice 1: pages through the real API and Mongo. A person creates a page, acts as it
 * with a header on their own session, and posts as it; a page cannot log anything personal;
 * nobody else can act as it; deleting it, or its only manager, leaves nothing behind.
 */
import { randomUUID } from 'node:crypto';
import type { FoodPost, Identity, MyPages, PageSummary } from '@life-portal/shared-types';
import type { AdminAccountsPage } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });
const text = (caption: string, audience = 'public') => ({ requestId: randomUUID(), title: '', caption, audience });

async function pageOf(owner: Account, username: string): Promise<PageSummary> {
  const made = await api.call<PageSummary>(owner, 'POST', '/pages', { name: `Page ${username}`, username, bio: 'About' });
  expect(made.status).toBe(201);
  return made.body;
}

describe('a page', () => {
  it('is created by a person, who then acts as it and posts as it', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = await pageOf(ana, `kitchen-${randomUUID().slice(0, 6)}`);
    expect((await api.call<MyPages>(ana, 'GET', '/pages')).body).toMatchObject({ pages: [{ id: page.id }], remaining: 2 });

    // The same session, with the header: the app is now the page.
    const identity = await api.call<Identity>(ana, 'GET', '/identity', undefined, as(page.id));
    expect(identity.body).toMatchObject({ kind: 'page', id: page.id, personId: ana.id });
    const me = await api.call<{ userId: string; isPage?: boolean }>(ana, 'GET', '/social/me', undefined, as(page.id));
    expect(me.body).toMatchObject({ userId: page.id, isPage: true });

    const posted = await api.call<FoodPost>(ana, 'POST', '/posts', text('From the page'), as(page.id));
    expect(posted.status).toBe(201);
    expect(posted.body.author).toMatchObject({ userId: page.id, isPage: true });
    expect(JSON.stringify(posted.body)).not.toContain(ana.id);

    // Another member reads it as a page's post, and learns nothing about who is behind it.
    const read = await api.call<FoodPost>(beka, 'GET', `/posts/${posted.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.author).toMatchObject({ userId: page.id, isPage: true });
    expect(JSON.stringify(read.body)).not.toContain(ana.id);

    // A page has followers, not friends, and posts to everyone or to nobody.
    expect((await api.call(ana, 'POST', '/posts', text('Friends only', 'friends'), as(page.id))).status).toBe(400);
    expect((await api.call(beka, 'PUT', `/social/connections/${page.id}`, { action: 'request' })).status).toBe(409);
  });

  it('cannot log anything personal, and person routes ignore the header', async () => {
    const ana = await api.account('ana');
    const page = await pageOf(ana, `gym-${randomUUID().slice(0, 6)}`);
    const today = new Date().toISOString().slice(0, 10);
    for (const [method, path, body] of [
      ['GET', `/nutrition?today=${today}&day=${today}`, undefined],
      ['PUT', '/nutrition/weigh-ins', { day: today, weightGrams: 80_000 }],
      ['POST', '/training/sessions', {}],
      ['GET', '/dashboard', undefined],
      ['POST', '/badges/check', {}],
      ['GET', '/cashflow', undefined],
    ] as const) {
      const answer = await api.call<{ code?: string }>(ana, method, path, body, as(page.id));
      expect([path, answer.status, answer.body?.code]).toEqual([path, 403, 'NOT_FOR_PAGES']);
    }
    // The library is open to a page.
    expect((await api.call(ana, 'GET', '/nutrition/foods', undefined, as(page.id))).status).toBe(200);
    expect((await api.call(ana, 'GET', '/training/plans', undefined, as(page.id))).status).toBe(200);
    // Signing in and the account are always the person's.
    expect((await api.call<{ id: string }>(ana, 'GET', '/auth/me', undefined, as(page.id))).body.id).toBe(ana.id);
  });

  it('can be acted as only by its manager, and nobody signs in as it', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = await pageOf(ana, `mine-${randomUUID().slice(0, 6)}`);
    const stranger = await api.call<{ code?: string }>(beka, 'GET', '/social/me', undefined, as(page.id));
    expect([stranger.status, stranger.body.code]).toEqual([403, 'NOT_A_MANAGER']);
    // Not a page at all: nobody acts as another person.
    expect((await api.call(beka, 'GET', '/social/me', undefined, as(ana.id))).status).toBe(403);
    expect((await api.call(beka, 'PATCH', `/pages/${page.id}`, { name: 'Taken', username: 'taken-over', bio: '' })).status).toBe(403);

    const row = await api.db.collection('users').findOne({ kind: 'page', managers: ana.id });
    expect(row?.['passwordHash']).toBeUndefined();
    const signIn = await api.call(null, 'POST', '/auth/login', { email: row?.['email'], password: 'anything-at-all' }, { 'X-Forwarded-For': '10.9.9.9' });
    expect(signIn.status).toBe(401);
  });

  it('holds a person to three pages and one username to one owner', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const tag = randomUUID().slice(0, 6);
    for (const n of [1, 2, 3]) await pageOf(ana, `p${n}-${tag}`);
    const fourth = await api.call<{ code?: string }>(ana, 'POST', '/pages', { name: 'Four', username: `p4-${tag}` });
    expect([fourth.status, fourth.body.code]).toEqual([403, 'PAGE_LIMIT']);
    const clash = await api.call<{ code?: string }>(beka, 'POST', '/pages', { name: 'Mine', username: `p1-${tag}` });
    expect([clash.status, clash.body.code]).toEqual([409, 'USERNAME_TAKEN']);
    expect(await api.db.collection('users').countDocuments({ kind: 'page', createdBy: beka.id })).toBe(0);
  });

  it('leaves nothing behind when it is deleted, or when its only manager is', async () => {
    const ana = await api.account('ana');
    const page = await pageOf(ana, `gone-${randomUUID().slice(0, 6)}`);
    const posted = await api.call<FoodPost>(ana, 'POST', '/posts', text('Soon gone'), as(page.id));
    expect((await api.call(ana, 'DELETE', `/pages/${page.id}`)).status).toBe(200);
    for (const [collection, filter] of [
      ['users', { kind: 'page', managers: ana.id }],
      ['social_profiles', { userId: page.id }],
      ['food_posts', { userId: page.id }],
    ] as const) {
      expect([collection, await api.db.collection(collection).countDocuments(filter)]).toEqual([collection, 0]);
    }
    expect((await api.call(ana, 'GET', `/posts/${posted.body.id}`)).status).toBe(404);
    // The header now names a page that is gone: the person is told, not served as someone else.
    expect((await api.call(ana, 'GET', '/social/me', undefined, as(page.id))).status).toBe(403);

    const second = await pageOf(ana, `gone2-${randomUUID().slice(0, 6)}`);
    await api.call(ana, 'POST', '/posts', text('Also gone'), as(second.id));
    // An account with no password confirms by typing its email, like one made with Google.
    await api.db.collection('users').updateOne({ email: ana.email }, { $unset: { passwordHash: 1 } });
    expect((await api.call(ana, 'POST', '/account/delete', { confirmEmail: ana.email })).status).toBe(200);
    expect(await api.db.collection('users').countDocuments({ $or: [{ email: ana.email }, { managers: ana.id }] })).toBe(0);
    expect(await api.db.collection('food_posts').countDocuments({ userId: second.id })).toBe(0);
  });

  it('lets the owner change one person\'s page limit, and suspend a page alone', async () => {
    const owner = await api.account('owner');
    const ana = await api.account('ana');
    const tag = randomUUID().slice(0, 6);
    for (const n of [1, 2, 3]) await pageOf(ana, `l${n}-${tag}`);
    const limit = (who: Account, value: number | null) => api.call(who, 'PUT', `/people-admin/${ana.id}/page-limit`, { limit: value });
    // Nobody but the owner sees People or changes a limit.
    expect((await limit(ana, 20)).status).toBe(403);
    expect((await api.call(ana, 'GET', '/people-admin')).status).toBe(403);

    const { CONFIG } = await import('../apps/api/src/config/configuration');
    api.app.get<{ developerUserId?: string }>(CONFIG).developerUserId = owner.id;
    try {
      expect((await limit(owner, 4)).status).toBe(200);
      const fourth = await pageOf(ana, `l4-${tag}`);
      expect((await api.call<{ code?: string }>(ana, 'POST', '/pages', { name: 'Five', username: `l5-${tag}` })).body.code).toBe('PAGE_LIMIT');
      expect((await limit(owner, -1)).status).toBe(200);
      await pageOf(ana, `l5-${tag}`);
      // Back to the default: what exists stays, and no more can be made.
      expect((await limit(owner, null)).status).toBe(200);
      expect((await api.call<{ code?: string }>(ana, 'POST', '/pages', { name: 'Six', username: `l6-${tag}` })).body.code).toBe('PAGE_LIMIT');
      expect((await limit(owner, 5000)).status).toBe(400);

      const people = await api.call<AdminAccountsPage>(owner, 'GET', '/people-admin?kind=people&q=ana');
      const row = people.body.accounts.find((account) => account.id === ana.id);
      expect(row).toMatchObject({ kind: 'person', pagesCreated: 5, suspended: false });
      expect(row?.pageLimit).toBeUndefined();
      expect(JSON.stringify(people.body)).not.toContain(ana.email);
      const pages = await api.call<AdminAccountsPage>(owner, 'GET', `/people-admin?kind=pages&q=l4-${tag}`);
      expect(pages.body.accounts).toEqual([expect.objectContaining({ id: fourth.id, kind: 'page', followerCount: 0, official: false })]);
      expect(pages.body.accounts[0].managers).toHaveLength(1);

      // Suspending the page alone: nobody acts as it, its posts are hidden, its manager is untouched.
      const posted = await api.call<FoodPost>(ana, 'POST', '/posts', text('Before'), as(fourth.id));
      expect((await api.call(owner, 'POST', `/auth/accounts/${fourth.id}/suspend`, { reason: 'test' })).status).toBeLessThan(300);
      const acting = await api.call<{ code?: string }>(ana, 'GET', '/social/me', undefined, as(fourth.id));
      expect([acting.status, acting.body.code]).toEqual([403, 'PAGE_SUSPENDED']);
      expect((await api.call(owner, 'GET', `/posts/${posted.body.id}`)).status).toBe(404);
      expect((await api.call(ana, 'GET', '/auth/me')).status).toBe(200);
      expect((await api.call(owner, 'POST', `/auth/accounts/${fourth.id}/unsuspend`)).status).toBeLessThan(300);
      expect((await api.call(ana, 'GET', '/social/me', undefined, as(fourth.id))).status).toBe(200);
    } finally {
      api.app.get<{ developerUserId?: string }>(CONFIG).developerUserId = undefined;
    }
  });
});
