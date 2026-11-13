import { RANK_DIVISIONS, RANK_TIERS } from '@life-portal/shared-types';
import { addDays, addMonths, daysInMonth, makeDay, toDay } from './dates';

/**
 * Monthly strength tournaments (issue #12): the season calendar and matchmaking. Pure; "now" is
 * always an argument. Scoring is not here: it waits for the owner's decision on #12. See
 * specs/026-strength-tournaments/spec.md and docs/modules/tournaments.md.
 *
 * Owner decisions (2026-11-13): seasons are calendar months in **UTC**; times are shown in the
 * member's own time zone, but every boundary is a UTC instant.
 */
/** Enrolment for a season opens at 00:00 on this day of the month before. */
export const SEASON_ENROL_OPENS_DAY = 20;
/** Days after the month's last day during which late-logged workouts still count. */
export const SEASON_GRACE_DAYS = 3;
/** Fewest entrants a group may have; smaller divisions are merged with their neighbours. */
export const TOURNAMENT_MIN_GROUP = 3;
/** Most entrants a group may have; bigger brackets are split evenly. */
export const TOURNAMENT_MAX_GROUP = 100;

/** `YYYY-MM`. */
export type SeasonId = string;

export interface Season {
  id: SeasonId;
  /** Workouts dated from `firstDay` to `lastDay` (inclusive) belong to the season. */
  firstDay: string;
  lastDay: string;
  /** Instants, as `Date`. Enrolment is open from `enrolOpensAt` until `locksAt` (exclusive). */
  enrolOpensAt: Date;
  locksAt: Date;
  /** 00:00 after the month's last day: the month is over, the grace period starts. */
  endsAt: Date;
  /**
   * The end of the grace period, 00:00 UTC on the 4th of the next month: a set saved before this
   * instant counts, one saved at or after it never does, and from here on results are frozen.
   */
  finalizesAt: Date;
}

export type SeasonPhase = 'upcoming' | 'enrolling' | 'running' | 'grace' | 'final';

