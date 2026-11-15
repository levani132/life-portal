import type { ExerciseRankView, SessionExercise, TrainingLevel, WorkoutSet } from '@life-portal/shared-types';
import { rankUps, recapRecords, workoutRecap, workoutTotals } from './workout-recap';

const set = (id: string, values: Partial<WorkoutSet>): WorkoutSet => ({
  id,
  workoutExerciseId: 'we',
  exerciseId: 'ex',
  order: 0,
  type: 'working',
  loggedAt: '2026-11-15T10:00:00.000Z',
  ...values,
});

const exercise = (id: string, name: string, measure: SessionExercise['snapshot']['measure'], sets: WorkoutSet[], muscles = ['chest']): SessionExercise =>
  ({
    id: `we-${id}`,
    sessionId: 's1',
    exerciseId: id,
    order: 0,
    snapshot: { name, equipmentType: 'barbell', measure, primaryMuscles: muscles },
    sets,
    openTargets: [],
    skipped: false,
  }) as SessionExercise;

const bench = exercise('bench', 'Bench Press', 'weight_reps', [
  set('w', { type: 'warmup', reps: 10, weightGrams: 40_000 }),
  set('a', { reps: 8, weightGrams: 80_000, records: ['heaviest', 'best_1rm'] }),
  set('b', { reps: 6, weightGrams: 80_000 }),
]);
const pullUps = exercise(
  'pull',
  'Pull-Up',
  'bodyweight_reps',
  [
    set('p1', { reps: 10, effectiveLoad: { grams: 75_000, bodyWeightDay: '2026-11-10' } }),
    set('p2', { reps: 8 }), // no body weight known: reps count, volume does not
  ],
  ['lats', 'biceps'],
);
const plank = exercise('plank', 'Plank', 'duration', [set('t', { durationSeconds: 60 })], ['abs']);
const empty = exercise('row', 'Row', 'weight_reps', []);

const session = { id: 's1', day: '2026-11-15', status: 'finished' as const, durationSeconds: 3600, exercises: [bench, pullUps, plank, empty] };

const position = (milestone: number) => ({ milestone, tier: 'explorer', division: 'II', score: 1000, progress: 0, basis: 'e1rm' });
const view = (highest?: number): ExerciseRankView =>
  ({
    exerciseId: 'bench',
    status: highest === undefined ? 'unranked' : 'ranked',
    windowDays: 90,
    excluded: { implausible: 0, noBodyWeight: 0, machine: 0 },
    ...(highest === undefined ? {} : { highest: { ...position(highest), version: 'v1' } }),
  }) as ExerciseRankView;

const level = (value: number, xp: number): TrainingLevel => ({ level: value, xp, xpIntoLevel: 0, xpForLevel: 100, countedWorkouts: 1 });

describe('workoutTotals (#25)', () => {
  it('counts warm-ups only as sets, and volume only where the load is known', () => {
    const totals = workoutTotals(session);
    expect(totals).toMatchObject({
      durationSeconds: 3600,
      exercises: 3, // the row with nothing logged is not an exercise done
      sets: 6,
      workingSets: 5,
      reps: 8 + 6 + 10 + 8,
      // 80 kg × 8 + 80 kg × 6 + 75 kg × 10; the pull-ups without a weigh-in add nothing.
      volumeGrams: 80_000 * 8 + 80_000 * 6 + 75_000 * 10,
    });
  });

  it('counts working sets per primary muscle, most first', () => {
    expect(workoutTotals(session).setsByMuscle).toEqual([
      { muscle: 'biceps', sets: 2 },
      { muscle: 'chest', sets: 2 },
      { muscle: 'lats', sets: 2 },
      { muscle: 'abs', sets: 1 },
    ]);
  });
});

describe('recapRecords (#25)', () => {
  it('lists only the records the server marked, with their values', () => {
    const records = recapRecords(session);
    expect(records.map((record) => [record.name, record.kind, record.setId])).toEqual([
      ['Bench Press', 'heaviest', 'a'],
      ['Bench Press', 'best_1rm', 'a'],
    ]);
    expect(records[0].entry?.value).toBe(80_000);
  });

  it('has none for a workout without marks', () => {
    expect(recapRecords({ ...session, exercises: [pullUps, plank] })).toEqual([]);
  });
});

describe('rankUps (#25)', () => {
  it('is a rank-up only when the best-ever milestone rose', () => {
    expect(rankUps([{ exerciseId: 'bench', name: 'Bench Press', before: view(4), after: view(5) }])).toEqual([
      { exerciseId: 'bench', name: 'Bench Press', from: position(4), to: position(5), version: 'v1' },
    ]);
    expect(rankUps([{ exerciseId: 'bench', name: 'Bench Press', before: view(5), after: view(5) }])).toEqual([]);
  });

  it('counts a first rank as a rank-up from nothing', () => {
    expect(rankUps([{ exerciseId: 'bench', name: 'Bench Press', before: view(), after: view(2) }])[0]).toMatchObject({ to: position(2) });
    expect(rankUps([{ exerciseId: 'bench', name: 'Bench Press', before: view(), after: view(2) }])[0].from).toBeUndefined();
  });

  it('never invents one: still unranked after is nothing', () => {
    expect(rankUps([{ exerciseId: 'bench', name: 'Bench Press', before: view(), after: view() }])).toEqual([]);
  });
});

describe('workoutRecap (#25)', () => {
  it('celebrates a level-up apart from ranks, and reports XP even without one', () => {
    const up = workoutRecap({ session, levels: { before: level(4, 300), after: level(5, 410) } });
    expect(up.level).toMatchObject({ from: 4, to: 5, xpGained: 110 });
    expect(up.rankUps).toBeUndefined(); // ranks off: absent, not empty

    const quiet = workoutRecap({
      session: { ...session, exercises: [pullUps] },
      levels: { before: level(5, 410), after: level(5, 520) },
      ranks: [{ exerciseId: 'bench', name: 'Bench Press', before: view(5), after: view(5) }],
    });
    expect(quiet.achievements).toBe(false);
    expect(quiet.rankUps).toEqual([]);
    expect(quiet.level?.xpGained).toBe(110);
  });

  it('has achievements with a record alone', () => {
    expect(workoutRecap({ session }).achievements).toBe(true);
  });
});
