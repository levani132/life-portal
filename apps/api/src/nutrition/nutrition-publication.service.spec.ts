import { NutritionPublicationService } from './nutrition-publication.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
const facts = {
  name: 'Historical yogurt',
  servingSize: 100,
  energyKcalPer100: 120,
  proteinMgPer100: 10000,
  carbMgPer100: 11000,
  fatMgPer100: 4000,
};
function query(rows: unknown) {
  const q = {
    sort: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn().mockResolvedValue(rows),
  };
  q.sort.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  return q;
}
function fixture() {
  const foods = {
    find: jest
      .fn()
      .mockReturnValue(
        query([
          {
            _id: 'food',
            userId: 'owner',
            ...facts,
            name: 'Current yogurt',
            unit: 'g',
            archived: false,
            notes: 'SECRET',
            visibility: 'private',
            barcode: 'PRIVATE',
            favourite: true,
            source: 'manual',
          },
        ]),
      ),
    updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
  };
  const entries = {
    find: jest
      .fn()
      .mockReturnValue(
        query([
          {
            _id: 'entry',
            userId: 'owner',
            foodId: 'food',
            day: '2026-10-22',
            slot: 'breakfast',
            amount: 150,
            unit: 'g',
            facts: { ...facts, notes: 'SECRET' },
            note: 'SECRET',
          },
        ]),
      ),
  };
  const meals = {
    findOne: jest.fn().mockReturnValue(query(null)),
    updateOne: jest.fn(),
  };
  return {
    foods,
    entries,
    meals,
    service: new NutritionPublicationService(
      foods as never,
      entries as never,
      meals as never,
    ),
  };
}
describe('nutrition publication boundary', () => {
  it('publishes frozen entry facts with a strict allowlist and owned source query', async () => {
    const f = fixture();
    const p = await f.service.snapshot('owner', {
      kind: 'entry',
      entryId: 'entry',
    });
    expect(f.entries.find).toHaveBeenCalledWith({
      userId: 'owner',
      _id: 'entry',
    });
    expect(p.items[0].name).toBe('Historical yogurt');
    expect(p.items[0].amount).toBe(150);
    for (const key of [
      'userId',
      'foodId',
      '_id',
      'notes',
      'note',
      'visibility',
      'barcode',
      'favourite',
    ])
      expect(p.items[0]).not.toHaveProperty(key);
  });
  it('publishes only active owned catalogue foods without meal quantities', async () => {
    const f = fixture();
    const p = await f.service.snapshot('owner', { kind: 'database' });
    expect(f.foods.find).toHaveBeenCalledWith({
      userId: 'owner',
      archived: false,
    });
    expect(p.items[0].name).toBe('Current yogurt');
    expect(p.items[0].amount).toBeUndefined();
    expect(f.entries.find).not.toHaveBeenCalled();
  });
  it('rejects mixed source modes and unavailable saved meals', async () => {
    const f = fixture();
    await expect(
      f.service.snapshot('owner', { kind: 'database', foodId: 'food' }),
    ).rejects.toThrow(BadRequestException);
    expect(f.foods.find).not.toHaveBeenCalled();
    await expect(
      f.service.snapshot('owner', {
        kind: 'combination',
        savedMealId: 'saved',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(f.meals.findOne).toHaveBeenCalledWith({
      userId: 'owner',
      _id: 'saved',
      archived: false,
    });
  });
  it('rejects incomplete saved-meal imports before writing copies', async () => {
    const f = fixture();
    const p = await f.service.snapshot('owner', {
      kind: 'meal',
      day: '2026-10-22',
      slot: 'breakfast',
    });
    p.items.push({ ...p.items[0], key: '1' });
    f.foods.find.mockReturnValue(query([]));
    await expect(
      f.service.import('reader', 'post', 'Author', p, ['0'], 'copy', true),
    ).rejects.toThrow(BadRequestException);
    expect(f.foods.updateOne).not.toHaveBeenCalled();
  });
  it('imports explicit food copies privately and tolerates a concurrent duplicate upsert', async () => {
    const f = fixture();
    const p = await f.service.snapshot('owner', { kind: 'database' });
    f.foods.find.mockReturnValue(query([]));
    expect(
      await f.service.import(
        'reader',
        'post',
        'Author',
        p,
        ['0'],
        'copy',
        false,
      ),
    ).toEqual({ createdCount: 1, reusedCount: 0, skippedCount: 0 });
    expect(f.foods.updateOne.mock.calls[0][1].$setOnInsert).toMatchObject({
      userId: 'reader',
      visibility: 'private',
      privacyVersion: 1,
      name: 'Current yogurt',
      source: 'imported',
      attribution: { label: 'Shared by Author' },
    });
    f.foods.updateOne.mockRejectedValueOnce({ code: 11000 });
    expect(
      await f.service.import(
        'reader',
        'post',
        'Author',
        p,
        ['0'],
        'copy',
        false,
      ),
    ).toEqual({ createdCount: 0, reusedCount: 1, skippedCount: 0 });
    expect(f.entries.find).not.toHaveBeenCalled();
  });
});
