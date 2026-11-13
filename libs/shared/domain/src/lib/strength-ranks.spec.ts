import {
  RANK_BENCHMARKS,
  exerciseRank,
  milestoneStarts,
  rankLabel,
  rankPosition,
  scoreSet,
  type BenchmarkVersion,
  type RankSet,
} from './strength-ranks';

const BENCH = 'fedb:Barbell_Bench_Press_-_Medium_Grip';
const TODAY = '2026-11-13';
const basis = { setId: 's', sessionId: 'w', day: TODAY, reps: 1 };
let n = 0;
const set = (day: string, weightKg: number, reps: number, bodyKg?: number, extra: Partial<RankSet> = {}): RankSet => ({
  id: `s${++n}`,
  sessionId: `w${n}`,
  day,
  type: 'working',
  reps,
  weightGrams: weightKg * 1000,
  ...(bodyKg ? { body: { day, weightGrams: bodyKg * 1000 } } : {}),
  ...extra,
});
const bench = (sets: RankSet[], standards: 'men' | 'women' | undefined = 'men', today = TODAY) =>
  exerciseRank({ exerciseId: 'x', seedKey: BENCH, measure: 'weight_reps', standards, sets, today });

describe('strength ranks (#5b)', () => {
  it('splits each tier into three divisions, Legend as wide as Master', () => {
    const starts = milestoneStarts([0, 500, 750, 1000, 1250, 1500, 1750, 2000]);
    expect(starts).toHaveLength(24);
    expect(starts.slice(0, 6)).toEqual([0, 167, 333, 500, 583, 667]);
    expect(starts.slice(-3)).toEqual([2000, 2083, 2167]);
  });

  it('places scores on the boundaries exactly and reports progress to the next division', () => {
    const tiers = [0, 500, 750, 1000, 1250, 1500, 1750, 2000];
    expect(rankLabel(rankPosition(0, tiers, basis))).toBe('Initiate III');
    expect(rankLabel(rankPosition(499, tiers, basis))).toBe('Initiate I');
    const explorer = rankPosition(500, tiers, basis);
    expect([rankLabel(explorer), explorer.nextScore, explorer.progress]).toEqual(['Explorer III', 583, 0]);
    expect(rankPosition(541, tiers, basis).progress).toBe(493);
    const legend = rankPosition(5000, tiers, basis);
    expect([rankLabel(legend), legend.nextScore, legend.progress]).toEqual(['Legend I', undefined, 1000]);
  });

  it('scales an e1RM allometrically, so a heavier lifter needs more load for the same score', () => {
    const standard = RANK_BENCHMARKS[0].exercises[BENCH];
    const at80 = scoreSet(standard, 'men', set(TODAY, 100, 1, 80));
    expect(at80).toMatchObject({ score: 1250, basis: { oneRepMaxGrams: 100_000, bodyWeightGrams: 80_000 } });
    // Twice the body weight: 2^(2/3) ≈ 1.587× the load for the same score, not 2×.
    const at160 = scoreSet(standard, 'men', set(TODAY, 158.7, 1, 160));
    expect('score' in at160 && Math.abs(at160.score - 1250) <= 1).toBe(true);
    // Epley for 5 reps: 100 × (1 + 5/30).
    expect(scoreSet(standard, 'men', set(TODAY, 100, 5, 80))).toMatchObject({ score: 1458 });
  });

  it('includes body weight for bodyweight lifts and subtracts nothing it should not', () => {
    const pullups = RANK_BENCHMARKS[0].exercises['fedb:Pullups'];
    // One strict pull-up at 80 kg is 1.0×; 10 kg added for 5 reps is 90 × 7/6 = 105 kg.
    expect(scoreSet(pullups, 'men', set(TODAY, 0, 1, 80, { weightGrams: undefined }))).toMatchObject({ score: 1000 });
    expect(scoreSet(pullups, 'men', set(TODAY, 10, 5, 80))).toMatchObject({ score: 1313, basis: { loadGrams: 90_000 } });
  });

  it('ranks push-ups by reps, without body weight', () => {
    const view = exerciseRank({ exerciseId: 'p', seedKey: 'fedb:Pushups', measure: 'bodyweight_reps', standards: 'men', sets: [set(TODAY, 0, 25)], today: TODAY });
    expect(view.current && [rankLabel(view.current), view.current.score]).toEqual(['Achiever II', 25]);
    expect(view.benchmark?.referenceBodyWeightGrams).toBeUndefined();
  });

  it('ranks only exact catalogue lifts under the measure the standard assumes', () => {
    expect(exerciseRank({ exerciseId: 'own', measure: 'weight_reps', standards: 'men', sets: [], today: TODAY })).toMatchObject({ status: 'unranked', reason: 'no_benchmark' });
    expect(exerciseRank({ exerciseId: 'x', seedKey: 'fedb:Dumbbell_Bench_Press', measure: 'weight_reps', standards: 'men', sets: [], today: TODAY }).reason).toBe('no_benchmark');
    expect(exerciseRank({ exerciseId: 'x', seedKey: BENCH, measure: 'bodyweight_reps', standards: 'men', sets: [], today: TODAY }).reason).toBe('no_benchmark');
  });

  it('asks for standards and for a recent weigh-in rather than guessing', () => {
    expect(exerciseRank({ exerciseId: 'x', seedKey: BENCH, measure: 'weight_reps', sets: [set(TODAY, 100, 1, 80)], today: TODAY })).toMatchObject({ status: 'unranked', reason: 'needs_standards' });
    const stale = set(TODAY, 100, 1, undefined, { body: { day: '2026-07-01', weightGrams: 80_000 } });
    expect(bench([stale, set(TODAY, 80, 1)])).toMatchObject({ status: 'unranked', reason: 'needs_body_weight', excluded: { noBodyWeight: 2 } });
  });

  it('uses the women standards and their 60 kg reference when chosen', () => {
    const view = bench([set(TODAY, 45, 1, 60)], 'women');
    expect(view.current && [rankLabel(view.current), view.current.score]).toEqual(['Veteran III', 750]);
    expect(view.benchmark?.referenceBodyWeightGrams).toBe(60_000);
  });

  it('keeps the best set of the last 90 days as current, and goes inactive, not lower, after', () => {
    const old = set('2026-06-01', 120, 1, 80); // 1.5× → Elite III
    const recent = set('2026-10-01', 90, 1, 80); // 1.125× → Achiever II
    const view = bench([old, recent]);
    expect(view.status).toBe('ranked');
    expect(view.current && rankLabel(view.current)).toBe('Achiever II');
    expect(view.highest && [rankLabel(view.highest), view.highest.version]).toEqual(['Elite III', 'v1-draft']);
    expect(view.currentUntil).toBe('2026-12-29');
    const later = bench([old, recent], 'men', '2026-12-30');
    expect([later.status, later.current, later.highest && rankLabel(later.highest)]).toEqual(['inactive', undefined, 'Elite III']);
    // A new valid set re-ranks from what it shows.
    const back = bench([old, recent, set('2027-02-01', 70, 1, 80)], 'men', '2027-02-01');
    expect(back.current && rankLabel(back.current)).toBe('Challenger II'); // 0.875×
  });

  it('ignores warm-ups, machine sets, reps outside 1–12, future sets and implausible scores', () => {
    const view = bench([
      set(TODAY, 300, 1, 80, { type: 'warmup' }),
      set(TODAY, 300, 1, 80, { machine: true }),
      set(TODAY, 100, 15, 80),
      set('2026-12-01', 300, 1, 80),
      set(TODAY, 300, 1, 80), // 3.75× bench: past 1.5 × the Legend start
      set(TODAY, 60, 1, 80),
    ]);
    expect(view.excluded).toEqual({ implausible: 1, noBodyWeight: 0, machine: 1 });
    expect(view.current?.score).toBe(750);
  });

  it('never takes away a highest rank earned under an older benchmark version', () => {
    const v1 = RANK_BENCHMARKS[0];
    const stricter: BenchmarkVersion = {
      ...v1,
      version: 'v2',
      draft: false,
      from: '2026-10-01',
      exercises: { ...v1.exercises, [BENCH]: { ...v1.exercises[BENCH], starts: { men: [0, 700, 1000, 1300, 1600, 1900, 2200, 2500], women: v1.exercises[BENCH].starts.women } } },
    };
    const view = exerciseRank(
      { exerciseId: 'x', seedKey: BENCH, measure: 'weight_reps', standards: 'men', sets: [set('2026-09-01', 120, 1, 80), set('2026-10-15', 120, 1, 80)], today: TODAY },
      [v1, stricter],
    );
    expect(view.highest && [rankLabel(view.highest), view.highest.version]).toEqual(['Elite III', 'v1-draft']);
    expect(view.current && rankLabel(view.current)).toBe('Achiever I'); // 1.5× under v2
    expect(view.benchmark?.version).toBe('v2');
  });

  it('is stable: the same sets give the same rank whatever their order', () => {
    const sets = [set('2026-10-01', 90, 3, 80), set('2026-10-08', 95, 1, 80), set('2026-10-15', 85, 5, 80)];
    expect(bench([...sets].reverse())).toEqual(bench(sets));
  });
});
