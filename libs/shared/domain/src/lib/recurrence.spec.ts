import type { Recurrence } from '@life-portal/shared-types';
import {
  describeRecurrence,
  monthlyEquivalentCents,
  nextOccurrence,
  occurrencesBetween,
} from './recurrence';

const monthly = (dayOfMonth: number, startDate = '2026-01-07'): Recurrence => ({
  cadence: 'monthly',
  interval: 1,
  dayOfMonth,
  startDate,
});

describe('occurrencesBetween', () => {
  it('lands on the salary day each month', () => {
    expect(occurrencesBetween(monthly(7), '2026-08-01', '2026-11-30')).toEqual([
      '2026-08-07',
      '2026-09-07',
      '2026-10-07',
      '2026-11-07',
    ]);
  });

  it('clamps a 31st schedule into February', () => {
    expect(occurrencesBetween(monthly(31, '2026-01-31'), '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('respects the schedule start and end, not just the query window', () => {
    const bounded: Recurrence = { ...monthly(7), startDate: '2026-09-07', endDate: '2026-10-07' };
    expect(occurrencesBetween(bounded, '2026-01-01', '2027-01-01')).toEqual([
      '2026-09-07',
      '2026-10-07',
    ]);
  });

  it('treats endDate as inclusive', () => {
    const bounded: Recurrence = { ...monthly(7), endDate: '2026-09-07' };
    expect(occurrencesBetween(bounded, '2026-08-01', '2026-12-31')).toEqual([
      '2026-08-07',
      '2026-09-07',
    ]);
  });

  it('honours intervals greater than one', () => {
    const everyOtherMonth: Recurrence = { ...monthly(1, '2026-01-01'), interval: 2 };
    expect(occurrencesBetween(everyOtherMonth, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-01',
      '2026-03-01',
      '2026-05-01',
    ]);
  });

  it('anchors weekly schedules to the requested weekday', () => {
    const weekly: Recurrence = {
      cadence: 'weekly',
      interval: 1,
      weekday: 5, // Friday
      startDate: '2026-08-03', // a Monday
    };
    expect(occurrencesBetween(weekly, '2026-08-01', '2026-08-25')).toEqual([
      '2026-08-07',
      '2026-08-14',
      '2026-08-21',
    ]);
  });

  it('fast-forwards a long-running daily schedule without walking every day', () => {
    const daily: Recurrence = { cadence: 'daily', interval: 1, startDate: '2015-01-01' };
    const result = occurrencesBetween(daily, '2026-08-01', '2026-08-05');
    expect(result).toEqual(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05']);
  });

  it('fast-forwards a long-running monthly schedule to the right day', () => {
    const result = occurrencesBetween(monthly(7, '2019-03-07'), '2026-08-01', '2026-09-30');
    expect(result).toEqual(['2026-08-07', '2026-09-07']);
  });

  it('returns nothing when the schedule has already ended', () => {
    const ended: Recurrence = { ...monthly(7), endDate: '2025-12-31' };
    expect(occurrencesBetween(ended, '2026-01-01', '2026-12-31')).toEqual([]);
  });

  it('survives a malformed zero interval', () => {
    const broken: Recurrence = { cadence: 'daily', interval: 0, startDate: '2026-08-01' };
    expect(occurrencesBetween(broken, '2026-08-01', '2026-08-03')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ]);
  });
});

describe('nextOccurrence', () => {
  it('finds the upcoming salary date', () => {
    expect(nextOccurrence(monthly(7), '2026-08-03')).toBe('2026-08-07');
    expect(nextOccurrence(monthly(7), '2026-08-08')).toBe('2026-09-07');
  });

  it('returns undefined past the schedule end', () => {
    expect(nextOccurrence({ ...monthly(7), endDate: '2026-08-07' }, '2026-08-08')).toBeUndefined();
  });
});

describe('monthlyEquivalentCents', () => {
  it('leaves a monthly amount alone', () => {
    expect(monthlyEquivalentCents(100_000, monthly(7))).toBe(100_000);
  });

  it('scales weekly and daily amounts up, and yearly down', () => {
    expect(monthlyEquivalentCents(10_000, { cadence: 'weekly', interval: 1, startDate: '2026-01-01' })).toBe(43_482);
    expect(monthlyEquivalentCents(1_000, { cadence: 'daily', interval: 1, startDate: '2026-01-01' })).toBe(30_438);
    expect(monthlyEquivalentCents(120_000, { cadence: 'yearly', interval: 1, startDate: '2026-01-01' })).toBe(10_000);
  });

  it('halves the monthly figure for an every-other-month schedule', () => {
    expect(monthlyEquivalentCents(100_000, { ...monthly(7), interval: 2 })).toBe(50_000);
  });
});

describe('describeRecurrence', () => {
  it('reads naturally', () => {
    expect(describeRecurrence(monthly(7))).toBe('monthly on the 7th');
    expect(describeRecurrence(monthly(1))).toBe('monthly on the 1st');
    expect(describeRecurrence(monthly(22))).toBe('monthly on the 22nd');
    expect(describeRecurrence({ cadence: 'weekly', interval: 2, startDate: '2026-01-01' })).toBe(
      'every 2 weeks',
    );
  });
});
