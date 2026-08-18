/**
 * Calendar-day arithmetic on `YYYY-MM-DD` strings.
 *
 * Everything here is UTC-anchored on purpose. A "day" in this app is a calendar day, not an
 * instant, so anchoring to UTC midnight keeps `addMonths` and `diffDays` stable regardless
 * of the server's timezone or daylight-saving transitions. Written by hand rather than
 * pulled from a date library because the domain layer stays dependency-free (constitution
 * principle V).
 */

/** A calendar day with no time component. */
export type DayString = string;

const DAY_MS = 86_400_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

/** Narrows any ISO date or date-time string to its calendar day. */
export function toDay(value: string | Date): DayString {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const match = DAY_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Not an ISO date: ${value}`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Parses a day string to a `Date` at UTC midnight. */
export function toUtcDate(day: string): Date {
  const [y, m, d] = toDay(day).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function makeDay(year: number, month: number, day: number): DayString {
  return toDay(new Date(Date.UTC(year, month - 1, day)));
}

export function yearOf(day: string): number {
  return Number(toDay(day).slice(0, 4));
}

/** 1-12. */
export function monthOf(day: string): number {
  return Number(toDay(day).slice(5, 7));
}

export function dayOfMonthOf(day: string): number {
  return Number(toDay(day).slice(8, 10));
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayOf(day: string): number {
  return toUtcDate(day).getUTCDay();
}

export function addDays(day: string, count: number): DayString {
  return toDay(new Date(toUtcDate(day).getTime() + count * DAY_MS));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Adds calendar months, clamping the day to the length of the target month so that
 * 31 January + 1 month is 28/29 February rather than spilling into March.
 */
export function addMonths(day: string, count: number): DayString {
  const d = toUtcDate(day);
  const targetMonthIndex = d.getUTCMonth() + count;
  const year = d.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const clampedDay = Math.min(d.getUTCDate(), daysInMonth(year, month + 1));
  return toDay(new Date(Date.UTC(year, month, clampedDay)));
}

export function addYears(day: string, count: number): DayString {
  return addMonths(day, count * 12);
}

/** Whole calendar days from `a` to `b`. Negative when `b` precedes `a`. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / DAY_MS);
}

/** Approximate whole months between two days, used for "months to payoff" figures. */
export function diffMonths(a: string, b: string): number {
  const from = toUtcDate(a);
  const to = toUtcDate(b);
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) {
    months -= 1;
  }
  return months;
}

export function isBefore(a: string, b: string): boolean {
  return toDay(a) < toDay(b);
}

export function isAfter(a: string, b: string): boolean {
  return toDay(a) > toDay(b);
}

export function isSameDay(a: string, b: string): boolean {
  return toDay(a) === toDay(b);
}

/** Inclusive on both ends. */
export function isWithin(day: string, from: string, to: string): boolean {
  const d = toDay(day);
  return d >= toDay(from) && d <= toDay(to);
}

export function minDay(...days: (string | undefined)[]): DayString | undefined {
  const present = days.filter((d): d is string => Boolean(d)).map(toDay);
  return present.length ? present.reduce((a, b) => (a < b ? a : b)) : undefined;
}

export function maxDay(...days: (string | undefined)[]): DayString | undefined {
  const present = days.filter((d): d is string => Boolean(d)).map(toDay);
  return present.length ? present.reduce((a, b) => (a > b ? a : b)) : undefined;
}

/** The `dayOfMonth`th of `day`'s month, clamped to the month's length. */
export function dayInMonthOf(day: string, dayOfMonth: number): DayString {
  const year = yearOf(day);
  const month = monthOf(day);
  return makeDay(year, month, Math.min(dayOfMonth, daysInMonth(year, month)));
}

/**
 * The next occurrence of `dayOfMonth` on or after `from`. Used to find the next salary date.
 */
export function nextDayOfMonth(from: string, dayOfMonth: number): DayString {
  const thisMonth = dayInMonthOf(from, dayOfMonth);
  return thisMonth >= toDay(from) ? thisMonth : dayInMonthOf(addMonths(from, 1), dayOfMonth);
}

/** Every calendar day in `[from, to]`. */
export function eachDay(from: string, to: string): DayString[] {
  const out: DayString[] = [];
  let cursor = toDay(from);
  const end = toDay(to);
  while (cursor <= end) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Formats a day for the UI, e.g. `7 Sep 2026`. */
export function formatDay(day: string, locale = 'en-GB'): string {
  return toUtcDate(day).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** `in 4 days`, `today`, `3 days ago`. */
export function relativeDays(from: string, to: string): string {
  const delta = diffDays(from, to);
  if (delta === 0) return 'today';
  if (delta === 1) return 'tomorrow';
  if (delta === -1) return 'yesterday';
  return delta > 0 ? `in ${delta} days` : `${Math.abs(delta)} days ago`;
}

/** Formats a `YYYY-MM` or `YYYY-MM-DD` month for the UI, e.g. `August 2026`. */
export function formatMonth(month: string, locale = 'en-GB'): string {
  return toUtcDate(`${month.slice(0, 7)}-01`).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
