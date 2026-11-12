# Research: Profile badges

Decisions R1–R10. Each says what was chosen, why, and what was rejected. File references are to
the code as of `main` at 4c12cc0.

## R1 A platform module, not a widget

**Decision.** A new `BadgesModule` (`apps/api/src/badges/`) owns badge awards and equip choices.
It has no Home card and no route of its own. Its UI lives on the profile, which `SocialModule`
already owns.

**Rationale.** Badges summarise other modules. A Home card would be a second dashboard of the
same facts, and a route of its own would be one more place to look. Notifications and Access are
the precedent for platform modules without a card.

**Alternatives.**
- Fields on `social_profiles`: rejected, because it makes SocialModule depend on Nutrition,
  Training and Posts for evaluation.
- Per-module badge code (Nutrition owns food badges): rejected, because equipping and showing
  are one concern, and a challenge source later would have no home.

## R2 Badges have their own endpoint, not a field on the profile response

**Decision.** The profile page fetches `GET /api/badges/people/:userId` alongside
`/social/profiles/:userId`. The badges endpoint repeats the profile's gate: the viewer and the
target have `social`, and neither has blocked the other (`SocialGraphService`).

**Rationale.** `PostsModule` imports `SocialModule` (`posts.module.ts:226`), and badges must read
posts. Embedding badges in `SocialService.profile()` would make
Social → Badges → Posts → Social a cycle. `forwardRef` would hide it rather than remove it. The
second request runs in parallel, so the profile is no slower (SC-006).

**Alternatives.**
- `forwardRef` or `ModuleRef` lookups: rejected as above.
- Moving post counting into SocialGraph: wrong owner.

## R3 What is stored: the award and the selection, nothing else

**Decision.** There are two collections:
- `badge_awards`: one immutable row per person, badge and tier.
- `badge_selections`: one row per person with the ordered equipped ids.

Progress, streak lengths and "on target" days are computed on every evaluation and never stored.

