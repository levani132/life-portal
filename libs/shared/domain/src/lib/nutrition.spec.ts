import type {
  Food,
  MealEntry,
  NutritionProfile,
  WeighIn,
} from '@life-portal/shared-types';
import {
  ACTIVITY_FACTORS,
  GOAL_PLAN,
  addTotals,
  ageOn,
  amountToServings,
  basalRate,
  cheatDayInfo,
  currentWeighIn,
  dayTotals,
  decorateEntry,
  defaultSlot,
  entryTotals,
  estimateBodyFatPct,
  factsFromInput,
  factsToInput,
  isRecorded,
  leanMassGrams,
  localDay,
  localMealContext,
  macroEnergyMismatch,
  mgToG,
  nextCheatDay,
  nutritionTargets,
  perServingTotals,
  servingsToAmount,
  slotTotals,
  snapshotFacts,
  summariseNutrition,
  sumTotals,
  weekBalance,
  weekEnd,
  weekStart,
} from './nutrition';

// ------------------------------------------------------------------ fixtures

/** Oats: 380 kcal, 13 g protein, 7 g fat, 60 g carbs, 10 g fibre per 100 g. */
const oats: Food = {
  id: 'food-oats',
  userId: 'u1',
  name: 'Rolled oats',
  brand: 'Store',
  unit: 'g',
  servingSize: 40,
  entryMode: 'per_100',
  favourite: false,
  source: 'manual',
  archived: false,
  energyKcalPer100: 380,
  proteinMgPer100: 13_000,
  fatMgPer100: 7_000,
  carbMgPer100: 60_000,
  fibreMgPer100: 10_000,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

/** Milk, measured in millilitres, and with no fibre figure at all. */
const milk: Food = {
  ...oats,
  id: 'food-milk',
  name: 'Milk 2%',
  unit: 'ml',
  servingSize: 200,
  energyKcalPer100: 50,
  proteinMgPer100: 3_400,
  fatMgPer100: 2_000,
  carbMgPer100: 4_800,
  fibreMgPer100: undefined,
};

function entry(overrides: Partial<MealEntry> & Pick<MealEntry, 'day' | 'slot'>): MealEntry {
  const food = overrides.foodId === milk.id ? milk : oats;
  const amount = overrides.amount ?? 100;
  return decorateEntry(
    {
      id: overrides.id ?? `entry-${overrides.day}-${overrides.slot}-${amount}`,
      userId: 'u1',
      day: overrides.day,
      slot: overrides.slot,
      foodId: food.id,
      amount,
      unit: food.unit,
      facts: snapshotFacts(food),
      createdAt: '2026-08-19T08:00:00.000Z',
      updatedAt: '2026-08-19T08:00:00.000Z',
    },
  );
}

const profile: NutritionProfile = {
  id: 'profile-1',
  userId: 'u1',
  sex: 'male',
  heightCm: 180,
  birthDate: '1996-05-10',
  activityLevel: 'moderate',
  goal: 'fat_loss',
  cheatDays: [],
  dayStartHour: 4,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const weighIn: WeighIn = {
  id: 'w1',
  userId: 'u1',
  day: '2026-08-18',
  weightGrams: 80_000,
  createdAt: '2026-08-18T00:00:00.000Z',
  updatedAt: '2026-08-18T00:00:00.000Z',
};

const TODAY = '2026-08-19';

// ------------------------------------------------------------------ unit maths

describe('entry maths', () => {
  it('scales per-100 facts to the amount eaten', () => {
    expect(entryTotals(50, oats)).toEqual({
      energyKcal: 190,
      proteinMg: 6_500,
      fatMg: 3_500,
      carbMg: 30_000,
      fibreMg: 5_000,
    });
  });

  it('leaves an unknown nutriment absent rather than zero', () => {
    expect(entryTotals(200, milk).fibreMg).toBeUndefined();
  });

  it('rounds once per entry, so a row and its total use the same arithmetic', () => {
    // 33 g of oats is 125.4 kcal; the row shows 125 and so must the sum of two of them.
    const one = entryTotals(33, oats);
    expect(one.energyKcal).toBe(125);
    expect(sumTotals([one, one]).energyKcal).toBe(250);
  });

  it('converts between servings and base units in both directions', () => {
    expect(servingsToAmount(1.5, 40)).toBe(60);
    expect(amountToServings(60, 40)).toBe(1.5);
    expect(amountToServings(45, 40)).toBe(1.13);
    // Never rounds an amount down to nothing.
    expect(servingsToAmount(0.001, 40)).toBe(1);
    expect(amountToServings(10, 0)).toBe(0);
  });

  it('reports one serving of a food', () => {
    expect(perServingTotals(oats).energyKcal).toBe(152);
    expect(perServingTotals(milk).energyKcal).toBe(100);
  });

  it('converts grams and milligrams for display', () => {
    expect(mgToG(6_500)).toBe(7);
    expect(mgToG(6_500, 1)).toBe(6.5);
    expect(mgToG(undefined)).toBe(0);
  });
});

describe('food entry modes', () => {
  it('normalises per-serving input to per-100 storage', () => {
    const facts = factsFromInput(
      { energyKcal: 152, proteinMg: 5_200, fatMg: 2_800, carbMg: 24_000, fibreMg: 4_000 },
      'per_serving',
      40,
    );
    expect(facts.energyKcalPer100).toBe(380);
    expect(facts.proteinMgPer100).toBe(13_000);
    expect(facts.fibreMgPer100).toBe(10_000);
  });

  it('passes per-100 input straight through', () => {
    const facts = factsFromInput(
      { energyKcal: 380, proteinMg: 13_000, fatMg: 7_000, carbMg: 60_000 },
      'per_100',
      40,
    );
    expect(facts.energyKcalPer100).toBe(380);
    expect(facts.fibreMgPer100).toBeUndefined();
  });

  it('round-trips back to the numbers the owner typed', () => {
    const typed = { energyKcal: 152, proteinMg: 5_200, fatMg: 2_800, carbMg: 24_000 };
    const stored = factsFromInput(typed, 'per_serving', 40);
    expect(factsToInput(stored, 'per_serving', 40)).toEqual(typed);
  });

  it('flags macros that cannot account for the stated energy', () => {
    // Per-serving numbers typed into a per-100 field: energy far below its own macros.
    expect(macroEnergyMismatch({ ...oats, energyKcalPer100: 120 })).toEqual({ impliedKcal: 355 });
    expect(macroEnergyMismatch(oats)).toBeUndefined();
    expect(
      macroEnergyMismatch({
        energyKcalPer100: 0,
        proteinMgPer100: 0,
        fatMgPer100: 0,
        carbMgPer100: 0,
      }),
    ).toBeUndefined();
  });
});

// ------------------------------------------------------------------ aggregation

describe('totals', () => {
  it('sums a day across slots and keeps every slot in menu order', () => {
    const entries = [
      entry({ day: TODAY, slot: 'breakfast', amount: 40 }),
      entry({ day: TODAY, slot: 'breakfast', amount: 40 }),
      entry({ day: TODAY, slot: 'dinner', amount: 100 }),
      entry({ day: '2026-08-18', slot: 'lunch', amount: 100 }),
    ];
    const totals = dayTotals(TODAY, entries);
    expect(totals.entryCount).toBe(3);
    expect(totals.totals.energyKcal).toBe(152 + 152 + 380);
    expect(totals.slots.map((slot) => slot.slot)).toEqual([
      'breakfast',
      'lunch',
      'dinner',
      'snack',
      'uncategorized',
    ]);
    expect(totals.slots[0].entries).toHaveLength(2);
    expect(totals.slots[1].totals.energyKcal).toBe(0);
  });

  it('keeps fibre absent when nothing eaten reported it', () => {
    const totals = slotTotals([entry({ day: TODAY, slot: 'lunch', foodId: milk.id, amount: 200 })]);
    expect(totals[1].totals.fibreMg).toBeUndefined();
  });

  it('treats a partially known fibre figure as the sum of what is known', () => {
    const mixed = addTotals(entryTotals(100, oats), entryTotals(200, milk));
    expect(mixed.fibreMg).toBe(10_000);
  });
});

describe('week balance', () => {
  const week = (today: string, days: string[]) =>
    weekBalance(
      days.map((day) => entry({ day, slot: 'lunch', amount: 100 })),
      today,
      2_000,
    );

  it('runs Monday to Sunday', () => {
    // 2026-08-19 is a Wednesday.
    expect(weekStart(TODAY)).toBe('2026-08-17');
    expect(weekEnd(TODAY)).toBe('2026-08-23');
    // A Sunday belongs to the week that started six days earlier, not the one starting tomorrow.
    expect(weekStart('2026-08-23')).toBe('2026-08-17');
    expect(weekStart('2026-08-17')).toBe('2026-08-17');
  });

  it('counts what was eaten and how many days were logged', () => {
    const balance = week(TODAY, ['2026-08-17', '2026-08-18', TODAY]);
    expect(balance.daysLogged).toBe(3);
    expect(balance.eatenKcal).toBe(380 * 3);
    expect(balance.targetKcal).toBe(14_000);
    expect(balance.differenceKcal).toBe(380 * 3 - 6_000);
    expect(balance.days).toHaveLength(7);
    expect(balance.days.filter((day) => day.isToday)).toHaveLength(1);
  });

  it('banks only days that were logged, and only days before today', () => {
    // Two logged days at 380 kcal against a 2000 target: 3240 banked. Today is excluded even
    // though it is under target, and Monday is excluded because nothing was logged.
    const balance = week(TODAY, ['2026-08-18', TODAY]);
    expect(balance.bankedKcal).toBe(2_000 - 380);
  });

  it('never banks a negative allowance', () => {
    const balance = weekBalance(
      [entry({ day: '2026-08-18', slot: 'dinner', amount: 1_000 })],
      TODAY,
      1_000,
    );
    expect(balance.bankedKcal).toBe(0);
  });

  it('omits target-derived figures when there is no target', () => {
    const balance = weekBalance([entry({ day: TODAY, slot: 'lunch' })], TODAY);
    expect(balance.targetKcal).toBeUndefined();
    expect(balance.differenceKcal).toBeUndefined();
    expect(balance.bankedKcal).toBe(0);
  });
});

// ------------------------------------------------------------------ body model

describe('body model', () => {
  it('counts age in whole years, including on the birthday', () => {
    expect(ageOn('1996-05-10', '2026-08-19')).toBe(30);
    expect(ageOn('1996-08-19', '2026-08-19')).toBe(30);
    expect(ageOn('1996-08-20', '2026-08-19')).toBe(29);
    expect(ageOn('2026-09-01', '2026-08-19')).toBe(0);
  });

  it('takes the latest weigh-in that is not in the future', () => {
    const rows = [
      weighIn,
      { ...weighIn, id: 'w2', day: '2026-08-10', weightGrams: 81_000 },
      { ...weighIn, id: 'w3', day: '2026-09-01', weightGrams: 70_000 },
    ];
    expect(currentWeighIn(rows, TODAY)?.id).toBe('w1');
    expect(currentWeighIn([], TODAY)).toBeUndefined();
  });

  it('derives lean mass from a recorded body-fat percentage', () => {
    expect(leanMassGrams(80_000, 0.2)).toBe(64_000);
  });

  it('estimates body fat from BMI, and says how confident it is', () => {
    const estimate = estimateBodyFatPct({ sex: 'male', weightGrams: 80_000, heightCm: 180, age: 30 });
    expect(estimate.value).toBeCloseTo(0.2, 2);
    expect(estimate.confidence).toBe('low');
    expect(estimate.basis).toContain('Deurenberg');
    // Same body, female: the formula reads about eleven points higher.
    const female = estimateBodyFatPct({ sex: 'female', weightGrams: 80_000, heightCm: 180, age: 30 });
    expect(female.value).toBeGreaterThan(estimate.value);
  });
});

describe('basal rate', () => {
  it('uses the owner’s own figure verbatim, and does not call it an estimate', () => {
    const figure = basalRate({
      profile: { ...profile, basalRateKcal: 1_700 },
      weighIn,
      today: TODAY,
    });
    expect(figure.value).toBe(1_700);
    expect(isRecorded(figure)).toBe(true);
  });

  it('uses Katch–McArdle when body fat was recorded', () => {
    const figure = basalRate({ profile, weighIn: { ...weighIn, bodyFatPct: 0.2 }, today: TODAY });
    // 370 + 21.6 × 64 = 1752.4
    expect(figure.value).toBe(1_752);
    expect(isRecorded(figure)).toBe(false);
    expect((figure as { basis: string }).basis).toContain('Katch–McArdle');
  });

  it('falls back to Mifflin–St Jeor on body weight', () => {
    const figure = basalRate({ profile, weighIn, today: TODAY });
    // 10×80 + 6.25×180 − 5×30 + 5 = 1780
    expect(figure.value).toBe(1_780);
    expect((figure as { basis: string }).basis).toContain('Mifflin');
  });

  it('applies the female constant', () => {
    const figure = basalRate({ profile: { ...profile, sex: 'female' }, weighIn, today: TODAY });
    // 10×80 + 6.25×180 − 5×30 − 161 = 1614
    expect(figure.value).toBe(1_614);
  });
});

// ------------------------------------------------------------------ targets

describe('nutritionTargets', () => {
  const targetsFor = (
    overrides: Partial<NutritionProfile> = {},
    weighIns: WeighIn[] = [weighIn],
  ) => nutritionTargets({ profile: { ...profile, ...overrides }, weighIns, today: TODAY });

  it('names every missing input and stays unavailable', () => {
    const empty = nutritionTargets({
      profile: { ...profile, sex: undefined, heightCm: undefined, birthDate: undefined },
      weighIns: [],
      today: TODAY,
    });
    expect(empty.available).toBe(false);
    expect(empty.missingInputs).toEqual(['sex', 'weighIn', 'heightCm', 'birthDate']);
    expect(empty.energyKcal).toBeUndefined();
  });

  it('needs only sex and a weigh-in when the basal rate was measured', () => {
    const targets = nutritionTargets({
      profile: { ...profile, heightCm: undefined, birthDate: undefined, basalRateKcal: 1_700 },
      weighIns: [weighIn],
      today: TODAY,
    });
    expect(targets.available).toBe(true);
    expect(targets.missingInputs).toEqual([]);
  });

  it('reports a missing weigh-in on its own', () => {
    expect(targetsFor({}, []).missingInputs).toEqual(['weighIn']);
  });

  it('multiplies the basal rate by the activity factor', () => {
    for (const level of Object.keys(ACTIVITY_FACTORS) as (keyof typeof ACTIVITY_FACTORS)[]) {
      const targets = targetsFor({ activityLevel: level });
      expect(targets.tdee?.value).toBe(Math.round(1_780 * ACTIVITY_FACTORS[level]));
    }
  });

  it('applies each goal’s energy factor to maintenance', () => {
    const maintenance = Math.round(1_780 * ACTIVITY_FACTORS.moderate);
    for (const goal of Object.keys(GOAL_PLAN) as (keyof typeof GOAL_PLAN)[]) {
      const targets = targetsFor({ goal });
      expect(targets.energyKcal?.value).toBe(
        Math.round(maintenance * GOAL_PLAN[goal].energyFactor),
      );
    }
  });

  it('uses body weight for protein when body fat is unknown', () => {
    const targets = targetsFor({ goal: 'fat_loss' });
    expect(targets.proteinG?.value).toBe(160); // 2.0 g/kg × 80 kg
    expect((targets.proteinG as { basis: string }).basis).toContain('body weight');
    expect(targets.bodyFatPct?.confidence).toBe('low');
    expect(targets.bodyFatRecordedPct).toBeUndefined();
  });

  it('switches to lean mass, and a higher figure per kg, when body fat was recorded', () => {
    const targets = targetsFor({ goal: 'fat_loss' }, [{ ...weighIn, bodyFatPct: 0.2 }]);
    expect(targets.proteinG?.value).toBe(147); // 2.3 g/kg × 64 kg
    expect((targets.proteinG as { basis: string }).basis).toContain('lean mass');
    expect(targets.bodyFatRecordedPct).toBe(0.2);
    expect(targets.bodyFatPct).toBeUndefined();
  });

  it('caps protein at 40% of the calorie target', () => {
    // A heavy, sedentary cut: 2.2 g/kg would take protein past 40% of a floored target.
    const targets = targetsFor({
      goal: 'pure_weight_loss',
      activityLevel: 'sedentary',
      basalRateKcal: 1_500,
    }, [{ ...weighIn, weightGrams: 140_000 }]);
    const energy = targets.energyKcal?.value as number;
    expect(targets.proteinG?.value).toBe(Math.floor((energy * 0.4) / 4));
    expect((targets.proteinG as { basis: string }).basis).toContain('Capped');
  });

  it('raises a too-deep deficit to the floor and explains it', () => {
    const targets = targetsFor({ goal: 'pure_weight_loss', activityLevel: 'sedentary' });
    const floor = Math.max(1_780, 1_500);
    expect(targets.energyKcal?.value).toBe(floor);
    expect(targets.floorApplied?.floorKcal).toBe(floor);
    expect(targets.floorApplied?.requestedKcal).toBeLessThan(floor);
    expect(targets.floorApplied?.reason).toContain('floor');
  });

  it('uses the female floor when the basal rate is lower still', () => {
    const targets = nutritionTargets({
      profile: { ...profile, sex: 'female', goal: 'pure_weight_loss', basalRateKcal: 1_000 },
      weighIns: [{ ...weighIn, weightGrams: 55_000 }],
      today: TODAY,
    });
    expect(targets.energyKcal?.value).toBe(1_200);
  });

  it('floors fat at 0.5 g/kg and 15% of energy', () => {
    const targets = targetsFor({ goal: 'pure_weight_loss' });
    const energy = targets.energyKcal?.value as number;
    expect(targets.fatG?.value).toBeGreaterThanOrEqual(Math.round(0.5 * 80));
    expect((targets.fatG?.value as number) * 9).toBeGreaterThanOrEqual(energy * 0.15 - 9);
  });

  it('leaves carbohydrate as the remainder', () => {
    const targets = targetsFor();
    const { energyKcal, proteinG, fatG, carbG } = targets;
    expect(carbG?.value).toBe(
      Math.round(
        ((energyKcal?.value as number) -
          (proteinG?.value as number) * 4 -
          (fatG?.value as number) * 9) /
          4,
      ),
    );
  });

  it('cuts fat first, then protein, rather than letting carbohydrate go negative', () => {
    const targets = targetsFor({ proteinOverrideG: 300, fatOverrideG: 150 });
    expect(targets.carbG?.value).toBeGreaterThanOrEqual(0);
    expect(targets.macroAdjustment).toBeDefined();
    expect(targets.macroAdjustment?.reason).toContain('negative');
    // Fat gave way before protein, and neither went below its floor.
    expect(targets.fatG?.value).toBeLessThan(150);
    expect(targets.fatG?.value).toBeGreaterThanOrEqual(Math.round(0.5 * 80));
    expect(targets.proteinG?.value).toBeGreaterThanOrEqual(Math.round(1.2 * 80));
  });

  it('treats every override as recorded, not estimated', () => {
    const targets = targetsFor({
      energyKcalOverrideMissing: undefined,
      energyOverrideKcal: 2_400,
      proteinOverrideG: 180,
      fatOverrideG: 70,
      carbOverrideG: 250,
    } as Partial<NutritionProfile>);
    expect(targets.energyKcal).toEqual({ value: 2_400, recorded: true });
    expect(targets.proteinG).toEqual({ value: 180, recorded: true });
    expect(targets.fatG).toEqual({ value: 70, recorded: true });
    expect(targets.carbG).toEqual({ value: 250, recorded: true });
    expect(targets.floorApplied).toBeUndefined();
  });

  it('suggests fibre from the energy target', () => {
    const targets = targetsFor({ energyOverrideKcal: 2_000 });
    expect(targets.fibreG?.value).toBe(28);
  });

  it('projects the weekly change and judges the rate', () => {
    const maintenance = Math.round(1_780 * ACTIVITY_FACTORS.moderate);

    const sane = targetsFor({ goal: 'fat_loss' });
    expect(sane.projectedWeeklyChangeKg).toBeCloseTo(
      ((sane.energyKcal?.value as number) - maintenance) * 7 / 7_700,
      2,
    );
    expect(sane.rateVerdict).toBe('sane');

    // A 1200 kcal deficit on an 80 kg frame is over 1% of body weight a week.
    expect(targetsFor({ energyOverrideKcal: maintenance - 1_200 }).rateVerdict).toBe('fast');
    expect(targetsFor({ goal: 'maintain' }).rateVerdict).toBe('sane');
    expect(targetsFor({ energyOverrideKcal: maintenance - 100 }).rateVerdict).toBe('slow');
    expect(targetsFor({ energyOverrideKcal: maintenance + 900 }).rateVerdict).toBe('fast');
    expect(targetsFor({ energyOverrideKcal: maintenance + 50 }).rateVerdict).toBe('slow');
  });

  it('sets recomposition apart: a small deficit and much more protein', () => {
    const recomp = targetsFor({ goal: 'recomp' });
    const fatLoss = targetsFor({ goal: 'fat_loss' });
    // A shallower deficit than fat loss, and more protein — that combination *is* the goal.
    expect(recomp.energyKcal?.value).toBeGreaterThan(fatLoss.energyKcal?.value as number);
    expect(recomp.proteinG?.value).toBeGreaterThan(fatLoss.proteinG?.value as number);
    expect(recomp.proteinG?.value).toBe(192); // 2.4 g/kg × 80 kg
    expect(recomp.goalNote).toContain('resistance');
  });

  it('lets recomposition protein past the usual 40% ceiling, but not past its own', () => {
    // 2.4 g/kg of a 140 kg frame is 336 g; at the goal's own 50% cap on a floored target it clips.
    const targets = nutritionTargets({
      profile: { ...profile, goal: 'recomp', activityLevel: 'sedentary', basalRateKcal: 1_500 },
      weighIns: [{ ...weighIn, weightGrams: 140_000 }],
      today: TODAY,
    });
    const energy = targets.energyKcal?.value as number;
    expect(targets.proteinG?.value).toBe(Math.floor((energy * 0.5) / 4));
    expect((targets.proteinG as { basis: string }).basis).toContain('50%');
  });

  it('holds the owner’s own numbers steady (100 kg, 197 cm, light, recomp)', () => {
    const targets = nutritionTargets({
      profile: { ...profile, heightCm: 197, activityLevel: 'light', goal: 'recomp' },
      weighIns: [{ ...weighIn, weightGrams: 100_000 }],
      today: TODAY,
    });
    expect(targets.bmr?.value).toBe(2_086);
    expect(targets.energyKcal?.value).toBe(2_581);
    expect(targets.proteinG?.value).toBe(240);
    expect(targets.projectedWeeklyChangeKg).toBeCloseTo(-0.26, 2);
    expect(targets.rateVerdict).toBe('sane');
  });

  it('explains the cap on maximum growth', () => {
    expect(targetsFor({ goal: 'max_gain' }).goalNote).toContain('+20%');
  });

  it('carries the weigh-in it used', () => {
    const targets = targetsFor();
    expect(targets.weightGrams).toBe(80_000);
    expect(targets.weighInDay).toBe('2026-08-18');
  });
});

// ------------------------------------------------------------------ time and slots

describe('local day and slot', () => {
  it('puts a meal before the day-start hour on the previous day', () => {
    // Local-time constructor, so this is timezone-independent.
    expect(localDay(new Date(2026, 7, 19, 1, 20), 4)).toBe('2026-08-18');
    expect(localDay(new Date(2026, 7, 19, 3, 59), 4)).toBe('2026-08-18');
    expect(localDay(new Date(2026, 7, 19, 4, 0), 4)).toBe('2026-08-19');
    expect(localDay(new Date(2026, 7, 19, 23, 30), 4)).toBe('2026-08-19');
  });

  it('rolls back across a month and a year boundary', () => {
    expect(localDay(new Date(2026, 8, 1, 2, 0), 4)).toBe('2026-08-31');
    expect(localDay(new Date(2027, 0, 1, 2, 0), 4)).toBe('2026-12-31');
  });

  it('honours a day-start hour of zero', () => {
    expect(localDay(new Date(2026, 7, 19, 1, 20), 0)).toBe('2026-08-19');
  });

  it('guesses the slot from the time of day', () => {
    expect(defaultSlot(8, 40)).toBe('breakfast');
    expect(defaultSlot(10, 29)).toBe('breakfast');
    expect(defaultSlot(10, 30)).toBe('lunch');
    expect(defaultSlot(13, 0)).toBe('lunch');
    expect(defaultSlot(15, 30)).toBe('snack');
    expect(defaultSlot(17, 0)).toBe('dinner');
    expect(defaultSlot(21, 29)).toBe('dinner');
    expect(defaultSlot(21, 30)).toBe('snack');
    expect(defaultSlot(2, 0)).toBe('breakfast');
  });

  it('bundles the day and slot for the browser', () => {
    expect(localMealContext(new Date(2026, 7, 19, 13, 5), 4)).toEqual({
      day: '2026-08-19',
      slot: 'lunch',
    });
  });
});

// ------------------------------------------------------------------ cheat day

describe('cheat day', () => {
  it('counts to the nearest configured weekday', () => {
    // 2026-08-19 is a Wednesday (weekday 3).
    expect(nextCheatDay(TODAY, [6])).toEqual({
      day: '2026-08-22',
      daysUntil: 3,
      isToday: false,
    });
    expect(nextCheatDay(TODAY, [1])).toEqual({
      day: '2026-08-24',
      daysUntil: 5,
      isToday: false,
    });
  });

  it('treats today as zero days away', () => {
    expect(nextCheatDay(TODAY, [3])).toEqual({ day: TODAY, daysUntil: 0, isToday: true });
  });

  it('picks the nearest of several cheat days', () => {
    expect(nextCheatDay(TODAY, [0, 5])?.day).toBe('2026-08-21');
  });

  it('returns nothing when no cheat day is configured, or the numbers are nonsense', () => {
    expect(nextCheatDay(TODAY, [])).toBeUndefined();
    expect(nextCheatDay(TODAY, [9, -1])).toBeUndefined();
  });

  it('totals only the queue rows still to be eaten', () => {
    const queued = {
      id: 'c1',
      userId: 'u1',
      foodId: oats.id,
      amount: 100,
      order: 0,
      eaten: false,
      missing: false,
      totals: entryTotals(100, oats),
      createdAt: '2026-08-18T00:00:00.000Z',
      updatedAt: '2026-08-18T00:00:00.000Z',
    };
    const info = cheatDayInfo({
      today: TODAY,
      cheatDays: [6],
      queue: [queued, { ...queued, id: 'c2', eaten: true }],
      bankedKcal: 1_200,
    });
    expect(info.queueTotals.energyKcal).toBe(380);
    expect(info.nextDay).toBe('2026-08-22');
    expect(info.daysUntil).toBe(3);
    expect(info.isToday).toBe(false);
    expect(info.bankedKcal).toBe(1_200);
  });

  it('reports no next day when none is configured', () => {
    const info = cheatDayInfo({ today: TODAY, cheatDays: [], queue: [], bankedKcal: 0 });
    expect(info.nextDay).toBeUndefined();
    expect(info.daysUntil).toBeUndefined();
    expect(info.isToday).toBe(false);
  });
});

// ------------------------------------------------------------------ summary and snapshot

describe('summary', () => {
  const targets = nutritionTargets({ profile, weighIns: [weighIn], today: TODAY });

  it('reports what is left when targets exist', () => {
    const totals = entryTotals(100, oats);
    const summary = summariseNutrition({
      day: TODAY,
      totals,
      entryCount: 1,
      targets,
      goal: 'fat_loss',
      cheat: { nextDay: '2026-08-22', daysUntil: 3 },
    });
    expect(summary.eatenKcal).toBe(380);
    expect(summary.leftKcal).toBe((targets.energyKcal?.value as number) - 380);
    expect(summary.proteinEatenG).toBe(13);
    expect(summary.proteinLeftG).toBe((targets.proteinG?.value as number) - 13);
    expect(summary.daysUntilCheat).toBe(3);
    expect(summary.targetsAvailable).toBe(true);
  });

  it('still reports what was eaten when targets are unavailable', () => {
    const summary = summariseNutrition({
      day: TODAY,
      totals: entryTotals(100, oats),
      entryCount: 1,
      targets: { available: false, missingInputs: ['sex'] },
      goal: 'maintain',
    });
    expect(summary.eatenKcal).toBe(380);
    expect(summary.targetKcal).toBeUndefined();
    expect(summary.leftKcal).toBeUndefined();
    expect(summary.proteinLeftG).toBeUndefined();
    expect(summary.nextCheatDay).toBeUndefined();
  });
});

describe('snapshot', () => {
  it('freezes name, brand and every known nutriment', () => {
    const facts = snapshotFacts(oats);
    expect(facts).toEqual({
      name: 'Rolled oats',
      brand: 'Store',
      servingSize: 40,
      energyKcalPer100: 380,
      proteinMgPer100: 13_000,
      fatMgPer100: 7_000,
      carbMgPer100: 60_000,
      fibreMgPer100: 10_000,
    });
  });

  it('omits what the food does not have, rather than writing zero', () => {
    const facts = snapshotFacts({ ...milk, brand: undefined });
    expect(facts.brand).toBeUndefined();
    expect(facts.fibreMgPer100).toBeUndefined();
    expect('sugarMgPer100' in facts).toBe(false);
  });

  it('survives the food changing afterwards', () => {
    const logged = entry({ day: TODAY, slot: 'breakfast', amount: 40 });
    const corrected: Food = { ...oats, energyKcalPer100: 500 };
    // The entry keeps what it was logged with; only new entries see the correction.
    expect(logged.totals.energyKcal).toBe(152);
    expect(entryTotals(40, corrected).energyKcal).toBe(200);
  });

  it('decorates a stored row with its derived totals and servings', () => {
    const decorated = entry({ day: TODAY, slot: 'lunch', amount: 60 });
    expect(decorated.servings).toBe(1.5);
    expect(decorated.totals.energyKcal).toBe(228);
  });
});
