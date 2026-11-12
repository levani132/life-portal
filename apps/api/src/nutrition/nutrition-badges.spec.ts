import { nutritionTargets } from '@life-portal/shared-domain';
import type { NutritionProfile, WeighIn } from '@life-portal/shared-types';
import { NutritionService } from './nutrition.service';

const profile: NutritionProfile = {
  id: 'p1',
  userId: 'u1',
  sex: 'male',
  heightCm: 180,
  birthDate: '1996-05-10',
  activityLevel: 'moderate',
  goal: 'fat_loss',
  cheatDays: [0],
  dayStartHour: 4,
  defaultFoodVisibility: 'private',
  shareDiary: false,
  shareMeals: false,
  shareWeight: false,
  shareTargets: false,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};
const weighIn = (day: string, weightGrams: number): WeighIn => ({
  id: day,
  userId: 'u1',
  day,
  weightGrams,
  createdAt: `${day}T00:00:00.000Z`,
  updatedAt: `${day}T00:00:00.000Z`,
});
const facts = {
  servingSize: 100,
  energyKcalPer100: 500,
  proteinMgPer100: 0,
  fatMgPer100: 0,
  carbMgPer100: 0,
};

function serviceWith(rows: { day: string; amount: number }[], weighIns: WeighIn[]) {
  const entries = {
    find: jest.fn().mockReturnValue({
      select: () => ({ lean: async () => rows.map((row) => ({ ...row, facts })) }),
    }),
  };
  const service = new NutritionService(
    {} as never,
    {} as never,
    {} as never,
    entries as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  Object.assign(service, {
    profile: jest.fn().mockResolvedValue(profile),
    listWeighIns: jest.fn().mockResolvedValue(weighIns),
  });
  return service;
}

describe('NutritionService.badgeInputs', () => {
  it('sums whole kcal per day and uses the starting target of the weigh-in in effect', async () => {
    const weighIns = [weighIn('2026-08-01', 90_000), weighIn('2026-08-10', 80_000)];
    const service = serviceWith(
      [
        { day: '2026-08-05', amount: 200 },
        { day: '2026-08-05', amount: 100 },
        { day: '2026-08-12', amount: 300 },
      ],
      weighIns,
    );
    const result = await service.badgeInputs('u1', '2026-08-20');
    const target = (day: string) =>
      Math.round(nutritionTargets({ profile, weighIns, today: day }).energyKcal?.value ?? 0);

    expect(result.cheatDays).toEqual([0]);
    expect(result.days).toEqual([
      { day: '2026-08-05', eatenKcal: 1500, targetKcal: target('2026-08-05') },
      { day: '2026-08-12', eatenKcal: 1500, targetKcal: target('2026-08-12') },
    ]);
    expect(result.days[0].targetKcal).not.toBe(result.days[1].targetKcal);
  });

  it('has no target before the first weigh-in and reads no profile without entries', async () => {
    const before = await serviceWith([{ day: '2026-07-01', amount: 100 }], [
      weighIn('2026-08-01', 90_000),
    ]).badgeInputs('u1', '2026-08-20');
    expect(before.days[0].targetKcal).toBeUndefined();

    const empty = serviceWith([], []);
    expect(await empty.badgeInputs('u1', '2026-08-20')).toEqual({ days: [], cheatDays: [] });
    expect((empty as unknown as { profile: jest.Mock }).profile).not.toHaveBeenCalled();
  });
});
