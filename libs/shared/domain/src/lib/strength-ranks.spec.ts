import {
  RANK_BENCHMARKS,
  exerciseRank as rankWith,
  milestoneStarts,
  rankLabel,
  rankPosition,
  scoreSet,
  type BenchmarkVersion,
  type RankSet,
} from './strength-ranks';

const BENCH = 'fedb:Barbell_Bench_Press_-_Medium_Grip';
const LEG_PRESS = 'fedb:Leg_Press';
/**
 * A fixed benchmark for the rules under test, so they don't move when the published thresholds
 * do. The published ones are checked separately (stress profiles below).
 */
const FIXTURE: BenchmarkVersion = {
  version: 'v1-draft',
  draft: true,
  from: '0000-01-01',
  basis: 'test',
  exercises: {
    [BENCH]: { method: 'e1rm', measure: 'weight_reps', starts: { men: [0, 500, 750, 1000, 1250, 1500, 1750, 2000], women: [0, 300, 450, 600, 750, 900, 1050, 1200] } },
    'fedb:Pullups': { method: 'e1rm', measure: 'bodyweight_reps', starts: { men: [0, 800, 1000, 1150, 1300, 1450, 1650, 1900], women: [0, 600, 800, 950, 1080, 1200, 1350, 1550] } },
    'fedb:Pushups': { method: 'reps', measure: 'bodyweight_reps', starts: { men: [0, 5, 10, 20, 30, 40, 55, 70], women: [0, 2, 5, 10, 18, 26, 36, 48] } },
    [LEG_PRESS]: { method: 'e1rm', measure: 'weight_reps', machine: true, starts: { men: [0, 1000, 1500, 2000, 2500, 3000, 3500, 4000], women: [0, 800, 1200, 1600, 2000, 2400, 2800, 3200] } },
  },
};
const exerciseRank = (input: Parameters<typeof rankWith>[0], versions: readonly BenchmarkVersion[] = [FIXTURE]) => rankWith(input, versions);
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
    const standard = FIXTURE.exercises[BENCH];
    const at80 = scoreSet(standard, 'men', set(TODAY, 100, 1, 80));
    expect(at80).toMatchObject({ score: 1250, basis: { oneRepMaxGrams: 100_000, bodyWeightGrams: 80_000 } });
    // Twice the body weight: 2^(2/3) ≈ 1.587× the load for the same score, not 2×.
    const at160 = scoreSet(standard, 'men', set(TODAY, 158.7, 1, 160));
    expect('score' in at160 && Math.abs(at160.score - 1250) <= 1).toBe(true);
    // Epley for 5 reps: 100 × (1 + 5/30).
    expect(scoreSet(standard, 'men', set(TODAY, 100, 5, 80))).toMatchObject({ score: 1458 });
  });

  it('includes body weight for bodyweight lifts and subtracts nothing it should not', () => {
    const pullups = FIXTURE.exercises['fedb:Pullups'];
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
    expect(exerciseRank({ exerciseId: 'x', seedKey: 'fedb:Not_In_The_Fixture', measure: 'weight_reps', standards: 'men', sets: [], today: TODAY }).reason).toBe('no_benchmark');
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
    const v1 = FIXTURE;
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

  it('adds at most +5% for hard sets in one workout, so volume cannot dominate', () => {
    const session = (count: number, id: string) =>
      Array.from({ length: count }, (_, i) => set(TODAY, i === 0 ? 100 : 80, 1, 80, { sessionId: id }));
    // 80 kg is 80% of the 100 kg top set: hard. Score without bonus: 1250.
    const one = bench(session(1, 'a'));
    expect(one.current?.basis).toMatchObject({ strengthScore: 1250, hardSets: 1, bonusPercent: 0 });
    expect(one.current?.score).toBe(1250);
    expect(bench(session(4, 'b')).current).toMatchObject({ score: 1288, basis: { hardSets: 4, bonusPercent: 3 } });
    expect(bench(session(6, 'c')).current?.score).toBe(1313);
    expect(bench(session(40, 'd')).current?.score).toBe(1313);
    // Light sets (below 75% of the best) are not hard and add nothing.
    const light = [set(TODAY, 100, 1, 80, { sessionId: 'e' }), ...Array.from({ length: 10 }, () => set(TODAY, 60, 1, 80, { sessionId: 'e' }))];
    expect(bench(light).current?.score).toBe(1250);
  });

  it('counts the bonus per workout, never across workouts', () => {
    const sets = [set(TODAY, 100, 1, 80, { sessionId: 'x' }), set('2026-11-10', 90, 1, 80, { sessionId: 'y' }), set('2026-11-11', 90, 1, 80, { sessionId: 'z' })];
    expect(bench(sets).current).toMatchObject({ score: 1250, basis: { hardSets: 1 } });
  });

  it('gives push-ups no work-capacity part', () => {
    const view = exerciseRank({ exerciseId: 'p', seedKey: 'fedb:Pushups', measure: 'bodyweight_reps', standards: 'men', sets: [set(TODAY, 0, 25, undefined, { sessionId: 'p' }), set(TODAY, 0, 24, undefined, { sessionId: 'p' })], today: TODAY });
    expect(view.current?.score).toBe(25);
    expect(view.current?.basis.bonusPercent).toBeUndefined();
  });

  it('counts machine sets for a machine standard, and marks the standard as a machine one', () => {
    const view = exerciseRank({ exerciseId: 'l', seedKey: LEG_PRESS, measure: 'weight_reps', standards: 'men', sets: [set(TODAY, 200, 1, 80, { machine: true })], today: TODAY });
    expect(view).toMatchObject({ status: 'ranked', excluded: { machine: 0 }, benchmark: { machine: true } });
    expect(view.current?.score).toBe(2500);
  });
});

