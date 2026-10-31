import type {
  HealthSample,
  NutritionProfile,
  NutritionTargets,
} from '@life-portal/shared-types';

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
  let recorded = 0,
    expected = 0,
    steps = 0;
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
          if (type === 'steps') steps += rate * (next - t);
          else {
            recorded += rate * (next - t);
            // 07:00–23:00 is an explicit forecast assumption; no activity phased through sleep.
            if (hour >= 7 && hour < 23)
              expected += (expectedDaily * (next - t)) / (16 * 3600000);
          }
        }
        t = next;
      }
    }
  }
  // Old all-activity multipliers cannot safely be decomposed; wait for profile migration.
  const adjustment = targets.expenditure
    ? Math.max(0, Math.round(recorded - expected))
    : 0;
  const starting = targets.energyKcal.value;
  const activity = {
    startingTargetKcal: starting,
    recordedActiveKcal: Math.round(recorded),
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
        'Starting target + recorded active energy − expected activity in matching sampled periods; uncertain periods retain their forecast. Downward adjustments are withheld because coverage cannot be established. No workout or step calories are added separately.',
      confidence: 'low',
    },
  };
}
