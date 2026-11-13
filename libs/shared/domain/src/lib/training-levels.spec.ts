import { addDays } from './dates';
import {
  TRAINING_LEVEL_CONFIG,
  levelForXp,
  trainingLevel,
  workoutXp,
  xpToReach,
  type LevelSession,
} from './training-levels';

const MONDAY = '2026-11-09';
let next = 0;
function session(day: string, overrides: Partial<LevelSession> = {}): LevelSession {
  next += 1;
  return {
    id: `s${next}`,
    day,
    startedAt: `${day}T18:00:${String(next % 60).padStart(2, '0')}.000Z`,
    status: 'finished',
    durationSeconds: 45 * 60,
    workingSets: 8,
    ...overrides,
  };
}
/** `weeks` weeks of Monday/Wednesday/Friday workouts ending in the week of `MONDAY`. */
function steady(weeks: number, perWeekDays = [0, 2, 4], sets = 8): LevelSession[] {
  const start = addDays(MONDAY, -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    perWeekDays.map((offset) => session(addDays(start, w * 7 + offset), { workingSets: sets })),
  ).flat();
}
const TODAY = addDays(MONDAY, 6);

describe('training levels (issue #5a)', () => {
  it('starts at level 1 with nothing done', () => {
    expect(trainingLevel([], TODAY)).toEqual({ level: 1, xp: 0, xpIntoLevel: 0, xpForLevel: 17, countedWorkouts: 0 });
  });

  it('reaches about level 100 after five years at three workouts a week, and keeps going', () => {
    const five = trainingLevel(steady(260), TODAY); // 780 workouts
    expect(five.countedWorkouts).toBe(780);
    expect(five.level).toBeGreaterThanOrEqual(95);
    expect(five.level).toBeLessThanOrEqual(105);
    const ten = trainingLevel(steady(520), TODAY);
    expect(ten.level).toBeGreaterThan(130); // no cap
  });

  it('is motivating early: a few levels in the first week, double digits in the first month', () => {
    expect(trainingLevel(steady(1), TODAY).level).toBeGreaterThanOrEqual(5);
    expect(trainingLevel(steady(4), TODAY).level).toBeGreaterThanOrEqual(10);
  });

  it('counts only finished workouts with 3+ non-warm-up sets and 10+ minutes', () => {
    const result = trainingLevel(
      [
        session(MONDAY), // counts
        session(addDays(MONDAY, 1), { status: 'open' }),
        session(addDays(MONDAY, 2), { workingSets: 2 }),
        session(addDays(MONDAY, 3), { durationSeconds: 9 * 60 }),
        session(addDays(MONDAY, 4), { durationSeconds: 10 * 60, workingSets: 3 }), // just counts
      ],
      TODAY,
    );
    expect(result.countedWorkouts).toBe(2);
    expect(result.xp).toBe(110 + 100);
  });

  it('gives a small, capped bonus for sets, not for weight', () => {
    expect(workoutXp({ workingSets: 3 })).toBe(100);
    expect(workoutXp({ workingSets: 8 })).toBe(110);
    expect(workoutXp({ workingSets: 13 })).toBe(120);
    expect(workoutXp({ workingSets: 60 })).toBe(120);
  });

  it('halves the 5th and 6th workout of a week and gives nothing for more', () => {
    const daily = Array.from({ length: 7 }, (_, i) => session(addDays(MONDAY, i), { workingSets: 3 }));
    const result = trainingLevel(daily, TODAY);
    expect(result.xp).toBe(4 * 100 + 2 * 50);
    expect(result.countedWorkouts).toBe(6);
  });

  it('halves a second workout on one day and ignores a third, without using up the week', () => {
    const sessions = [
      session(MONDAY, { workingSets: 3 }),
      session(MONDAY, { workingSets: 3 }),
      session(MONDAY, { workingSets: 3 }), // nothing, and not counted against the week
      session(addDays(MONDAY, 1), { workingSets: 3 }),
      session(addDays(MONDAY, 2), { workingSets: 3 }),
      session(addDays(MONDAY, 3), { workingSets: 3 }), // 5th earning workout of the week: half
      session(addDays(MONDAY, 4), { workingSets: 3 }), // 6th earning: still half, because the third
      // Monday one did not take a slot (had it, this would be 7th and earn nothing)
    ];
    const result = trainingLevel(sessions, TODAY);
    expect(result.xp).toBe(100 + 50 + 100 + 100 + 50 + 50);
    expect(result.countedWorkouts).toBe(6);
  });

  it('defeats farming: daily tiny or extra sessions earn little more than steady training', () => {
    const farmed = Array.from({ length: 52 * 7 }, (_, i) => [
      session(addDays(MONDAY, -i), { workingSets: 60 }),
      session(addDays(MONDAY, -i), { workingSets: 60 }),
      session(addDays(MONDAY, -i), { workingSets: 2, durationSeconds: 60 }),
    ]).flat();
    const honest = steady(52);
    const ratio = trainingLevel(farmed, MONDAY).xp / trainingLevel(honest, TODAY).xp;
    expect(ratio).toBeLessThan(2.2);
  });

  it('never penalises rest: a gap of months loses nothing', () => {
    const before = steady(10);
    const after = trainingLevel(before, addDays(TODAY, 200));
    expect(after).toEqual(trainingLevel(before, TODAY));
  });

  it('recomputes from what exists: an edit or deletion simply changes the result', () => {
    const sessions = steady(4);
    const all = trainingLevel(sessions, TODAY);
    const fewer = trainingLevel(sessions.slice(1), TODAY);
    expect(fewer.xp).toBe(all.xp - 110);
    const shortened = sessions.map((s, i) => (i === 0 ? { ...s, workingSets: 2 } : s));
    expect(trainingLevel(shortened, TODAY).xp).toBe(all.xp - 110);
  });

  it('ignores workouts dated after today', () => {
    expect(trainingLevel([session(addDays(TODAY, 1))], TODAY).countedWorkouts).toBe(0);
  });

  it('is deterministic regardless of input order', () => {
    const sessions = steady(6);
    expect(trainingLevel([...sessions].reverse(), TODAY)).toEqual(trainingLevel(sessions, TODAY));
  });

  it('maps XP to levels exactly at the boundaries, with progress into the level', () => {
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(17);
    expect(xpToReach(100)).toBe(17 * 4950);
    expect(levelForXp(16)).toBe(1);
    expect(levelForXp(17)).toBe(2);
    expect(levelForXp(xpToReach(100))).toBe(100);
    expect(levelForXp(xpToReach(100) - 1)).toBe(99);
    const one = trainingLevel([session(MONDAY)], TODAY); // 110 XP
    expect(one.level).toBe(levelForXp(110));
    expect(one.xpIntoLevel).toBe(110 - xpToReach(one.level));
    expect(one.xpForLevel).toBe(TRAINING_LEVEL_CONFIG.xpStep * one.level);
    expect(one.xpIntoLevel).toBeLessThan(one.xpForLevel);
  });
});
