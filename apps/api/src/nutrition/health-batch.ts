import { randomBytes } from 'crypto';

export interface HealthWindow {
  id: string;
  from: string;
  to: string;
  blocked?: boolean;
}
export const HEALTH_BATCH_LIMIT = 50; // Per kind: at most 100 combined rows.
export const HEALTH_RUN_WINDOWS = 12;
const HOUR = 3600000;
export const HEALTH_WINDOW_HOURS = 6;
const WINDOW = HEALTH_WINDOW_HOURS * HOUR;
const window = (from: number, to: number): HealthWindow => ({
  id: randomBytes(16).toString('hex'),
  from: new Date(from).toISOString(),
  to: new Date(to).toISOString(),
});

/** Newest windows first; UTC boundaries partition raw samples, not the user's food day. */
function windows(from: number, to: number): HealthWindow[] {
  const result: HealthWindow[] = [];
  while (to > from) {
    const start = Math.max(from, to - WINDOW);
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
  if (!previousTo) return windows(earliest, end);
  // Cover time since the previous plan, with at least six hours of overlap for delayed Watch data.
  if (!remaining.length)
    return windows(
      Math.max(earliest, Math.min(Date.parse(previousTo), end - 6 * HOUR)),
      end,
    );
  // Preserve the cursor: repeated launches must not starve pending work with tiny new windows.
  return [
    ...remaining,
    ...windows(Math.max(earliest, Date.parse(previousTo)), end),
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
