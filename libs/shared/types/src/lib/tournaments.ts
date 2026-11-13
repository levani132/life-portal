import type { RankDivision, RankTier } from './training';

/**
 * Monthly strength tournaments (issue #12), behind `tournaments`. Contracts only. Scoring is not
 * decided yet, so nothing here carries a score, position or result: the group view lists who is
 * in it and says standings come later.
 */

/** Separate men's and women's competitions, matching the separate rank standards. */
export const TOURNAMENT_CATEGORIES = ['men', 'women'] as const;
export type TournamentCategory = (typeof TOURNAMENT_CATEGORIES)[number];

/** Bumped whenever what joining discloses changes; an entry records the version agreed to. */
export const TOURNAMENT_CONSENT_VERSION = 1;
/** Results and entries are deleted this many months after a season's results are final. */
export const TOURNAMENT_RETENTION_MONTHS = 12;

export type SeasonPhaseName = 'upcoming' | 'enrolling' | 'running' | 'grace' | 'final';

export interface SeasonView {
  /** `YYYY-MM`. */
  id: string;
  firstDay: string;
  lastDay: string;
  /** ISO instants (UTC). The web shows them in the member's own time zone. */
  enrolOpensAt: string;
  locksAt: string;
  endsAt: string;
  finalizesAt: string;
  phase: SeasonPhaseName;
}

/**
 * Where an entry stands:
 * - `entered`: joined, before the lock.
 * - `grouped`: in a group of 3–100 after the lock.
 * - `no_tournament`: fewer than 3 people entered this exercise and category.
 * - `not_ranked`: no current rank on the exercise at the lock, so no group.
 * - `voided`: removed by the developer, with a reason.
 * - `forming`: the lock has passed and groups are being formed.
 */
export type TournamentEntryStatus = 'entered' | 'forming' | 'grouped' | 'no_tournament' | 'not_ranked' | 'voided';

export interface TournamentEntry {
  id: string;
  exerciseId: string;
  exerciseName: string;
  season: SeasonView;
  category: TournamentCategory;
  status: TournamentEntryStatus;
  /** The rank frozen at the lock (own entry only; never shown to others). */
  lockedRank?: { tier: RankTier; division: RankDivision };
  groupId?: string;
  voidReason?: string;
  joinedAt: string;
}

/** `GET /tournaments`: what can be joined now, and the member's own entries. */
export interface TournamentOverview {
  /** The season open for enrolment now, if any. */
  enrollable?: SeasonView;
  entries: TournamentEntry[];
  consentVersion: number;
  retentionMonths: number;
}

/** One member as the rest of their group sees them: public identity only. */
export interface TournamentGroupMember {
  /** Absent when the viewer and this member have blocked one another: shown as "A member". */
  userId?: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  self: boolean;
}

/** `GET /tournaments/groups/:id`: members of the viewer's own group only. */
export interface TournamentGroupView {
  id: string;
  exerciseId: string;
  exerciseName: string;
  season: SeasonView;
  category: TournamentCategory;
  /** e.g. "Veteran II" or "Achiever III – Veteran I". */
  rankRange: string;
  members: TournamentGroupMember[];
  /** Always null until scoring is approved; the UI says standings come later. */
  standings: null;
}

/** `POST /tournaments/entries`. */
export interface JoinTournamentRequest {
  exerciseId: string;
  season: string;
  category: TournamentCategory;
  /** Must equal `TOURNAMENT_CONSENT_VERSION`: the member agreed to that disclosure. */
  consentVersion: number;
}
