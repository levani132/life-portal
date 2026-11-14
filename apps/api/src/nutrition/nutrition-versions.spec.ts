import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { matches } from '../training/fake-model.testing';
import { NutritionService } from './nutrition.service';

/**
 * Spec 030 (issue #19): a meal or a weigh-in edited on two devices. Each edit carries the version
 * the device saw; the second one is refused with the row as it is now, never silently applied.
 */

type Row = Record<string, unknown> & { _id: Types.ObjectId };

/** Just the model calls these paths make, with the unique `(userId, day)` weigh-in index. */
function model(unique?: string[]) {
  const docs: Row[] = [];
  const wrap = (row: Row | undefined) =>
    row ? { ...row, toJSON: () => ({ ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== '_id')), id: String(row._id) }) } : null;
  const apply = (row: Row, update: Record<string, Record<string, unknown>>) => {
    Object.assign(row, update['$set'] ?? {});
    for (const key of Object.keys(update['$unset'] ?? {})) delete row[key];
    for (const [key, by] of Object.entries(update['$inc'] ?? {})) row[key] = ((row[key] as number | undefined) ?? 0) + (by as number);
  };
  return {
    docs,
    findOne: jest.fn(async (filter: Record<string, unknown>) => wrap(docs.find((row) => matches(row, filter)))),
    findOneAndUpdate: jest.fn(
      async (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>, options: { upsert?: boolean } = {}) => {
        let row = docs.find((doc) => matches(doc, filter));
        if (!row && options.upsert) {
          const seeded = Object.fromEntries(Object.entries(filter).filter(([, value]) => typeof value !== 'object'));
          if (unique && docs.some((doc) => unique.every((key) => doc[key] === seeded[key]))) {
            throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
          }
          row = { _id: new Types.ObjectId(), ...seeded } as Row;
          docs.push(row);
        }
        if (!row) return null;
        apply(row, update);
        return wrap(row);
      },
    ),
    deleteOne: jest.fn(async (filter: Record<string, unknown>) => {
      const index = docs.findIndex((row) => matches(row, filter));
      if (index >= 0) docs.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    }),
  };
}

function fixture() {
  const entries = model();
  const weighIns = model(['userId', 'day']);
  const service = new NutritionService(
    {} as never,
    {} as never,
    {} as never,
    entries as never,
    {} as never,
    {} as never,
    weighIns as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, entries, weighIns };
}

const facts = { name: 'Matsoni', servingSize: 200, energyKcalPer100: 60, proteinMgPer100: 3_000, fatMgPer100: 3_200, carbMgPer100: 4_000 };

function meal(f: ReturnType<typeof fixture>) {
  const row = { _id: new Types.ObjectId(), userId: 'u', day: '2026-11-14', slot: 'breakfast', foodId: 'f', amount: 100, unit: 'g', facts };
  f.entries.docs.push(row);
  return String(row._id);
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error instanceof ConflictException ? (error.getResponse() as { code: string; current?: Record<string, unknown> }) : error;
  }
  throw new Error('was accepted');
}

describe('meals edited on two devices (spec 030)', () => {
  it('bumps the version on each correction and refuses one made against an older version', async () => {
    const f = fixture();
    const id = meal(f);
    await expect(f.service.updateEntry('u', id, { amount: 150, baseVersion: 0 })).resolves.toMatchObject({ amount: 150, version: 1 });
    const body = await refusal(f.service.updateEntry('u', id, { amount: 300, baseVersion: 0 }));
    expect(body).toMatchObject({ code: 'STALE_EDIT', current: { amount: 150, version: 1, totals: { energyKcal: 90 } } });
    expect(f.entries.docs[0]['amount']).toBe(150);
    await expect(f.service.updateEntry('u', id, { amount: 300, baseVersion: 1 })).resolves.toMatchObject({ amount: 300, version: 2 });
  });

  it('turns a correction of a deleted meal into ROW_DELETED, and deleting it twice is fine', async () => {
    const f = fixture();
    const id = meal(f);
    await expect(f.service.removeEntry('u', id)).resolves.toEqual({ id, deleted: true });
    await expect(f.service.removeEntry('u', id)).resolves.toEqual({ id, deleted: true });
    expect(await refusal(f.service.updateEntry('u', id, { amount: 1, baseVersion: 0 }))).toMatchObject({ code: 'ROW_DELETED' });
    await expect(f.service.updateEntry('u', id, { amount: 1 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never touches another person’s meal: deleting it is a no-op', async () => {
    const f = fixture();
    const id = meal(f);
    await f.service.removeEntry('someone-else', id);
    expect(f.entries.docs).toHaveLength(1);
  });
});

describe('weigh-ins from two devices (spec 030)', () => {
  const put = (f: ReturnType<typeof fixture>, weightGrams: number, baseVersion?: number) =>
    f.service.upsertWeighIn('u', '2026-11-14', { day: '2026-11-14', weightGrams, ...(baseVersion !== undefined ? { baseVersion } : {}) });

  it('never overwrites a weigh-in the device did not see', async () => {
    const f = fixture();
    await expect(put(f, 80_000, 0)).resolves.toMatchObject({ weightGrams: 80_000, version: 1 });
    // The other device saw no weigh-in for the day either.
    expect(await refusal(put(f, 81_000, 0))).toMatchObject({ code: 'STALE_EDIT', current: { weightGrams: 80_000, version: 1 } });
    expect(f.weighIns.docs).toHaveLength(1);
    expect(f.weighIns.docs[0]['weightGrams']).toBe(80_000);
    // The person chose theirs over the stored one.
    await expect(put(f, 81_000, 1)).resolves.toMatchObject({ weightGrams: 81_000, version: 2 });
  });

  it('refuses a correction of a weigh-in deleted elsewhere, and keeps unchecked puts working', async () => {
    const f = fixture();
    expect(await refusal(put(f, 80_000, 3))).toMatchObject({ code: 'ROW_DELETED' });
    await expect(put(f, 80_000)).resolves.toMatchObject({ weightGrams: 80_000, version: 1 });
    await expect(put(f, 79_500)).resolves.toMatchObject({ weightGrams: 79_500, version: 2 });
  });

  it('answers a create that lost the race with the winner, not a 500', async () => {
    const f = fixture();
    // The device's read saw no weigh-in; another device inserted one before its write.
    f.weighIns.findOne.mockImplementationOnce(async () => null);
    f.weighIns.docs.push({ _id: new Types.ObjectId(), userId: 'u', day: '2026-11-14', weightGrams: 82_000, version: 1 });
    expect(await refusal(put(f, 80_000, 0))).toMatchObject({ code: 'STALE_EDIT', current: { weightGrams: 82_000 } });
  });

  it('counts deleting a weigh-in already gone as done', async () => {
    const f = fixture();
    const id = String(new Types.ObjectId());
    await expect(f.service.removeWeighIn('u', id)).resolves.toEqual({ id, deleted: true });
  });
});
