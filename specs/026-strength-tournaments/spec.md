# Feature Specification: Monthly strength tournaments

**Feature Branch**: `claude/issue-12`

**Created**: 2026-11-13

**Status**: Draft — proposed rules awaiting owner review on issue #12

**Input**: Issue #12, "Build opt-in monthly Journey strength tournaments" (owner-approved
direction), built on the exercise strength ranks of #5b (`docs/modules/training.md`,
"Strength ranks").

## Status of this spec

Only the **season calendar** and **matchmaking** are built
(`libs/shared/domain/src/lib/tournaments.ts`, pure and tested). They depend only on the defaults
in Q1–Q2. Everything stored, scored or shown to another member waits for the owner's answers to
the questions on #12, mirrored in "Open questions" below. All rollout is behind a `tournaments`
feature flag (internal on, production off), added with the first API slice.

## User Scenarios & Testing

### User Story 1 — Join next month's tournament for a lift (P1)

A member with a current rank on an exercise opens its statistics and sees "Join December's
tournament". Before joining, they see exactly what other entrants will see about them. They join,
and they can withdraw any time.

**Acceptance Scenarios**:
1. **Given** a current rank on bench press and December enrolment open (20 Nov 00:00 – 1 Dec
   00:00, Tbilisi), **When** they join, **Then** they are entered for December with their rank and
   baseline snapshotted at the 1 December lock.
2. **Given** an inactive or unranked exercise, **Then** joining is unavailable, with the reason.
3. **Given** it is 5 December, **Then** the only offer is January, from 20 December.

### User Story 2 — See my group during the month (P1)

After the lock, an entrant sees their group: its rank range, its size, their place, their score,
and the days left. No kilograms, reps, body weight, standards or workouts of anyone else are shown.

**Acceptance Scenarios**:
1. **Given** 2 entrants for an exercise, **Then** neither has a tournament this month, and both
   are told so honestly. Nobody is invented to fill the group.
2. **Given** a division with 1 entrant and the next division up with 4, **Then** they share a
   group labelled with the range, e.g. "Achiever III – Veteran III".
3. **Given** two members who blocked each other in one group, **Then** each sees the other only
   as "A member".

### User Story 3 — Results (P2)

When the grace period ends, the standings freeze. The entrant sees their final place, and their
past results for 12 months.

## Rules

### Season lifecycle (built)
- **Clock.** Asia/Tbilisi, UTC+4, with no daylight saving (`SEASON_UTC_OFFSET_HOURS`). A season
  is a calendar month, `YYYY-MM`.
- **Which sets belong to a season.** A set belongs to the season its workout's `day` falls in.
  That day is the member's own, decided in the browser as for every workout.
- **Phases.**
  - `upcoming`;
  - `enrolling`: from 00:00 on the 20th of the month before;
  - `running`: from 00:00 on the 1st, when enrolment locks;
  - `grace`: from 00:00 after the last day, for 3 days (`SEASON_GRACE_DAYS`);
  - `final`.
- **No late entries.** Between the 1st and the 20th there is nothing to join
  (`enrollableSeason`).
- **Counting.** A set counts if it is dated in the month **and was saved before finalisation**
  (`countsForSeason`). A backfill after the fact never changes final standings.

### Matchmaking (built)
- **Who can enter.** You need a current rank on that exercise at lock, which means a valid set
  in the last 90 days.
- **Snapshot at lock.** Your entry snapshots your milestone and rank score at lock. Ranking up
  during the season never moves you.
- **Grouping** (`matchEntrants`):
  - Each division starts as its own bracket.
  - Walking up from the lowest, a bracket under 3 entrants (`TOURNAMENT_MIN_GROUP`) absorbs the
    next one up until it has at least 3.
  - A short bracket left at the top joins the group below it.
  - A bracket over 100 (`TOURNAMENT_MAX_GROUP`) is split, in score order, into the fewest
    equal groups.
  - An exercise with fewer than 3 entrants in total runs no tournament that month.
  - The result is deterministic.
- **Mixed standards.** Groups mix men's and women's standards. A milestone is already normalised
  to each member's own standards, and splitting would disclose the choice to the whole group.

### Scoring (proposed, not built — Q3)
- **Baseline.** The rank score at lock: the best valid set in the 90 days before.
- **Score.** The improvement of the best valid in-season set over the baseline, as a
  percentage, capped at +15%.
- **Tie-break.** Weeks of the month with at least one valid set of that exercise (at most 4).
  If still tied, the place is shared.
- **Not scored.** No points for total weight, sets or workouts.
- **Which sets are valid.** The same rules as ranks: no warm-ups, no machine sets, a fresh
  weigh-in, and the implausibility cap.

### Visibility and privacy (proposed, not built — Q4, Q5)
- **What group members see of you:**
  - display name, username and avatar;
  - your place and score;
  - the group's rank range.

  Nothing else: no loads, reps, body weight, standards, dates or workouts. Nothing is public or
  on your profile.
- **Joining is narrow consent.** It is consent to exactly that, for that season, and to nothing
  else (no model training, no other use).
- **Withdrawal.** Allowed any time: you leave the board at once and places are recomputed.
  Deleting training history or the account removes your entries.
- **Retention.** Final standings are kept 12 months.

### Integrity (proposed — Q6)
- Rank rules apply to every set.
- Edits and deletions count until grace ends; after that, results are frozen.
- The developer can void an entry with a reason, and places are recomputed.
- No appeals flow in v1.
- No prizes are offered or implied.

### Storage (proposed)
- Three new collections:
  - `tournament_entries`: user, exercise, season, and the snapshot at lock;
  - `tournament_groups`;
  - `tournament_results`: standings frozen at finalisation.
- **A deliberate exception to "derived never persisted".** The snapshots exist so that a
  finished competition is never rewritten by a later edit or a benchmark change. The same
  reasoning applies as for `meal_entries.facts`.
- Live standings during a season are derived on read.

## Open questions (issue #12)
1. Calendar, time zone, enrolment window, grace.
2. Matching rules: minimum 3, widening, no late entries.
3. Scoring: improvement % capped at 15%, or absolute score within the group.
4. Visible fields, blocks, and whether a social profile is required.
5. Withdrawal, deletion and the 12-month retention.
6. Integrity and voiding.
7. Notifications: enrolment open, group set, results in.

## Out of scope
Prizes or rewards of any kind; public leaderboards; population calibration of ranks; weekly
contests.
