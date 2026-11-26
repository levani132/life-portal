/**
 * Spec 046: a portal opened without an account. Only people findable by strangers (and pages);
 * only what is public; two newest public posts in the narrow preview form; and the signed-in
 * lookup from an address to an account.
 */
import { randomUUID } from 'node:crypto';
import type { PageSummary, PublicPortal } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

async function named(who: Account, discoverable: boolean): Promise<string> {
  const username = `p${randomUUID().slice(0, 8)}`;
  expect((await api.call(who, 'PUT', '/social/me', { username, displayName: `Name ${username}`, bio: 'Lifts and lentils', discoverable })).status).toBe(200);
  return username;
}
const post = (who: Account, caption: string, audience: string) =>
  api.call<{ id: string }>(who, 'POST', '/posts', { requestId: randomUUID(), title: '', caption, audience });

describe('the open portal', () => {
  it('shows a findable person’s public side to a visitor, and nothing else', async () => {
    const ana = await api.account('ana');
    const username = await named(ana, true);
    await post(ana, 'Oldest public', 'public');
    await post(ana, 'Middle public', 'public');
    await post(ana, 'Friends only', 'friends');
    await post(ana, 'Newest public', 'public');
    await post(ana, 'Private', 'private');

    const open = await api.call<PublicPortal>(null, 'GET', `/public/portals/${username}`);
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({ username, displayName: `Name ${username}`, bio: 'Lifts and lentils' });
    expect(open.body.posts.map((row) => row.caption)).toEqual(['Newest public', 'Middle public']);
    // The visitor's answer names no account id and carries no tracking data.
    expect(JSON.stringify(open.body)).not.toContain(ana.id);
    expect(open.body.widgets).toEqual([]);
    // With an @ too, and in any case.
    expect((await api.call(null, 'GET', `/public/portals/@${username.toUpperCase()}`)).status).toBe(200);
  });

  it('keeps a person who is not findable private, and opens a page', async () => {
    const beka = await api.account('beka');
    const username = await named(beka, false);
    const hidden = await api.call<{ code?: string }>(null, 'GET', `/public/portals/${username}`);
    expect([hidden.status, hidden.body.code]).toEqual([404, 'PORTAL_PRIVATE']);
    expect((await api.call(null, 'GET', '/public/portals/nobody-here')).status).toBe(404);

    const page = (await api.call<PageSummary>(beka, 'POST', '/pages', { name: 'Open kitchen', username: `open-${randomUUID().slice(0, 6)}`, bio: 'Soups' })).body;
    const opened = await api.call<PublicPortal>(null, 'GET', `/public/portals/${page.username}`);
    expect(opened.body).toMatchObject({ displayName: 'Open kitchen', isPage: true });
  });

  it('turns an address into an account for members, never across a block', async () => {
    const ana = await api.account('ana');
    const gio = await api.account('gio');
    const username = await named(ana, false);
    expect((await api.call<{ userId: string }>(gio, 'GET', `/social/usernames/${username}`)).body.userId).toBe(ana.id);
    await api.call(ana, 'PUT', `/social/connections/${gio.id}`, { action: 'block' });
    expect((await api.call(gio, 'GET', `/social/usernames/${username}`)).status).toBe(404);
    expect((await api.call(null, 'GET', `/social/usernames/${username}`)).status).toBe(401);
  });
});
