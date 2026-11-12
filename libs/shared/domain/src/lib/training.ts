import {
  EQUIPMENT_TYPES,
  MUSCLES,
  SET_VALUE_FIELDS,
  type EquipmentType,
  type Measure,
  type Muscle,
  type OneRepMaxEstimate,
  type RecordEntry,
  type RecordKind,
  type SetType,
  type SetValueField,
  type SetValues,
} from '@life-portal/shared-types';

/**
 * Training (spec 020): pure rules shared by the API, the web form and the tests.
 * No clock, no Mongo: "now" is always an argument.
 */

// ------------------------------------------------------------------ set fields per measure

export interface SetFieldRule {
  /** Fields a set of this measure may carry. Anything else is rejected, not ignored. */
  allowed: readonly SetValueField[];
  /** Fields it must carry. */
  required: readonly SetValueField[];
}

const SET_FIELD_RULES: Record<Measure, SetFieldRule> = {
  weight_reps: { allowed: ['reps', 'weightGrams'], required: ['reps', 'weightGrams'] },
  // The weight is optional added load (a belt, a vest).
  bodyweight_reps: { allowed: ['reps', 'weightGrams'], required: ['reps'] },
  assisted_reps: { allowed: ['reps', 'assistGrams'], required: ['reps', 'assistGrams'] },
  // The weight is optional (a loaded carry for time).
  duration: { allowed: ['durationSeconds', 'weightGrams'], required: ['durationSeconds'] },
  distance_duration: {
    allowed: ['distanceMeters', 'durationSeconds'],
    required: ['distanceMeters', 'durationSeconds'],
  },
};

export function setFieldsFor(measure: Measure): SetFieldRule {
  return SET_FIELD_RULES[measure];
}

/** Inclusive bounds for each value. Anything outside is implausible input (spec edge cases). */
export const SET_LIMITS: Record<SetValueField, { min: number; max: number }> = {
  reps: { min: 1, max: 1000 },
  weightGrams: { min: 0, max: 1_000_000 },
  assistGrams: { min: 1, max: 500_000 },
  durationSeconds: { min: 1, max: 86_400 },
  distanceMeters: { min: 1, max: 1_000_000 },
};

const FIELD_LABELS: Record<SetValueField, string> = {
  reps: 'Reps',
  weightGrams: 'Weight',
  assistGrams: 'Assistance',
  durationSeconds: 'Time',
  distanceMeters: 'Distance',
};

/**
 * Checks a complete set's values against its measure. Returns a message for the person, or
 * `null` when valid. `undefined` and `null` both mean "not given".
 */
export function validateSetValues(
  measure: Measure,
  values: SetValues,
): string | null {
  const rule = setFieldsFor(measure);
  for (const field of SET_VALUE_FIELDS) {
    const value = values[field];
    const given = value !== undefined && value !== null;
    if (given && !rule.allowed.includes(field)) {
      return `${FIELD_LABELS[field]} does not apply to this exercise.`;
    }
    if (!given) {
      if (rule.required.includes(field)) return `${FIELD_LABELS[field]} is required.`;
      continue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return `${FIELD_LABELS[field]} must be a whole number.`;
    }
    const { min, max } = SET_LIMITS[field];
    if (value < min || value > max) {
      return `${FIELD_LABELS[field]} must be between ${min} and ${max}.`;
    }
  }
  return null;
}

/** RPE is a 1–10 scale in half steps. */
export function isValidRpe(rpe: number): boolean {
  return rpe >= 1 && rpe <= 10 && Number.isInteger(rpe * 2);
}

// ------------------------------------------------------------------ sessions

/** An open session with no activity for this long is offered to be finished or discarded. */
export const STALE_SESSION_MS = 12 * 60 * 60 * 1000;

/**
 * A session's duration in whole seconds: to `endedAt` when finished, else to its last
 * activity (the last set, or the start). Never to "now": an open session that was abandoned
 * must not keep growing.
 */
export function sessionDurationSeconds(input: {
  startedAt: string;
  endedAt?: string;
  lastSetAt?: string;
}): number {
  const start = Date.parse(input.startedAt);
  const end = Date.parse(input.endedAt ?? input.lastSetAt ?? input.startedAt);
  return Math.max(0, Math.round((end - start) / 1000));
}

