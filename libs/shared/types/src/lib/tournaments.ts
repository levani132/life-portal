import type { RankDivision, RankMethod, RankTier } from './training';

/**
 * Monthly strength tournaments (issue #12), behind `tournaments`. Contracts only. Scoring follows
 * the owner's formula (docs/modules/tournaments.md): the season's best strength score, raised by
 * an improvement bonus of at most 5% over a baseline frozen at the lock.
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
 * - `not_eligible`: the exercise has no tournament (a machine or cable standard: machines are not
 *   comparable between members). Only an entry made before that rule can reach it.
 * - `voided`: removed by the developer, with a reason.
 * - `forming`: the lock has passed and groups are being formed.
 */
export type TournamentEntryStatus = 'entered' | 'forming' | 'grouped' | 'no_tournament' | 'not_ranked' | 'not_eligible' | 'voided';

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
  /** Once the season's results are final: the member's place (absent with no valid set) of `of`. */
  result?: { place?: number; of: number; score?: number };
}

/** `GET /tournaments`: what can be joined now, and the member's own entries. */
export interface TournamentOverview {
  /** The season open for enrolment now, if any. */
  enrollable?: SeasonView;
  entries: TournamentEntry[];
  consentVersion: number;
  retentionMonths: number;
}

/** One member as the rest of their group sees them: public identity, place and score only. */
export interface TournamentStanding {
  /** Absent when the viewer and this member have blocked one another: shown as "A member". */
  userId?: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  self: boolean;
  /** Shared by exact ties; absent with no valid set this season. */
  place?: number;
  /** The tournament score, in rank-score units (see `method`). */
  score?: number;
}

/** How the viewer's own score was worked out. Never shown for anyone else. */
export interface TournamentScoreView {
  score: number;
  /** The season's best valid strength score, without the rank's work-capacity bonus. */
  strengthScore: number;
  /** The best strength score of the 90 days before the lock, frozen then. */
  baseline: number;
  /** Basis points, never negative. */
  improvementBp: number;
  /** Basis points, 0–500. */
  bonusBp: number;
  /** The bonus was withheld because the standards changed after the lock. */
  bonusWithheld?: 'standards_changed';
  /** The day of the workout the best set came from. */
  day: string;
}

/** `GET /tournaments/groups/:id`: the viewer's own group only. */
export interface TournamentGroupView {
  id: string;
  exerciseId: string;
  exerciseName: string;
  season: SeasonView;
  category: TournamentCategory;
  /** e.g. "Veteran II" or "Achiever III – Veteran I". */
  rankRange: string;
  /** How scores read: × body weight (`e1rm`) or reps. From the standard frozen at the lock. */
  method: RankMethod;
  /** The standards version the season is scored under, frozen at the lock (e.g. `v1`). */
  standardsVersion?: string;
  /** Live until grace ends, then frozen. Ordered by place; members without a score last. */
  standings: TournamentStanding[];
  final: boolean;
  /** The viewer's own breakdown, when they have a valid set this season. */
  own?: TournamentScoreView;
}

/** `POST /tournaments/entries`. */
export interface JoinTournamentRequest {
  exerciseId: string;
  season: string;
  category: TournamentCategory;
  /** Must equal `TOURNAMENT_CONSENT_VERSION`: the member agreed to that disclosure. */
  consentVersion: number;
}