describe('published standards: stress profiles (v1-draft-2)', () => {
  const v = RANK_BENCHMARKS[RANK_BENCHMARKS.length - 1];
  const tierOf = (seedKey: string, standards: 'men' | 'women', weightKg: number, reps: number, bodyKg: number) => {
    const standard = v.exercises[seedKey];
    const scored = scoreSet(standard, standards, set(TODAY, weightKg, reps, bodyKg));
    if ('skip' in scored) throw new Error('not scored');
    return rankPosition(scored.score, standard.starts[standards], scored.basis).tier;
  };

  it('has eight increasing tier starts from 0 for every exercise and both standards; women never above men', () => {
    for (const [key, standard] of Object.entries(v.exercises)) {
      for (const standards of ['men', 'women'] as const) {
        const starts = standard.starts[standards];
        expect([key, starts.length, starts[0]]).toEqual([key, 8, 0]);
        starts.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(starts[i]));
      }
      if (standard.method === 'e1rm') standard.starts.women.forEach((value, i) => expect(value).toBeLessThanOrEqual(standard.starts.men[i]));
    }
  });

  it('keeps Legend below world-record lifts (IPF raw records, scaled to the reference weight)', () => {
    // Record anchors as scaled multiples: men ~80 kg, women ~60 kg (OpenIPF, 2025–26).
    const records: Record<string, { men: number; women: number }> = {
      'fedb:Barbell_Squat': { men: 4120, women: 3460 },
      'fedb:Barbell_Bench_Press_-_Medium_Grip': { men: 2670, women: 2120 },
      'fedb:Barbell_Deadlift': { men: 4530, women: 3900 },
    };
    for (const [key, record] of Object.entries(records)) {
      expect(v.exercises[key].starts.men[7]).toBeLessThanOrEqual(record.men * 0.85);
      expect(v.exercises[key].starts.women[7]).toBeLessThanOrEqual(record.women * 0.85);
    }
  });

  it('orders variants as the research does, tier by tier', () => {
    const below = (lower: string, upper: string) =>
      v.exercises[lower].starts.men.slice(1).forEach((value, i) => expect(value).toBeLessThan(v.exercises[upper].starts.men[i + 1]));
    below('fedb:Front_Barbell_Squat', 'fedb:Barbell_Squat');
    below('fedb:Barbell_Squat', 'fedb:Barbell_Deadlift');
    below('fedb:Romanian_Deadlift', 'fedb:Barbell_Deadlift');
    below('fedb:Barbell_Incline_Bench_Press_-_Medium_Grip', 'fedb:Barbell_Bench_Press_-_Medium_Grip');
    below('fedb:Standing_Military_Press', 'fedb:Barbell_Bench_Press_-_Medium_Grip');
    below('fedb:Dumbbell_Bench_Press', 'fedb:Barbell_Bench_Press_-_Medium_Grip');
    below('fedb:Barbell_Squat', 'fedb:Leg_Press');
  });

  it('places realistic lifters where the tier names say', () => {
    // Untrained man, 80 kg: bench 50 × 5.
    expect(tierOf('fedb:Barbell_Bench_Press_-_Medium_Grip', 'men', 50, 5, 80)).toBe('Explorer');
    // 1–2 years of training, 80 kg: bench 90 × 5, squat 120 × 5.
    expect(tierOf('fedb:Barbell_Bench_Press_-_Medium_Grip', 'men', 90, 5, 80)).toBe('Achiever');
    expect(tierOf('fedb:Barbell_Squat', 'men', 120, 5, 80)).toBe('Achiever');
    // Advanced man, 90 kg: squat 180 × 3.
    expect(tierOf('fedb:Barbell_Squat', 'men', 180, 3, 90)).toBe('Elite');
    // Beginner woman, 60 kg: squat 40 × 8. Intermediate woman, 65 kg: bench 45 × 5, deadlift 85 × 3;
    // 100 × 3 (≈1.54× body weight) is already Veteran, the coaching tables' "proficient".
    expect(tierOf('fedb:Barbell_Squat', 'women', 40, 8, 60)).toBe('Explorer');
    expect(tierOf('fedb:Barbell_Bench_Press_-_Medium_Grip', 'women', 45, 5, 65)).toBe('Achiever');
    expect(tierOf('fedb:Barbell_Deadlift', 'women', 85, 3, 65)).toBe('Achiever');
    expect(tierOf('fedb:Barbell_Deadlift', 'women', 100, 3, 65)).toBe('Veteran');
    // Heavy and light men with the same 1.07× and 1.5× body-weight bench land within one tier.
    expect(tierOf('fedb:Barbell_Bench_Press_-_Medium_Grip', 'men', 140, 1, 130)).toBe('Achiever');
    expect(tierOf('fedb:Barbell_Bench_Press_-_Medium_Grip', 'men', 90, 1, 60)).toBe('Achiever');
  });

  it('makes one strict pull-up or dip at least Explorer; heavier, it scales up to Challenger', () => {
    for (const body of [55, 70, 80]) {
      expect(tierOf('fedb:Pullups', 'men', 0, 1, body)).toBe('Explorer');
      expect(tierOf('fedb:Dips_-_Triceps_Version', 'men', 0, 1, body)).toBe('Explorer');
    }
    for (const body of [100, 120]) expect(tierOf('fedb:Pullups', 'men', 0, 1, body)).toBe('Challenger');
    // For women a strict pull-up is rarer: Challenger at a typical weight, Achiever when heavier.
    for (const body of [45, 60]) expect(tierOf('fedb:Pullups', 'women', 0, 1, body)).toBe('Challenger');
    expect(tierOf('fedb:Pullups', 'women', 0, 1, 80)).toBe('Achiever');
  });

  it('lets the work-capacity part move a rank by about one division, never a tier', () => {
    for (const standard of Object.values(v.exercises).filter((s) => s.method === 'e1rm')) {
      for (const standards of ['men', 'women'] as const) {
        const starts = standard.starts[standards];
        for (let tier = 1; tier < 8; tier++) {
          const plain = rankPosition(starts[tier], starts, basis).milestone;
          const boosted = rankPosition(Math.round(starts[tier] * 1.05), starts, basis).milestone;
          expect(boosted - plain).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});

