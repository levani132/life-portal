import { randomBytes } from 'crypto';

export interface HealthWindow {
  id: string;
  from: string;
  to: string;
  blocked?: boolean;
}
export const HEALTH_BATCH_LIMIT = 250; // Per kind: at most 500 combined rows.
export const HEALTH_RUN_WINDOWS = 12;
const HOUR = 3600000;
const window = (from: number, to: number): HealthWindow => ({
  id: randomBytes(16).toString('hex'),
  from: new Date(from).toISOString(),
  to: new Date(to).toISOString(),
});

/** Newest windows first; UTC boundaries partition raw samples, not the user's food day. */
function hours(from: number, to: number): HealthWindow[] {
  const result: HealthWindow[] = [];
  while (to > from) {
    const start = Math.max(from, Math.floor((to - 1) / HOUR) * HOUR);
    result.push(window(start, to));
    to = start;
  }
  return result;
}
export function planHealthWindows(
  to: string,
  previousTo?: string,
  pending: HealthWindow[] = [],
): HealthWindow[] {
  const end = Date.parse(to),
    earliest = end - 72 * HOUR;
  const remaining = pending
    .filter((w) => Date.parse(w.to) > earliest)
    .map((w) =>
      Date.parse(w.from) < earliest ? window(earliest, Date.parse(w.to)) : w,
    );
  if (!previousTo) return hours(earliest, end);
  if (!remaining.length) return hours(end - 6 * HOUR, end); // Delayed Watch data is re-read.
  return [
    ...hours(Math.max(earliest, Date.parse(previousTo)), end),
    ...remaining,
  ];
}
export function splitHealthWindow(w: HealthWindow): HealthWindow[] {
  const from = Date.parse(w.from),
    to = Date.parse(w.to);
  if (to - from <= 1000) return [{ ...w, blocked: true }];
  const middle = Math.floor((from + (to - from) / 2) / 1000) * 1000;
  return [window(middle, to), window(from, middle)];
}
export function healthWindowResponse(queue: HealthWindow[]) {
  const w = queue[0];
  return {
    state: !w ? 'done' : w.blocked ? 'blocked' : 'ready',
    done: !w,
    blocked: w?.blocked ?? false,
    remaining: queue.length,
    maxWindows: HEALTH_RUN_WINDOWS,
    ...(w
      ? {
          window: {
            ...w,
            queryFrom: new Date(Date.parse(w.from) - 1000).toISOString(),
            limitPerKind: HEALTH_BATCH_LIMIT,
          },
        }
      : {}),
  };
}
