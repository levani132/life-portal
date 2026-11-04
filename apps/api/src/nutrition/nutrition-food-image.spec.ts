import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NutritionService } from './nutrition.service';

const key = 'foods/u/f-1.jpg';
function fixture() {
  const id = new Types.ObjectId();
  const json = { id: String(id), name: 'Lobiani', image: { key, width: 1, height: 1 } };
  const doc = { _id: id, image: undefined as unknown, toJSON: () => ({ ...json }) };
  const foods = {
    create: jest.fn().mockResolvedValue(doc),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    find: jest.fn().mockResolvedValue([{ ...doc, image: json.image }]),
    findOne: jest.fn(() => ({
      select: () => ({ lean: async () => ({ image: json.image }) }),
      then: (resolve: (v: unknown) => void) => resolve(doc),
    })),
    findOneAndUpdate: jest.fn().mockResolvedValue({ ...doc, toJSON: () => ({ id: String(id), name: 'Lobiani' }) }),
  };
  const entries = { aggregate: jest.fn().mockResolvedValue([]) };
  const media = {
    copyForFood: jest.fn().mockResolvedValue({ key, width: 1080, height: 1350 }),
    signKey: jest.fn(async (k: string) => `https://r2/${k}?signed`),
    deleteKey: jest.fn(),
  };
  const graph = { };
  const service = new NutritionService(
    {} as never,
    graph as never,
    foods as never,
    entries as never,
    {} as never,
    { findOne: jest.fn().mockReturnValue({ lean: async () => null }) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    media as never,
  );
  (service as unknown as { ensurePrivateSharing: () => Promise<void> }).ensurePrivateSharing = async () => undefined;
  return { id, foods, media, service };
}
const base = {
  name: 'Lobiani',
  servingSize: 250,
  energyKcal: 650,
  proteinMg: 20_000,
  carbMg: 80_000,
  fatMg: 25_000,
  visibility: 'private',
};

describe('food pictures', () => {
  it('copies the upload in as the picture and answers with a signed link, never the key', async () => {
    const f = fixture();
    const food = await f.service.createFood('u', { ...base, imageMediaId: String(new Types.ObjectId()) });
    expect(f.media.copyForFood).toHaveBeenCalledWith('u', expect.any(String), String(f.id));
    expect(f.foods.updateOne).toHaveBeenCalledWith({ _id: f.id }, { $set: { image: { key, width: 1080, height: 1350 } } });
    expect(food.image).toEqual({ url: `https://r2/${key}?signed`, width: 1080, height: 1350 });
    expect(JSON.stringify(food)).not.toContain('"key"');
  });
  it('undoes the food when its picture cannot be used', async () => {
    const f = fixture();
    f.media.copyForFood.mockRejectedValue(new BadRequestException('Upload not finished.'));
    await expect(
      f.service.createFood('u', { ...base, imageMediaId: String(new Types.ObjectId()) }),
    ).rejects.toThrow(BadRequestException);
    expect(f.foods.deleteOne).toHaveBeenCalledWith({ _id: f.id });
  });
  it('lists foods with signed pictures and no keys', async () => {
    const f = fixture();
    const [food] = await f.service.listFoods('u');
    expect(food.image?.url).toBe(`https://r2/${key}?signed`);
    expect(JSON.stringify(food)).not.toContain(key + '"');
  });
  it('deletes the old file when the picture is removed', async () => {
    const f = fixture();
    await f.service.updateFood('u', String(f.id), { removeImage: true } as never);
    expect(f.foods.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'u', _id: String(f.id) },
      expect.objectContaining({ $unset: { image: '' } }),
      expect.anything(),
    );
    expect(f.media.deleteKey).toHaveBeenCalledWith(key);
  });
});
