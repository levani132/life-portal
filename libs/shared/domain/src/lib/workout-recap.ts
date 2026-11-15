import type {
  ExerciseRankView,
  RecapLevel,
  RecapRankUp,
  RecapRecord,
  SessionDetail,
  SessionExercise,
  TrainingLevel,
  WorkoutRecap,
  WorkoutSet,
  WorkoutTotals,
} from '@life-portal/shared-types';
import { recordEntryFor, type BodyWeight } from './training';

/**
 * Finishing a workout (issue #25). Everything here is derived from the workout and from the
 * server's own rank and level engines; nothing is stored, and nothing is invented. Pure: the
 * caller passes the ranks and levels it worked out before and after the workout.
 */

type TotalsInput = Pick<SessionDetail, 'durationSeconds'> & {
  exercises: readonly Pick<SessionExercise, 'snapshot' | 'sets'>[];
};

/** The load a set moved: its effective load (body weight known), else the weight on the bar. */
function loadOf(exercise: Pick<SessionExercise, 'snapshot'>, set: WorkoutSet): number | undefined {
  if (set.effectiveLoad) return set.effectiveLoad.grams;
  return exercise.snapshot.measure === 'weight_reps' ? set.weightGrams : undefined;
}

/** The workout's numbers: duration, sets, reps, volume and sets per muscle. Warm-ups are left out of all but `sets`. */
export function workoutTotals(session: TotalsInput): WorkoutTotals {
  let sets = 0;
  let workingSets = 0;
  let reps = 0;
  let volumeGrams = 0;
  const muscles = new Map<string, number>();
  for (const exercise of session.exercises) {
    for (const set of exercise.sets) {
      sets += 1;
      if (set.type === 'warmup') continue;
      workingSets += 1;
      reps += set.reps ?? 0;
      const load = loadOf(exercise, set);
      if (load !== undefined && set.reps) volumeGrams += load * set.reps;
      for (const muscle of exercise.snapshot.primaryMuscles) muscles.set(muscle, (muscles.get(muscle) ?? 0) + 1);
    }
  }
  return {
    durationSeconds: session.durationSeconds,
    exercises: session.exercises.filter((exercise) => exercise.sets.length > 0).length,
    sets,
    workingSets,
    reps,
    volumeGrams,
    setsByMuscle: [...muscles]
      .map(([muscle, count]) => ({ muscle: muscle as WorkoutTotals['setsByMuscle'][number]['muscle'], sets: count }))
      .sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle)),
  };
}

/** The body weight behind a set's effective load, recovered from the load and the set's own values. */
function bodyOf(exercise: Pick<SessionExercise, 'snapshot'>, set: WorkoutSet): BodyWeight | undefined {
  const load = set.effectiveLoad;
  if (!load) return undefined;
  const weightGrams =
    exercise.snapshot.measure === 'assisted_reps'
      ? load.grams + (set.assistGrams ?? 0)
      : load.grams - (set.weightGrams ?? 0) + (set.assistGrams ?? 0);
  return { day: load.bodyWeightDay, weightGrams };
}

/**
 * The records this workout's sets set, from the marks the server put on them when they were
 * done. A first workout has none: there was nothing earlier to beat.
 */
export function recapRecords(session: Pick<SessionDetail, 'id' | 'day'> & { exercises: readonly SessionExercise[] }): RecapRecord[] {
  return session.exercises.flatMap((exercise) =>
    exercise.sets.flatMap((set) =>
      (set.records ?? []).map((kind) => {
        const entry = recordEntryFor(kind, exercise.snapshot.measure, {
          ...set,
          sessionId: session.id,
          day: session.day,
          body: bodyOf(exercise, set),
        });
        return {
          exerciseId: exercise.exerciseId,
          name: exercise.snapshot.name,
          measure: exercise.snapshot.measure,
          kind,
          setId: set.id,
          ...(entry ? { entry } : {}),
        };
      }),
    ),
  );
}

export interface RankBeforeAfter {
  exerciseId: string;
  name: string;
  /** The rank without this workout's sets. */
  before: ExerciseRankView;
  /** The rank with them. */
  after: ExerciseRankView;
}

/**
 * Strength ranks this workout raised: the best ever (`highest`) after it is a higher milestone
 * than before it, or the exercise had no rank before. A rank it only kept, or a recent rank
 * (`current`) that came back, is not a rank-up.
 */
export function rankUps(ranks: readonly RankBeforeAfter[]): RecapRankUp[] {
  return ranks.flatMap(({ exerciseId, name, before, after }) => {
    const to = after.highest;
    if (!to) return [];
    const from = before.highest;
    if (from && to.milestone <= from.milestone) return [];
    const { version, ...position } = to;
    const fromPosition = from ? (({ version: _v, ...rest }) => rest)(from) : undefined;
    return [{ exerciseId, name, ...(fromPosition ? { from: fromPosition } : {}), to: position, version }];
  });
}

/** The overall training level before and after the workout, and the XP it earned. */
export function levelChange(before: TrainingLevel, after: TrainingLevel): RecapLevel {
  return { from: before.level, to: after.level, xpGained: Math.max(0, after.xp - before.xp), after };
}

/** The whole recap. `ranks` and `levels` are left out when those features are off. */
export function workoutRecap(input: {
  session: Pick<SessionDetail, 'id' | 'day' | 'status' | 'durationSeconds'> & { exercises: readonly SessionExercise[] };
  ranks?: readonly RankBeforeAfter[];
  levels?: { before: TrainingLevel; after: TrainingLevel };
}): WorkoutRecap {
  const records = recapRecords(input.session);
  const ups = input.ranks ? rankUps(input.ranks) : undefined;
  const level = input.levels ? levelChange(input.levels.before, input.levels.after) : undefined;
  return {
    sessionId: input.session.id,
    day: input.session.day,
    status: input.session.status,
    totals: workoutTotals(input.session),
    records,
    ...(ups ? { rankUps: ups } : {}),
    ...(level ? { level } : {}),
    achievements: records.length > 0 || (ups?.length ?? 0) > 0 || (level ? level.to > level.from : false),
  };
}