export function isStaleSession(
  input: { status: 'open' | 'finished'; startedAt: string; lastSetAt?: string },
  nowMs: number,
): boolean {
  if (input.status !== 'open') return false;
  const last = Date.parse(input.lastSetAt ?? input.startedAt);
  return nowMs - last > STALE_SESSION_MS;
}

// ------------------------------------------------------------------ catalogue

/** Lower-case, accents folded, punctuation dropped, spaces collapsed. Used for search. */
export function normaliseSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A free-exercise-db entry, as vendored (facts only). */
export interface CatalogueEntry {
  id: string;
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  category: string;
}

const EQUIPMENT_MAP: Record<string, EquipmentType> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  'body only': 'bodyweight',
  cable: 'cable',
  machine: 'machine',
  kettlebells: 'kettlebell',
  bands: 'band',
  'medicine ball': 'medicine_ball',
  'exercise ball': 'exercise_ball',
  'foam roll': 'foam_roll',
  'e-z curl bar': 'ez_bar',
  other: 'other',
};

export function catalogueEquipment(entry: Pick<CatalogueEntry, 'equipment'>): EquipmentType {
  return (entry.equipment && EQUIPMENT_MAP[entry.equipment]) || 'other';
}

/** `middle back` → `middle_back`; unknown names are dropped. */
export function catalogueMuscles(names: string[]): Muscle[] {
  const known = new Set<string>(MUSCLES);
  return [
    ...new Set(
      names.map((name) => name.replace(/ /g, '_')).filter((name) => known.has(name)),
    ),
  ] as Muscle[];
}

/**
 * How a dataset exercise is measured (research R2): cardio is distance and time, stretches and
 * static holds are time, movements without equipment are bodyweight reps, the rest weight × reps.
 */
export function catalogueMeasure(
  entry: Pick<CatalogueEntry, 'category' | 'equipment' | 'force'>,
): Measure {
  if (entry.category === 'cardio') return 'distance_duration';
  if (entry.category === 'stretching' || entry.force === 'static') return 'duration';
  if (entry.equipment === 'body only' || entry.equipment === null) return 'bodyweight_reps';
  return 'weight_reps';
}

export function isEquipmentType(value: string): value is EquipmentType {
  return (EQUIPMENT_TYPES as readonly string[]).includes(value);
}

// ------------------------------------------------------------------ progress (spec 020 US3)

/** A weigh-in as Training reads it from Nutrition: whole grams on a calendar day. */
export interface BodyWeight {
  day: string;
  weightGrams: number;
}

/** The latest weigh-in on or before `day`, from weigh-ins in ascending day order. */
export function bodyWeightOn(weighIns: readonly BodyWeight[], day: string): BodyWeight | undefined {
  let found: BodyWeight | undefined;
  for (const weighIn of weighIns) {
    if (weighIn.day > day) break;
    found = weighIn;
  }
  return found;
}

/** The weight a set moved, and where it came from. */
export interface EffectiveLoad {
  grams: number;
  /** Set when the load includes body weight: the day of the weigh-in used. */
  bodyWeightDay?: string;
}

/**
 * The load a set moved, in whole grams. Weight × reps: the weight. Bodyweight reps: body weight
 * plus any added load. Assisted reps: body weight minus the assistance, never below zero.
 * `undefined` when body weight is needed and unknown (no figure rather than a wrong one, FR-020),
 * and for timed and distance work, where load is not what is measured.
 */
export function effectiveLoadGrams(
  measure: Measure,
  set: SetValues,
  body?: BodyWeight,
): EffectiveLoad | undefined {
  switch (measure) {
    case 'weight_reps':
      return set.weightGrams === undefined ? undefined : { grams: set.weightGrams };
    case 'bodyweight_reps':
      return body ? { grams: body.weightGrams + (set.weightGrams ?? 0), bodyWeightDay: body.day } : undefined;
    case 'assisted_reps':
      return body
        ? { grams: Math.max(0, body.weightGrams - (set.assistGrams ?? 0)), bodyWeightDay: body.day }
        : undefined;
    default:
      return undefined;
  }
}

/** Estimates come only from sets of 1–12 reps (research R3). */
export const ONE_REP_MAX_MAX_REPS = 12;

/**
 * Epley: `load × (1 + reps / 30)`, and a single rep is the load itself. Whole grams, rounded once.
 * `undefined` outside 1–12 reps or without a positive load.
 */
