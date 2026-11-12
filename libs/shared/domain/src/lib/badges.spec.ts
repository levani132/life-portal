import {
  countMilestones,
  evaluateBadges,
  isOnTarget,
  loggingStreak,
  onTargetDays,
  type BadgeInputs,
  type FoodDayFacts,
} from './badges';
import { addDays } from './dates';

// 2026-08-17 is a Monday.
const TODAY = '2026-08-30'; // a Sunday
const days = (from: string, count: number) =>
  Array.from({ length: count }, (_, i) => addDays(from, i));

describe('loggingStreak', () => {
  it('counts consecutive days and a gap breaks the run', () => {
    const result = loggingStreak(
      [...days('2026-08-01', 3), ...days('2026-08-10', 5)],
      '2026-08-14',
    );
    expect(result.runs.map((run) => run.length)).toEqual([3, 5]);
    expect(result.current).toBe(5);
  });

  it('does not break on today before anything is logged today', () => {
    const result = loggingStreak(days('2026-08-23', 7), TODAY); // ends yesterday
    expect(result.current).toBe(7);
  });

  it('extends with today once today has an entry', () => {
    expect(loggingStreak(days('2026-08-24', 7), TODAY).current).toBe(7);
  });

  it('is zero once a whole day has been missed', () => {
    expect(loggingStreak(days('2026-08-20', 5), TODAY).current).toBe(0);
  });

  it('ignores duplicates, order and future days', () => {
    const input = ['2026-08-29', '2026-08-28', '2026-08-29', '2026-09-05'];
    const result = loggingStreak(input, TODAY);
    expect(result.runs).toEqual([['2026-08-28', '2026-08-29']]);
  });

  it('has no runs without data', () => {
    expect(loggingStreak([], TODAY)).toEqual({ current: 0, runs: [] });
  });
});

describe('isOnTarget', () => {
  it('includes exactly ±10% and nothing beyond', () => {
    expect(isOnTarget({ day: TODAY, eatenKcal: 2200, targetKcal: 2000 })).toBe(true);
    expect(isOnTarget({ day: TODAY, eatenKcal: 1800, targetKcal: 2000 })).toBe(true);
    expect(isOnTarget({ day: TODAY, eatenKcal: 2201, targetKcal: 2000 })).toBe(false);
    expect(isOnTarget({ day: TODAY, eatenKcal: 1799, targetKcal: 2000 })).toBe(false);
  });

  it('is never on target without a target', () => {
    expect(isOnTarget({ day: TODAY, eatenKcal: 2000 })).toBe(false);
  });
});

describe('onTargetDays', () => {
  const on = (day: string): FoodDayFacts => ({ day, eatenKcal: 2000, targetKcal: 2000 });
  const off = (day: string): FoodDayFacts => ({ day, eatenKcal: 3000, targetKcal: 2000 });

  it('breaks on an off-target day, a missing day and a day without a target', () => {
    const rows = [
      on('2026-08-17'),
      off('2026-08-18'),
      on('2026-08-19'),
      // 2026-08-20 missing
      on('2026-08-21'),
      { day: '2026-08-22', eatenKcal: 2000 }, // no target
      on('2026-08-23'),
    ];
    const result = onTargetDays(rows, [], '2026-08-24');
    expect(result.runs.map((run) => run.length)).toEqual([1, 1, 1, 1]);
    expect(result.totalDays).toHaveLength(4);
  });

  it('skips a cheat weekday whatever was eaten, but counts it in the total when on target', () => {
    // Mon..Sun, Sunday (0) is a cheat day, off target; then Monday on target.
    const rows = [...days('2026-08-17', 6).map(on), off('2026-08-23'), on('2026-08-24')];
    const result = onTargetDays(rows, [0], '2026-08-25');
    expect(result.runs).toHaveLength(1);
    expect(result.current).toBe(7);

    const onCheat = onTargetDays([on('2026-08-23')], [0], '2026-08-24');
    expect(onCheat.totalDays).toEqual(['2026-08-23']);
    expect(onCheat.runs).toEqual([]);
  });

  it('a missing cheat day does not break the streak either', () => {
    const rows = [...days('2026-08-17', 6).map(on), on('2026-08-24')];
    expect(onTargetDays(rows, [0], '2026-08-24').current).toBe(7);
  });

  it('today never breaks the streak', () => {
    const rows = [...days('2026-08-24', 6).map(on), off(TODAY)];
    expect(onTargetDays(rows, [], TODAY).current).toBe(6);
  });
});

describe('countMilestones', () => {
  it('dates each tier by the n-th event', () => {
    expect(
      countMilestones(['2026-08-03', '2026-08-01', '2026-08-02'], [1, 2, 5]),
    ).toEqual([
      { tier: 1, reachedOn: '2026-08-01' },
      { tier: 2, reachedOn: '2026-08-02' },
    ]);
  });
});

describe('evaluateBadges', () => {
  const base: BadgeInputs = {
    accountCreatedOn: '2026-07-01',
    setupCompleted: true,
    postDays: ['2026-08-05'],
    friendAcceptedDays: ['2026-08-10', undefined],
  };
  const find = (input: BadgeInputs, id: string) =>
    evaluateBadges(input, TODAY).find((badge) => badge.badgeId === id);

  it('awards the standard badges with dates from history', () => {
    expect(find(base, 'setup')?.reached).toEqual([{ tier: 1, reachedOn: TODAY }]);
    expect(find(base, 'firstPost')?.reached).toEqual([{ tier: 1, reachedOn: '2026-08-05' }]);
    // An unknown acceptance day is today, and the earliest known one wins.
    expect(find(base, 'firstFriend')?.reached).toEqual([{ tier: 1, reachedOn: '2026-08-10' }]);
    expect(find(base, 'earlyMember')?.reached).toEqual([{ tier: 1, reachedOn: '2026-07-01' }]);
  });

  it('reports progress toward the lowest tier not reached', () => {
    expect(find(base, 'connected')?.progress).toEqual({ current: 2, next: 10 });
    expect(find({ ...base, setupCompleted: false }, 'setup')?.reached).toEqual([]);
  });

  it('has no progress once every tier is reached', () => {
    expect(find(base, 'firstPost')?.progress).toBeUndefined();
  });

  it('leaves food out unless it was loaded', () => {
    expect(find(base, 'loggingStreak')).toBeUndefined();
  });

  it('dates a streak tier from the run that first reached it, even if it is broken now', () => {
    const food = {
      days: [...days('2026-08-01', 8), ...days('2026-08-20', 3)].map((day) => ({
        day,
        eatenKcal: 2000,
        targetKcal: 2000,
      })),
      cheatDays: [],
    };
    const logging = find({ ...base, food }, 'loggingStreak');
    expect(logging?.reached).toEqual([{ tier: 7, reachedOn: '2026-08-07' }]);
    expect(logging?.progress).toEqual({ current: 0, next: 30 });
    expect(find({ ...base, food }, 'daysOnTarget')?.progress).toEqual({ current: 11, next: 30 });
  });

  it('clamps dates to the account lifetime', () => {
    const early = { ...base, postDays: ['2026-01-01'] };
    expect(find(early, 'firstPost')?.reached[0].reachedOn).toBe('2026-07-01');
  });
});
