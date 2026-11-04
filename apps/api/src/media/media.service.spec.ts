import { BadRequestException, HttpException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MediaService } from './media.service';

function fixture() {
  const id = String(new Types.ObjectId());
  const row = {
    _id: new Types.ObjectId(id),
    userId: 'owner',
    kind: 'video',
    key: `media/owner/${id}.mp4`,
    posterKey: `media/owner/${id}-poster.jpg`,
    posterBytes: 50_000,
    contentType: 'video/mp4',
    bytes: 4_000_000,
    width: 720,
    height: 1280,
    durationMs: 12_000,
    requestId: 'request',
  };
  const media = {
    countDocuments: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    updateMany: jest.fn(),
    find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([row]) }),
    findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(row) }),
  };
  const access = { require: jest.fn(), forUser: jest.fn() };
  const objects: Record<string, { bytes: number; contentType: string }> = {
    [row.key]: { bytes: row.bytes, contentType: 'video/mp4' },
    [row.posterKey]: { bytes: 50_000, contentType: 'image/jpeg' },
  };
  const storage = {
    configured: true,
    head: jest.fn(async (key: string) => objects[key] ?? null),
    presignPut: jest.fn(async (key: string) => ({ url: `https://r2/${key}`, headers: {} })),
    presignGet: jest.fn(async (key: string) => `https://r2/${key}?signed`),
    delete: jest.fn().mockResolvedValue(true),
    copy: jest.fn(),
  };
  const service = new MediaService(
    media as never,
    access as never,
    storage as never,
    { disableSchedules: true } as never,
  );
  return { id, row, media, access, storage, objects, service };
}

describe('MediaService', () => {
  it('reserves by request before checking, then checks both files', async () => {
    const f = fixture();
    const attached = await f.service.reserve('owner', 'request', [f.id]);
    expect(f.media.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner', postId: { $exists: false } }),
      { $set: { requestId: 'request' } },
    );
    expect(attached).toEqual([
      expect.objectContaining({ id: f.id, kind: 'video', posterKey: f.row.posterKey, durationMs: 12_000 }),
    ]);
  });
  it('refuses an upload that has not arrived or does not match what was declared', async () => {
    const f = fixture();
    delete f.objects[f.row.posterKey];
    await expect(f.service.reserve('owner', 'request', [f.id])).rejects.toThrow(/Upload not finished/);
    const g = fixture();
    g.objects[g.row.key].bytes = 99;
    await expect(g.service.reserve('owner', 'request', [g.id])).rejects.toThrow(BadRequestException);
  });
  it('refuses media another request (or another person) holds', async () => {
    const f = fixture();
    f.media.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    await expect(f.service.reserve('owner', 'request', [f.id])).rejects.toThrow(/no longer be used/);
  });
  it('rate limits upload links and validates limits before signing', async () => {
    const f = fixture();
    await expect(
      f.service.ticket('owner', { kind: 'image', contentType: 'image/png', bytes: 10, width: 1, height: 1 }),
    ).rejects.toThrow(/JPEG/);
    f.media.countDocuments.mockResolvedValue(60);
    await expect(
      f.service.ticket('owner', { kind: 'image', contentType: 'image/jpeg', bytes: 10, width: 1, height: 1 }),
    ).rejects.toThrow(HttpException);
    expect(f.storage.presignPut).not.toHaveBeenCalled();
  });
  it('signs a ticket for a video and its still under the uploader', async () => {
    const f = fixture();
    const ticket = await f.service.ticket('owner', {
      kind: 'video',
      contentType: 'video/webm',
      bytes: 1_000_000,
      width: 720,
      height: 1280,
      durationMs: 5_000,
      poster: { bytes: 40_000 },
    });
    expect(ticket.upload.url).toMatch(new RegExp(`media/owner/${ticket.id}\\.webm$`));
    expect(ticket.poster?.url).toMatch(/-poster\.jpg$/);
    expect(f.storage.presignPut).toHaveBeenCalledWith(expect.any(String), 'video/webm', 1_000_000);
  });
  it('signs read links without storage keys in the response', async () => {
    const f = fixture();
    const [item] = await f.service.sign([
      { id: f.id, kind: 'video', key: f.row.key, posterKey: f.row.posterKey, contentType: 'video/mp4', width: 720, height: 1280, durationMs: 12_000 },
    ]);
    expect(item).toEqual({
      id: f.id,
      kind: 'video',
      width: 720,
      height: 1280,
      durationMs: 12_000,
      url: `https://r2/${f.row.key}?signed`,
      posterUrl: `https://r2/${f.row.posterKey}?signed`,
    });
  });
});

describe('copyForFood', () => {
  it("copies a video's still to the food's own key and keeps the upload pending", async () => {
    const f = fixture();
    const image = await f.service.copyForFood('owner', f.id, 'food1');
    expect(f.storage.copy).toHaveBeenCalledWith(f.row.posterKey, expect.stringMatching(/^foods\/owner\/food1-\w+\.jpg$/));
    expect(image).toEqual({ key: expect.stringMatching(/^foods\/owner\//), width: 608, height: 1080 });
    expect(f.media.updateMany).not.toHaveBeenCalled();
  });
  it('refuses a file that has not arrived', async () => {
    const f = fixture();
    delete f.objects[f.row.posterKey];
    await expect(f.service.copyForFood('owner', f.id, 'food1')).rejects.toThrow(/Upload not finished/);
  });
});
