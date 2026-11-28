/**
 * Spec 048: a portal's wallpaper. A preset is stored by name and shown to whoever can open the
 * portal (visitors included, once the portal is public); a page has one of its own; "No wallpaper" clears it.
 * Own photos go through storage, which this harness does not run.
 */
import { randomUUID } from 'node:crypto';
import type { PageSummary, PublicPortal, SocialProfile } from '@life-portal/shared-types';
import { startApi, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

describe('portal wallpaper', () => {
  it('is a preset everyone who opens the portal sees, never on a page, and can be cleared', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const username = `w${randomUUID().slice(0, 8)}`;
    await api.call(ana, 'PUT', '/social/me', { username, displayName: 'Ana', bio: '', discoverable: true });

    expect((await api.call(ana, 'PUT', '/social/me/wallpaper', { preset: 'not-a-preset' })).status).toBe(400);
    expect((await api.call(ana, 'PUT', '/social/me/wallpaper', {})).status).toBe(400);
    const set = await api.call<{ wallpaper: unknown }>(ana, 'PUT', '/social/me/wallpaper', { preset: 'aurora' });
    expect(set.status).toBe(200);
    expect(set.body.wallpaper).toEqual({ preset: 'aurora' });

    expect((await api.call<SocialProfile>(ana, 'GET', '/social/me')).body.wallpaper).toEqual({ preset: 'aurora' });
    expect((await api.call<SocialProfile>(beka, 'GET', `/social/profiles/${ana.id}`)).body.wallpaper).toEqual({ preset: 'aurora' });
    expect((await api.call<PublicPortal>(null, 'GET', `/public/portals/${username}`)).body.wallpaper).toEqual({ preset: 'aurora' });

    // A page has one too, set by its manager acting as it; the person's own is untouched.
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Wall page', username: `wp-${randomUUID().slice(0, 6)}`, bio: '' })).body;
    expect((await api.call(ana, 'PUT', '/social/me/wallpaper', { preset: 'dusk' }, { 'x-lp-act-as': page.id })).status).toBe(200);
    expect((await api.call<SocialProfile>(beka, 'GET', `/social/profiles/${page.id}`)).body.wallpaper).toEqual({ preset: 'dusk' });
    expect((await api.call<SocialProfile>(ana, 'GET', '/social/me')).body.wallpaper).toEqual({ preset: 'aurora' });

    expect((await api.call(ana, 'DELETE', '/social/me/wallpaper')).status).toBe(200);
    expect((await api.call<SocialProfile>(ana, 'GET', '/social/me')).body.wallpaper).toBeUndefined();
  });
});
