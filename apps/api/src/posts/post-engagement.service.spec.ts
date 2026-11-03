import { NotFoundException } from '@nestjs/common';
import {
  PostEngagementService,
  PostLikeSchema,
  PostCommentSchema,
} from './post-engagement.service';

function fixture() {
  const likes = {
    countDocuments: jest.fn(async () => 1),
    exists: jest.fn(async () => ({})),
    updateOne: jest.fn(async (..._args: unknown[]) => ({ upsertedCount: 0 })),
    deleteOne: jest.fn(),
  };
  const row = {
    _id: 'a'.repeat(24),
    userId: 'reader',
    postId: 'post',
    requestId: 'request',
    text: 'Hello',
    deleted: false,
    createdAt: new Date('2026-11-02T00:00:00Z'),
  };
  const chain = {
    sort: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn(async () => [row]),
  };
  chain.sort.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  const comments = {
    countDocuments: jest.fn(async () => 1),
    updateOne: jest.fn(async (..._args: unknown[]) => ({ matchedCount: 1 })),
    findOne: jest.fn(() => ({ lean: async () => row })),
    find: jest.fn(() => chain),
  };
  const posts = { detail: jest.fn(async () => ({ isOwner: false })) };
  const social = {
    own: jest.fn(),
    postAuthor: jest.fn(async () => ({
      userId: 'reader',
      displayName: 'Reader',
      username: 'reader',
    })),
  };
  const graph = {
    between: jest.fn(async () => ({ blockedBy: [] as string[] })),
  };
  const notifications = { notify: jest.fn(async () => undefined) };
  return {
    likes,
    comments,
    posts,
    row,
    chain,
    graph,
    social,
    notifications,
    service: new PostEngagementService(
      likes as never,
      comments as never,
      posts as never,
      social as never,
      graph as never,
      notifications as never,
    ),
  };
}
it('checks current post access before every engagement read or write', async () => {
  const f = fixture();
  f.posts.detail.mockRejectedValue(new NotFoundException());
  await expect(f.service.stats('reader', 'post')).rejects.toThrow(
    NotFoundException,
  );
  await expect(f.service.setLike('reader', 'post', true)).rejects.toThrow(
    NotFoundException,
  );
  await expect(f.service.list('reader', 'post')).rejects.toThrow(
    NotFoundException,
  );
  await expect(
    f.service.add('reader', 'post', 'Hello', 'request'),
  ).rejects.toThrow(NotFoundException);
  expect(f.likes.countDocuments).not.toHaveBeenCalled();
  expect(f.likes.updateOne).not.toHaveBeenCalled();
  expect(f.comments.updateOne).not.toHaveBeenCalled();
});
it('uses idempotent likes and enforces uniqueness in the database', async () => {
  const f = fixture();
  await f.service.setLike('reader', 'post', true);
  await f.service.setLike('reader', 'post', true);
  expect(f.likes.updateOne).toHaveBeenCalledWith(
    { postId: 'post', userId: 'reader' },
    { $setOnInsert: { postId: 'post', userId: 'reader' } },
    { upsert: true },
  );
  expect(PostLikeSchema.indexes()).toEqual(
    expect.arrayContaining([
      [{ postId: 1, userId: 1 }, expect.objectContaining({ unique: true })],
    ]),
  );
  await f.service.setLike('reader', 'post', false);
  expect(f.likes.deleteOne).toHaveBeenCalledWith({
    postId: 'post',
    userId: 'reader',
  });
});
it('deduplicates comment retries without overwriting previously accepted text', async () => {
  const f = fixture();
  expect(
    (await f.service.add('reader', 'post', ' Hello ', 'request')).text,
  ).toBe('Hello');
  await f.service.add('reader', 'post', 'Hello', 'request');
  expect(f.comments.updateOne).toHaveBeenCalledWith(
    { postId: 'post', userId: 'reader', requestId: 'request' },
    {
      $setOnInsert: {
        postId: 'post',
        userId: 'reader',
        requestId: 'request',
        text: 'Hello',
        deleted: false,
      },
    },
    { upsert: true },
  );
  expect(PostCommentSchema.indexes()).toEqual(
    expect.arrayContaining([
      [
        { postId: 1, userId: 1, requestId: 1 },
        expect.objectContaining({ unique: true }),
      ],
    ]),
  );
});
it('validates comments and pagination before writing', async () => {
  const f = fixture();
  await expect(
    f.service.add('reader', 'post', '   ', 'request'),
  ).rejects.toThrow('1–1,000');
  await expect(
    f.service.add('reader', 'post', 'x'.repeat(1001), 'request'),
  ).rejects.toThrow('1–1,000');
  await expect(f.service.list('reader', 'post', 'bad cursor')).rejects.toThrow(
    'cursor',
  );
  expect(f.comments.updateOne).not.toHaveBeenCalled();
});
it('allows only the commenter or the post owner to remove a comment', async () => {
  const f = fixture();
  await f.service.remove('reader', 'post', f.row._id);
  expect(f.comments.updateOne).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'reader',
      postId: 'post',
      _id: f.row._id,
    }),
    { $set: { deleted: true, text: '' } },
  );
  f.posts.detail.mockResolvedValue({ isOwner: true });
  await f.service.remove('owner', 'post', f.row._id);
  expect(f.comments.updateOne.mock.calls.at(-1)?.[0]).not.toHaveProperty(
    'userId',
  );
});
it('hides blocked commenters and returns bounded pages', async () => {
  const f = fixture();
  f.row.userId = 'blocked';
  f.graph.between.mockResolvedValue({ blockedBy: ['reader'] });
  expect((await f.service.list('reader', 'post')).comments).toEqual([]);
  expect(f.chain.limit).toHaveBeenCalledWith(21);
});

it('notifies the post owner once for a new like or comment, never for repeats', async () => {
  const f = fixture();
  const post = { id: 'post', title: 'Lunch', isOwner: false, author: { userId: 'owner' } };
  f.posts.detail.mockResolvedValue(post as never);
  f.social.own.mockResolvedValue({ displayName: 'Reader' } as never);
  f.likes.updateOne.mockResolvedValueOnce({ upsertedCount: 1 });
  await f.service.setLike('reader', 'post', true);
  await f.service.setLike('reader', 'post', true);
  f.comments.updateOne.mockResolvedValueOnce({ matchedCount: 0, upsertedCount: 1 } as never);
  await f.service.add('reader', 'post', 'Looks great', 'request');
  await f.service.add('reader', 'post', 'Looks great', 'request');
  expect(f.notifications.notify.mock.calls).toEqual([
    [
      {
        type: 'postLike',
        recipientId: 'owner',
        actorId: 'reader',
        actorName: 'Reader',
        targetId: 'post',
        postTitle: 'Lunch',
      },
    ],
    [
      {
        type: 'postComment',
        commentText: 'Looks great',
        recipientId: 'owner',
        actorId: 'reader',
        actorName: 'Reader',
        targetId: 'post',
        postTitle: 'Lunch',
      },
    ],
  ]);
});
