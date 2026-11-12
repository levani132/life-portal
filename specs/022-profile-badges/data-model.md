# Data model: Profile badges

Calendar days are `YYYY-MM-DD` strings. `createdAt` and `updatedAt` come from
`baseSchemaOptions`.

## Catalogue: `BADGE_CATALOGUE` (shared types, not stored)

```ts
type BadgeFamily = 'standard' | 'food' | 'training';
type BadgeId =
  | 'setup' | 'firstPost' | 'firstFriend' | 'connected' | 'earlyMember'
  | 'loggingStreak' | 'onTargetStreak' | 'daysOnTarget'
  | 'firstWorkout' | 'workouts' | 'consistency';

interface BadgeDefinition {
  id: BadgeId;
  family: BadgeFamily;
  name: string;            // "Logging streak"
  description: string;     // "Food logged {tier} days in a row" ({tier} filled per tier)
  unit?: 'days' | 'weeks' | 'workouts' | 'friends'; // for progress copy
  tiers: number[];         // thresholds ascending; [1] for an untiered badge
  requires: FeatureId[];   // always includes 'social'
  icon: string;            // web maps the key to a lucide icon
}
```

| id | family | tiers | requires (besides social) | rule |
|---|---|---|---|---|
| `setup` | standard | [1] | none | Portal `setupCompleted` is true |
| `firstPost` | standard | [1] | foodPosts | at least one original, non-deleted post (`repostOf` absent, `deleted: false`) |
| `firstFriend` | standard | [1] | none | at least one accepted, unblocked connection |
| `connected` | standard | [10] | none | at least 10 such connections |
| `earlyMember` | standard | [1] | none | `users.createdAt` before `EARLY_MEMBER_CUTOFF` (null means everyone qualifies) |
| `loggingStreak` | food | [7, 30, 100, 365] | nutrition | consecutive food days with at least one meal entry |
| `onTargetStreak` | food | [7, 30] | nutrition | consecutive on-target days, with cheat weekdays skipped |
| `daysOnTarget` | food | [30, 100, 365] | nutrition | total on-target days |
| `firstWorkout` | training | [1] | training | at least one `workout_sessions` row with `status: 'finished'` |
| `workouts` | training | [10, 50, 100, 250] | training | number of finished sessions |
| `consistency` | training | [4, 12, 26, 52] | training | consecutive Monday-start weeks with at least 2 finished sessions |

The catalogue can only grow. Removing a badge id would orphan awards, so ids are never reused.

## Collection: `badge_awards`

The one persisted fact: a person reached a tier. Rows are immutable once inserted.

| Field | Type | Rule |
|---|---|---|
| `userId` | ObjectId | required, indexed |
| `badgeId` | string | required; any id, so challenge badges need no schema change |
| `tier` | number | required; the threshold reached (`1` for untiered badges) |
| `earnedOn` | day string | required; see research R7 |
| `source` | `'rule' \| 'challenge'` | required; `'rule'` in v1 |
| `sourceId` | string? | a future challenge id; no default |
| `createdAt` | Date | the moment it was awarded |

- **Indexes.** `{userId: 1, badgeId: 1, tier: 1}` is unique: it gives idempotency and makes
  concurrent awards safe. `{userId: 1, createdAt: -1}` serves the Activity source.
- **Write.** Upsert with `$setOnInsert` only. Never `$set`, never deleted, and there is no
  `PATCH`.
- **Account deletion.** There is no account-deletion path yet. When one is added, it must
  remove these rows too.

## Collection: `badge_selections`

| Field | Type | Rule |
|---|---|---|
| `userId` | ObjectId | unique |
| `equipped` | string[] | 0–3 distinct badge ids, in display order |

- **Write.** `PUT` replaces the whole array, with `upsert`. The tier is not stored: an equipped
  badge always shows the highest earned tier (FR-012).
- **Read filter.** Ids that are no longer earned or accessible are dropped on read, not
  rewritten.

## Pure rules: `libs/shared/domain/src/lib/badges.ts`

All take `today` explicitly. None of them read a clock.

```ts
interface TierReached { tier: number; reachedOn: string }
interface BadgeEvaluation {
  badgeId: BadgeId;
  reached: TierReached[];                       // every tier currently reached in history
  progress?: { current: number; next: number }; // toward the lowest unreached tier
}

loggingStreak(days: string[], today: string): { current: number; runs: {start, end}[] }
onTargetDays(rows: {day, eatenKcal, targetKcal?}[], cheatWeekdays: number[], today: string)
  : { streak: number; total: number; streakRuns; totalReachedOn: (n) => string | undefined }
weeklyConsistency(finishedDays: string[], today: string, minPerWeek = 2)
  : { current: number; runs }
countMilestones(datedEvents: string[], tiers: number[]): TierReached[]
evaluateBadges(input: BadgeInputs, today: string): BadgeEvaluation[]
```

**Rules every test must cover:**
- **The current day or week never breaks a run.**
  - A streak counts through yesterday, plus today if today qualifies.
  - The week containing `today` extends a consistency run if it already has 2 sessions.
    Otherwise it is ignored rather than counted as a miss.
- **Missing data neither counts nor qualifies.** A day without entries breaks the logging
  streak. A day without a target breaks the on-target streak and is not counted.
- **Cheat days are skipped.** A cheat weekday is skipped in on-target streaks: a run continues
  across it whether or not it was logged or on target. It is still counted as an ordinary day
  in the total and in the logging streak.
- **Tiers are reached in history order.** A tier counts as reached if any historical run hit
  it, not just the current one. `reachedOn` is the day that run reached the tier, taking the
  earliest such run.
- **The ±10% rule:** `|eaten − target| * 10 <= target`, in integers.

## Response shapes (shared types)

```ts
interface BadgeView {                 // owner's own collection
  badgeId: BadgeId;
  tier?: number;                      // highest earned tier, absent if locked
  earnedOn?: string;
  tiersEarned: { tier: number; earnedOn: string }[];
  progress?: { current: number; next: number };   // owner only
  isNew?: boolean;                    // created by this evaluation
}
interface MyBadges { badges: BadgeView[]; equipped: BadgeId[] }

interface PublicBadge { badgeId: BadgeId; tier: number; earnedOn: string }
interface PersonBadges { equipped: PublicBadge[] }
```
