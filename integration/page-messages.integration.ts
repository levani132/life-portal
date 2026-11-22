/**
 * Spec 040, slice 3: messages with a page, through the real API and Mongo. Anyone may write to
 * a page; the conversation is the page's, not its manager's; a page writes first only to
 * someone who follows it.
 */
import { randomUUID } from 'node:crypto';
import type { ChatMessage, ConversationView, InboxEntry, PageSummary } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });
const say = (text: string) => ({ requestId: randomUUID(), text });

async function pageOf(owner: Account, name: string): Promise<PageSummary> {
  const made = await api.call<PageSummary>(owner, 'POST', '/pages', { name, username: `${name}-${randomUUID().slice(0, 6)}`, bio: '' });
  expect(made.status).toBe(201);
  return made.body;
}
const open = (who: Account, otherId: string, headers?: Record<string, string>) =>
  api.call<{ id: string }>(who, 'POST', '/messages/conversations', { userId: otherId }, headers);

describe('messages with a page', () => {
  it('lets a stranger write to a page; the page answers; the manager’s own inbox stays empty', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = await pageOf(ana, 'shop');

    const opened = await open(beka, page.id);
    expect(opened.status).toBeLessThan(300);
    const sent = await api.call<ChatMessage>(beka, 'POST', `/messages/conversations/${opened.body.id}/messages`, say('Do you deliver?'));
    expect(sent.status).toBeLessThan(300);

    const pageInbox = await api.call<InboxEntry[]>(ana, 'GET', '/messages/conversations', undefined, as(page.id));
    expect(pageInbox.body.map((entry) => entry.id)).toEqual([opened.body.id]);
    expect(pageInbox.body[0].other).toMatchObject({ userId: beka.id });
    expect((await api.call<InboxEntry[]>(ana, 'GET', '/messages/conversations')).body).toEqual([]);
    // The manager, as themselves, is not a member of the page's conversation.
    expect((await api.call(ana, 'GET', `/messages/conversations/${opened.body.id}`)).status).toBe(404);

    const reply = await api.call<ChatMessage>(ana, 'POST', `/messages/conversations/${opened.body.id}/messages`, say('We do.'), as(page.id));
    expect(reply.status).toBeLessThan(300);
    const view = await api.call<ConversationView>(beka, 'GET', `/messages/conversations/${opened.body.id}`);
    expect(view.body).toMatchObject({ canSend: true, other: { userId: page.id, isPage: true } });
    expect(JSON.stringify(view.body)).not.toContain(ana.id);
  });

  it('does not let a page write first to someone who has nothing to do with it', async () => {
    const ana = await api.account('ana');
    const gio = await api.account('gio');
    const page = await pageOf(ana, 'loud');
    expect((await open(ana, gio.id, as(page.id))).status).toBe(403);

    // Once they follow it, it may; and a block ends that.
    expect((await api.call(gio, 'PUT', `/follows/${page.id}`, {})).status).toBe(200);
    const opened = await open(ana, gio.id, as(page.id));
    expect(opened.status).toBeLessThan(300);
    expect((await api.call(ana, 'POST', `/messages/conversations/${opened.body.id}/messages`, say('Thanks for following'), as(page.id))).status).toBeLessThan(300);
    expect((await api.call(gio, 'PUT', `/social/connections/${page.id}`, { action: 'block' })).status).toBe(200);
    expect((await api.call(ana, 'POST', `/messages/conversations/${opened.body.id}/messages`, say('Still there?'), as(page.id))).status).toBe(403);
  });

  it('takes the page’s conversations with it when the page is deleted', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const page = await pageOf(ana, 'brief');
    const opened = await open(beka, page.id);
    await api.call(beka, 'POST', `/messages/conversations/${opened.body.id}/messages`, say('Hello'));
    expect((await api.call(ana, 'DELETE', `/pages/${page.id}`)).status).toBe(200);
    expect(await api.db.collection('conversations').countDocuments({ memberIds: page.id })).toBe(0);
    expect(await api.db.collection('messages').countDocuments({ conversationId: opened.body.id })).toBe(0);
  });
});
