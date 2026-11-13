# Strength tournaments (issue #12)

Opt-in monthly competitions on one exercise, among members at a similar **current** strength rank
([training](training.md), "Strength ranks"). Spec, owner decisions and open questions:
[specs/026-strength-tournaments](../../specs/026-strength-tournaments/spec.md).

**Scoring is not built.** The owner has not approved how members are scored, ordered or tied
(#12, 2026-11-13). Nothing in this module computes a score, a position, a result or a tie-break,
and the results reminder is registered but never sent. A group lists who is in it and says
standings come later.

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
  - that logs are self-reported;
  - that there are no prizes.
- **Recorded consent.** The entry records `consentVersion` (`TOURNAMENT_CONSENT_VERSION`). A
  change to what joining discloses bumps it, and an old version is refused.

## Privacy

- **What a group member sees of another:** display name, username, photo, the group's rank range,
  the category, and later the place and tournament score. Never kilograms, reps, body weight,
  standards beyond the category, dates or workouts. The API response carries nothing else
  (tested by key set).
- **Only the group.** Only members of the group see it. Anyone else, including a withdrawn or
  voided member, gets a 404. Nothing is public or on a profile.
- **Blocks hide identity.** A pair who blocked one another, in either direction, see each other
  only as "A member".
- **No implied order.** Members are listed self first, then by name, so no order looks like a
  standing.
- **No caching.** Responses are `private, no-store`.

## Collections

| Collection | Holds |
|---|---|
| `tournament_entries` | userId, exerciseId, season, category, consentVersion; at the lock `outcome` (`grouped`/`no_tournament`/`not_ranked`), `groupId` and the frozen rank; `voidedAt`/`voidReason`. Unique per user, exercise and season |
| `tournament_groups` | season, exercise, category, index, milestone range, `memberIds` |
| `tournament_locks` | who is forming one exercise-and-category's groups, and when it finished |

**Retention.** Every row carries `expireAt`: 12 months after the season's `finalizesAt`. A TTL
index deletes it.

**Why stored.** Entries are the member's own choice. Groups and the frozen rank are a deliberate
snapshot, the second exception to "derived never persisted" after `meal_entries.facts`: a
finished or running competition must not be rewritten by a later edit or benchmark change.

## API (`/api/tournaments`, `private, no-store`)

| Route | Notes |
|---|---|
| `GET /` | The month open for enrolment (if any) and the member's own entries with their status. Forms due groups lazily |
| `POST /entries` | `{exerciseId, season, category, consentVersion}`. 400 outside enrolment, on an old consent version, a category that doesn't match the rank's standards, no social profile, no benchmark or no current rank. 409 if already entered |
| `DELETE /entries/:id` | Withdraw, own entry only, any time: the entry is deleted and the member leaves the group at once |
| `POST /entries/:id/void` | Developer only, `{reason}`. The member sees the reason; the group no longer shows them |
| `GET /groups/:id` | Own group only, otherwise 404. `standings` is always `null` |

## Integrity

- **Which sets count.** The rank rules decide: valid sets only, implausible sets excluded,
  machine sets only for machine standards, and a fresh weigh-in.
- **Frozen at the deadline.** Sets saved after grace never count, and results will be frozen at
  `finalizesAt`. That freezing is part of scoring, so it is not built.
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
| `tournamentResultsReady` | Registered, **never sent** until scoring exists |

No per-set, rank-change or position notifications exist.

## Deletion

There is no account-deletion feature yet. When one is added, it must delete the member's
`tournament_entries` and remove them from `tournament_groups.memberIds`, exactly as withdrawal
does. Deleting a workout changes nothing here before the lock. After the lock the frozen rank
stands; how deleted sets affect scoring will be decided with scoring.

## Not built (waiting on the owner)

- **Scoring:** the score, positions, tie-breaks, final results, the results reminder and
  results history. The frozen `lockedScore` keeps an improvement-based option open.
- **Production rollout.**
