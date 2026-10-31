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
  const context = (ms: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
    );
    const hour = Number(parts['hour']);
    let date = `${parts['year']}-${parts['month']}-${parts['day']}`;
    if (hour < profile.dayStartHour)
      date = new Date(Date.parse(date + 'T12:00:00Z') - 86400000)
        .toISOString()
        .slice(0, 10);
    return { date, hour };
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
    const rows = valid.filter((s) => s.type === type);
    const bounds = [
      ...new Set(
        rows.flatMap((s) => [
          Date.parse(s.start),
          Math.min(limit, Date.parse(s.end)),
        ]),
      ),
    ].sort((a, b) => a - b);
    for (let i = 0; i < bounds.length - 1; i++) {
      const start = bounds[i],
        end = bounds[i + 1];
      const covering = rows
        .filter((s) => Date.parse(s.start) <= start && Date.parse(s.end) >= end)
        .sort(
          (a, b) =>
            a.source.localeCompare(b.source) || a.id.localeCompare(b.id),
        );
      const row = covering[0];
      if (!row) continue;
      const rate = row.value / (Date.parse(row.end) - Date.parse(row.start));
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
      : limit - Date.parse(lastSync) > 300000
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
