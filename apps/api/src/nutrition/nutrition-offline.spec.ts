import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NutritionService } from './nutrition.service';

/** Spec 029 (issue #18): meals logged offline arrive with the id the device gave them. */
function fixture({ taken = false, food = true } = {}) {
  const foodId = String(new Types.ObjectId());
  const foodJson = {
    id: foodId,
    userId: 'u',
    name: 'Matsoni',
    unit: 'g',
    servingSize: 200,
    energyKcalPer100: 60,
    proteinMgPer100: 3_000,
    fatMgPer100: 3_200,
    carbMgPer100: 4_000,
  };
  const foods = {
    findOne: jest.fn().mockResolvedValue(food ? { _id: foodId, toJSON: () => ({ ...foodJson }) } : null),
    find: jest.fn().mockResolvedValue([{ _id: foodId, toJSON: () => ({ ...foodJson }) }]),
  };
  const saved: unknown[] = [];
  const entries = {
    exists: jest.fn().mockResolvedValue(taken ? { _id: 'x' } : null),
    create: jest.fn(async (doc: Record<string, unknown>) => {
      saved.push(doc);
      return { toJSON: () => ({ id: String(doc['_id'] ?? 'server-id'), ...doc }) };
    }),
    insertMany: jest.fn(async (docs: Record<string, unknown>[]) => {
      saved.push(...docs);
      return docs.map((doc) => ({ toJSON: () => ({ id: String(doc['_id'] ?? 'server-id'), ...doc }) }));
    }),
  };
  const service = new NutritionService(
    {} as never,
    {} as never,
    foods as never,
    entries as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, entries, saved, foodId };
}

describe('meals logged offline (spec 029)', () => {
  it('keeps the device’s id and still snapshots the facts from the food, not the request', async () => {
    const f = fixture();
    const id = String(new Types.ObjectId());
    const entry = await f.service.createEntry('u', {
      id,
      day: '2026-11-14',
      slot: 'breakfast',
      foodId: f.foodId,
      amount: 150,
      // A request cannot assert what the meal contained.
      facts: { energyKcalPer100: 9999 },
    } as never);
    expect(entry.id).toBe(id);
    expect(String((f.saved[0] as { _id: unknown })._id)).toBe(id);
    expect(entry.facts.energyKcalPer100).toBe(60);
    expect(entry.totals.energyKcal).toBe(90);
  });

  it('refuses an id any user already has', async () => {
    const f = fixture({ taken: true });
    await expect(
      f.service.createEntry('u', { id: String(new Types.ObjectId()), day: '2026-11-14', slot: 'lunch', foodId: f.foodId, amount: 100 }),
    ).rejects.toMatchObject({ response: { code: 'ID_TAKEN' } });
    expect(f.entries.create).not.toHaveBeenCalled();
  });

  it('says plainly when the food was deleted while the meal waited on the device', async () => {
    const f = fixture({ food: false });
    const error = await f.service
      .createEntry('u', { day: '2026-11-14', slot: 'lunch', foodId: f.foodId, amount: 100 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({ code: 'FOOD_GONE' });
  });

  it('logs a saved meal with one device id per component, and refuses if the meal changed since', async () => {
    const f = fixture();
    const meal = {
      id: 'm1',
      name: 'Breakfast bowl',
      loggable: true,
      components: [{ foodId: f.foodId, amount: 200 }, { foodId: f.foodId, amount: 50 }],
    };
    (f.service as unknown as { oneSavedMeal: () => Promise<unknown> }).oneSavedMeal = async () => meal;
    const ids = [String(new Types.ObjectId()), String(new Types.ObjectId())];
    const logged = await f.service.logSavedMeal('u', 'm1', { day: '2026-11-14', ids });
    expect(logged.map((entry) => entry.id)).toEqual(ids);
    await expect(f.service.logSavedMeal('u', 'm1', { day: '2026-11-14', ids: [ids[0]] })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
