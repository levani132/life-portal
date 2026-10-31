import { activityTargets } from './activity';
import { nutritionTargets } from './nutrition';
import { migratedSetupSteps } from './portal';
import type {
  HealthSample,
  NutritionProfile,
  NutritionTargets,
} from '@life-portal/shared-types';
const profile = {
  dayStartHour: 4,
  timeZone: 'Asia/Tbilisi',
  everydayMovement: 'mixed',
  exerciseSessionsPerWeek: 3,
  exerciseMinutes: 60,
  exerciseType: 'strength',
  sex: 'male',
  birthDate: '1990-01-01',
  heightCm: 180,
  activityLevel: 'light',
  goal: 'maintain',
} as NutritionProfile;
const targets = {
  available: true,
  missingInputs: [],
  energyKcal: { value: 2800, recorded: true },
  expenditure: {
    restingKcal: 1800,
    digestionKcal: 280,
    everydayKcal: 600,
    exerciseKcal: 200,
  },
} as NutritionTargets;
const now = '2026-10-31T12:00:00Z';
const sample = (
  value: number,
  extra: Partial<HealthSample> = {},
): HealthSample => ({
  id: 'one',
  source: 'watch',
  type: 'activeEnergy',
  start: '2026-10-31T07:00:00Z',
  end: '2026-10-31T08:00:00Z',
  value,
  ...extra,
});
const calculate = (samples: HealthSample[], day = '2026-10-31', p = profile) =>
  activityTargets(targets, p, day, samples, now, now).activity!;
describe('Health replacement model', () => {
  it('keeps no-data, zero, steps-only and low-energy targets stable', () => {
    for (const rows of [
      [],
      [sample(0)],
      [sample(5)],
      [sample(5000, { type: 'steps' })],
    ])
      expect(calculate(rows).currentTargetKcal).toBe(2800);
  });
  it('replaces only matching awake periods and adds no workout or step energy', () => {
    const result = calculate([
      sample(200),
      sample(900, { type: 'workout' }),
      sample(1000, { type: 'steps' }),
    ]);
    expect(result.expectedReplacedKcal).toBe(50);
    expect(result.adjustmentKcal).toBe(150);
    expect(result.currentTargetKcal).toBe(2950);
    expect(result.steps).toBe(1000);
    expect(result.workouts).toBe(1);
  });
  it('does not double count retries, overlapping devices or later replacement', () => {
    const a = sample(200);
    expect(
      calculate([a, a, sample(200, { source: 'phone', id: 'two' })])
        .recordedActiveKcal,
    ).toBe(200);
    expect(calculate([sample(300)]).adjustmentKcal).toBe(250);
  });
  it('keeps estimates in missing periods, does not spread activity through sleep, and respects 4am', () => {
    const beforeBoundary = sample(100, {
      start: '2026-10-30T23:00:00Z',
      end: '2026-10-31T01:00:00Z',
    });
    expect(calculate([beforeBoundary]).recordedActiveKcal).toBe(50);
    expect(calculate([beforeBoundary], '2026-10-30').recordedActiveKcal).toBe(
      50,
    );
    expect(calculate([beforeBoundary]).expectedReplacedKcal).toBe(0);
  });
  it('uses the supplied timezone across DST boundaries', () => {
    const s = sample(180, {
      start: '2026-11-01T05:00:00Z',
      end: '2026-11-01T08:00:00Z',
    });
    const result = activityTargets(
      targets,
      { ...profile, timeZone: 'America/New_York' },
      '2026-10-31',
      [s],
      '2026-11-01T10:00:00Z',
      now,
    );
    expect(result.activity?.recordedActiveKcal).toBe(180);
  });
  it('never decomposes legacy all-activity multipliers into replaceable energy', () => {
    const result = activityTargets(
      { ...targets, expenditure: undefined },
      profile,
      '2026-10-31',
      [sample(200)],
      now,
    );
    expect(result.activity?.adjustmentKcal).toBe(0);
    expect(result.activity?.status).toBe('missing');
  });
  it('separates digestion and net exercise, including strength rests', () => {
    const result = nutritionTargets({
      profile,
      today: '2026-10-31',
      weighIns: [{ day: '2026-10-31', weightGrams: 80000 } as never],
    });
    expect(result.expenditure?.exerciseKcal).toBe(86); // (3.5 - 1) * 80 * 1 * 3 / 7
    const e = result.expenditure!;
    expect(result.tdee?.value).toBe(
      e.restingKcal + e.everydayKcal + e.exerciseKcal + e.digestionKcal,
    );
  });
});
describe('onboarding migration', () => {
  it('preserves legacy steps, introduces new steps and keeps explicit partial completion', () => {
    expect(migratedSetupSteps({ setupCompleted: true })).toEqual([
      'modules',
      'privacy',
      'home',
      'ready',
    ]);
    expect(migratedSetupSteps({ setupStep: 2 })).toEqual([
      'modules',
      'privacy',
    ]);
    expect(
      migratedSetupSteps({
        setupCompleted: true,
        completedSetupSteps: ['home'],
      }),
    ).toEqual(['home']);
  });
});

it('marks Health receipts stale only at the six-hour reminder threshold', () => {
  const received = '2026-10-31T06:00:00Z';
  expect(
    activityTargets(
      targets,
      profile,
      '2026-10-31',
      [],
      '2026-10-31T11:59:59Z',
      received,
    ).activity?.status,
  ).toBe('partial');
  expect(
    activityTargets(
      targets,
      profile,
      '2026-10-31',
      [],
      '2026-10-31T12:00:00Z',
      received,
    ).activity?.status,
  ).toBe('stale');
});

it('keeps source priority through nested overlaps and after the preferred source ends', () => {
  const rows = [
    sample(200, {
      id: 'long',
      source: 'b',
      start: '2026-10-31T07:00:00Z',
      end: '2026-10-31T09:00:00Z',
    }),
    sample(200, {
      id: 'short',
      source: 'a',
      start: '2026-10-31T07:30:00Z',
      end: '2026-10-31T08:30:00Z',
    }),
  ];
  expect(calculate(rows).recordedActiveKcal).toBe(300);
});
it('merges thousands of adjacent samples from overlapping devices without adding both', () => {
  const start = Date.parse('2026-10-31T07:00:00Z');
  const rows = Array.from({ length: 2000 }, (_, i) =>
    sample(1, {
      id: String(i),
      source: 'a',
      start: new Date(start + i * 9000).toISOString(),
      end: new Date(start + (i + 1) * 9000).toISOString(),
    }),
  );
  expect(
    calculate([...rows, ...rows.map((s) => ({ ...s, source: 'b' }))])
      .recordedActiveKcal,
  ).toBe(2000);
});