export function estimateOneRepMax(loadGrams: number, reps: number): number | undefined {
  if (!(loadGrams > 0) || !Number.isInteger(reps) || reps < 1 || reps > ONE_REP_MAX_MAX_REPS) return undefined;
  return reps === 1 ? loadGrams : Math.round(loadGrams * (1 + reps / 30));
}

/** Load × reps, or `undefined` without a load or reps. */
export function setVolumeGrams(load: EffectiveLoad | undefined, reps: number | undefined): number | undefined {
  return load && reps ? load.grams * reps : undefined;
}

/** Seconds per kilometre, for "fastest pace". `undefined` without both a distance and a time. */
export function paceSecondsPerKm(set: SetValues): number | undefined {
  if (!set.distanceMeters || !set.durationSeconds) return undefined;
  return Math.round((set.durationSeconds * 1000) / set.distanceMeters);
}

/** One logged set as progress sees it: in time order, with its session's day and body weight. */
export interface ProgressSet extends SetValues {
  id: string;
  sessionId: string;
  day: string;
  type: SetType;
  /** The weigh-in on or before `day`, if any (bodyweight and assisted loads need it). */
  body?: BodyWeight;
}

/** The labelled estimate for one set, or `undefined` when none can be made. */
export function oneRepMaxFor(measure: Measure, set: ProgressSet): OneRepMaxEstimate | undefined {
  if (set.type === 'warmup' || set.reps === undefined) return undefined;
  const load = effectiveLoadGrams(measure, set, set.body);
  const value = load && estimateOneRepMax(load.grams, set.reps);
  if (!load || !value) return undefined;
  return {
    valueGrams: value,
    basis: {
      formula: 'epley',
      fromSetId: set.id,
      weightGrams: load.grams,
      reps: set.reps,
      ...(load.bodyWeightDay ? { bodyWeightDay: load.bodyWeightDay } : {}),
    },
  };
}

/** The best estimate among some sets (the highest value; the earliest set on a tie). */
export function bestOneRepMax(measure: Measure, sets: readonly ProgressSet[]): OneRepMaxEstimate | undefined {
  let best: OneRepMaxEstimate | undefined;
  for (const set of sets) {
    const estimate = oneRepMaxFor(measure, set);
    if (estimate && (!best || estimate.valueGrams > best.valueGrams)) best = estimate;
  }
  return best;
}

/** Which record kinds apply to a measure (FR-019). */
export function recordKindsFor(measure: Measure): RecordKind[] {
  switch (measure) {
    case 'weight_reps':
      return ['heaviest', 'best_1rm', 'most_reps'];
    case 'bodyweight_reps':
    case 'assisted_reps':
      return ['most_reps', 'heaviest', 'best_1rm'];
    case 'duration':
      return ['longest_duration'];
    case 'distance_duration':
      return ['longest_distance', 'longest_duration', 'fastest_pace'];
  }
}

interface Candidate {
  value: number;
  /** Lower is better (pace). */
  lowerIsBetter?: boolean;
  bodyWeightDay?: string;
  loadGrams?: number;
}

function candidate(kind: RecordKind, measure: Measure, set: ProgressSet): Candidate | undefined {
  const load = effectiveLoadGrams(measure, set, set.body);
  switch (kind) {
    case 'heaviest':
      return load && load.grams > 0 ? { value: load.grams, bodyWeightDay: load.bodyWeightDay } : undefined;
    case 'best_1rm': {
      const estimate = oneRepMaxFor(measure, set);
      return estimate ? { value: estimate.valueGrams, bodyWeightDay: estimate.basis.bodyWeightDay } : undefined;
    }
    case 'most_reps':
      return set.reps ? { value: set.reps, loadGrams: measure === 'weight_reps' ? set.weightGrams : undefined } : undefined;
    case 'longest_duration':
      return set.durationSeconds ? { value: set.durationSeconds } : undefined;
    case 'longest_distance':
      return set.distanceMeters ? { value: set.distanceMeters } : undefined;
    case 'fastest_pace': {
      const pace = paceSecondsPerKm(set);
      return pace ? { value: pace, lowerIsBetter: true } : undefined;
    }
  }
}

const beats = (a: Candidate, b: Candidate) => (a.lowerIsBetter ? a.value < b.value : a.value > b.value);

