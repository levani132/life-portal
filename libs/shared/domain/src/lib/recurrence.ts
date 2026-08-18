import type { Cadence, Recurrence } from '@life-portal/shared-types';
import {
  addDays,
  addMonths,
  addYears,
  dayInMonthOf,
  dayOfMonthOf,
  diffDays,
  diffMonths,
  makeDay,
  maxDay,
  monthOf,
  toDay,
  weekdayOf,
  yearOf,
  type DayString,
} from './dates';

/** Guards against a pathological `interval: 0` producing an infinite loop. */
function safeInterval(interval: number | undefined): number {
  const n = Math.floor(interval ?? 1);
  return n >= 1 ? n : 1;
}

/**
 * Fast-forwards to the first occurrence on or after `from` without walking every step from
 * `startDate`, which matters because a daily expense started years ago would otherwise cost
 * thousands of iterations per projection.
 */
function firstOccurrenceOnOrAfter(recurrence: Recurrence, from: DayString): DayString {
  const start = toDay(recurrence.startDate);
  const interval = safeInterval(recurrence.interval);
  if (start >= from) {
    return alignToAnchor(recurrence, start);
  }

  switch (recurrence.cadence) {
    case 'daily': {
      const steps = Math.ceil(diffDays(start, from) / interval);
      return addDays(start, steps * interval);
    }
    case 'weekly': {
      const anchor = alignToAnchor(recurrence, start);
      const stride = interval * 7;
      if (anchor >= from) return anchor;
      const steps = Math.ceil(diffDays(anchor, from) / stride);
      return addDays(anchor, steps * stride);
    }
    case 'monthly': {
      const dom = recurrence.dayOfMonth ?? dayOfMonthOf(start);
      const monthsApart = diffMonths(start, from);
      // Rewind one interval then step forward, so the clamped day-of-month can never skip
      // an occurrence that falls earlier in the month than `start`'s day.
      let candidate = dayInMonthOf(
        addMonths(start, Math.floor(monthsApart / interval) * interval),
        dom,
      );
      while (candidate < from) {
        candidate = dayInMonthOf(addMonths(candidate, interval), dom);
      }
      return candidate;
    }
    case 'yearly': {
      const month = recurrence.month ?? monthOf(start);
      const dom = recurrence.dayOfMonth ?? dayOfMonthOf(start);
      let candidate = makeDay(yearOf(start), month, dom);
      const yearsApart = yearOf(from) - yearOf(start);
      if (yearsApart > 0) {
        candidate = addYears(candidate, Math.floor(yearsApart / interval) * interval);
      }
      while (candidate < from) {
        candidate = addYears(candidate, interval);
      }
      return candidate;
    }
    default:
      return start;
  }
}

/** Moves a start date onto the schedule's anchor (weekday for weekly, day-of-month else). */
function alignToAnchor(recurrence: Recurrence, day: DayString): DayString {
  if (recurrence.cadence === 'weekly' && recurrence.weekday != null) {
    const delta = (recurrence.weekday - weekdayOf(day) + 7) % 7;
    return addDays(day, delta);
  }
  if (recurrence.cadence === 'monthly' && recurrence.dayOfMonth != null) {
    const candidate = dayInMonthOf(day, recurrence.dayOfMonth);
    return candidate >= day ? candidate : dayInMonthOf(addMonths(day, 1), recurrence.dayOfMonth);
  }
  return day;
}

function step(recurrence: Recurrence, day: DayString): DayString {
  const interval = safeInterval(recurrence.interval);
  switch (recurrence.cadence) {
    case 'daily':
      return addDays(day, interval);
    case 'weekly':
      return addDays(day, interval * 7);
    case 'monthly':
      return dayInMonthOf(
        addMonths(day, interval),
        recurrence.dayOfMonth ?? dayOfMonthOf(recurrence.startDate),
      );
    case 'yearly':
      return addYears(day, interval);
    default:
      return addDays(day, 1);
  }
}

/** Hard ceiling so a malformed recurrence cannot hang a request. */
const MAX_OCCURRENCES = 5000;

/**
 * Every occurrence of `recurrence` within `[from, to]`, inclusive on both ends.
 *
 * The recurrence's own `startDate`/`endDate` bound the result further: an expense that ended
 * last year contributes nothing even if the requested window is wide.
 */
export function occurrencesBetween(
  recurrence: Recurrence,
  from: string,
  to: string,
): DayString[] {
  const windowStart = maxDay(toDay(from), toDay(recurrence.startDate)) as DayString;
  const windowEnd = recurrence.endDate
    ? [toDay(to), toDay(recurrence.endDate)].sort()[0]
    : toDay(to);
  if (windowStart > windowEnd) return [];

  const out: DayString[] = [];
  let cursor = firstOccurrenceOnOrAfter(recurrence, windowStart);
  while (cursor <= windowEnd && out.length < MAX_OCCURRENCES) {
    if (cursor >= windowStart) out.push(cursor);
    const next = step(recurrence, cursor);
    if (next <= cursor) break;
    cursor = next;
  }
  return out;
}

/** The next occurrence on or after `from`, or undefined if the schedule has ended. */
export function nextOccurrence(recurrence: Recurrence, from: string): DayString | undefined {
  const candidate = firstOccurrenceOnOrAfter(recurrence, maxDay(toDay(from), toDay(recurrence.startDate)) as DayString);
  if (recurrence.endDate && candidate > toDay(recurrence.endDate)) return undefined;
  return candidate;
}

/** Average occurrences per 30-day month, used to normalise cadences into a monthly figure. */
const MONTHLY_FACTOR: Record<Cadence, number> = {
  daily: 30.4375,
  weekly: 4.348214,
  monthly: 1,
  yearly: 1 / 12,
};

/**
 * Normalises any cadence to a per-month amount so mixed schedules can be summed into a
 * single "monthly burn" figure. Approximate by nature — the day-by-day projection is the
 * authority; this is for the headline number only.
 */
export function monthlyEquivalentCents(amountCents: number, recurrence: Recurrence): number {
  const factor = MONTHLY_FACTOR[recurrence.cadence] ?? 1;
  return Math.round((amountCents * factor) / safeInterval(recurrence.interval));
}

/** Human-readable schedule, e.g. `monthly on the 7th`, `every 2 weeks`. */
export function describeRecurrence(recurrence: Recurrence): string {
  const interval = safeInterval(recurrence.interval);
  const every = interval === 1 ? '' : `every ${interval} `;
  switch (recurrence.cadence) {
    case 'daily':
      return interval === 1 ? 'daily' : `${every}days`;
    case 'weekly': {
      const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const on = recurrence.weekday != null ? ` on ${names[recurrence.weekday]}` : '';
      return `${interval === 1 ? 'weekly' : `${every}weeks`}${on}`;
    }
    case 'monthly': {
      const dom = recurrence.dayOfMonth ?? dayOfMonthOf(recurrence.startDate);
      return `${interval === 1 ? 'monthly' : `${every}months`} on the ${ordinal(dom)}`;
    }
    case 'yearly':
      return interval === 1 ? 'yearly' : `${every}years`;
    default:
      return 'unknown schedule';
  }
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
