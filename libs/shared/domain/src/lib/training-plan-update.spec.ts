import type { Measure, PlanTarget } from '@life-portal/shared-types';
import {
  planDayUpdate,
  targetsFromSets,
  type PlanDayExercise,
  type PlanUpdateSessionExercise,
  type PlanUpdateSet,
} from './training-plan-update';

const working = (reps: number, weightGrams?: number): PlanTarget => ({ type: 'working', reps, ...(weightGrams ? { weightGrams } : {}) });

const CATALOGUE: Record<string, { name: string; measure: Measure }> = {
  bench: { name: 'Bench press', measure: 'weight_reps' },
  row: { name: 'Barbell row', measure: 'weight_reps' },
  fly: { name: 'Cable fly', measure: 'weight_reps' },
  dip: { name: 'Dip', measure: 'bodyweight_reps' },
  plank: { name: 'Plank', measure: 'duration' },
  curl: { name: 'Curl', measure: 'weight_reps' },
};
const lookup = (id: string) => CATALOGUE[id];

const day: PlanDayExercise[] = [
  { id: 'p1', exerciseId: 'bench', restSeconds: 120, targets: [working(5, 80_000), working(5, 80_000)] },
  { id: 'p2', exerciseId: 'row', restSeconds: 90, targets: [working(8, 60_000)] },
  { id: 'p3', exerciseId: 'fly', note: 'Slow', targets: [working(12)] },
];

const set = (reps: number, weightGrams = 50_000, type = 'working') => ({ type, reps, weightGrams });

/** A workout row as the plan started it, done as planned. */
const asPlanned = (exercise: PlanDayExercise, extra: Partial<PlanUpdateSessionExercise> = {}): PlanUpdateSessionExercise => ({
  exerciseId: exercise.exerciseId,
  name: CATALOGUE[exercise.exerciseId].name,
  measure: CATALOGUE[exercise.exerciseId].measure,
  planExerciseId: exercise.id,
  sets: [set(5)],
  ...(exercise.superset ? { superset: exercise.superset } : {}),
  ...extra,
});

const adHoc = (exerciseId: string, sets: PlanUpdateSet[] = [set(10)], extra: Partial<PlanUpdateSessionExercise> = {}): PlanUpdateSessionExercise => ({
  exerciseId,
  name: CATALOGUE[exerciseId].name,
  measure: CATALOGUE[exerciseId].measure,
  sets,
  ...extra,
});

describe('targetsFromSets', () => {
  it('keeps type and reps, never the weight', () => {
    expect(targetsFromSets('weight_reps', [set(10, 40_000, 'warmup'), set(8, 60_000), set(6, 70_000, 'failure')])).toEqual([
      { type: 'warmup', reps: 10 },
      { type: 'working', reps: 8 },
      { type: 'working', reps: 6 },
    ]);
  });

  it('takes time for a timed exercise and caps at the plan limit', () => {
    const sets = Array.from({ length: 25 }, () => ({ type: 'working', durationSeconds: 45 }));
    const targets = targetsFromSets('duration', sets);
    expect(targets).toHaveLength(20);
    expect(targets[0]).toEqual({ type: 'working', durationSeconds: 45 });
  });
});

