# Feature Specification: Monthly strength tournaments

**Feature Branch**: `claude/issue-12`

**Created**: 2026-11-13

**Status**: Approved, scoring included (owner, #12, 2026-11-13T11:44Z and 11:53Z). Built behind `tournaments`; production rollout waits on review.

**Input**: Issue #12, "Build opt-in monthly Journey strength tournaments" (owner-approved
direction), built on the exercise strength ranks of #5b (`docs/modules/training.md`,
"Strength ranks").

## Status of this spec

Built behind the `tournaments` flag (internal on, production off): the UTC season calendar,
matchmaking, entries with category and consent, the lock snapshot (rank and baseline) and groups,
scoring, live standings, results frozen after grace, withdrawal, developer voiding, retention and
the three reminders. See `docs/modules/tournaments.md`. Production rollout waits on review.

## User Scenarios & Testing

### User Story 1 — Join next month's tournament for a lift (P1)

A member with a current rank on an exercise opens its statistics and sees "Join December's
tournament". Before joining, they see exactly what other entrants will see about them. They join,
and they can withdraw any time.

**Acceptance Scenarios**:
1. **Given** a current rank on bench press and December enrolment open (20 Nov 00:00 – 1 Dec
   00:00 UTC), **When** they join, **Then** they are entered for December with their rank and
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
- **Clock.** UTC is canonical (owner). Every boundary is a UTC instant, shown to the member in
  their local time. A season is a calendar month, `YYYY-MM`.
- **Which sets belong to a season.** A set belongs to the season its workout's `day` falls in.
  That day is the member's own, decided in the browser as for every workout.
- **Phases.**
  - `upcoming`;
  - `enrolling`: from 00:00 on the 20th of the month before;
  - `running`: from 00:00 on the 1st, when enrolment locks;
  - `grace`: from 00:00 after the last day, for 3 days (`SEASON_GRACE_DAYS`), ending exactly at
    00:00:00 UTC on the 4th of the next month;
  - `final`.
- **No late entries.** Between the 1st and the 20th there is nothing to join
  (`enrollableSeason`).
- **Counting.** A set counts if it is dated in the month **and was saved before finalisation**
  (`countsForSeason`). A backfill after the fact never changes final standings.

### Matchmaking (built)
- **Exercises.** Any exercise with a benchmark, machines included when they have their own
  standards (owner, #12). One tournament is one catalogue exercise, so incompatible variants are
  never compared.
- **Who can enter.** You need a current rank to join; someone unranked can establish one during
  enrolment. At lock the rank is recomputed from sets saved before the lock; no current rank
  then means `not_ranked`, with an explanation.
- **Snapshot at lock.** Your entry snapshots your milestone, rank score, scoring baseline and
  benchmark version at lock. Ranking up
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
- **Categories (owner).** Men's and women's tournaments are separate. The member selects the
  category explicitly when joining, after being told group members will see it. It must match
  the standards their rank uses, so the private setting is never disclosed silently.
- **Fewer than 3.** No tournament, and the member is told why.

### Scoring (owner-approved, built)
- **Score.** `best × (1 + min(5%, improvement / 15% × 5%))`, with
  `improvement = max(0, best / baseline − 1)`. `best` is the season's best valid strength score,
  without the work-capacity bonus.
- **Baseline.** The best valid strength score of the 90 days before the lock, frozen then.
- **Ties.** Exact ties share the place; there is no tie-break.
- **Not scored.** No points for total weight, sets or workouts.
- **Which sets are valid.** The same rules as ranks: no warm-ups, no machine sets on a
  free-weight standard, a fresh weigh-in, and the implausibility cap.

### Visibility and privacy (approved, built)
- **What group members see of you:**
  - display name, username and avatar;
  - your place and score;
  - the group's rank range and the category.

  Nothing else: no loads, reps, body weight, standards, dates or workouts. Nothing is public or
  on your profile.
- **Joining is narrow consent.** It is consent to exactly that, for that season, and to nothing
  else (no model training, no other use).
- **Blocks.** Two members who blocked one another see each other only as "A member".
- **Withdrawal.** Immediate, any time: the entry is deleted and you leave the group at once.
  Account deletion removes your rows (there is no account deletion yet; see the module doc).
- **Retention.** At most 12 months after the season finalises, by TTL; the rules are shown
  before opt-in.

### Integrity (approved)
- Rank rules apply to every set.
- Edits and deletions count until grace ends; after that, results are frozen.
- The developer can void an entry with a reason; the member sees it.
- Self-report limits are stated before joining. No appeals flow in v1.
- No prizes are offered or implied.

### Storage (built, except results)
- Three new collections:
  - `tournament_entries`: user, exercise, season, category, consent version, and the snapshot
    at lock;
  - `tournament_groups`;
  - `tournament_locks`: makes group formation happen once;
  - results: frozen on the group (`results`, `finalizedAt`) once grace ends.
- **A deliberate exception to "derived never persisted".** The snapshots exist so that a
  finished competition is never rewritten by a later edit or a benchmark change. The same
  reasoning applies as for `meal_entries.facts`.
- Live standings during a season are derived on read.

## Open questions (issue #12)
Answered by the owner on 2026-11-13: calendar (UTC), matching, privacy and categories,
withdrawal and retention, integrity, notifications (enrolment open, group assigned, results
ready, opted-in members only), and scoring (absolute strength with a capped 5% improvement
bonus, shared ties). Still open:
1. Production rollout.
2. Flagged with the scoring build: different machines on one machine exercise share a
   tournament.
