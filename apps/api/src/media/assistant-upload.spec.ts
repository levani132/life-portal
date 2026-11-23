import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MediaService } from './media.service';

const segment = (marker: number, data: number[]) => [0xff, marker, ((data.length + 2) >> 8) & 0xff, (data.length + 2) & 0xff, ...data];
const text = (value: string) => [...value].map((char) => char.charCodeAt(0));
const frame = segment(0xc0, [8, 0x01, 0xe0, 0x02, 0x80, 1, 1, 0x11, 0]); // 640 × 480
const scan = [...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9];
const exif = segment(0xe1, [...text('Exif\0\0GPS 41.7151,44.8271')]);
const jpeg = (withExif: boolean) => new Uint8Array([0xff, 0xd8, ...(withExif ? exif : []), ...frame, ...scan]);

/** Spec 041: what the server does with a file an assistant uploaded, before it can be attached. */
function fixture(file: Uint8Array | null, row: Record<string, unknown> = {}) {
  const id = String(new Types.ObjectId());
  const stored = { _id: id, userId: 'page', kind: 'image', key: `media/page/${id}.jpg`, contentType: 'image/jpeg', bytes: file?.length ?? 0, width: 1, height: 1, viaAssistant: true, ...row };
  const media = {
    findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(stored) }),
    find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([stored]) }) }),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  };
  const storage = {
    configured: true,
    head: jest.fn(async () => (file ? { bytes: file.length, contentType: 'image/jpeg' } : null)),
    read: jest.fn(async () => file),
    write: jest.fn(),
    delete: jest.fn().mockResolvedValue(true),
  };
  const service = new MediaService(media as never, { require: jest.fn() } as never, storage as never, {} as never);
  return { id, media, storage, service };
}

describe('an assistant’s photo upload', () => {
  it('records the true size and removes location data before the photo can be used', async () => {
    const f = fixture(jpeg(true));
    const result = await f.service.finishAssistantUpload('page', f.id);
    expect(result).toMatchObject({ id: f.id, width: 640, height: 480 });
    const written = f.storage.write.mock.calls[0][2] as Uint8Array;
    expect(String.fromCharCode(...written)).not.toContain('GPS');
    expect(written.length).toBeLessThan(jpeg(true).length);
    expect(f.media.updateOne).toHaveBeenCalledWith({ _id: f.id }, { $set: expect.objectContaining({ width: 640, height: 480, bytes: written.length, checkedAt: expect.any(Date) }) });
  });

  it('leaves a clean photo as it is', async () => {
    const f = fixture(jpeg(false));
    await f.service.finishAssistantUpload('page', f.id);
    expect(f.storage.write).not.toHaveBeenCalled();
    expect(f.media.updateOne).toHaveBeenCalled();
  });

  it('deletes and refuses a file that is not a JPEG', async () => {
    const f = fixture(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
    await expect(f.service.finishAssistantUpload('page', f.id)).rejects.toMatchObject({ response: { code: 'NOT_A_PHOTO' } });
    expect(f.storage.delete).toHaveBeenCalled();
    expect(f.media.deleteOne).toHaveBeenCalledWith({ _id: f.id });
    expect(f.media.updateOne).not.toHaveBeenCalled();
  });

  it('says so when nothing was uploaded yet, and keeps the link usable', async () => {
    const f = fixture(null);
    await expect(f.service.finishAssistantUpload('page', f.id)).rejects.toMatchObject({ response: { code: 'NOT_UPLOADED' } });
    expect(f.media.deleteOne).not.toHaveBeenCalled();
  });

  it('refuses to attach an upload that was not checked, or that a browser made', async () => {
    await expect(fixture(jpeg(false)).service.requireAssistantChecked('page', [String(new Types.ObjectId())])).rejects.toBeInstanceOf(BadRequestException);
    const browser = fixture(jpeg(false), { viaAssistant: undefined, checkedAt: new Date() });
    await expect(browser.service.requireAssistantChecked('page', [browser.id])).rejects.toMatchObject({ response: { code: 'MEDIA_NOT_CHECKED' } });
    const checked = fixture(jpeg(false), { checkedAt: new Date() });
    await expect(checked.service.requireAssistantChecked('page', [checked.id])).resolves.toBeUndefined();
  });
});
