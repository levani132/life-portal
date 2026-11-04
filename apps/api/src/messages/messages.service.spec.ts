import { FEATURE_IDS, type FeatureAccess, type NotificationEvent } from '@life-portal/shared-types';
import type { NotificationTypeDef } from '../notifications/notifications.service';
import { MessagesService } from './messages.service';

const all = Object.fromEntries(FEATURE_IDS.map((id) => [id, true])) as FeatureAccess;
const NOW = new Date('2026-11-03T12:00:00Z');
const CONV = 'c'.repeat(24);
const lean = <T>(value: T) => ({ lean: async () => value, select: () => ({ lean: async () => value }) });

function fixture() {
  const conversation = {
    _id: CONV,
    kind: 'direct',
    pair: 'ana:ben',
    memberIds: ['ana', 'ben'],
    members: [{ userId: 'ana' }, { userId: 'ben' } as Record<string, unknown>],
  };
  const conversations = {
    findOne: jest.fn((filter: Record<string, unknown>) =>
      lean(
        !filter['memberIds'] || conversation.memberIds.includes(filter['memberIds'] as string)
          ? conversation
          : null,
      ),
    ),
    updateOne: jest.fn(async (..._args: unknown[]) => ({})),
    find: jest.fn(() => ({ limit: () => ({ lean: async () => [conversation] }) })),
  };
  let stored: Record<string, unknown> | null = null;
  const messages = {
    findOne: jest.fn(() => lean(stored)),
    updateOne: jest.fn(async (filter: Record<string, unknown>, update: { $setOnInsert: Record<string, unknown> }) => {
      stored = { _id: 'm'.repeat(24), ...update.$setOnInsert };
      return { upsertedCount: 1, matchedCount: 0 };
    }),
    countDocuments: jest.fn(async (..._args: unknown[]) => 0),
    aggregate: jest.fn(async () => [] as unknown[]),
    exists: jest.fn(async () => null),
  };
  const graph = {
    between: jest.fn(async () => ({ state: 'accepted', blockedBy: [] as string[] }) as unknown),
  };
  const access = { forUser: jest.fn(async () => ({ access: all })) };
  const social = {
    authors: jest.fn(async () => new Map([['ben', { userId: 'ben', displayName: 'Ben', username: 'ben' }]])),
    own: jest.fn(async () => ({ displayName: 'Ana' })),
  };
  const posts = {
    detail: jest.fn(async (): Promise<unknown> => ({
      id: 'p'.repeat(24),
      title: 'Lunch',
      author: { displayName: 'Ana' },
      kind: 'meal',
      totalKcal: 640,
      caption: '',
      media: [],
    })),
  };
  const defs: NotificationTypeDef[] = [];
  const notifications = {
    notify: jest.fn(async (_e: NotificationEvent) => undefined),
    register: jest.fn((def: NotificationTypeDef) => defs.push(def)),
    registerBadgeSource: jest.fn(),
  };
  const service = new MessagesService(
    conversations as never,
    messages as never,
    graph as never,
    access as never,
    social as never,
    posts as never,
    notifications as never,
  );
  service.now = () => NOW;
  service.onModuleInit();
  return {
    service,
    conversation,
    conversations,
    messages,
    graph,
    access,
    posts,
    notifications,
    defs,
    setStored: (row: Record<string, unknown> | null) => {
      stored = row;
    },
  };
}

const request = '5b1f2d6e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

describe('who can message', () => {
  it('opens the one conversation per pair only between friends', async () => {
    const f = fixture();
    await expect(f.service.open('ana', 'ben')).resolves.toEqual({ id: CONV });
    expect(f.conversations.updateOne).toHaveBeenCalledWith(
      { kind: 'direct', pair: 'ana:ben' },
      expect.anything(),
      { upsert: true },
    );
    f.graph.between.mockResolvedValueOnce({ state: 'pending', blockedBy: [] });
    await expect(f.service.open('ana', 'ben')).rejects.toThrow('friends only');
    f.graph.between.mockResolvedValueOnce({ state: 'none', blockedBy: ['ben'] });
    await expect(f.service.open('ana', 'ben')).rejects.toThrow('can’t message');
    // Refusals create nothing.
    expect(f.conversations.updateOne).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for a conversation the caller is not in', async () => {
    const f = fixture();
    await expect(f.service.view('cat', CONV)).rejects.toThrow('Conversation not found.');
    await expect(f.service.page('cat', CONV)).rejects.toThrow('Conversation not found.');
    await expect(f.service.view('ana', 'not-an-id')).rejects.toThrow('Conversation not found.');
  });

  it('keeps history readable but refuses new messages after unfriending', async () => {
    const f = fixture();
    f.graph.between.mockResolvedValue({ state: 'none', blockedBy: [] });
    const view = await f.service.view('ana', CONV);
    expect(view).toMatchObject({ canSend: false, cannotSendReason: 'not-friends' });
    await expect(f.service.send('ana', CONV, { requestId: request, text: 'hi' })).rejects.toThrow(
      'friends only',
    );
  });
});

