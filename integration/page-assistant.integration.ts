/**
 * Spec 041: the assistant for pages, through the real API and Mongo, by the connector's
 * `/mcp/call` endpoint. The person must allow assistants; the page must be marked "run with
 * AI"; everything counted is capped and listed; one person's pages never engage with each other.
 */
import { randomUUID } from 'node:crypto';
import type { AssistantActivity, MyPages, PageSummary } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

interface Called {
  status: number;
  body: { result?: Record<string, unknown> & unknown[]; code?: string; message?: string };
}

async function connector(who: Account) {
  const token = (await api.call<{ token: string }>(who, 'POST', '/mcp/token')).body.token;
  expect(token).toBeTruthy();
  return async (tool: string, args: Record<string, unknown> = {}): Promise<Called> => {
    const response = await fetch(`${api.url}/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, tool, arguments: args }),
    });
    return { status: response.status, body: (await response.json().catch(() => ({}))) as Called['body'] };
  };
}
const allow = (who: Account) => api.call(who, 'PUT', '/pages/assistant', { enabled: true });
const name = (prefix: string) => `${prefix}-${randomUUID().slice(0, 6)}`;

describe('the assistant for pages', () => {
  it('does nothing until the person allows it, and only as a page marked run with AI', async () => {
    const ana = await api.account('ana');
    const call = await connector(ana);
    const byHand = await api.call<PageSummary>(ana, 'POST', '/pages', { name: 'By hand', username: name('hand'), bio: '' });

    const refused = await call('create_page', { name: 'Robot', username: name('robot') });
    expect([refused.status, refused.body.code]).toEqual([403, 'ASSISTANT_OFF']);
    expect((await allow(ana)).status).toBe(200);
    expect((await api.call<MyPages>(ana, 'GET', '/pages')).body.assistant).toBe(true);

    // A page made by hand is not the assistant's until its manager marks it.
    const notAi = await call('create_page_post', { pageId: byHand.body.id, caption: 'Hello' });
    expect([notAi.status, notAi.body.code]).toEqual([403, 'PAGE_NOT_AI']);

    const made = await call('create_page', { name: 'Robot kitchen', username: name('robot') });
    expect(made.status).toBeLessThan(300);
    const pageId = String(made.body.result?.['id']);
    const row = await api.db.collection('users').findOne({ kind: 'page', name: 'Robot kitchen' });
    expect(row).toMatchObject({ aiManaged: true, managers: [ana.id] });
    expect(await api.db.collection('social_profiles').countDocuments({ userId: pageId, aiManaged: true })).toBe(1);

    const listed = await call('list_my_pages');
    const pages = listed.body.result?.['pages'] as { id: string; usable: boolean }[];
    expect(pages.find((page) => page.id === pageId)?.usable).toBe(true);
    expect(pages.find((page) => page.id === byHand.body.id)?.usable).toBe(false);

    // Somebody else's connector cannot use the page.
    const beka = await api.account('beka');
    await allow(beka);
    const stranger = await (await connector(beka))('create_page_post', { pageId, caption: 'Not mine' });
    expect([stranger.status, stranger.body.code]).toEqual([403, 'NOT_A_MANAGER']);

    // Turning the consent off stops everything again.
    await api.call(ana, 'PUT', '/pages/assistant', { enabled: false });
    expect((await call('create_page_post', { pageId, caption: 'After' })).body.code).toBe('ASSISTANT_OFF');
  });

  it('builds a library, posts from it, saves a draft and publishes it', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    await allow(ana);
    const call = await connector(ana);
    const pageId = String((await call('create_page', { name: 'Robot deli', username: name('deli') })).body.result?.['id']);

    const food = await call('create_page_food', { pageId, name: 'Lentil soup', servingSize: 300, energyKcal: 80, proteinMg: 5000, fatMg: 2000, carbMg: 10_000 });
    expect(food.status).toBeLessThan(300);
    const foodId = String(food.body.result?.['id']);
    const recipe = await call('create_page_recipe', { pageId, name: 'Soup bowl', foods: [{ foodId, amount: 300 }] });
    expect(recipe.status).toBeLessThan(300);
    expect(((await call('list_page_foods', { pageId })).body.result as unknown[]).length).toBe(1);

    const posted = await call('create_page_post', { pageId, caption: 'A soup to save', title: 'Lentil soup', foodId });
    expect(posted.status).toBeLessThan(300);
    const postId = String(posted.body.result?.['id']);
    const read = await api.call<{ author: { isPage?: boolean; aiManaged?: boolean }; items: unknown[] }>(beka, 'GET', `/posts/${postId}`);
    expect(read.status).toBe(200);
    expect(read.body.author).toMatchObject({ isPage: true, aiManaged: true });
    expect(read.body.items).toHaveLength(1);

    const draft = await call('create_page_post', { pageId, caption: 'Not yet', draft: true });
    const draftId = String(draft.body.result?.['id']);
    expect(draft.body.result?.['draft']).toBe(true);
    expect((await api.call(beka, 'GET', `/posts/${draftId}`)).status).toBe(404);
    expect((await call('publish_page_draft', { pageId, postId: draftId })).status).toBeLessThan(300);
    expect((await api.call(beka, 'GET', `/posts/${draftId}`)).status).toBe(200);

    const mine = await call('list_page_posts', { pageId });
    expect((mine.body.result?.['posts'] as unknown[]).length).toBe(2);
    // Bad input is refused before anything happens.
    expect((await call('create_page_food', { pageId, name: 'No numbers' })).status).toBe(400);

    const activity = await api.call<AssistantActivity>(ana, 'GET', `/page-assistant/activity/${pageId}`);
    expect(activity.body.actions.map((action) => action.tool)).toEqual(expect.arrayContaining(['create_page_food', 'create_page_post', 'publish_page_draft']));
    expect(activity.body.today.find((row) => row.kind === 'post')).toMatchObject({ used: 3 });
    expect((await api.call(beka, 'GET', `/page-assistant/activity/${pageId}`)).status).toBe(403);
    expect(JSON.stringify(activity.body)).not.toContain('A soup to save');
  });

  it('engages with others, never with the same person’s pages, and stops at the cap', async () => {
    const owner = await api.account('owner');
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    await allow(ana);
    await allow(beka);
    const call = await connector(ana);
    const first = String((await call('create_page', { name: 'Robot one', username: name('one') })).body.result?.['id']);
    const second = String((await call('create_page', { name: 'Robot two', username: name('two') })).body.result?.['id']);
    const other = String((await (await connector(beka))('create_page', { name: 'Other robot', username: name('other') })).body.result?.['id']);
    const theirs = await (await connector(beka))('create_page_post', { pageId: other, caption: 'From the other page' });
    const theirPost = String(theirs.body.result?.['id']);
    const sibling = await call('create_page_post', { pageId: second, caption: 'From the sibling' });
    const siblingPost = String(sibling.body.result?.['id']);

    // One person's pages do not follow, like or comment on each other.
    for (const [tool, args] of [
      ['follow_page', { pageId: first, targetPageId: second }],
      ['like_post', { pageId: first, postId: siblingPost }],
      ['comment_on_post', { pageId: first, postId: siblingPost, text: 'Great!' }],
    ] as const) {
      const answer = await call(tool, args);
      expect([tool, answer.status, answer.body.code]).toEqual([tool, 403, 'SAME_MANAGER']);
    }
    expect(await api.db.collection('follows').countDocuments({ followerId: first })).toBe(0);

    expect((await call('follow_page', { pageId: first, targetPageId: other })).status).toBeLessThan(300);
    expect((await call('like_post', { pageId: first, postId: theirPost })).status).toBeLessThan(300);
    expect((await call('comment_on_post', { pageId: first, postId: theirPost, text: 'Saved this.' })).status).toBeLessThan(300);
    const following = await call('get_following', { pageId: first });
    expect((following.body.result?.['posts'] as { id: string }[]).map((post) => post.id)).toContain(theirPost);
    const comments = await call('get_post_comments', { pageId: first, postId: theirPost });
    expect((comments.body.result?.['comments'] as { text: string; author: { isPage: boolean } }[])[0]).toMatchObject({ text: 'Saved this.', author: { isPage: true } });

    // The owner lowers this person's comment cap to what is already used: the next is refused.
    const { CONFIG } = await import('../apps/api/src/config/configuration');
    api.app.get<{ developerUserId?: string }>(CONFIG).developerUserId = owner.id;
    try {
      expect((await api.call(ana, 'PUT', `/page-assistant/caps/${ana.id}`, { caps: { comment: 1 } })).status).toBe(403);
      expect((await api.call(owner, 'PUT', `/page-assistant/caps/${ana.id}`, { caps: { comment: 1 } })).status).toBe(200);
      const capped = await call('comment_on_post', { pageId: first, postId: theirPost, text: 'Again.' });
      expect([capped.status, capped.body.code]).toEqual([429, 'CAP_REACHED']);
      // Lifted for this person: it goes through.
      expect((await api.call(owner, 'PUT', `/page-assistant/caps/${ana.id}`, { caps: { comment: -1 } })).status).toBe(200);
      expect((await call('comment_on_post', { pageId: first, postId: theirPost, text: 'Again.' })).status).toBeLessThan(300);
      // The defaults are the owner's to change, and a zero stops a kind for everyone without an override.
      const defaults = await api.call<Record<string, number>>(owner, 'GET', '/page-assistant/caps');
      expect(defaults.body).toMatchObject({ post: 10, comment: 30 });
      expect((await api.call(owner, 'PUT', '/page-assistant/caps', { caps: { ...defaults.body, like: 0 } })).status).toBe(200);
      expect((await call('like_post', { pageId: second, postId: theirPost })).body.code).toBe('CAP_REACHED');
      expect((await api.call(owner, 'PUT', '/page-assistant/caps', { caps: defaults.body })).status).toBe(200);
      expect((await api.call(owner, 'PUT', `/page-assistant/caps/${ana.id}`, { caps: null })).status).toBe(200);
    } finally {
      api.app.get<{ developerUserId?: string }>(CONFIG).developerUserId = undefined;
    }

    // Deleting a page takes its log with it.
    expect(await api.db.collection('page_assistant_actions').countDocuments({ pageId: first })).toBeGreaterThan(0);
    expect((await api.call(ana, 'DELETE', `/pages/${first}`)).status).toBe(200);
    expect(await api.db.collection('page_assistant_actions').countDocuments({ pageId: first })).toBe(0);
  });
});
