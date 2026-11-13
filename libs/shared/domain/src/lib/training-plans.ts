import {
  PLAN_LIMITS,
  PLAN_TARGET_TYPES,
  SET_VALUE_FIELDS,
  type Measure,
  type PlanInput,
  type PlanTarget,
  type PlannedExercise,
  type SetType,
  type SetValues,
  type WeightUnit,
} from '@life-portal/shared-types';
import { addDays } from './dates';
import { SET_LIMITS, setFieldsFor } from './training';
import { formatDistance, formatDuration, formatWeight } from './training-format';
import { isSupersetKey } from './training-workout';

/**
 * Workout plans (spec 023): checking a plan, describing a target, and what a started plan
 * workout suggests. Pure: no clock, no Mongo. See `docs/modules/training.md`.
 */

// ------------------------------------------------------------------ validation

const FIELD_LABELS: Record<(typeof SET_VALUE_FIELDS)[number], string> = {
  reps: 'Reps',
  weightGrams: 'Weight',
  assistGrams: 'Assistance',
  durationSeconds: 'Time',
  distanceMeters: 'Distance',
};

const REP_MEASURES: readonly Measure[] = ['weight_reps', 'bodyweight_reps', 'assisted_reps'];

const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);

/**
 * One target set against its exercise's measure. A target carries the same fields as a set
 * (`setFieldsFor`), but less is required: a plan may leave the weight to the person. Reps are
 * required for rep measures, time for timed ones, and distance or time for distance ones.
 * Returns a message for the person, or `null` when valid.
 */
export function validatePlanTarget(measure: Measure, target: PlanTarget): string | null {
  if (!(PLAN_TARGET_TYPES as readonly string[]).includes(target.type)) {
    return 'A planned set is a warm-up or a working set.';
  }
  const rule = setFieldsFor(measure);
  for (const field of SET_VALUE_FIELDS) {
    const value = target[field];
    if (value === undefined || value === null) continue;
    if (!rule.allowed.includes(field)) return `${FIELD_LABELS[field]} does not apply to this exercise.`;
    if (!isWhole(value)) return `${FIELD_LABELS[field]} must be a whole number.`;
    const { min, max } = SET_LIMITS[field];
    if (value < min || value > max) return `${FIELD_LABELS[field]} must be between ${min} and ${max}.`;
  }
  if (measure === 'bodyweight_reps' && target.weightGrams && target.assistGrams) {
    return 'Use added weight or assistance, not both.';
  }
  if (REP_MEASURES.includes(measure) && target.reps == null) return 'Reps are required.';
  if (measure === 'duration' && target.durationSeconds == null) return 'Time is required.';
  if (measure === 'distance_duration' && target.distanceMeters == null && target.durationSeconds == null) {
    return 'A distance or a time is required.';
  }
  if (target.repsMax != null) {
    if (target.reps == null) return 'A rep range needs its lower end.';
    if (!isWhole(target.repsMax) || target.repsMax > SET_LIMITS.reps.max) {
      return `The top of the rep range must be a whole number up to ${SET_LIMITS.reps.max}.`;
    }
    if (target.repsMax <= target.reps) return 'The top of the rep range must be above its lower end.';
  }
  return null;
}

export interface PlanProblem {
  /** Where, e.g. `workouts.1.exercises.0.targets.2`. */
  path: string;
  message: string;
}

/**
 * A whole plan against `PLAN_LIMITS` and each target against its exercise's measure.
 * `measureOf` answers `undefined` for an exercise the caller may not use. An empty list is valid.
 */