**Rationale.** Principle III. An award is a **fact about a moment** ("on 3 Dec this person had
logged 30 days in a row"), in the same way a published post is. It is not a cache of a live
value: nothing recomputes it, and later edits must not move it (FR-005). The code proves it is
necessary: unfriending sets `state: 'none'` and unsets `acceptedAt`
(`social-graph.module.ts:195-219`), so "had a first friend" cannot be derived afterwards.

**Alternatives.**
- Fully derived with no awards: rejected. Deleting meals or unfriending would revoke badges,
  breaking FR-005 and SC-005.
- Storing current streaks: rejected. That is a derived value (principle III).

## R4 Evaluation is triggered by reads and by the browser, with no event bus

**Decision.** `BadgesService.evaluate(userId, today)` runs:
1. on `GET /api/badges/me` (opening the collection or the own profile), and
2. on `POST /api/badges/check?today=`, which the web fires (unawaited, at most once per 30 s per
   tab) after a successful meal log, workout finish, post publish or friend accept, and once on
   app start.

It returns the awards it created.

**Rationale.**
- The codebase has no event emitter (no `@nestjs/event-emitter`, no `@OnEvent`), and the
  modules that act (Nutrition, Training, Posts, SocialGraph) must not import Badges (R2).
- The free tier forbids an always-on worker.
- The browser already decides "today" (`dayStartHour`). Meals logged through MCP or a Shortcut
  are picked up on the next app start, which still meets SC-002 ("or the next time the person
  opens their profile").

**Alternatives.**
- Adding `@nestjs/event-emitter`: rejected. It is a new dependency and a new pattern for one
  consumer, and the acting services would still need `today`.
- Evaluating on every portal read: rejected. It doubles the cost of the most frequent request.

## R5 Evaluation cost and idempotency

**Decision.**
- **Reads.** Evaluation loads only what it needs:
  - meal entries projected to `{day, amount, facts.energyKcal}` and grouped per day in memory;
  - finished-session days;
  - a count and first-date for original, non-deleted posts;
  - the accepted friend count;
  - setup state;
  - `users.createdAt`.
- **Skipping work.** A family whose every tier is already earned is not loaded at all.
- **Writes.** Awards are written with
  `updateOne({userId, badgeId, tier}, {$setOnInsert: …}, {upsert: true})`, guarded by a unique
  index. Only rows where `upsertedCount === 1` count as new, so concurrent evaluations create one
  award and one notification (FR-007).

**Rationale.**
- **Size of the meal read:** a heavy logger writes about 3,000 entries a year, which is still a
  small projected read on M0.
- **`$setOnInsert` only:** this avoids the `$set`/`$setOnInsert` conflict trap in CLAUDE.md.

**Alternatives.**
- Incremental counters: rejected, as stored derived state (principle III).

## R6 The "on target" target for a past day

**Decision.**
- **Formula.** A food day is on target when `|eatenKcal − targetKcal| ≤ 10% × targetKcal`.
- **Which target.** `targetKcal` is the **starting target** (before the Apple Health activity
  adjustment) from `nutritionTargets({profile, weighIns, today: day})`. That uses the weigh-in in
  effect on that day and the age on that day (`nutrition.ts:551, 560, 698`).
- **When it does not count.** Days with no entries, or whose target is unavailable, neither count
  nor qualify. Configured `cheatDays` weekdays are skipped.
- **Spec change.** The spec's FR-008 is amended to say "starting target".

**Rationale.**
- **Why the starting target:** weekly banking already uses it
  (`nutrition.service.ts:1247, 1329`), and the activity adjustment depends on Apple Health samples
  that are deleted when Health is disconnected, so it is not reproducible for past days.
- **Known limitation:** the profile (goal, activity level) is not versioned, so past days are
  judged against today's goal. Because awards are permanent once earned, this only affects
  badges not yet earned. The module doc labels this as the basis (principle VI).

**Alternatives.**
- Activity-adjusted target: rejected. It is not reproducible.
- Versioning the nutrition profile: rejected. It is a large change for a badge.

## R7 Earned dates

**Decision.**
- **Which date.** An award's `earnedOn` is the day the threshold was **reached according to the
  history at evaluation time**. That is the day the streak or count crossed the tier; for a
  friend, the `acceptedAt` day; for early member, the `createdAt` day. When history cannot tell
  (setup, or a friendship whose `acceptedAt` is missing), it is `today`.
- **Ordering rule.** `earnedOn` never comes before the account's creation day and never comes
  after `today`.
- **Spec change.** The spec's back-dating edge case is amended to match: filling in a missed day
  can complete a streak, and the badge is then dated on the day the streak actually reached the
  tier.

**Rationale.** This is one rule for launch backfill and normal use, it gives honest dates, and
it needs no "first evaluation" marker.

## R8 Notifications for yourself

**Decision.**
- **New type.** `badgeEarned`. It requires `['social']` and has `windowMs: 0`. The event has
  `actorId = recipientId`, `targetId = badgeId`, and an optional `count`.
- **Self-notifications.** `NotificationTypeDef` gains `selfAllowed?: true`, and `shouldNotify`
  (`libs/shared/domain/src/lib/notifications.ts:39-58`) skips the `'self'` rule only for such
  types.
- **One per evaluation.** An evaluation that creates n > 0 awards sends one notification: the
  badge name when n = 1, otherwise "You earned n badges". This collapses the launch backfill
  (FR-020).
- **Activity and link.** The Activity source lists `badge_awards` rows. The deep link is
  `/profile?badge=<badgeId>`.

**Rationale.** Today every notification has another person as its actor; this is the first
system notification. A flag on the type keeps the `'self'` safeguard for every other type.

**Alternatives.**
- A separate "system" notification path: rejected, as it duplicates delivery, preferences and
  the iOS rule.

## R9 Catalogue lives in shared types, rules in the domain library

**Decision.**
- **`libs/shared/types/src/lib/badges.ts`** holds `BADGE_CATALOGUE`, a constant like `MODULES`,
  plus the types. Each entry has: id, family, name, description, tiers, `requires: FeatureId[]`
  and an icon key.
- **`libs/shared/domain/src/lib/badges.ts`** holds the pure rules. They take plain inputs and an
  explicit `today`, and return per badge `{tiersReached: {tier, reachedOn}[], progress}`. The
  functions are `loggingStreak`, `onTargetDays`, `weeklyConsistency`, `countMilestones` and
  `evaluateBadges`.

**Rationale.** The web needs names and descriptions to render other people's badges without
another request, and the rules are principle V. Challenges later add catalogue entries with a
different `source`; the award and selection shapes do not change (FR-003).

## R10 Access and visibility

**Decision.**
- **What a badge requires.** Every badge requires `social`, because badges are shown on
  profiles. Food badges also require `nutrition`, training badges `training`, and "First post"
  requires `foodPosts`.
- **Where access is applied.** It is applied **on read** through `AccessService.forUser`:
  - an inaccessible badge is filtered from the collection, the equipped list and other viewers'
    responses, but never deleted;
  - equipping an inaccessible or unearned badge returns a 400;
  - evaluation still awards inaccessible badges, so nothing is lost when access returns.
- **Other viewers.** They receive `{badgeId, tier, earnedOn}` for equipped, accessible badges
  only (FR-016).
- **"View as".** The equipped list does not depend on the relationship, so the "View as"
  preview is satisfied by calling the people endpoint for yourself.

**Training stays unshareable.** Showing an equipped training badge does not make training
shareable: `UNSHAREABLE_MODULES` governs live widget sharing, which badges do not use. This is
recorded in DECISIONS as part of "equipping is consent".
