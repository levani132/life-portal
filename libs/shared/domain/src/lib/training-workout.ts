/**
 * Spec 025: what a workout in progress shows: supersets, which exercises are done, which one is
 * current, and how long to rest after a set. Pure and derived from what is logged; nothing here
 * is stored.
 */

const SUPERSET_KEY = /^[A-Za-z0-9_-]{1,40}$/;

/** A superset key: opaque, short, URL-safe. */
export function isSupersetKey(value: unknown): value is string {
  return typeof value === 'string' && SUPERSET_KEY.test(value);
}

export interface SupersetPlace {
  /** `A`, `B`, … in the order the supersets appear. */
  label: string;
  /** 1-based position within the superset. */
  position: number;
  size: number;
  /** The members, in order. */
  ids: string[];
}

/**
 * Exercises next to each other with the same key are a superset; one alone with a key is not.
 * Only neighbours count, so moving an exercise away takes it out without touching the others.
 */
export function supersetRuns(items: readonly { id: string; superset?: string }[]): Map<string, SupersetPlace> {
  const places = new Map<string, SupersetPlace>();
  let runs = 0;
  for (let start = 0; start < items.length; ) {
    const key = items[start].superset;
    let end = start + 1;
    while (key && end < items.length && items[end].superset === key) end++;
    if (end - start > 1) {
      const ids = items.slice(start, end).map((item) => item.id);
      const label = runLabel(runs++);
      ids.forEach((id, index) => places.set(id, { label, position: index + 1, size: ids.length, ids }));
    }
    start = end;
  }
  return places;
}

/** A, B, … Z, AA, AB, … */
function runLabel(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

type Keys = readonly (string | undefined)[];

/** The indexes of the run of equal, defined keys around `index` (just `index` when it has none). */
function runAround(keys: Keys, index: number): [number, number] {
  const key = keys[index];
  if (!key) return [index, index];
  let start = index;
  let end = index;
  while (start > 0 && keys[start - 1] === key) start--;
  while (end < keys.length - 1 && keys[end + 1] === key) end++;
  return [start, end];
}

/**
 * Joins the exercise at `index` with the next one into one superset, merging their supersets if
 * both are already in one. Returns every key, so the caller can save the ones that changed.
 */
export function linkWithNext(keys: Keys, index: number, makeKey: () => string): (string | undefined)[] {
  const out = [...keys];
  if (index < 0 || index >= keys.length - 1) return out;
  const key = keys[index] ?? keys[index + 1] ?? makeKey();
  const [start] = runAround(keys, index);
  const [, end] = runAround(keys, index + 1);
  for (let i = start; i <= end; i++) out[i] = key;
  return out;
}

/**
 * Splits a superset between `index` and the next exercise. A side left with one exercise loses
 * its key; a side of two or more stays a superset (the second half under a new key).
 */
export function unlinkFromNext(keys: Keys, index: number, makeKey: () => string): (string | undefined)[] {
  const out = [...keys];
  if (index < 0 || index >= keys.length - 1 || !keys[index] || keys[index] !== keys[index + 1]) return out;
  const [start, end] = runAround(keys, index);
  if (index === start) out[index] = undefined;
  if (index + 1 === end) out[index + 1] = undefined;
  else {
    const key = makeKey();
    for (let i = index + 1; i <= end; i++) out[i] = key;
  }
  return out;
}

export interface FocusExercise {
  id: string;
  superset?: string;
  skipped: boolean;
  /** Planned sets; 0 for an exercise added during the workout. */
  targetCount: number;
  /** Sets logged, including ones still being sent. */
  logged: number;
  /** The rest after a set, chosen in this workout or from the plan; absent for the default. */
  restSeconds?: number;
}

export interface WorkoutFocus {
  /** Done: every planned set logged, or, with no plan, logged and moved on from. */
  doneIds: Set<string>;
  /** The exercise to do next; absent when everything is done or skipped. */
  currentId?: string;
}

/**
 * Which exercises are done and which one is current, from what is logged and which exercise the
 * last set was in (`lastId`).
 *
 * - A planned exercise is done once its planned sets are all logged; extra sets keep it done.
 * - One added during the workout has no target, so it is done once it has a set and the last set
 *   was in another exercise (outside its superset): the person moved on.
 * - The current exercise follows the last set: in a superset, the next member that is not done,
 *   round and round; otherwise the last set's exercise while it is not done. Failing that, the
 *   first exercise that is neither done nor skipped.
 */
export function workoutFocus(exercises: readonly FocusExercise[], lastId?: string): WorkoutFocus {
  const runs = supersetRuns(exercises);
  const lastRun = lastId ? (runs.get(lastId)?.ids ?? [lastId]) : [];
  const done = (exercise: FocusExercise) => {
    if (exercise.skipped) return false;
    if (exercise.targetCount > 0) return exercise.logged >= exercise.targetCount;
    return exercise.logged > 0 && lastId !== undefined && !lastRun.includes(exercise.id);
  };
  const doneIds = new Set(exercises.filter(done).map((exercise) => exercise.id));
  const open = (id: string) => {
    const exercise = exercises.find((item) => item.id === id);
    return exercise !== undefined && !exercise.skipped && !doneIds.has(id);
  };
  if (lastId && exercises.some((exercise) => exercise.id === lastId)) {
    const at = lastRun.indexOf(lastId);
    for (let k = 1; k <= lastRun.length; k++) {
      const id = lastRun[(at + k) % lastRun.length];
      if (open(id)) return { doneIds, currentId: id };
    }
  }
  const first = exercises.find((exercise) => open(exercise.id));
  return { doneIds, ...(first ? { currentId: first.id } : {}) };
}

/**
 * How long to rest after the last set. Mid-way through a superset round (the current exercise is
 * a later member of the same superset) there is no rest: 0. After a round, the rest is the last
 * member's. Otherwise the exercise's own rest, else `defaultSeconds`.
 */
export function restAfter(
  exercises: readonly FocusExercise[],
  lastId: string | undefined,
  currentId: string | undefined,
  defaultSeconds: number,
): number {
  if (!lastId) return 0;
  const run = supersetRuns(exercises).get(lastId);
  if (run && currentId && run.ids.indexOf(currentId) > run.ids.indexOf(lastId)) return 0;
  const restOf = run ? run.ids[run.ids.length - 1] : lastId;
  return exercises.find((exercise) => exercise.id === restOf)?.restSeconds ?? defaultSeconds;
}
