import type {
  HealthSample,
  ActivityHour,
  NutritionProfile,
  NutritionTargets,
} from '@life-portal/shared-types';

/**
 * Active kcal for walking `steps`: stride from height (0.415 × height, the usual
 * pedometer rule) times the net cost of walking, about 0.5 kcal per kg per km above resting.
 * 10,000 steps at 180 cm and 96 kg is about 360 kcal. Undefined without height or weight.
 */
export function stepsActiveKcal(steps: number, heightCm?: number, weightGrams?: number) {
  if (!heightCm || !weightGrams || steps <= 0) return undefined;
  const km = (steps * heightCm * 0.415) / 100_000;
  return km * (weightGrams / 1000) * 0.5;
}

/** Raw sample merging: pick one source per overlapping interval, never sum devices.
 * A stable source order is deliberately conservative; this is not HealthKit statistics.
 * No downward adjustment: neither permissions nor sample absence proves full coverage.
 */
export function activityTargets(
  targets: NutritionTargets,
  profile: NutritionProfile,
  day: string,
  samples: HealthSample[],
  now: string,
  lastSync?: string,
): NutritionTargets {
  if (!targets.energyKcal) return targets;
  const zone = profile.timeZone ?? 'UTC';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const contextCache = new Map<number, { date: string; hour: number }>();
  const context = (ms: number) => {
    const minute = Math.floor(ms / 60000);
    const cached = contextCache.get(minute);
    if (cached) return cached;
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
    );
    const hour = Number(parts['hour']);
    let date = `${parts['year']}-${parts['month']}-${parts['day']}`;
    if (hour < profile.dayStartHour)
      date = new Date(Date.parse(date + 'T12:00:00Z') - 86400000)
        .toISOString()
        .slice(0, 10);
    const value = { date, hour };
    contextCache.set(minute, value);
    return value;
  };
  const limit = Date.parse(now);
  const valid = [
    ...new Map(
      samples
        .filter(
          (s) =>
            Date.parse(s.end) > Date.parse(s.start) &&
            Date.parse(s.start) < limit &&
            s.value >= 0,
        )
        .map((s) => [`${s.type}:${s.source}:${s.id}`, s]),
    ).values(),
  ];
  const timeline: ActivityHour[] = Array.from({ length: 24 }, (_, index) => ({
    hour: (profile.dayStartHour + index) % 24,
    activeKcal: 0,
    steps: 0,
    hasActiveEnergy: false,
    hasSteps: false,
  }));
  let recorded = 0,
    expected = 0,
    steps = 0,
    fromSteps = 0;
  // Expected activity in the minutes an energy sample covered, per hour.
  const energyExpected = timeline.map(() => 0);
  const expectedDaily =
    (targets.expenditure?.everydayKcal ?? 0) +
    (targets.expenditure?.exerciseKcal ?? 0);
  for (const type of ['activeEnergy', 'steps'] as const) {
    // Sweep sample boundaries with a priority heap. Batching can collect thousands of
    // records; scanning and re-parsing every sample for every boundary would be quadratic.
    const rows = valid
      .filter((s) => s.type === type)
      .sort(
        (a, b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id),
      )
      .map((s) => ({
        start: Date.parse(s.start),
        end: Date.parse(s.end),
        value: s.value,
      }));
    const events = rows
      .flatMap((row, rank) => [
        { at: row.start, rank, begins: true },
        { at: Math.min(limit, row.end), rank, begins: false },
      ])
      .sort((a, b) => a.at - b.at);
    const active = new Set<number>(),
      heap: number[] = [];
    const push = (rank: number) => {
      heap.push(rank);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (heap[parent] <= heap[i]) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
      }
    };
    const pop = () => {
      const last = heap.pop();
      if (!heap.length || last === undefined) return;
      heap[0] = last;
      let i = 0;
      while (2 * i + 1 < heap.length) {
        let child = 2 * i + 1;
        if (child + 1 < heap.length && heap[child + 1] < heap[child]) child++;
        if (heap[i] <= heap[child]) break;
        [heap[i], heap[child]] = [heap[child], heap[i]];
        i = child;
      }
    };
    for (let i = 0; i < events.length; ) {
      const start = events[i].at;
      while (i < events.length && events[i].at === start) {
        const event = events[i++];
        if (event.begins) {
          active.add(event.rank);
          push(event.rank);
        } else active.delete(event.rank);
      }
      while (heap.length && !active.has(heap[0])) pop();
      if (i >= events.length || !heap.length) continue;
      const end = events[i].at;
      const row = rows[heap[0]];
      const rate = row.value / (row.end - row.start);
      // Split at minutes to respect timezone/DST/day boundary and awake-only forecast.
      for (let t = start; t < end; ) {
        const next = Math.min(end, (Math.floor(t / 60000) + 1) * 60000);
        const { date, hour } = context(t);
        if (date === day) {
          const bucket = timeline[(hour - profile.dayStartHour + 24) % 24];
          const amount = rate * (next - t);
          if (type === 'steps') {
            steps += amount;
            bucket.steps += amount;
            bucket.hasSteps = true;
          } else {
            bucket.activeKcal += amount;
            bucket.hasActiveEnergy = true;
            // 07:00–23:00 is an explicit forecast assumption; no activity phased through sleep.
            if (hour >= 7 && hour < 23)
              energyExpected[(hour - profile.dayStartHour + 24) % 24] +=
                (expectedDaily * (next - t)) / (16 * 3600000);
          }
        }
        t = next;
      }
    }
  }
  // recorded energy wins in any hour that has it (a Watch's figure already includes
  // the walking); an hour with steps only (an iPhone without a Watch) is estimated from the
  // steps, height and weight, and then counts as covered for the whole hour, because a phone's
  // step samples cover only the moving minutes.
  const estimated: (number | undefined)[] = timeline.map(() => undefined);
  timeline.forEach((bucket, index) => {
    if (bucket.hasActiveEnergy) {
      recorded += bucket.activeKcal;
      expected += energyExpected[index];
      return;
    }
    if (!bucket.hasSteps) return;
    const kcal = stepsActiveKcal(bucket.steps, profile.heightCm, targets.weightGrams);
    if (kcal === undefined) return;
    estimated[index] = kcal;
    recorded += kcal;
    fromSteps += kcal;
    if (bucket.hour >= 7 && bucket.hour < 23) expected += expectedDaily / 16;
  });
  // Old all-activity multipliers cannot safely be decomposed; wait for profile migration.
  const adjustment = targets.expenditure
    ? Math.max(0, Math.round(recorded - expected))
    : 0;
  const starting = targets.energyKcal.value;
  const activity = {
    timeline: timeline.map((bucket, index) => ({
      ...bucket,
      activeKcal: Math.round(bucket.activeKcal * 100) / 100,
      ...(estimated[index] !== undefined && { estimatedKcal: Math.round(estimated[index]! * 100) / 100 }),
      steps: Math.round(bucket.steps * 100) / 100,
    })),
    startingTargetKcal: starting,
    recordedActiveKcal: Math.round(recorded),
    ...(fromSteps > 0 && { estimatedFromStepsKcal: Math.round(fromSteps) }),
    expectedReplacedKcal: Math.round(expected),
    adjustmentKcal: adjustment,
    currentTargetKcal: starting + adjustment,
    steps: Math.round(steps),
    workouts: valid.filter(
      (s) => s.type === 'workout' && context(Date.parse(s.start)).date === day,
    ).length,
    lastSync,
    status: !lastSync
      ? ('missing' as const)
      : limit - Date.parse(lastSync) >= 6 * 60 * 60 * 1000
        ? ('stale' as const)
        : ('partial' as const),
  };
  return {
    ...targets,
    activity,
    energyKcal: {
      value: activity.currentTargetKcal,
      basis:
        'Starting target + recorded active energy − expected activity in matching sampled periods; uncertain periods retain their forecast. Downward adjustments are withheld because coverage cannot be established. An hour with steps but no recorded energy is estimated from the steps, height and weight; workouts are never added separately.',
      confidence: 'low',
    },
  };
}
