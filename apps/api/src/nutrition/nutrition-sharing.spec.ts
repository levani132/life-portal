import { NutritionService } from './nutrition.service';
function fixture(flags: {
  shareMeals?: boolean;
  shareDiary?: boolean;
  shareTargets?: boolean;
  shareWeight?: boolean;
}) {
  const service = new NutritionService(
    ...(Array(9).fill({}) as [
      never,
      never,
      never,
      never,
      never,
      never,
      never,
      never,
      never,
    ]),
  );
  const profile = jest
    .spyOn(service, 'profile')
    .mockResolvedValue(flags as never);
  const summary = jest.spyOn(service, 'summary').mockResolvedValue({
    eatenKcal: 120,
    proteinEatenG: 10,
    entryCount: 1,
    targetKcal: 2345,
  } as never);
  const weights = jest.spyOn(service, 'listWeighIns').mockResolvedValue([
    { day: '2026-10-20', weightGrams: 74000 },
    { day: '2026-10-25', weightGrams: 75000 },
  ] as never);
  return { service, profile, summary, weights };
}
describe('food sharing categories', () => {
  it('fails closed when preferences are absent and does not load private records', async () => {
    const f = fixture({});
    expect(await f.service.sharedStats('owner', '2026-10-22')).toEqual([]);
    expect(f.summary).not.toHaveBeenCalled();
    expect(f.weights).not.toHaveBeenCalled();
  });
  it('shares meal totals without leaking targets or weight', async () => {
    const f = fixture({ shareMeals: true });
    expect(await f.service.sharedStats('owner', '2026-10-22')).toEqual([
      { label: 'Eaten today', value: '120 kcal' },
      { label: 'Protein', value: '10 g' },
      { label: 'Logged foods', value: '1' },
    ]);
    expect(f.weights).not.toHaveBeenCalled();
  });
  it('shares targets without meal totals', async () => {
    const f = fixture({ shareTargets: true });
    expect(await f.service.sharedStats('owner', '2026-10-22')).toEqual([
      { label: 'Daily target', value: '2345 kcal', estimated: true },
    ]);
  });
  it('shares only recorded weight and excludes future weigh-ins', async () => {
    const f = fixture({ shareWeight: true });
    expect(await f.service.sharedStats('owner', '2026-10-22')).toEqual([
      { label: 'Weight', value: '74 kg' },
    ]);
    expect(f.summary).not.toHaveBeenCalled();
  });
  it('represents all three enabled categories with at most three stats', async () => {
    const f = fixture({
      shareMeals: true,
      shareTargets: true,
      shareWeight: true,
    });
    expect(
      (await f.service.sharedStats('owner', '2026-10-22')).map((s) => s.label),
    ).toEqual(['Eaten today', 'Daily target', 'Weight']);
  });
});

describe('explicit daily diary sharing', () => {
  it.each([{}, { shareMeals: true }, { shareDiary: false }])(
    'keeps foods private unless independently opted in: %j',
    async (flags) => {
      const f = fixture(flags);
      const entries = jest.spyOn(f.service, 'listEntries');
      expect(
        await f.service.sharedDiary('owner', '2026-10-22', '2026-10-22'),
      ).toBeNull();
      expect(entries).not.toHaveBeenCalled();
    },
  );
  it('projects only food names, portions and nutrition from the requested owned day', async () => {
    const f = fixture({ shareDiary: true });
    const totals = {
      energyKcal: 120,
      proteinMg: 10000,
      carbMg: 11000,
      fatMg: 4000,
    };
    const entries = jest
      .spyOn(f.service, 'listEntries')
      .mockResolvedValue([
        {
          id: 'PRIVATE_ENTRY_ID',
          userId: 'PRIVATE_USER',
          foodId: 'PRIVATE_FOOD',
          day: '2026-10-22',
          slot: 'breakfast',
          amount: 100,
          unit: 'g',
          facts: {
            name: 'Yogurt',
            servingSize: 100,
            energyKcalPer100: 120,
            proteinMgPer100: 10000,
            carbMgPer100: 11000,
            fatMgPer100: 4000,
            notes: 'PRIVATE_NOTE',
          },
          totals: { ...totals, notes: 'PRIVATE_TOTAL' },
          note: 'PRIVATE_NOTE',
        },
      ] as never);
    const result = await f.service.sharedDiary(
      'owner',
      '2026-10-22',
      '2026-10-22',
    );
    expect(entries).toHaveBeenCalledWith('owner', { day: '2026-10-22' });
    expect(result?.slots[0].foods[0]).toEqual({
      name: 'Yogurt',
      amount: 100,
      unit: 'g',
      totals,
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(f.summary).not.toHaveBeenCalled();
    expect(f.weights).not.toHaveBeenCalled();
  });
});
