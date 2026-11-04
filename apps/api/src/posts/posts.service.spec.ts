import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { PostsService } from './posts.service';
import type { FoodPublication } from '@life-portal/shared-types';
import type { CreatePostDto } from './posts.dto';
const publication: FoodPublication = {
  kind: 'food',
  label: 'Oats',
  items: [
    {
      key: '0',
      name: 'Oats',
      unit: 'g',
      servingSize: 100,
      energyKcalPer100: 380,
      proteinMgPer100: 14000,
      carbMgPer100: 65000,
      fatMgPer100: 8000,
    },
  ],
};
function fixture() {
  const row = {
    _id: new Types.ObjectId(),
    userId: 'owner',
    requestId: 'request',
    previewHash: 'hash',
    title: 'Oats',
    caption: '',
    audience: 'private',
    deleted: false,
    publication,
    createdAt: new Date('2026-10-22T10:00:00Z'),
    updatedAt: new Date('2026-10-22T10:00:00Z'),
  };
  const posts = {
    findOne: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(row) }),
    updateOne: jest.fn(),
  };
  const reports = {
    exists: jest.fn().mockResolvedValue(null),
    updateOne: jest.fn(),
    findById: jest.fn(),
    updateMany: jest.fn(),
  };
  const access = {
    requireDeveloper: jest.fn(),
    require: jest.fn().mockResolvedValue(undefined),
    forUser: jest.fn().mockResolvedValue({
      access: { social: true, nutrition: true, foodPosts: true },
    }),
  };
  const social = {
    postAuthor: jest.fn().mockResolvedValue({
      userId: 'owner',
      displayName: 'Owner',
      username: 'owner',
    }),
  };
  const graph = {
    between: jest.fn().mockResolvedValue({ state: 'none', blockedBy: [] }),
  };
  const media = {
    sign: jest.fn().mockResolvedValue([]),
    reserve: jest.fn().mockResolvedValue([]),
    claim: jest.fn(),
    removeForPost: jest.fn(),
  };
  const nutrition = { snapshot: jest.fn().mockResolvedValue(publication) };
  const service = new PostsService(
    posts as never,
    reports as never,
    access as never,
    nutrition as never,
    { ...social, own: jest.fn() } as never,
    graph as never,
    media as never,
    { jwtSecret: 'isolated-test-key' } as never,
  );
  return { row, posts, reports, access, social, graph, media, nutrition, service };
}
describe('post read authorization and publish retries', () => {
  it('allows the owner without looking up other accounts or inventing catalogue calories', async () => {
    const f = fixture();
    expect(await f.service.detail('owner', String(f.row._id))).toMatchObject({
      isOwner: true,
      itemCount: 1,
    });
    expect(f.graph.between).not.toHaveBeenCalled();
  });
  it.each(['stranger', 'developer'])(
    'does not expose private posts to %s',
    async (viewer) => {
      const f = fixture();
      await expect(f.service.detail(viewer, String(f.row._id))).rejects.toThrow(
        NotFoundException,
      );
    },
  );
  it('requires a current friendship and rejects either-direction blocks', async () => {
    const f = fixture();
    f.row.audience = 'friends';
    await expect(f.service.detail('reader', String(f.row._id))).rejects.toThrow(
      NotFoundException,
    );
    f.graph.between.mockResolvedValue({ state: 'accepted', blockedBy: [] });
    await expect(
      f.service.detail('reader', String(f.row._id)),
    ).resolves.toMatchObject({ isOwner: false });
    for (const blockedBy of [['owner'], ['reader']]) {
      f.graph.between.mockResolvedValue({ state: 'accepted', blockedBy });
      await expect(
        f.service.detail('reader', String(f.row._id)),
      ).rejects.toThrow(NotFoundException);
    }
  });
  it('hides even public posts when author access is disabled or the viewer reported it', async () => {
    const f = fixture();
    f.row.audience = 'public';
    f.access.forUser.mockResolvedValue({
      access: { social: true, nutrition: true, foodPosts: false },
    });
    await expect(f.service.detail('reader', String(f.row._id))).rejects.toThrow(
      NotFoundException,
    );
    f.access.forUser.mockResolvedValue({
      access: { social: true, nutrition: true, foodPosts: true },
    });
    f.reports.exists.mockResolvedValue({ _id: 'report' });
    await expect(f.service.detail('reader', String(f.row._id))).rejects.toThrow(
      NotFoundException,
    );
  });
  it('rejects deleted request retries before rebuilding or resurrecting the source', async () => {
    const f = fixture();
    f.row.deleted = true;
    await expect(
      f.service.create('owner', {
        source: { kind: 'food', foodId: String(new Types.ObjectId()) },
        requestId: 'request',
        previewHash: 'hash',
        title: 'Oats',
        caption: '',
        audience: 'private',
      } as CreatePostDto),
    ).rejects.toThrow(ConflictException);
    expect(f.posts.updateOne).not.toHaveBeenCalled();
  });
  it('tolerates a repeated report that hides the row between the initial existence check and read', async () => {
    const f = fixture();
    f.row.audience = 'public';
    f.reports.exists
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'concurrent' })
      .mockResolvedValueOnce({ _id: 'concurrent' });
    await expect(
      f.service.report('reader', String(f.row._id), { reason: 'spam' }),
    ).resolves.toEqual({ success: true });
    expect(f.reports.updateOne).not.toHaveBeenCalled();
  });
  it('removes a reported snapshot and resolves every report for that post', async () => {
    const f = fixture();
    const reportId = String(new Types.ObjectId());
    f.reports.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ postId: String(f.row._id) }),
    });
    await expect(f.service.moderate('developer', reportId)).resolves.toEqual({
      success: true,
    });
    expect(f.access.requireDeveloper).toHaveBeenCalledWith('developer');
    expect(f.posts.updateOne).toHaveBeenCalledWith(
      { _id: String(f.row._id) },
      {
        $set: { deleted: true, title: 'Removed post', caption: '' },
        $unset: { publication: '', media: '' },
      },
    );
    expect(f.media.removeForPost).toHaveBeenCalledWith(String(f.row._id));
    expect(f.reports.updateMany).toHaveBeenCalledWith(
      { postId: String(f.row._id) },
      { $set: { resolvedAt: expect.any(Date) } },
    );
  });
});

