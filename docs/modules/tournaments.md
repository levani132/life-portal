# Strength tournaments (issue #12)

Opt-in monthly competitions on one exercise, among members at a similar **current** strength rank
([training](training.md), "Strength ranks"). Spec, owner decisions and open questions:
[specs/026-strength-tournaments](../../specs/026-strength-tournaments/spec.md).

Scoring is the owner's approved formula (#12, 2026-11-13T11:53Z): absolute strength first, with
an improvement bonus of at most 5%. Production stays off and #12 stays open until review.

## Gates

Feature flag **`tournaments`**: on for internal and developer accounts, off in production by
default. Every route also needs `training`, `trainingRanks` and `social`, because group members see
each other's names.

## Calendar (owner: UTC)

`libs/shared/domain/src/lib/tournaments.ts`, pure, with `now` always an argument.
- **Clock.** A season is a calendar month, `YYYY-MM`, and every boundary is a **UTC** instant. The
  web shows those instants in the member's own time zone.
- **Which sets belong to a season.** A set belongs to the season its workout's `day` falls in;
  that day is the member's own, as for every workout.
- **Phases:**

  | Phase | From (UTC) |
  |---|---|
  | `upcoming` | – |
  | `enrolling` | 00:00 on the 20th of the month before |
  | `running` | 00:00 on the 1st; enrolment locks here |
  | `grace` | 00:00 on the 1st of the next month |
  | `final` | 00:00 on the 4th of the next month |

- **Grace cutoff.** Exactly 00:00:00 UTC on the 4th of the next month (`finalizesAt`). A set
  *saved* before it counts; one saved at or after it never does (`countsForSeason`).
- **No late entries.** Between the 1st and the 20th there is nothing to join
  (`enrollableSeason`).

## Matching

- **Joining needs a current rank.** You need a current rank on that exercise *when you join*:
  a member who is unranked can log a valid set during enrolment and then join.
- **The lock.** At the lock, each entrant's rank is recomputed as it stood then: `today` is the
  last day of the previous month, and only sets with `loggedAt` before the lock instant count.
  The rank uses the **category's** standards (`TrainingRankService.rankFor`). Entrants with no
  current rank then get `not_ranked`.
- **Grouping.** `matchEntrants` groups each exercise and category separately:
  - every division starts as its own bracket;
  - a bracket with fewer than 3 widens upward, and the group shows its range;
  - a bracket over 100 is split evenly, in score order;
  - fewer than 3 entrants in total means no tournament (`no_tournament`).
  - Nobody is ever invented.
- **The snapshot is frozen.** Groups and each entry's frozen rank (`lockedMilestone`,
  `lockedScore`, `lockedVersion`) are written once. A later rank change, edit or benchmark change
  never reshuffles them.
- **When groups are formed.** By the hourly job, or lazily by the first read after the lock. A
  unique `tournament_locks` row makes it happen once; a claim older than two minutes without
  `formedAt` is taken over.
- **Variants never mix.** Each tournament is one catalogue exercise (one `seedKey`), so
  variants and machines are never compared with each other. A machine exercise with its own
  standard can have its own tournament.

## Scoring (owner-approved)

`libs/shared/domain/src/lib/tournament-scoring.ts`, pure and tested:

```
improvement      = max(0, best / baseline − 1)
improvementBonus = min(5%, improvement / 15% × 5%)     linear to +15%, then capped
tournamentScore  = best × (1 + improvementBonus)
```

- **`best`.** The season's best valid **strength** score (`bestStrength`): the rank's normalised
  one-rep-max score (or reps for a reps standard) of the best workout. It never includes the
  rank's work-capacity bonus, and there are no points for workouts, sets or volume.
  - **Which sets count.** Sets dated in the season's month, in finished workouts, saved before
    `finalizesAt`. They are scored by the rank rules: no warm-ups, no machine sets on a
    free-weight standard, a fresh weigh-in, and implausible sets left out.
- **`baseline`.** The same measure over the 90 days before the lock (`scoringWindows`), counting
  only sets saved before the lock instant. It is frozen into `lockedBaseline` at the lock. A
  current rank implies a baseline; without both the entry is `not_ranked`, and no improvement is
  ever invented.
- **Rounding and examples.** Improvement and bonus are whole basis points, rounded **down**, so
  rounding never grants a bonus. The score is rounded to a whole rank-score unit (0.001× body
  weight). Examples: +3% gives +1%; +15% or more gives +5%; getting weaker gives no penalty and no
  bonus.