const SEASON_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 00:00 UTC on `day`, as an instant. */
function seasonMidnight(day: string): Date {
  const [y, m, d] = toDay(day).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** The season a workout day belongs to. */
export function seasonIdOf(day: string): SeasonId {
  return toDay(day).slice(0, 7);
}

export function season(id: SeasonId): Season {
  const match = SEASON_PATTERN.exec(id);
  if (!match) throw new Error(`Not a season: ${id}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const firstDay = makeDay(year, month, 1);
  const lastDay = makeDay(year, month, daysInMonth(year, month));
  const previous = addMonths(firstDay, -1);
  return {
    id,
    firstDay,
    lastDay,
    enrolOpensAt: seasonMidnight(`${previous.slice(0, 8)}${String(SEASON_ENROL_OPENS_DAY).padStart(2, '0')}`),
    locksAt: seasonMidnight(firstDay),
    endsAt: seasonMidnight(addDays(lastDay, 1)),
    finalizesAt: seasonMidnight(addDays(lastDay, 1 + SEASON_GRACE_DAYS)),
  };
}

export function seasonPhase(target: Season, now: Date): SeasonPhase {
  const t = now.getTime();
  if (t < target.enrolOpensAt.getTime()) return 'upcoming';
  if (t < target.locksAt.getTime()) return 'enrolling';
  if (t < target.endsAt.getTime()) return 'running';
  if (t < target.finalizesAt.getTime()) return 'grace';
  return 'final';
}

/** The UTC day at `now`: the season clock. */
export function seasonDayAt(now: Date): string {
  return toDay(now);
}

/**
 * The season a member can join at `now`, if any: next month's once its enrolment has opened.
 * There are no late entries; between the 1st and the 20th there is nothing to join.
 */
export function enrollableSeason(now: Date): Season | undefined {
  const next = season(seasonIdOf(addMonths(`${seasonIdOf(seasonDayAt(now))}-01`, 1)));
  return seasonPhase(next, now) === 'enrolling' ? next : undefined;
}

/**
 * Whether a set counts for a season: its workout is dated in the month, and it was saved before
 * the standings became final. A set dated in the month but saved later (a backfill after the
 * fact) never counts.
 */
export function countsForSeason(target: Season, set: { day: string; savedAt: Date }): boolean {
  const day = toDay(set.day);
  return day >= target.firstDay && day <= target.lastDay && set.savedAt.getTime() < target.finalizesAt.getTime();
}

// ── Matchmaking ─────────────────────────────────────────────────────────────

export interface TournamentEntrant {
  userId: string;
  /** Current rank milestone at lock, 0–23 (`RankPosition.milestone`). */
  milestone: number;
  /** The rank score at lock (`RankPosition.score`); orders entrants within a division. */
  score: number;
}

export interface TournamentGroup {
  /** The lowest and highest milestone in the group; equal unless the group was widened. */
  minMilestone: number;
  maxMilestone: number;
  entrants: TournamentEntrant[];
}

export interface Matchmaking {
  groups: TournamentGroup[];
  /** Entrants for whom no tournament runs: fewer than the minimum entered the exercise at all. */
  unmatched: TournamentEntrant[];
}

/** "Veteran II", or "Achiever III – Veteran I" for a widened group. */
export function groupRangeLabel(group: Pick<TournamentGroup, 'minMilestone' | 'maxMilestone'>): string {
  const label = (m: number) => `${RANK_TIERS[Math.floor(m / 3)]} ${RANK_DIVISIONS[m % 3]}`;
  return group.minMilestone === group.maxMilestone
    ? label(group.minMilestone)
    : `${label(group.minMilestone)} – ${label(group.maxMilestone)}`;
}

/**
 * Groups one exercise's entrants for one season.
 *
 * 1. Every division (milestone) starts as its own bracket.
 * 2. Walking up from the lowest, a bracket below the minimum takes in the next one up, and so on,
 *    until it has enough; a short bracket left at the top joins the one below it. The group's
 *    range shows the widening; nobody is invented to fill a group.
 * 3. A bracket above the maximum is split, in score order, into the fewest equal-sized groups.
 *
 * Deterministic: the same entrants always give the same groups (ties go by userId).
 */
export function matchEntrants(
  entrants: readonly TournamentEntrant[],
  min = TOURNAMENT_MIN_GROUP,
  max = TOURNAMENT_MAX_GROUP,
): Matchmaking {
  if (entrants.length < min) return { groups: [], unmatched: [...entrants] };
  const sorted = [...entrants].sort(
    (a, b) => a.milestone - b.milestone || a.score - b.score || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  const brackets: TournamentEntrant[][] = [];
  for (const entrant of sorted) {
    const last = brackets[brackets.length - 1];
    if (last && last[0].milestone === entrant.milestone) last.push(entrant);
    else brackets.push([entrant]);
  }
  const merged: TournamentEntrant[][] = [];
  let open: TournamentEntrant[] = [];
  for (const bracket of brackets) {
    open = [...open, ...bracket];
    if (open.length >= min) {
      merged.push(open);
      open = [];
    }
  }
  if (open.length) {
    // Fewer than `min` left at the top: they join the group below (there is one, since the total
    // is at least `min`).
    merged[merged.length - 1] = [...merged[merged.length - 1], ...open];
  }
  const groups: TournamentGroup[] = [];
  for (const bracket of merged) {
    const parts = Math.ceil(bracket.length / max);
    const base = Math.floor(bracket.length / parts);
    const extra = bracket.length % parts;
    let at = 0;
    for (let p = 0; p < parts; p++) {
      const size = base + (p < extra ? 1 : 0);
      const slice = bracket.slice(at, at + size);
      at += size;
      groups.push({
        minMilestone: slice[0].milestone,
        maxMilestone: slice[slice.length - 1].milestone,
        entrants: slice,
      });
    }
  }
  return { groups, unmatched: [] };
}