it('updates only the audience and only for the post owner', async () => {
  const f = fixture();
  const id = String(f.row._id);
  f.posts.updateOne.mockResolvedValue({ matchedCount: 1 });
  await f.service.updateAudience('owner', id, 'friends');
  expect(f.posts.updateOne).toHaveBeenCalledWith(
    { _id: id, userId: 'owner', deleted: { $ne: true } },
    { $set: { audience: 'friends' } },
  );
  f.posts.updateOne.mockResolvedValue({ matchedCount: 0 });
  await expect(
    f.service.updateAudience('stranger', id, 'public'),
  ).rejects.toThrow(NotFoundException);
});

describe('posts without food (spec 014)', () => {
  const textOnly = {
    requestId: 'text-request',
    title: '',
    caption: 'Back from the gym',
    audience: 'friends',
  } as CreatePostDto;
  function textFixture() {
    const f = fixture();
    const stored: Record<string, unknown> = {
      ...f.row,
      requestId: 'text-request',
      previewHash: undefined,
      publication: undefined,
      title: '',
      caption: 'Back from the gym',
      audience: 'friends',
    };
    f.posts.findOne
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) })
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(stored) });
    return { ...f, stored };
  }
  it('publishes a text-only post without touching the food module', async () => {
    const f = textFixture();
    const post = await f.service.create('owner', textOnly);
    expect(f.nutrition.snapshot).not.toHaveBeenCalled();
    const insert = f.posts.updateOne.mock.calls[0][1].$setOnInsert;
    expect(insert).not.toHaveProperty('publication');
    expect(insert).not.toHaveProperty('media');
    expect(post).toMatchObject({ caption: 'Back from the gym', itemCount: 0, items: [], media: [] });
    expect(post.kind).toBeUndefined();
    expect(f.media.claim).not.toHaveBeenCalled();
  });
  it('refuses a post with no text, media or food', async () => {
    const f = textFixture();
    await expect(
      f.service.create('owner', { ...textOnly, caption: '  ' }),
    ).rejects.toThrow(BadRequestException);
    expect(f.posts.updateOne).not.toHaveBeenCalled();
  });
  it('stores reserved media and claims it for the created post', async () => {
    const f = textFixture();
    const id = String(new Types.ObjectId());
    const attached = {
      id,
      kind: 'image',
      key: `media/owner/${id}.jpg`,
      contentType: 'image/jpeg',
      width: 1080,
      height: 1350,
    };
    f.media.reserve.mockResolvedValue([attached]);
    f.stored['media'] = [attached];
    await f.service.create('owner', { ...textOnly, mediaIds: [id] });
    expect(f.media.reserve).toHaveBeenCalledWith('owner', 'text-request', [id]);
    expect(f.posts.updateOne.mock.calls[0][1].$setOnInsert.media).toEqual([attached]);
    expect(f.media.claim).toHaveBeenCalledWith('owner', 'text-request', String(f.row._id));
  });
  it('treats a retry with different media as a different request', async () => {
    const f = fixture();
    f.posts.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ ...f.row, previewHash: undefined, publication: undefined, caption: 'Hi', title: '', media: [] }),
    });
    await expect(
      f.service.create('owner', { ...textOnly, requestId: 'request', caption: 'Hi', audience: 'private', mediaIds: [String(new Types.ObjectId())] }),
    ).rejects.toThrow(ConflictException);
  });
  it('refuses to import from a post that has no foods', async () => {
    const f = fixture();
    f.row.audience = 'public';
    (f.row as { publication?: unknown }).publication = undefined;
    await expect(f.service.importPreview('reader', String(f.row._id))).rejects.toThrow(
      BadRequestException,
    );
  });
});