- **Standards.** One scoring standard per season, copied at the lock (#5). Each entry stores
  `lockedStandard` (version, method, measure, both categories' tier starts, machine) next to
  `lockedVersion`; every entry of a lock gets the same version, because they all rank on the day
  before the season. The baseline and every later score use that copy (`tournamentStandard`), and
  sets are read under its measure, so a new version or a catalogue measure change never switches a
  season mid-way. Only an entry locked before copies were kept (none exist: the flag has been off)
  falls back to its version name, with `v1-rc1` read as `v1`; if that version is gone, the current
  one scores and the bonus is **withheld** (`bonusWithheld: 'standards_changed'`).
- **Places.** Descending tournament score within the group (`placeStandings`). Exactly equal
  scores share a place (1, 1, 3), with no tie-break by volume or workouts. A member without a
  valid set this season has no score and no place, and is listed last.
- **Live, then frozen.** During the month and grace, standings are computed on read. At
  `finalizesAt` the group's `results` are written once, by a conditional update from the first
  read or the hourly job, and members get "results ready". Places are always derived from the
  stored scores of the members still in the group, so a withdrawal or voiding after the results
  still takes effect.
- **Edits and deletions.**
  - Before the lock, they shape the baseline.
  - After the lock, they never move it: it is frozen, and a backdated set saved later is outside
    both windows.
  - During the season and grace, editing or deleting a season set changes the live score.
  - After `finalizesAt`, nothing changes.
  - Tested in `tournaments.service.spec.ts`.

## Categories and consent

- **Separate competitions.** Men's and women's competitions are separate, matching the separate
  standards.
- **Chosen at join.** The member chooses the category explicitly when joining; nothing is
  preselected. It must equal the standards their rank uses, or the join is refused with a reason.
  So a private setting is never silently turned into a disclosed category.
- **Before agreeing**, the join screen shows:
  - what group members see;
  - what they never see;
  - the lock, month and grace times in local time;
  - the 12-month retention and withdrawal;
  - how the score is worked out;
  - that logs are self-reported;
  - that there are no prizes.
- **Recorded consent.** The entry records `consentVersion` (`TOURNAMENT_CONSENT_VERSION`). A
  change to what joining discloses bumps it, and an old version is refused.

## Privacy

- **What a group member sees of another:** display name, username, photo, the group's rank range,
  the category, the place and the tournament score. Never kilograms, reps, body weight, the
  baseline or the improvement, dates or workouts. The API response carries nothing else (tested
  by key set). Only the viewer gets their own breakdown (`own`).
- **Only the group.** Only members of the group see it. Anyone else, including a withdrawn or
  voided member, gets a 404. Nothing is public or on a profile.
- **Blocks hide identity.** A pair who blocked one another, in either direction, see each other
  only as "A member".
- **Order.** By place; equal places, and members without a score, are in name order.
- **No caching.** Responses are `private, no-store`.

## Collections

| Collection | Holds |
|---|---|
| `tournament_entries` | userId, exerciseId, season, category, consentVersion; at the lock `outcome` (`grouped`/`no_tournament`/`not_ranked`), `groupId`, the frozen rank, `lockedBaseline` and `lockedStandard`; `voidedAt`/`voidReason`. Unique per user, exercise and season |
| `tournament_groups` | season, exercise, category, index, milestone range, `memberIds`; after grace `finalizedAt` and `results` (each member's frozen score breakdown) |
| `tournament_locks` | who is forming one exercise-and-category's groups, and when it finished |

**Retention.** Every row carries `expireAt`: 12 months after the season's `finalizesAt`. A TTL
index deletes it.

**Why stored.** Entries are the member's own choice. Groups, the frozen rank and baseline, and the
final results are deliberate snapshots, the second exception to "derived never persisted" after
`meal_entries.facts`: a finished or running competition must not be rewritten by a later edit or
benchmark change. Live standings are not stored.

## API (`/api/tournaments`, `private, no-store`)

| Route | Notes |
|---|---|
| `GET /` | The month open for enrolment (if any) and the member's own entries with their status, and `result` (place of size) once final. Forms due groups and freezes due results lazily |
| `POST /entries` | `{exerciseId, season, category, consentVersion}`. 400 outside enrolment, on an old consent version, a category that doesn't match the rank's standards, no social profile, no benchmark or no current rank. 409 if already entered |
| `DELETE /entries/:id` | Withdraw, own entry only, any time: the entry is deleted and the member leaves the group at once |
| `POST /entries/:id/void` | Developer only, `{reason}`. The member sees the reason; the group no longer shows them |
| `GET /groups/:id` | Own group only, otherwise 404. `standings` (identity, place, score), `final`, `method`, and `own` (the viewer's breakdown) |

## Integrity

- **Which sets count.** The rank rules decide: valid sets only, implausible sets excluded,
  machine sets only for machine standards, and a fresh weigh-in.
- **Frozen at the deadline.** Sets saved after grace never count, and results are frozen at
  `finalizesAt`.
- **Logs are self-reported,** and the join screen says so.
- **Voiding.** The developer can void an entry with a reason. In v1 an appeal is a message to the
  owner.
- **No prizes,** offered or implied.

## Notifications

Three personal reminders, sent with `remind()`, only to members who entered, and subject to their
preferences. The lock-screen text is generic.

| Type | When |
|---|---|
| `tournamentEnrollmentOpen` | 00:10 UTC on the 20th, to members with any entry still within retention |
| `tournamentGroupAssigned` | When groups are formed, to members who got a group |
| `tournamentResultsReady` | When a group's results are frozen, to its members, once |

No per-set, rank-change or position notifications exist.

## Deletion

There is no account-deletion feature yet. When one is added, it must delete the member's
`tournament_entries` and remove them from `tournament_groups.memberIds`, exactly as withdrawal
does. Deleting workouts is covered under Scoring, "Edits and deletions".

## Open (flagged to the owner on #12)

- **Machines.** Different machines logged against one machine exercise are compared in one
  tournament.
- **Production rollout.** It stays off until review.
