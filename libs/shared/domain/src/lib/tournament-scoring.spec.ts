import type { BenchmarkVersion, ExerciseStandard, RankSet } from './strength-ranks';
import {
  bestStrength,
  freezeStandard,
  placeStandings,
  scoringWindows,
  tournamentScore,
  tournamentStandard,
} from './tournament-scoring';
import { season } from './tournaments';

const STANDARD: ExerciseStandard = {
  method: 'e1rm',
  measure: 'weight_reps',
  starts: { men: [0, 500, 750, 1000, 1250, 1500, 1750, 2000], women: [0, 300, 450, 600, 750, 900, 1050, 1200] },
};
let n = 0;
/** One set in its own workout unless `sessionId` is given; an 80 kg man, so score = kg × 12.5. */
const set = (day: string, kg: number, extra: Partial<RankSet> = {}): RankSet => ({
  id: `s${++n}`,
  sessionId: `w${n}`,
  day,
  type: 'working',
  reps: 1,
  weightGrams: kg * 1000,
  body: { day, weightGrams: 80_000 },
  ...extra,
});

describe('tournament score (owner formula, #12)', () => {
  it('gives the documented examples: +3% → +1%, +15% → +5%, more is capped', () => {
    expect(tournamentScore(1030, 1000)).toMatchObject({ improvementBp: 300, bonusBp: 100, score: 1040 });
    expect(tournamentScore(1150, 1000)).toMatchObject({ improvementBp: 1500, bonusBp: 500, score: 1208 });
    expect(tournamentScore(1400, 1000)).toMatchObject({ improvementBp: 4000, bonusBp: 500, score: 1470 });
  });

  it('is linear up to the cap and rounds the bonus down, never up', () => {
    expect(tournamentScore(1149, 1000).bonusBp).toBe(496);
    expect(tournamentScore(1001, 1000)).toMatchObject({ improvementBp: 10, bonusBp: 3 });
    // 0.29% improvement: 9.67 bp of bonus, rounded down to 9.
    expect(tournamentScore(10029, 10000).bonusBp).toBe(9);
  });

  it('never penalises getting weaker, and equal is no bonus', () => {
    expect(tournamentScore(900, 1000)).toEqual({ score: 900, strengthScore: 900, baseline: 1000, improvementBp: 0, bonusBp: 0 });
    expect(tournamentScore(1000, 1000)).toMatchObject({ score: 1000, bonusBp: 0 });
  });

  it('never invents improvement: no baseline, or withheld when standards changed', () => {
    expect(tournamentScore(1200, 0)).toMatchObject({ score: 1200, bonusBp: 0, improvementBp: 0 });
    expect(tournamentScore(1150, 1000, true)).toEqual({
      score: 1150,
      strengthScore: 1150,
      baseline: 1000,
      improvementBp: 1500,
      bonusBp: 0,
      bonusWithheld: 'standards_changed',
    });
  });

  it('absolute strength stays the main comparator: the stronger lifter wins despite less improvement', () => {
    const strong = tournamentScore(1500, 1500); // no improvement
    const improver = tournamentScore(1300, 1000); // +30%, capped bonus
    expect(strong.score).toBeGreaterThan(improver.score);
  });
});

describe('best strength in a window', () => {
  it('uses strength alone: the work-capacity bonus never counts', () => {
    const sessionId = 'heavy-day';
    const sets = [set('2026-12-05', 100, { sessionId }), set('2026-12-05', 90, { sessionId }), set('2026-12-05', 90, { sessionId })];
    expect(bestStrength(STANDARD, 'men', sets, '2026-12-01', '2026-12-31')).toMatchObject({ score: 1250, basis: { day: '2026-12-05' } });
    const best = bestStrength(STANDARD, 'men', sets, '2026-12-01', '2026-12-31');
    expect(best?.basis).not.toHaveProperty('bonusPercent');
  });

  it('counts only days inside the window, and follows the rank rules', () => {
    const sets = [
      set('2026-11-30', 140), // before the season
      set('2027-01-01', 140), // after it
      set('2026-12-10', 100, { type: 'warmup' }),
      set('2026-12-10', 120, { machine: true }), // machine on a free-weight standard
      set('2026-12-11', 110, { body: undefined }), // no weigh-in
      set('2026-12-12', 400), // implausible
      set('2026-12-20', 96),
    ];
    expect(bestStrength(STANDARD, 'men', sets, '2026-12-01', '2026-12-31')?.score).toBe(1200);
    expect(bestStrength(STANDARD, 'men', [], '2026-12-01', '2026-12-31')).toBeUndefined();
  });
});

describe('scoring windows and standards', () => {
  it('baseline is the 90 days before the 1st, the season is the month', () => {
    expect(scoringWindows(season('2026-12'))).toEqual({
      baselineFrom: '2026-09-02',
      baselineTo: '2026-11-30',
      seasonFrom: '2026-12-01',
      seasonTo: '2026-12-31',
    });
  });

  it('scores under the version frozen at the lock; a replaced draft falls back and says so', () => {
    const v = (version: string, from: string): BenchmarkVersion => ({ version, draft: true, from, basis: '', exercises: { bench: STANDARD } });
    const versions = [v('a', '0000-01-01'), v('b', '2026-12-15')];
    expect(tournamentStandard('bench', 'weight_reps', 'a', '2026-12-20', versions)).toMatchObject({ version: 'a', changed: false });
    expect(tournamentStandard('bench', 'weight_reps', 'gone', '2026-12-20', versions)).toMatchObject({ version: 'b', changed: true });
    expect(tournamentStandard('bench', 'bodyweight_reps', 'a', '2026-12-20', versions)).toBeUndefined();
    expect(tournamentStandard(undefined, 'weight_reps', 'a', '2026-12-20', versions)).toBeUndefined();
  });

  it('scores a season under its copy from the lock, unchanged by any later version or measure (#5)', () => {
    const frozen = freezeStandard('a', { ...STANDARD, note: 'not scoring', provisional: true });
    expect(frozen).toEqual({ version: 'a', method: STANDARD.method, measure: STANDARD.measure, starts: STANDARD.starts });
    const replaced: BenchmarkVersion[] = [{ version: 'b', draft: true, from: '0000-01-01', basis: '', exercises: { bench: { ...STANDARD, starts: { men: STANDARD.starts.men.map((x) => x * 2), women: STANDARD.starts.women } } } }];
    // The copy wins over the published versions, and even over a changed logging measure.
    expect(tournamentStandard('bench', 'bodyweight_reps', frozen, '2026-12-20', replaced)).toEqual({
      standard: { method: STANDARD.method, measure: STANDARD.measure, starts: STANDARD.starts },
      version: 'a',
      changed: false,
    });
    // Mutating the source after the copy changes nothing.
    const source = { ...STANDARD, starts: { men: [...STANDARD.starts.men], women: [...STANDARD.starts.women] } };
    const copy = freezeStandard('a', source);
    source.starts.men[1] = 1;
    expect(copy.starts.men[1]).toBe(STANDARD.starts.men[1]);
  });
});

describe('standings', () => {
  it('orders by score, shares exact ties, and has no volume tie-break', () => {
    const out = placeStandings([
      { id: 'a', score: 1000 },
      { id: 'b', score: 1200 },
      { id: 'c' },
      { id: 'd', score: 1000 },
      { id: 'e', score: 900 },
    ]);
    expect(out.map((row) => [row.id, row.place])).toEqual([
      ['b', 1],
      ['a', 2],
      ['d', 2],
      ['e', 4],
      ['c', undefined],
    ]);
  });
});
