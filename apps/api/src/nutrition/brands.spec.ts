import { ForbiddenException } from '@nestjs/common';
import { BRAND_EXISTS, STARTER_BRANDS } from '@life-portal/shared-types';
import { BrandsService } from './brands';

const DEV = 'dev';
type Stored = { _id: string; userId?: string; name: string; key: string; logo?: { key: string; width: number; height: number } };

/** An in-memory `food_brands`: just the queries the service makes. */
function fixture(seed: Stored[] = []) {
  const rows: Stored[] = [...seed];
  let next = 1;
  const matches = (row: Stored, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([field, want]) => {
      if (field === '$or') return (want as Record<string, unknown>[]).some((option) => matches(row, option));
      const value = (row as unknown as Record<string, unknown>)[field];
      if (want && typeof want === 'object' && '$exists' in want) return (value !== undefined) === (want as { $exists: boolean }).$exists;
      return value === want;
    });
  const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });
  const brands = {
    bulkWrite: (ops: { updateOne: { filter: Record<string, unknown>; update: { $setOnInsert: Stored } } }[]) => {
      for (const { updateOne } of ops) if (!rows.some((row) => matches(row, updateOne.filter))) rows.push({ ...updateOne.update.$setOnInsert, _id: `s${next++}` });
      return Promise.resolve();
    },
    find: (filter: Record<string, unknown>) => {
      const found = rows.filter((row) => matches(row, filter));
      return { ...lean(found), sort: () => ({ limit: () => lean([...found].sort((a, b) => a.name.localeCompare(b.name))) }) };
    },
    findOne: (filter: Record<string, unknown>) => lean(rows.find((row) => matches(row, filter)) ?? null),
    findById: (id: string) => lean(rows.find((row) => row._id === id) ?? null),
    countDocuments: (filter: Record<string, unknown>) => Promise.resolve(rows.filter((row) => matches(row, filter)).length),
    create: (doc: Omit<Stored, '_id'>) => {
      const row = { ...doc, _id: `b${next++}` };
      rows.push(row);
      return Promise.resolve({ _id: row._id, toObject: () => row });
    },
    updateOne: (filter: { _id: string }, update: { $set: Partial<Stored> }) => {
      Object.assign(rows.find((row) => row._id === filter._id)!, update.$set);
      return Promise.resolve();
    },
    findOneAndUpdate: (filter: { _id: string }, update: { $set?: Partial<Stored>; $unset?: Record<string, string> }) => {
      const row = rows.find((item) => item._id === filter._id);
      if (row) {
        Object.assign(row, update.$set ?? {});
        for (const field of Object.keys(update.$unset ?? {})) delete (row as unknown as Record<string, unknown>)[field];
      }
      return lean(row ?? null);
    },
    deleteOne: ({ _id }: { _id: string }) => {
      rows.splice(rows.findIndex((row) => row._id === _id), 1);
      return Promise.resolve();
    },
  };
  const foods = { updateMany: jest.fn().mockResolvedValue(undefined) };
  const media = {
    signKey: jest.fn(async (key: string) => `signed:${key}`),
    copyForBrand: jest.fn(async () => ({ key: 'brands/x.jpg', width: 10, height: 10 })),
    deleteKey: jest.fn(),
  };
  const access = {
    requireDeveloper: (userId: string) => {
      if (userId !== DEV) throw new ForbiddenException();
    },
  };
  // `isValidObjectId` wants 24 hex characters; the fake ids are short, so ids are looked up as given.
  const service = new BrandsService(brands as never, foods as never, media as never, access as never);
  return { rows, foods, media, service };
}

const ID = '0123456789abcdef01234567';