describe('planDayUpdate', () => {
  it('finds nothing when the workout followed the plan, even with more sets and other weights', () => {
    const diff = planDayUpdate({
      day,
      lookup,
      session: day.map((exercise) => asPlanned(exercise, { sets: [set(5, 100_000), set(5), set(3)] })),
      removed: [],
    });
    expect(diff.changes).toEqual([]);
    expect(diff.exercises).toEqual(day.map((exercise) => ({ ...exercise })));
  });

  it('keeps skipped and not-done exercises: only an explicit removal removes', () => {
    // p2 was skipped or never done, so finishing dropped its row; p3 was removed on purpose.
    const diff = planDayUpdate({ day, lookup, session: [asPlanned(day[0])], removed: ['p3'] });
    expect(diff.changes).toEqual([{ kind: 'removed', planExerciseId: 'p3', name: 'Cable fly' }]);
    expect(diff.exercises.map((exercise) => exercise.id)).toEqual(['p1', 'p2']);
  });

  it('adds an exercise done during the workout after the one before it, with targets from logged sets', () => {
    const diff = planDayUpdate({
      day,
      lookup,
      session: [asPlanned(day[0]), adHoc('dip', [set(12, 10_000), set(10, 10_000)], { restSeconds: 60 }), asPlanned(day[1]), asPlanned(day[2])],
      removed: [],
    });
    expect(diff.changes).toEqual([{ kind: 'added', exerciseId: 'dip', name: 'Dip', sets: 2 }]);
    expect(diff.exercises[1]).toEqual({
      exerciseId: 'dip',
      restSeconds: 60,
      targets: [
        { type: 'working', reps: 12 },
        { type: 'working', reps: 10 },
      ],
    });
    expect(diff.exercises).toHaveLength(4);
    expect(diff.after[1].change).toBe('added');
  });

  it('never adds an exercise with no logged set', () => {
    const diff = planDayUpdate({ day, lookup, session: [...day.map((e) => asPlanned(e)), adHoc('dip', [])], removed: [] });
    expect(diff.changes).toEqual([]);
  });

  it('adds before the first plan exercise when that is where it was done', () => {
    const diff = planDayUpdate({ day, lookup, session: [adHoc('plank', [{ type: 'warmup', durationSeconds: 60 }]), ...day.map((e) => asPlanned(e))], removed: [] });
    expect(diff.exercises[0]).toEqual({ exerciseId: 'plank', targets: [{ type: 'warmup', durationSeconds: 60 }] });
  });

  it('adds at the end when nothing from the plan was done', () => {
    const diff = planDayUpdate({ day, lookup, session: [adHoc('curl')], removed: [] });
    expect(diff.exercises.map((exercise) => exercise.exerciseId)).toEqual(['bench', 'row', 'fly', 'curl']);
  });

  it('reports the fewest moves for a reorder', () => {
    const diff = planDayUpdate({ day, lookup, session: [asPlanned(day[2]), asPlanned(day[0]), asPlanned(day[1])], removed: [] });
    expect(diff.changes).toEqual([{ kind: 'moved', planExerciseId: 'p3', name: 'Cable fly', from: 3, to: 1 }]);
    expect(diff.exercises.map((exercise) => exercise.id)).toEqual(['p3', 'p1', 'p2']);
  });

  it('keeps an untouched exercise in its place while the done ones are reordered around it', () => {
    // p2 not done; p3 done before p1.
    const diff = planDayUpdate({ day, lookup, session: [asPlanned(day[2]), asPlanned(day[0])], removed: [] });
    expect(diff.exercises.map((exercise) => exercise.id)).toEqual(['p3', 'p2', 'p1']);
  });

  it('keeps the plan targets on a same-measure swap', () => {
    const diff = planDayUpdate({
      day,
      lookup,
      session: [asPlanned(day[0], { exerciseId: 'curl', name: 'Curl', sets: [set(15, 10_000)] }), asPlanned(day[1]), asPlanned(day[2])],
      removed: [],
    });
    expect(diff.changes).toEqual([{ kind: 'replaced', planExerciseId: 'p1', fromName: 'Bench press', toName: 'Curl', targetsKept: true }]);
    expect(diff.exercises[0]).toEqual({ ...day[0], exerciseId: 'curl' });
  });

  it('derives targets from logged sets on a swap to another measure, without weights', () => {
    const diff = planDayUpdate({
      day,
      lookup,
      session: [asPlanned(day[0], { exerciseId: 'dip', name: 'Dip', measure: 'bodyweight_reps', sets: [set(9, 20_000)] }), asPlanned(day[1]), asPlanned(day[2])],
      removed: [],
    });
    expect(diff.exercises[0].targets).toEqual([{ type: 'working', reps: 9 }]);
    expect(diff.changes[0]).toMatchObject({ kind: 'replaced', targetsKept: false });
  });

  it('applies a changed rest and superset, and keeps the note', () => {
    const diff = planDayUpdate({
      day,
      lookup,
      session: [asPlanned(day[0], { restSeconds: 180 }), asPlanned(day[1], { superset: 'A' }), asPlanned(day[2], { superset: 'A' })],
      removed: [],
    });
    expect(diff.changes.map((change) => change.kind)).toEqual(['rest', 'superset', 'superset']);
    expect(diff.exercises[0].restSeconds).toBe(180);
    expect(diff.exercises[2]).toMatchObject({ note: 'Slow', superset: 'A' });
  });

  it('does not bring back a plan exercise deleted from the day since the workout started', () => {
    const edited = day.filter((exercise) => exercise.id !== 'p2');
    const diff = planDayUpdate({ day: edited, lookup, session: day.map((e) => asPlanned(e)), removed: [] });
    expect(diff.changes).toEqual([]);
    expect(diff.exercises.map((exercise) => exercise.id)).toEqual(['p1', 'p3']);
  });

  it('leaves edits made to the day since the workout started alone', () => {
    // The plan gained an exercise and new targets after the workout began; the workout touched neither.
    const edited: PlanDayExercise[] = [{ ...day[0], targets: [working(3, 90_000)] }, day[1], day[2], { id: 'p4', exerciseId: 'curl', targets: [working(12)] }];
    const diff = planDayUpdate({ day: edited, lookup, session: [asPlanned(day[0], { restSeconds: 150 }), asPlanned(day[1]), asPlanned(day[2])], removed: [] });
    expect(diff.changes.map((change) => change.kind)).toEqual(['rest']);
    expect(diff.exercises[0].targets).toEqual([working(3, 90_000)]);
    expect(diff.exercises.map((exercise) => exercise.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('is empty once applied: running it again on the updated day finds nothing', () => {
    // An added exercise is not part of this: the API records that the workout updated the plan.
    const session = [asPlanned(day[1]), asPlanned(day[0], { restSeconds: 60, exerciseId: 'curl', name: 'Curl' })];
    const first = planDayUpdate({ day, lookup, session, removed: ['p3'] });
    expect(first.changes.map((change) => change.kind)).toEqual(['replaced', 'removed', 'moved', 'rest']);
    const applied = first.exercises.map((exercise) => ({ ...exercise, id: exercise.id as string }));
    expect(planDayUpdate({ day: applied, lookup, session, removed: ['p3'] }).changes).toEqual([]);
  });

  it('describes the day before and after', () => {
    const diff = planDayUpdate({ day, lookup, session: [asPlanned(day[0])], removed: ['p2'] });
    expect(diff.before.map((line) => line.name)).toEqual(['Bench press', 'Barbell row', 'Cable fly']);
    expect(diff.after.map((line) => line.name)).toEqual(['Bench press', 'Cable fly']);
  });
});