/**
 * Personal records over one exercise's sets, given **in the order they were done** (session day,
 * then session start, then set order). Warm-ups never count.
 *
 * - `marks`: for each set, the kinds it was a record for **when it was done**: it beat every
 *   earlier working set. A set is only marked once there is an earlier session to beat, so a
 *   first workout is not a page of "records". Later sets never change an earlier set's marks,
 *   so deleting or lowering a set simply moves the records to the true best remaining one.
 * - `best`: the current best of each kind and the set that holds it (the earliest on a tie).
 *
 * `most_reps` on a loaded exercise is "more reps than any earlier set at this load or heavier",
 * so 10 reps at 80 kg after 8 at 80 kg is a record even though 12 at 60 kg came before.
 */
export function personalRecords(
  measure: Measure,
  sets: readonly ProgressSet[],
): { marks: Map<string, RecordKind[]>; best: RecordEntry[] } {
  const kinds = recordKindsFor(measure);
  const marks = new Map<string, RecordKind[]>();
  const best = new Map<RecordKind, { set: ProgressSet; candidate: Candidate }>();
  const earlier: { set: ProgressSet; load?: number }[] = [];
  const sessionsSeen = new Set<string>();
  for (const set of sets) {
    if (set.type === 'warmup') continue;
    const hasEarlierSession = [...sessionsSeen].some((id) => id !== set.sessionId);
    const won: RecordKind[] = [];
    const load = effectiveLoadGrams(measure, set, set.body)?.grams;
    for (const kind of kinds) {
      const mine = candidate(kind, measure, set);
      if (!mine) continue;
      if (kind === 'most_reps' && measure === 'weight_reps') {
        // Reps at this load or heavier. Without a load, no reps record.
        if (load === undefined) continue;
        const rivals = earlier.filter((item) => item.load !== undefined && item.load >= load);
        const top = Math.max(0, ...rivals.map((item) => item.set.reps ?? 0));
        if (hasEarlierSession && rivals.length > 0 && (set.reps ?? 0) > top) won.push(kind);
      } else {
        const current = best.get(kind);
        if (hasEarlierSession && current && beats(mine, current.candidate)) won.push(kind);
      }
      const current = best.get(kind);
      if (!current || beats(mine, current.candidate)) best.set(kind, { set, candidate: mine });
    }
    if (won.length) marks.set(set.id, won);
    earlier.push({ set, load });
    sessionsSeen.add(set.sessionId);
  }
  return {
    marks,
    best: kinds.flatMap((kind) => {
      const entry = best.get(kind);
      if (!entry) return [];
      return [
        {
          kind,
          value: entry.candidate.value,
          setId: entry.set.id,
          sessionId: entry.set.sessionId,
          day: entry.set.day,
          ...(entry.candidate.bodyWeightDay ? { bodyWeightDay: entry.candidate.bodyWeightDay } : {}),
          ...(entry.candidate.loadGrams !== undefined ? { loadGrams: entry.candidate.loadGrams } : {}),
        },
      ];
    }),
  };
}

/**
 * The best working set of one session: highest estimated 1RM, else heaviest load, else most reps,
 * else longest distance, else longest time. `undefined` when only warm-ups were done.
 */
export function bestSetOf(measure: Measure, sets: readonly ProgressSet[]): string | undefined {
  const working = sets.filter((set) => set.type !== 'warmup');
  const order: RecordKind[] = ['best_1rm', 'heaviest', 'most_reps', 'longest_distance', 'longest_duration'];
  for (const kind of order) {
    let top: { id: string; candidate: Candidate } | undefined;
    for (const set of working) {
      const mine = candidate(kind, measure, set);
      if (mine && (!top || beats(mine, top.candidate))) top = { id: set.id, candidate: mine };
    }
    if (top) return top.id;
  }
  return working[0]?.id;
}

/** Load × reps over working sets with a known load; `undefined` when there is none. */
export function sessionVolumeGrams(measure: Measure, sets: readonly ProgressSet[]): number | undefined {
  let total: number | undefined;
  for (const set of sets) {
    if (set.type === 'warmup') continue;
    const volume = setVolumeGrams(effectiveLoadGrams(measure, set, set.body), set.reps);
    if (volume !== undefined) total = (total ?? 0) + volume;
  }
  return total;
}
