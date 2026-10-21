import { ConflictException, NotFoundException } from '@nestjs/common';
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
  const service = new PostsService(
    posts as never,
    reports as never,
    access as never,
    {} as never,
    social as never,
    graph as never,
    { jwtSecret: 'isolated-test-key' } as never,
  );
  return { row, posts, reports, access, social, graph, service };
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
        $unset: { publication: '' },
      },
    );
    expect(f.reports.updateMany).toHaveBeenCalledWith(
      { postId: String(f.row._id) },
      { $set: { resolvedAt: expect.any(Date) } },
    );
  });
});
