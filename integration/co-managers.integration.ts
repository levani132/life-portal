/**
 * Spec 045: co-managers through the real API and Mongo. A manager invites a person by username;
 * they accept or decline; the creator removes, anyone leaves, the last manager stays. A page is
 * suspended only when none of its managers can act.
 */
import { randomUUID } from 'node:crypto';
import type { MyPages, PageInvite, PageManagers, PageSummary } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });
async function usernameOf(who: Account): Promise<string> {
  const row = await api.db.collection('social_profiles').findOne({ userId: who.id });
  if (row?.['username']) return String(row['username']);
  const name = `u${randomUUID().slice(0, 8)}`;
  await api.call(who, 'PUT', '/social/me', { username: name, displayName: name, bio: '', discoverable: true });
  return (await api.db.collection('social_profiles').findOne({ userId: who.id }))?.['username'] ?? name;
}

describe('co-managers', () => {
  it('invites, accepts, posts as the page, leaves; the creator removes; the last one stays', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const gio = await api.account('gio');
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Team kitchen', username: `team-${randomUUID().slice(0, 6)}`, bio: '' })).body;

    // Before an invitation, Beka cannot act as the page.
    expect((await api.call(beka, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'Hi', audience: 'public' }, as(page.id))).status).toBe(403);
    const bekaName = await usernameOf(beka);
    const invited = await api.call<PageManagers>(ana, 'POST', `/pages/${page.id}/managers`, { username: bekaName });
    expect(invited.status).toBe(201);
    expect(invited.body.invites.map((row) => row.userId)).toEqual([beka.id]);
    expect((await api.call<{ code?: string }>(ana, 'POST', `/pages/${page.id}/managers`, { username: 'nobody-has-this' })).body.code).toBe('NO_SUCH_PERSON');
    // Nobody else can see or change the page's managers.
    expect((await api.call(gio, 'GET', `/pages/${page.id}/managers`)).status).toBe(403);

    const waiting = await api.call<PageInvite[]>(beka, 'GET', '/pages/invites/mine');
    expect(waiting.body).toMatchObject([{ page: { id: page.id, name: 'Team kitchen' } }]);
    // Only Beka can answer it.
    expect((await api.call(gio, 'PUT', `/pages/invites/${waiting.body[0].id}`, { accept: true })).status).toBe(404);
    const accepted = await api.call<MyPages>(beka, 'PUT', `/pages/invites/${waiting.body[0].id}`, { accept: true });
    expect(accepted.body.pages.map((row) => row.id)).toContain(page.id);
    expect((await api.call(beka, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'From Beka', audience: 'public' }, as(page.id))).status).toBe(201);

    const list = (await api.call<PageManagers>(beka, 'GET', `/pages/${page.id}/managers`)).body;
    expect(list.managers.map((row) => [row.userId, row.creator, row.you, row.mayRemove])).toEqual([
      [ana.id, true, false, false],
      [beka.id, false, true, true],
    ]);
    // Beka cannot remove the creator; Ana (the creator) can remove Beka.
    expect((await api.call<{ code?: string }>(beka, 'DELETE', `/pages/${page.id}/managers/${ana.id}`)).body.code).toBe('CANNOT_REMOVE');
    expect((await api.call(ana, 'DELETE', `/pages/${page.id}/managers/${beka.id}`)).status).toBe(200);
    expect((await api.call(beka, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'Again', audience: 'public' }, as(page.id))).status).toBe(403);

    // The last manager cannot leave.
    expect((await api.call<{ code?: string }>(ana, 'DELETE', `/pages/${page.id}/managers/${ana.id}`)).body.code).toBe('LAST_MANAGER');

    // A declined invitation is simply gone.
    const gioName = await usernameOf(gio);
    await api.call(ana, 'POST', `/pages/${page.id}/managers`, { username: gioName });
    const gioInvite = (await api.call<PageInvite[]>(gio, 'GET', '/pages/invites/mine')).body[0];
    await api.call(gio, 'PUT', `/pages/invites/${gioInvite.id}`, { accept: false });
    expect((await api.call<PageManagers>(ana, 'GET', `/pages/${page.id}/managers`)).body).toMatchObject({ invites: [], managers: [{ userId: ana.id }] });
  });

  it('suspends a page only when every manager is suspended, and restores it with one', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Shared', username: `shared-${randomUUID().slice(0, 6)}`, bio: '' })).body;
    await api.call(ana, 'POST', `/pages/${page.id}/managers`, { username: await usernameOf(beka) });
    const invite = (await api.call<PageInvite[]>(beka, 'GET', '/pages/invites/mine')).body[0];
    await api.call(beka, 'PUT', `/pages/invites/${invite.id}`, { accept: true });

    const { AuthService } = await import('../apps/api/src/auth/auth.service');
    const auth = api.app.get(AuthService);
    const suspended = async () => !!(await api.db.collection('users').findOne({ _id: new (await import('mongodb')).ObjectId(page.id) }))?.['suspendedAt'];
    await auth.suspend(ana.id, 'test');
    expect(await suspended()).toBe(false);
    await auth.suspend(beka.id, 'test');
    expect(await suspended()).toBe(true);
    await auth.unsuspend(beka.id);
    expect(await suspended()).toBe(false);
  });
});