describe('sending', () => {
  it('stores a text once and notifies the other member without the text in the event kind', async () => {
    const f = fixture();
    const message = await f.service.send('ana', CONV, { requestId: request, text: '  hi Ben ' });
    expect(message).toMatchObject({ mine: true, kind: 'text', text: 'hi Ben', requestId: request });
    expect(f.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message',
        recipientId: 'ben',
        actorId: 'ana',
        actorName: 'Ana',
        targetId: CONV,
        messageKind: 'text',
        messageText: 'hi Ben',
      }),
    );
  });

  it('returns the original on a retry and never notifies twice', async () => {
    const f = fixture();
    f.setStored({
      _id: 'm'.repeat(24),
      senderId: 'ana',
      requestId: request,
      kind: 'text',
      text: 'hi',
      createdAt: NOW,
    });
    // Even if the friendship ended in between, the stored message comes back.
    f.graph.between.mockResolvedValue({ state: 'none', blockedBy: [] });
    const again = await f.service.send('ana', CONV, { requestId: request, text: 'hi' });
    expect(again.text).toBe('hi');
    expect(f.messages.updateOne).not.toHaveBeenCalled();
    expect(f.notifications.notify).not.toHaveBeenCalled();
  });

  it('limits a member to 30 messages a minute', async () => {
    const f = fixture();
    f.messages.countDocuments.mockResolvedValueOnce(30);
    await expect(f.service.send('ana', CONV, { requestId: request, text: 'hi' })).rejects.toThrow(
      'too fast',
    );
  });

  it('only sends posts the sender can see, and needs exactly one of text or post', async () => {
    const f = fixture();
    f.posts.detail.mockRejectedValueOnce(new Error('Post not found.'));
    await expect(
      f.service.send('ana', CONV, { requestId: request, postId: 'p'.repeat(24) }),
    ).rejects.toThrow('posts you can see');
    await expect(
      f.service.send('ana', CONV, { requestId: request, text: 'x', postId: 'p'.repeat(24) }),
    ).rejects.toThrow('either');
  });
});

describe('reading', () => {
  it('renders a shared post with the viewer’s own access, or as unavailable', async () => {
    const f = fixture();
    const row = {
      _id: 'm'.repeat(24),
      senderId: 'ana',
      requestId: request,
      kind: 'post',
      postId: 'p'.repeat(24),
      createdAt: NOW,
    };
    (f.messages as Record<string, unknown>)['find'] = jest.fn(() => ({
      sort: () => ({ limit: () => ({ lean: async () => [row] }) }),
    }));
    f.posts.detail.mockRejectedValueOnce(new Error('Post not found.'));
    const page = await f.service.page('ben', CONV);
    expect(page.messages[0]).toMatchObject({ mine: false, kind: 'post', post: { unavailable: true } });
    expect(page.messages[0].requestId).toBeUndefined();
    expect(f.posts.detail).toHaveBeenCalledWith('ben', 'p'.repeat(24));
    // The sender, who can see it, gets the card.
    const own = await f.service.page('ana', CONV);
    expect(own.messages[0].post).toEqual({ id: 'p'.repeat(24), title: 'Lunch', authorName: 'Ana', totalKcal: 640 });
  });

  it('sync marks the caller read and viewing, and reports the other member’s read time', async () => {
    const f = fixture();
    f.conversation.members[0] = { userId: 'ana', lastReadAt: new Date('2026-11-03T11:00:00Z') };
    const result = await f.service.sync('ben', CONV);
    expect(f.conversations.updateOne).toHaveBeenCalledWith(
      { _id: CONV, 'members.userId': 'ben' },
      { $set: { 'members.$.lastReadAt': NOW, 'members.$.viewingAt': NOW } },
    );
    expect(result).toMatchObject({
      otherLastReadAt: '2026-11-03T11:00:00.000Z',
      canSend: true,
      serverTime: NOW.toISOString(),
      messages: [],
      unsentIds: [],
    });
  });

  it('unsend is for the sender only and erases the content', async () => {
    const f = fixture();
    (f.messages.updateOne as jest.Mock).mockResolvedValueOnce({ matchedCount: 0 });
    await expect(f.service.unsend('ben', CONV, 'e'.repeat(24))).rejects.toThrow('Message not found.');
    expect(f.messages.updateOne).toHaveBeenCalledWith(
      { _id: 'e'.repeat(24), conversationId: CONV, senderId: 'ben' },
      { $set: { unsentAt: NOW }, $unset: { text: '', postId: '' } },
    );
  });

  it('counts unread as the other member’s live messages since you last read', async () => {
    const f = fixture();
    f.conversation.members[1] = { userId: 'ben', lastReadAt: new Date('2026-11-03T10:00:00Z') };
    await f.service.unreadCount('ben');
    expect(f.messages.exists).toHaveBeenCalledWith({
      conversationId: CONV,
      senderId: { $ne: 'ben' },
      unsentAt: { $exists: false },
      createdAt: { $gt: new Date('2026-11-03T10:00:00Z') },
    });
  });
});

describe('notification suppression', () => {
  const event = {
    type: 'message' as const,
    recipientId: 'ben',
    actorId: 'ana',
    actorName: 'Ana',
    targetId: CONV,
  };
  it('skips a recipient viewing the conversation or who muted it', async () => {
    const f = fixture();
    const suppress = f.defs[0].suppress as (e: NotificationEvent) => Promise<boolean>;
    expect(await suppress(event)).toBe(false);
    f.conversation.members[1] = { userId: 'ben', viewingAt: new Date(NOW.getTime() - 5_000) };
    expect(await suppress(event)).toBe(true);
    f.conversation.members[1] = { userId: 'ben', viewingAt: new Date(NOW.getTime() - 60_000) };
    expect(await suppress(event)).toBe(false);
    f.conversation.members[1] = { userId: 'ben', muted: true };
    expect(await suppress(event)).toBe(true);
  });
  it('registers one collapsing type per conversation and a badge source', () => {
    const f = fixture();
    expect(f.defs[0]).toMatchObject({ type: 'message', requires: ['messages'], windowMs: 0 });
    expect(f.defs[0].collapseKey(event)).toBe(CONV);
    expect(f.defs[0].url(event)).toBe(`/messages/${CONV}`);
    expect(f.notifications.registerBadgeSource).toHaveBeenCalled();
  });
});
