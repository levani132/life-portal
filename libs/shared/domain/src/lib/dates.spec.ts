import {
  addDays,
  addMonths,
  dayInMonthOf,
  diffDays,
  diffMonths,
  eachDay,
  formatMonth,
  nextDayOfMonth,
  toDay,
  wallClockDay,
  weekdayOf,
} from './dates';

describe('dates', () => {
  it('narrows date-times to calendar days', () => {
    expect(toDay('2026-08-03T22:45:00.000Z')).toBe('2026-08-03');
    expect(toDay(new Date(Date.UTC(2026, 7, 3)))).toBe('2026-08-03');
  });

  it('clamps addMonths to the length of the target month', () => {
    // The bug this guards: 31 January + 1 month must not spill into 3 March.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-02-15', -3)).toBe('2025-11-15');
  });

  it('counts whole days and months', () => {
    expect(diffDays('2026-08-03', '2026-08-10')).toBe(7);
    expect(diffDays('2026-08-10', '2026-08-03')).toBe(-7);
    // Not yet a full month, because the day-of-month has not been reached.
    expect(diffMonths('2026-08-07', '2026-09-06')).toBe(0);
    expect(diffMonths('2026-08-07', '2026-09-07')).toBe(1);
  });

  it('is unaffected by daylight-saving transitions', () => {
    // Europe/Tbilisi has no DST, but a server in Europe/London would shift on 2026-03-29.
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('finds the next salary date, rolling into the following month', () => {
    expect(nextDayOfMonth('2026-08-03', 7)).toBe('2026-08-07');
    expect(nextDayOfMonth('2026-08-07', 7)).toBe('2026-08-07');
    expect(nextDayOfMonth('2026-08-08', 7)).toBe('2026-09-07');
  });

  it('clamps a day-of-month to short months', () => {
    expect(dayInMonthOf('2026-02-10', 31)).toBe('2026-02-28');
  });

  it('enumerates inclusive day ranges', () => {
    expect(eachDay('2026-08-01', '2026-08-04')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('reports weekdays in UTC', () => {
    expect(weekdayOf('2026-08-03')).toBe(1); // a Monday
  });

  it('formats a month from either a month key or a full day', () => {
    expect(formatMonth('2026-08')).toBe('August 2026');
    expect(formatMonth('2026-08-18')).toBe('August 2026');
  });
});

describe('wallClockDay', () => {
  it('reads the literal wall clock, never the machine timezone', () => {
    // 05:00 in Tbilisi is 01:00 UTC. Read through Date.getHours() on a UTC host, the 4am rule
    // fires against the wrong clock and files the payment a day early — the bug this exists for.
    expect(wallClockDay('2026-08-31T05:00:00+04:00')).toBe('2026-08-31');
    expect(wallClockDay('2026-08-31T01:00:00+04:00')).toBe('2026-08-30');
  });

  it('accepts a wall clock with no offset, as a browser datetime-local sends', () => {
    expect(wallClockDay('2026-08-30T18:00')).toBe('2026-08-30');
    expect(wallClockDay('2026-08-30T03:59')).toBe('2026-08-29');
  });

  it('treats a bare date as that day — there is no clock to apply the rule to', () => {
    expect(wallClockDay('2026-08-23')).toBe('2026-08-23');
  });

  it('respects the configured day-start hour', () => {
    expect(wallClockDay('2026-08-31T05:00:00+04:00', 6)).toBe('2026-08-30');
    expect(wallClockDay('2026-08-31T05:00:00+04:00', 0)).toBe('2026-08-31');
  });

  it('refuses locale prose rather than guessing', () => {
    // What an iOS Shortcut sends when the date variable has no format set.
    expect(wallClockDay('30 Aug 2026 at 22:38')).toBeNull();
    expect(wallClockDay('30/08/2026, 22:38')).toBeNull();
    expect(wallClockDay('')).toBeNull();
    expect(wallClockDay(undefined)).toBeNull();
  });
});