export function validatePlan(
  plan: PlanInput,
  measureOf: (exerciseId: string) => Measure | undefined,
): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const push = (path: string, message: string) => problems.push({ path, message });
  const name = plan.name?.trim() ?? '';
  if (!name) push('name', 'The plan needs a name.');
  else if (name.length > PLAN_LIMITS.name) push('name', `A plan name is at most ${PLAN_LIMITS.name} characters.`);
  if ((plan.description?.length ?? 0) > PLAN_LIMITS.description) {
    push('description', `A description is at most ${PLAN_LIMITS.description} characters.`);
  }
  if (plan.workouts.length > PLAN_LIMITS.workouts) {
    push('workouts', `A plan has at most ${PLAN_LIMITS.workouts} workouts.`);
  }
  plan.workouts.forEach((workout, w) => {
    const at = `workouts.${w}`;
    const workoutName = workout.name?.trim() ?? '';
    if (!workoutName) push(`${at}.name`, 'Each workout needs a name.');
    else if (workoutName.length > PLAN_LIMITS.name) {
      push(`${at}.name`, `A workout name is at most ${PLAN_LIMITS.name} characters.`);
    }
    if (workout.exercises.length > PLAN_LIMITS.exercises) {
      push(`${at}.exercises`, `A workout has at most ${PLAN_LIMITS.exercises} exercises.`);
    }
    workout.exercises.forEach((exercise, e) => {
      const ex = `${at}.exercises.${e}`;
      const measure = measureOf(exercise.exerciseId);
      if (!measure) {
        push(`${ex}.exerciseId`, 'That exercise is not available.');
        return;
      }
      if (exercise.restSeconds != null && (!isWhole(exercise.restSeconds) || exercise.restSeconds < 0 || exercise.restSeconds > PLAN_LIMITS.restMax)) {
        push(`${ex}.restSeconds`, `Rest is between 0 and ${PLAN_LIMITS.restMax} seconds.`);
      }
      if (exercise.superset != null && !isSupersetKey(exercise.superset)) {
        push(`${ex}.superset`, 'A superset key is letters, digits, - and _.');
      }
      if ((exercise.note?.length ?? 0) > PLAN_LIMITS.note) {
        push(`${ex}.note`, `A note is at most ${PLAN_LIMITS.note} characters.`);
      }
      if (exercise.targets.length < PLAN_LIMITS.targetsMin || exercise.targets.length > PLAN_LIMITS.targetsMax) {
        push(`${ex}.targets`, `An exercise has ${PLAN_LIMITS.targetsMin} to ${PLAN_LIMITS.targetsMax} planned sets.`);
      }
      exercise.targets.forEach((target, t) => {
        const problem = validatePlanTarget(measure, target);
        if (problem) push(`${ex}.targets.${t}`, problem);
      });
    });
  });
  return problems;
}

// ------------------------------------------------------------------ display

/**
 * A target in a few characters: `8–12 reps`, `60 kg × 5`, `+10 kg × 8`, `−20 kg × 6–8`, `0:45`,
 * `1 km in 5:00`; warm-ups are prefixed `Warm-up`. Display only.
 */
export function describeTarget(measure: Measure, target: PlanTarget, unit: WeightUnit = 'kg'): string {
  const reps = target.reps == null ? '' : target.repsMax ? `${target.reps}–${target.repsMax}` : `${target.reps}`;
  const w = (grams: number) => formatWeight(grams, unit);
  let text: string;
  switch (measure) {
    case 'weight_reps':
      text = target.weightGrams != null ? `${w(target.weightGrams)} × ${reps}` : `${reps} reps`;
      break;
    case 'bodyweight_reps':
      text = target.weightGrams
        ? `+${w(target.weightGrams)} × ${reps}`
        : target.assistGrams
          ? `−${w(target.assistGrams)} × ${reps}`
          : `${reps} reps`;
      break;
    case 'assisted_reps':
      text = target.assistGrams ? `−${w(target.assistGrams)} × ${reps}` : `${reps} reps`;
      break;
    case 'duration': {
      const time = formatDuration(target.durationSeconds ?? 0);
      text = target.weightGrams ? `${time} with ${w(target.weightGrams)}` : time;
      break;
    }
    case 'distance_duration':
      text =
        target.distanceMeters != null && target.durationSeconds != null
          ? `${formatDistance(target.distanceMeters)} in ${formatDuration(target.durationSeconds)}`
          : target.distanceMeters != null
            ? formatDistance(target.distanceMeters)
            : formatDuration(target.durationSeconds ?? 0);
      break;
  }
  return target.type === 'warmup' ? `Warm-up ${text}` : text;
}

