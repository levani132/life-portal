/**
 * Spec 045: on a page run with AI, what a person writes through the app (a post, a comment, a
 * message) carries "by a person"; what the assistant writes does not, and neither does anything
 * on a page not run with AI. Reactions carry no mark.
 */
import { randomUUID } from 'node:crypto';
import type { ChatMessage, FoodPost, MessagesPage, PageSummary, PostComment, PostCommentsPage } from '@life-portal/shared-types';
import { startApi, type Account, type TestApi } from './harness';

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
});
afterAll(() => api?.close());

const as = (pageId: string) => ({ 'x-lp-act-as': pageId });
const post = (who: Account, caption: string, headers?: Record<string, string>) =>
  api.call<FoodPost>(who, 'POST', '/posts', { requestId: randomUUID(), title: '', caption, audience: 'public' }, headers);

async function pageOf(owner: Account, name: string, ai: boolean): Promise<PageSummary> {
  const made = await api.call<PageSummary>(owner, 'POST', '/pages', { name, username: `${name}-${randomUUID().slice(0, 6)}`, bio: '' });
  expect(made.status).toBe(201);
  if (ai) expect((await api.call(owner, 'PATCH', `/pages/${made.body.id}`, { name: made.body.name, username: made.body.username, bio: '', aiManaged: true })).status).toBe(200);
  return made.body;
}

describe('the "by a person" mark', () => {
  it('marks what a person writes as a page run with AI, and nothing else', async () => {
    const ana = await api.account('ana');
    const beka = await api.account('beka');
    const robot = await pageOf(ana, 'robot', true);
    const plain = await pageOf(ana, 'plain', false);

    // A post by hand on the AI page is marked; on the plain page, and by a person as themselves, it is not.
    const byHand = await post(ana, 'Written by me', as(robot.id));
    expect(byHand.body.byPerson).toBe(true);
    expect((await post(ana, 'Plain page', as(plain.id))).body.byPerson).toBeUndefined();
    expect((await post(ana, 'As myself')).body.byPerson).toBeUndefined();
    // Everyone else sees the mark too.
    expect((await api.call<FoodPost>(beka, 'GET', `/posts/${byHand.body.id}`)).body.byPerson).toBe(true);

    // The assistant's post on the same page is not marked.
    const { PostsService } = await import('../apps/api/src/posts/posts.service');
    const byAssistant = await api.app.get(PostsService).create(robot.id, { requestId: randomUUID(), title: '', caption: 'From the assistant', audience: 'public' } as never);
    expect(byAssistant.byPerson).toBeUndefined();

    // Comments: by hand as the AI page, marked; as a person, not.
    const theirs = await post(beka, 'Beka asks something');
    const comment = await api.call<PostComment>(ana, 'POST', `/posts/${theirs.body.id}/comments`, { text: 'Answer by hand', requestId: randomUUID() }, as(robot.id));
    expect(comment.body.byPerson).toBe(true);
    await api.call(beka, 'POST', `/posts/${theirs.body.id}/comments`, { text: 'Thanks', requestId: randomUUID() });
    const listed = (await api.call<PostCommentsPage>(beka, 'GET', `/posts/${theirs.body.id}/comments`)).body.comments;
    expect(listed.map((row) => [row.text, row.byPerson])).toEqual([
      ['Thanks', undefined],
      ['Answer by hand', true],
    ]);

    // Messages: Beka writes to the page; the reply by hand is marked for both sides.
    const opened = await api.call<{ id: string }>(beka, 'POST', '/messages/conversations', { userId: robot.id });
    await api.call(beka, 'POST', `/messages/conversations/${opened.body.id}/messages`, { requestId: randomUUID(), text: 'Hi' });
    const reply = await api.call<ChatMessage>(ana, 'POST', `/messages/conversations/${opened.body.id}/messages`, { requestId: randomUUID(), text: 'Hello from a person' }, as(robot.id));
    expect(reply.body.byPerson).toBe(true);
    const seen = (await api.call<MessagesPage>(beka, 'GET', `/messages/conversations/${opened.body.id}/messages`)).body.messages;
    expect(seen.map((row) => [row.text, row.byPerson])).toEqual([
      ['Hi', undefined],
      ['Hello from a person', true],
    ]);
  });
});