describe('food brands', () => {
  it('starts with the public brands, names only', async () => {
    const list = await fixture().service.list('ana');
    expect(list.map((brand) => brand.name)).toEqual(expect.arrayContaining(["McDonald's", "Wendy's"]));
    expect(list).toHaveLength(STARTER_BRANDS.length);
    expect(list.every((brand) => brand.scope === 'public' && !brand.logoUrl)).toBe(true);
  });

  it('turns any spelling of an existing brand into that brand, and makes a new name the person’s own', async () => {
    const f = fixture();
    expect(await f.service.resolve('ana', '  mc donalds ')).toBe("McDonald's");
    expect(await f.service.resolve('ana', 'Corner  Bakery')).toBe('Corner Bakery');
    expect(f.rows.find((row) => row.key === 'cornerbakery')).toMatchObject({ userId: 'ana', name: 'Corner Bakery' });
    // The second spelling is the first brand, not a second one.
    expect(await f.service.resolve('ana', 'corner-bakery')).toBe('Corner Bakery');
    expect(f.rows.filter((row) => row.key === 'cornerbakery')).toHaveLength(1);
    expect(await f.service.resolve('ana', '  ')).toBeUndefined();
  });

  it('keeps one person’s brands out of another’s list', async () => {
    const f = fixture();
    await f.service.resolve('ana', 'Corner Bakery');
    expect((await f.service.list('ben')).some((brand) => brand.key === 'cornerbakery')).toBe(false);
    expect((await f.service.list('ana')).find((brand) => brand.key === 'cornerbakery')).toMatchObject({ scope: 'own' });
  });

  it('refuses to create a brand that exists in any spelling, public or own, and says which', async () => {
    const f = fixture();
    await expect(f.service.create('ana', { name: 'MCDONALDS' })).rejects.toMatchObject({
      response: { code: BRAND_EXISTS, existing: { name: "McDonald's", scope: 'public' } },
    });
    await f.service.create('ana', { name: 'Corner Bakery' });
    await expect(f.service.create('ana', { name: 'corner bakery' })).rejects.toMatchObject({ response: { code: BRAND_EXISTS } });
  });

  it('lets only the developer create or publish a public brand', async () => {
    const f = fixture();
    await expect(f.service.create('ana', { name: 'Glovo', public: true })).rejects.toThrow(ForbiddenException);
    expect(await f.service.create(DEV, { name: 'Glovo', public: true })).toMatchObject({ scope: 'public' });
    await expect(f.service.publish('ana', ID)).rejects.toThrow(ForbiddenException);
  });

  it('does not let anyone touch another person’s brand, or a public one unless they are the developer', async () => {
    const f = fixture([
      { _id: ID, userId: 'ana', name: 'Corner Bakery', key: 'cornerbakery' },
      { _id: 'abcdefabcdefabcdefabcdef', name: 'Glovo', key: 'glovo' },
    ]);
    await expect(f.service.update('ben', ID, { name: 'Mine now' })).rejects.toThrow('Brand not found.');
    await expect(f.service.remove('ben', ID)).rejects.toThrow('Brand not found.');
    await expect(f.service.update('ana', 'abcdefabcdefabcdefabcdef', { name: 'Glovoo' })).rejects.toThrow('Brand not found.');
    expect(await f.service.update(DEV, 'abcdefabcdefabcdefabcdef', { name: 'Glovo App' })).toMatchObject({ name: 'Glovo App' });
  });

  it('renaming a brand renames it on the owner’s foods, and may not take another brand’s name', async () => {
    const f = fixture([{ _id: ID, userId: 'ana', name: 'Corner Bakery', key: 'cornerbakery' }]);
    await expect(f.service.update('ana', ID, { name: 'kfc' })).rejects.toMatchObject({ response: { code: BRAND_EXISTS } });
    await f.service.update('ana', ID, { name: 'The Corner Bakery' });
    expect(f.foods.updateMany).toHaveBeenCalledWith({ userId: 'ana', brand: 'Corner Bakery' }, { $set: { brand: 'The Corner Bakery' } });
  });

  it('gives a brand a logo and signs it on the way out', async () => {
    const f = fixture([{ _id: ID, userId: 'ana', name: 'Corner Bakery', key: 'cornerbakery' }]);
    const brand = await f.service.update('ana', ID, { imageMediaId: 'a'.repeat(24) });
    expect(brand.logoUrl).toBe('signed:brands/x.jpg');
    expect(JSON.stringify(brand)).not.toContain('"key":"brands/');
  });
});
