import {
  countsForSeason,
  enrollableSeason,
  groupRangeLabel,
  matchEntrants,
  season,
  seasonDayAt,
  seasonIdOf,
  seasonPhase,
  type TournamentEntrant,
} from './tournaments';

const at = (iso: string) => new Date(iso);

describe('season calendar', () => {
  it('runs a calendar month on Tbilisi time, with enrolment from the 20th and three days of grace', () => {
    const s = season('2026-12');
    expect(s.firstDay).toBe('2026-12-01');
    expect(s.lastDay).toBe('2026-12-31');
    expect(s.enrolOpensAt.toISOString()).toBe('2026-11-19T20:00:00.000Z');
    expect(s.locksAt.toISOString()).toBe('2026-11-30T20:00:00.000Z');
    expect(s.endsAt.toISOString()).toBe('2026-12-31T20:00:00.000Z');
    expect(s.finalizesAt.toISOString()).toBe('2027-01-03T20:00:00.000Z');
  });

  it('handles February in a leap year and the year boundary for enrolment', () => {
    expect(season('2028-02').lastDay).toBe('2028-02-29');
    expect(season('2027-01').enrolOpensAt.toISOString()).toBe('2026-12-19T20:00:00.000Z');
  });

  it('rejects anything that is not YYYY-MM', () => {
    expect(() => season('2026-13')).toThrow();
    expect(() => season('2026-1')).toThrow();
  });

  it('moves through its phases at exactly the boundary instants', () => {
    const s = season('2026-12');
    expect(seasonPhase(s, at('2026-11-19T19:59:59Z'))).toBe('upcoming');
    expect(seasonPhase(s, at('2026-11-19T20:00:00Z'))).toBe('enrolling');
    expect(seasonPhase(s, at('2026-11-30T19:59:59Z'))).toBe('enrolling');
    expect(seasonPhase(s, at('2026-11-30T20:00:00Z'))).toBe('running');
    expect(seasonPhase(s, at('2026-12-31T19:59:59Z'))).toBe('running');
    expect(seasonPhase(s, at('2026-12-31T20:00:00Z'))).toBe('grace');
    expect(seasonPhase(s, at('2027-01-03T20:00:00Z'))).toBe('final');
  });

  it('reads the day on the season clock, not UTC', () => {
    expect(seasonDayAt(at('2026-11-30T21:00:00Z'))).toBe('2026-12-01');
    expect(seasonIdOf('2026-12-31')).toBe('2026-12');
  });

  it('offers next month only while its enrolment is open; no late entries', () => {
    expect(enrollableSeason(at('2026-11-25T10:00:00Z'))?.id).toBe('2026-12');
    // 1 December in Tbilisi (still 30 November in UTC): December has locked; January is not open.
    expect(enrollableSeason(at('2026-11-30T21:00:00Z'))).toBeUndefined();
    expect(enrollableSeason(at('2026-12-10T10:00:00Z'))).toBeUndefined();
    expect(enrollableSeason(at('2026-12-19T20:00:00Z'))?.id).toBe('2027-01');
  });

  it('counts a set dated in the month only if it was saved before the standings were final', () => {
    const s = season('2026-12');
    expect(countsForSeason(s, { day: '2026-12-31', savedAt: at('2027-01-02T09:00:00Z') })).toBe(true);
    expect(countsForSeason(s, { day: '2026-12-15', savedAt: at('2027-01-03T20:00:00Z') })).toBe(false);
    expect(countsForSeason(s, { day: '2026-11-30', savedAt: at('2026-12-01T09:00:00Z') })).toBe(false);
    expect(countsForSeason(s, { day: '2027-01-01', savedAt: at('2027-01-01T09:00:00Z') })).toBe(false);
  });
});

describe('matchmaking', () => {
  const entrant = (userId: string, milestone: number, score = 1000 + milestone * 10): TournamentEntrant => ({
    userId,
    milestone,
    score,
  });

  it('runs no tournament when too few entered, and invents nobody', () => {
    const result = matchEntrants([entrant('a', 5), entrant('b', 5)]);
    expect(result.groups).toEqual([]);
    expect(result.unmatched.map((e) => e.userId)).toEqual(['a', 'b']);
  });

  it('keeps full divisions to themselves', () => {
    const result = matchEntrants(['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => entrant(id, i < 3 ? 4 : 9)));
    expect(result.groups.map((g) => [g.minMilestone, g.maxMilestone, g.entrants.length])).toEqual([
      [4, 4, 3],
      [9, 9, 3],
    ]);
  });

  it('widens a short division upward and shows the widened range', () => {
    const result = matchEntrants([entrant('a', 9), entrant('b', 10), entrant('c', 12), entrant('d', 12), entrant('e', 12)]);
    expect(result.groups.map((g) => g.entrants.map((e) => e.userId))).toEqual([['a', 'b', 'c', 'd', 'e']]);
    expect(groupRangeLabel(result.groups[0])).toBe('Achiever III – Veteran III');
  });

  it('folds a short top bracket into the group below it', () => {
    const result = matchEntrants([entrant('a', 3), entrant('b', 3), entrant('c', 3), entrant('d', 20)]);
    expect(result.groups).toHaveLength(1);
    expect(groupRangeLabel(result.groups[0])).toBe('Explorer III – Master I');
  });

  it('splits an oversized bracket into the fewest equal groups, in score order', () => {
    const many = Array.from({ length: 7 }, (_, i) => entrant(`u${i}`, 6, 1000 + i));
    const result = matchEntrants(many, 3, 3);
    expect(result.groups.map((g) => g.entrants.length)).toEqual([3, 2, 2]);
    expect(result.groups[0].entrants.map((e) => e.score)).toEqual([1000, 1001, 1002]);
    const big = matchEntrants(Array.from({ length: 250 }, (_, i) => entrant(`u${i}`, 6)));
    expect(big.groups.map((g) => g.entrants.length)).toEqual([84, 83, 83]);
  });

  it('is deterministic whatever order entries arrive in', () => {
    const list = [entrant('c', 4, 5), entrant('a', 4, 5), entrant('b', 4, 5), entrant('d', 7)];
    const once = matchEntrants(list);
    const again = matchEntrants([...list].reverse());
    expect(again).toEqual(once);
    expect(once.groups[0].entrants.map((e) => e.userId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('labels a single-division group by that division', () => {
    expect(groupRangeLabel({ minMilestone: 13, maxMilestone: 13 })).toBe('Veteran II');
    expect(groupRangeLabel({ minMilestone: 0, maxMilestone: 0 })).toBe('Initiate III');
  });
});
