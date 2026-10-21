import type {
  FoodPublication,
  PostSelection,
  PublishedFood,
} from '@life-portal/shared-types';
import {
  canReadFoodPost,
  canonicalPublication,
  publicationCalories,
  publicationFoodIdentity,
  validPostSelection,
} from './posts';
const food: PublishedFood = {
  key: '0',
  name: 'Yogurt',
  unit: 'g',
  servingSize: 100,
  energyKcalPer100: 120,
  proteinMgPer100: 10000,
  carbMgPer100: 11000,
  fatMgPer100: 4000,
};
describe('food publication contracts', () => {
  it.each<PostSelection>([
    { kind: 'entry', entryId: 'entry' },
    { kind: 'meal', day: '2026-10-22', slot: 'breakfast' },
    { kind: 'day', day: '2026-10-22' },
    { kind: 'food', foodId: 'food' },
    { kind: 'database' },
    { kind: 'combination', savedMealId: 'saved' },
    { kind: 'combination', components: [{ foodId: 'food', amount: 100 }] },
  ])('accepts an exact source: %j', (source) =>
    expect(validPostSelection(source)).toBe(true),
  );
  it.each<PostSelection>([
    { kind: 'entry' },
    { kind: 'meal', day: '2026-10-22' },
    { kind: 'day', day: '2026-10-22', slot: 'breakfast' },
    { kind: 'database', foodId: 'food' },
    { kind: 'combination', savedMealId: 'saved', components: [] },
    { kind: 'combination' },
  ])('rejects missing or mixed source fields: %j', (source) =>
    expect(validPostSelection(source)).toBe(false),
  );
  it('recognises the same food across slots and quantities without merging different facts', () => {
    expect(publicationFoodIdentity(food)).toBe(
      publicationFoodIdentity({
        ...food,
        key: '9',
        name: ' yogurt ',
        amount: 200,
        slot: 'dinner',
      }),
    );
    for (const other of [
      { ...food, energyKcalPer100: 121 },
      { ...food, servingSize: 150 },
      { ...food, brand: 'Different' },
      { ...food, unit: 'ml' as const },
      { ...food, fibreMgPer100: 0 },
    ])
      expect(publicationFoodIdentity(other)).not.toBe(
        publicationFoodIdentity(food),
      );
  });
  it('fingerprints exact preview content, provenance and portions', () => {
    const p: FoodPublication = {
      kind: 'entry',
      label: 'Yogurt',
      items: [{ ...food, amount: 100 }],
    };
    expect(canonicalPublication({ ...p })).toBe(canonicalPublication(p));
    for (const item of [
      { ...p.items[0], name: 'YOGURT' },
      { ...p.items[0], amount: 200 },
      { ...p.items[0], attribution: { label: 'Other source' } },
      { ...p.items[0], slot: 'dinner' as const },
    ])
      expect(canonicalPublication({ ...p, items: [item] })).not.toBe(
        canonicalPublication(p),
      );
  });
  it('adds portion calories only when all portions are known', () => {
    expect(
      publicationCalories([
        { ...food, amount: 150 },
        { ...food, key: '1', amount: 25 },
      ]),
    ).toBe(210);
    expect(publicationCalories([food])).toBeUndefined();
    expect(
      publicationCalories([{ ...food, amount: 100 }, food]),
    ).toBeUndefined();
  });
  it('evaluates every audience, relationship and feature state without privilege bypass', () => {
    for (const audience of ['private', 'friends', 'public'] as const)
      for (const own of [false, true])
        for (const friends of [false, true])
          for (const blocked of [false, true])
            for (const enabled of [false, true]) {
              expect(
                canReadFoodPost({ audience, own, friends, blocked, enabled }),
              ).toBe(
                enabled &&
                  !blocked &&
                  (own ||
                    audience === 'public' ||
                    (audience === 'friends' && friends)),
              );
            }
  });
});
