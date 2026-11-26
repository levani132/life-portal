/**
 * Spec 045: a page's notifications reach its managers' phones always, or, if a manager chose so,
 * only on a device that is using the app as that page. A person's own notifications open as them.
 */
import { randomUUID } from 'node:crypto';
import type { FoodPost, NotificationPreferences, PageSummary, PushPayload } from '@life-portal/shared-types';
import { startApi, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('notifications for a page’s managers', () => {
  it('reach every device by default, and only the device using the page once a manager asks', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Shop', username: `shop-${randomUUID().slice(0, 6)}`, bio: '' })).body;

    // Two phones of Ana's: one using the app as the page, one as herself.
    const device = (endpoint: string, actingAs?: string) => ({
      userId: ana.id,
      endpoint,
      keys: { p256dh: 'k', auth: 'a' },
      label: endpoint,
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(actingAs ? { actingAs } : {}),
    });
    await api.db.collection('push_devices').insertMany([device('https://push.example/as-page', page.id), device('https://push.example/as-ana')]);
    await api.db.collection('notification_preferences').insertOne({ userId: ana.id, enabled: true });

    const { PushSender } = await import('../apps/api/src/notifications/push-sender');
    const sender = api.app.get(PushSender);
    const sent: { endpoint: string; payload: PushPayload }[] = [];
    Object.defineProperty(sender, 'configured', { get: () => true });
    sender.send = (async (target: { endpoint: string }, payload: PushPayload) => {
      sent.push({ endpoint: target.endpoint, payload });
      return 'ok';
    }) as never;

    const comment = async (caption: string) => {
      const post = (await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption, audience: 'public' }, as(page.id))).body;
      await api.call(beka, 'POST', `/posts/${post.id}/comments`, { text: 'Nice', requestId: randomUUID() });
      await wait(400);
    };

    await comment('First');
    expect(sent.map((row) => row.endpoint).sort()).toEqual(['https://push.example/as-ana', 'https://push.example/as-page']);
    expect(sent[0].payload.url).toContain(`as=${page.id}`);

    // Ana chooses "only while using the app as this page".
    const prefs = await api.call<NotificationPreferences>(ana, 'PUT', `/notifications/pages/${page.id}`, { onlyWhileActing: true });
    expect(prefs.body.pagesWhileActing).toEqual([page.id]);
    sent.length = 0;
    await comment('Second');
    expect(sent.map((row) => row.endpoint)).toEqual(['https://push.example/as-page']);

    // Back to always; and nobody else can set it for a page they do not manage.
    await api.call(ana, 'PUT', `/notifications/pages/${page.id}`, { onlyWhileActing: false });
    expect((await api.call(beka, 'PUT', `/notifications/pages/${page.id}`, { onlyWhileActing: true })).status).toBe(404);
    sent.length = 0;
    await comment('Third');
    expect(sent).toHaveLength(2);

    // Ana's own notification opens as her, whichever identity the app was using.
    await api.db.collection('notification_preferences').updateOne({ userId: ana.id }, { $set: { enabled: true } });
    sent.length = 0;
    const own = (await api.call<FoodPost>(ana, 'POST', '/posts', { requestId: randomUUID(), title: '', caption: 'Mine', audience: 'public' })).body;
    await api.call(beka, 'POST', `/posts/${own.id}/comments`, { text: 'Hi Ana', requestId: randomUUID() });
    await wait(400);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((row) => row.payload.url.endsWith('as=me'))).toBe(true);
  });

  it('records a device as using a page only if its person manages it', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = (await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'Desk', username: `desk-${randomUUID().slice(0, 6)}`, bio: '' })).body;
    const { NotificationsService } = await import('../apps/api/src/notifications/notifications.service');
    const service = api.app.get(NotificationsService);
    const sub = (n: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: 'k', auth: 'a' } });
    await service.registerDevice(ana.id, sub('ana'), 'Phone', false, page.id);
    await service.registerDevice(beka.id, sub('beka'), 'Phone', false, page.id);
    expect(await api.db.collection('push_devices').findOne({ userId: ana.id })).toMatchObject({ actingAs: page.id });
    expect((await api.db.collection('push_devices').findOne({ userId: beka.id }))?.['actingAs']).toBeUndefined();
    // Switching back to herself clears it.
    await service.registerDevice(ana.id, sub('ana'), 'Phone', false, null);
    expect((await api.db.collection('push_devices').findOne({ userId: ana.id }))?.['actingAs']).toBeUndefined();
  });
});
