import { usageReport, type UsageEvent } from './usage';

const TODAY = '2026-11-22';
const ev = (userId: string, day: string, kind: UsageEvent['kind'] = 'food'): UsageEvent => ({ userId, day, kind });

describe('usageReport', () => {
  it('counts distinct people per day and per window, and what they did', () => {
    const report = usageReport({
      today: TODAY,
      range: 7,
      totalAccounts: 10,
      signups: [{ userId: 'a', day: '2026-11-20' }, { userId: 'b', day: '2026-11-22' }, { userId: 'old', day: '2026-10-01' }],
      events: [
        ev('a', TODAY), ev('a', TODAY, 'training'), ev('a', TODAY, 'post'), ev('a', TODAY),
        ev('c', TODAY, 'social'),
        ev('a', '2026-11-20'), ev('d', '2026-11-18', 'weight'),
        ev('e', '2026-11-01'), // outside 7 days, inside 30
        ev('f', '2026-11-23'), // the future is ignored
      ],
    });
    expect(report.days).toHaveLength(7);
    expect(report.days[0].day).toBe('2026-11-16');
    expect(report.days[6]).toEqual({ day: TODAY, newAccounts: 1, active: 2, food: 1, training: 1, posted: 1 });
    expect(report.days[4]).toMatchObject({ day: '2026-11-20', newAccounts: 1, active: 1 });
    expect(report).toMatchObject({ totalAccounts: 10, newAccounts: 2, activeToday: 2, active7: 3, active30: 4 });
    expect(report.people).toEqual({ food: 1, training: 1, weight: 1, post: 1, social: 1 });
    // Of the two accounts created in the range, only `a` ever did anything.
    expect(report.newAccountsActivated).toBe(1);
    expect(JSON.stringify(report)).not.toMatch(/"userId"|"a"|"old"/);
  });

  it('measures who came back: active on day N or later, among accounts old enough to tell', () => {
    const report = usageReport({
      today: TODAY,
      range: 30,
      totalAccounts: 5,
      signups: [
        { userId: 'stayed', day: '2026-10-01' },
        { userId: 'left', day: '2026-10-01' },
        { userId: 'week', day: '2026-11-10' },
        { userId: 'new', day: TODAY },
        { userId: 'ancient', day: '2026-01-01' }, // outside the 90-day window
      ],
      events: [
        ev('stayed', '2026-10-01'), ev('stayed', '2026-11-15'),
        ev('left', '2026-10-01'), // only on the day of sign-up
        ev('week', '2026-11-18'),
        ev('new', TODAY),
        ev('ancient', TODAY),
      ],
    });
    expect(report.retention).toEqual([
      { afterDays: 1, eligible: 3, returned: 2 },
      { afterDays: 7, eligible: 3, returned: 2 },
      { afterDays: 30, eligible: 2, returned: 1 },
    ]);
  });

  it('answers zeros for an empty app', () => {
    const report = usageReport({ today: TODAY, range: 7, totalAccounts: 0, signups: [], events: [] });
    expect(report).toMatchObject({ newAccounts: 0, activeToday: 0, active7: 0, active30: 0, newAccountsActivated: 0 });
    expect(report.days.every((day) => day.active === 0 && day.newAccounts === 0)).toBe(true);
    expect(report.retention.every((step) => step.eligible === 0 && step.returned === 0)).toBe(true);
  });
});