// ------------------------------------------------------------------ a started plan workout

/**
 * The planned sets still to do (research R5): logged sets use up targets in order, whatever was
 * logged. Nothing links a set to a target, so deleting a set brings its target back.
 */
export function openTargets(
  planned: Pick<PlannedExercise, 'targets'> | undefined,
  loggedSetCount: number,
  skipped = false,
): PlanTarget[] {
  if (!planned || skipped) return [];
  return planned.targets.slice(Math.max(loggedSetCount, 0));
}

export interface Prefill {
  type: SetType;
  values: SetValues;
  /** Where the values came from, shown beside the suggestion (principle 6). */
  source: 'last_time' | 'plan';
}

/**
 * What a suggestion's fields start with (research R6, FR-012). From last time when the person
 * did this exercise before: the set at the same position, else that session's last set. Otherwise
 * from the target: the low end of a rep range and any planned weight, assistance, time or
 * distance. Only fields the measure allows are returned. The set type always follows the target.
 */
export function prefillFor(
  measure: Measure,
  target: PlanTarget,
  previousSets: readonly SetValues[] | undefined,
  position: number,
): Prefill {
  const allowed = setFieldsFor(measure).allowed;
  const pick = (source: SetValues): SetValues => {
    const values: SetValues = {};
    for (const field of allowed) {
      const value = source[field];
      if (value !== undefined && value !== null) values[field] = value;
    }
    return values;
  };
  const before = previousSets?.length ? (previousSets[position] ?? previousSets[previousSets.length - 1]) : undefined;
  if (before) return { type: target.type, values: pick(before), source: 'last_time' };
  return { type: target.type, values: pick(target), source: 'plan' };
}

// ------------------------------------------------------------------ progress (research R8)

/** The part of a session that progress reads. Open sessions count: you are doing it now. */
export interface PlanSessionRef {
  planId: string;
  planWorkoutId: string;
  day: string;
  /** Orders two sessions on one day. */
  startedAt: number;
}

export interface PlanProgress {
  /** The latest day each workout was done, by workout id. Workouts never done are absent. */
  lastDoneDay: Record<string, string>;
  /** The workout after the most recently done one, wrapping; the first when none was done. */
  nextWorkoutId?: string;
}

const newestFirst = (a: PlanSessionRef, b: PlanSessionRef) =>
  a.day === b.day ? b.startedAt - a.startedAt : a.day < b.day ? 1 : -1;

/**
 * Derived on every read from the plan's sessions, never stored (principle III), so a deleted
 * session simply stops counting. A session for a workout no longer in the plan sets no last-done
 * day and is passed over when choosing the next workout.
 */
export function planProgress(workoutIds: readonly string[], sessions: readonly PlanSessionRef[]): PlanProgress {
  const lastDoneDay: Record<string, string> = {};
  const known = new Set(workoutIds);
  const ordered = [...sessions].filter((session) => known.has(session.planWorkoutId)).sort(newestFirst);
  for (const session of ordered) lastDoneDay[session.planWorkoutId] ??= session.day;
  if (!workoutIds.length) return { lastDoneDay };
  const latest = ordered[0];
  const nextWorkoutId = latest
    ? workoutIds[(workoutIds.indexOf(latest.planWorkoutId) + 1) % workoutIds.length]
    : workoutIds[0];
  return { lastDoneDay, nextWorkoutId };
}

/**
 * Plans with a session in the `days` up to and including `today`, newest first, one entry per
 * plan, at most `max`. Sessions after `today` (another time zone's tomorrow) still count.
 */
export function recentPlanIds(
  sessions: readonly PlanSessionRef[],
  today: string,
  days = 28,
  max = 3,
): string[] {
  const from = addDays(today, -(days - 1));
  const ids: string[] = [];
  for (const session of [...sessions].sort(newestFirst)) {
    if (session.day < from) break;
    if (!ids.includes(session.planId)) ids.push(session.planId);
    if (ids.length === max) break;
  }
  return ids;
}
