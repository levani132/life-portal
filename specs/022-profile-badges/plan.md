# Implementation Plan: Profile badges

**Branch**: `022-profile-badges` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/022-profile-badges/spec.md`

## Summary

A new platform module, `badges`, has no Home card. Pure rules in `libs/shared/domain` evaluate
eleven catalogue badges from facts the owning modules export:
- meal days and per-day calories against the starting target;
- finished workout days;
- original post days;
- accepted friendships;
- setup state;
- account creation.

The only things stored are immutable awards, one per person, badge and tier, and each person's
choice of up to three equipped badges. Evaluation runs when the person opens their badges, and
on an unawaited `POST /badges/check` that the web sends after qualifying actions. There is no
event bus and no worker. The profile fetches equipped badges from a badges endpoint that
repeats the profile's gate. A new `badgeEarned` notification is the first notification a person
sends to themself.

## Technical Context

**Language/Version**: TypeScript (strict), Node per repo.

**Primary Dependencies**: NestJS 11, Mongoose 9, class-validator; Next.js 16, SWR, Tailwind,
lucide-react. No new dependency.

**Storage**: MongoDB. Two new collections: `badge_awards` and `badge_selections`
([data-model.md](data-model.md)).

**Testing**: Jest. `libs/shared/domain/src/lib/badges.spec.ts`;
`apps/api/src/badges/badges.service.spec.ts`; additions to the notifications domain spec.

**Target Platform**: The installed PWA on a phone, plus desktop.

**Project Type**: Web application (Nx monorepo).

**Performance Goals**: The profile is no slower than today, because the badges request runs in
parallel (SC-006). An evaluation for a year-long heavy logger (about 3,000 entries) completes in
well under a second on Tier 0.

**Constraints**:
- Free tier: no worker and no scheduled job.
- Awards must be idempotent under concurrent evaluation.
- Nothing about other people beyond `{badgeId, tier, earnedOn}` of equipped badges.

**Scale/Scope**:
- Eleven badges and 22 tiers.
- Four endpoints.
- Small read-only additions to five modules.
- One profile UI section.

## Constitution Check

*GATE: passes before Phase 0, and re-checked after Phase 1 design (below).*

| Principle | How the design follows it |
|---|---|
| I. Bounded module | `BadgesModule` owns its two collections and `/api/badges`. Other modules only **export read methods** returning plain facts (days, counts). Badges never queries their collections. The profile UI is a section of Social's page, like shared widgets. No Home card, so the card rule is untouched. |
| II. Integer units | Calories compared in whole kcal; the ±10% check is done in integers. |
| III. Derived never persisted | Streaks, totals, progress and "on target" are computed on every evaluation. An award is an immutable fact about a moment, like a publication event, and is never recomputed or edited (research R3). |
| IV. Single-sourced | Targets come from Nutrition's `nutritionTargets`; badges never copies a value. Equipped tier is not stored, only the id. |
| V. Pure projections | All rules are in `libs/shared/domain/src/lib/badges.ts` with an explicit `today`. |
| VI. Estimates labelled | "On target" is judged against the **starting** target with the current goal. The badge description and the module doc say so. Earned dates come from history (R7). |
| Auth and scoping | Every query is filtered by `userId`. The people route repeats the profile gate (social, block) and returns only equipped, accessible badges. |
| Docs | New `docs/modules/badges.md`; updates to social, notifications, nutrition, training and posts docs (new exported reads); DECISIONS, CHANGELOG and CLAUDE.md in the same change. |

**Result: PASS.** Two collections are justified in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/022-profile-badges/
├── spec.md
├── plan.md            # this file
├── research.md        # R1–R10
├── data-model.md
├── quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md           # /speckit-tasks
```

### Source Code

```text
libs/shared/types/src/lib/badges.ts            # BADGE_CATALOGUE, BadgeId, views, EARLY_MEMBER_CUTOFF
libs/shared/types/src/lib/notifications.ts     # + 'badgeEarned', event `count?`
libs/shared/domain/src/lib/badges.ts           # loggingStreak, onTargetDays, weeklyConsistency, countMilestones, evaluateBadges
libs/shared/domain/src/lib/badges.spec.ts
libs/shared/domain/src/lib/notifications.ts    # selfAllowed bypass of 'self'; badge text

apps/api/src/badges/
├── badges.module.ts                           # controller (4 routes), schemas, DTOs
├── badges.schemas.ts                          # badge_awards, badge_selections
├── badges.service.ts                          # evaluate, mine, equip, forPerson, notification type and activity source
└── badges.service.spec.ts
apps/api/src/nutrition/nutrition.service.ts    # + badgeInputs(userId, today)
apps/api/src/training/sessions.service.ts      # + finishedDays(userId)
apps/api/src/posts/posts.service.ts            # + originalPostDays(userId)
apps/api/src/social-graph/social-graph.module.ts # + acceptedSince(userId)
apps/api/src/notifications/notifications.service.ts # selfAllowed on the type def
apps/api/src/app/app.module.ts                 # import BadgesModule

apps/web/src/components/badges.tsx             # BadgeMark, EquippedBadges, BadgeCollection, BadgeSheet
apps/web/src/lib/badges.ts                     # checkBadges() (throttled, unawaited)
apps/web/src/components/social.tsx             # header row + own collection; ?badge= highlight
apps/web/src/components/notifications.tsx      # activity label
(call sites)                                   # meal log, workout finish, post publish, friend accept, app start

docs/modules/badges.md                         # new
```

**Structure Decision**: the existing Nx layout. One new API module, with no new web route. The
UI is part of `/profile` and `/people/:id`.

## Phase 0: Research

Done: [research.md](research.md). Highlights:

- **R2 A separate endpoint.** Posts imports Social, so embedding badges in the profile would
  create a module cycle.
- **R3 Awards are stored, progress is not.** Unfriending erases `acceptedAt`, so "first friend"
  cannot be derived later.
- **R4 No event bus.** Evaluation runs on reads, plus a web-sent `check` after qualifying
  actions.
- **R6 The starting target**, with the weigh-in in effect that day. The activity adjustment is
  not reproducible for past days. Spec FR-008 is amended.
- **R7 Earned date** is when history reached the tier. The spec's back-dating edge case is
  amended.
- **R8 `selfAllowed`** on notification types, so a person can notify themself only for badges.

## Phase 1: Design

- [data-model.md](data-model.md): the catalogue table, two collections, the pure functions and
  the rules every test covers.
- [contracts/api.md](contracts/api.md): four routes and the cross-module reads.
- [quickstart.md](quickstart.md): automated coverage and ten manual scenarios.

### Implementation notes worth knowing before tasks

- **`$setOnInsert` only** on award upserts. Never put the same field in `$set` as well (the
  CLAUDE.md trap).
- **Notify after the write** and only when `upsertedCount === 1`. Call it with `void`, so it is
  never awaited by the request that caused it.
- **`badgeInputs` stays inside Nutrition.** It groups entries by day and computes one target per
  distinct weigh-in period, not one per day, so the cost scales with weigh-ins. Only the facts
  `{day, eatenKcal, targetKcal?}` and `cheatDays` leave the module.
- **Web `checkBadges()`**:
  - fire-and-forget, throttled to one call per 30 s per tab;
  - `today` comes from the same `localDay` as meals;
  - on a non-empty result, it revalidates `/badges/me` and the own people key.
- **UI tone** (FR-018):
  - Marks are small rounded pills: a lucide icon plus the name and tier ("30-day streak").
  - Tiers are told apart by a quiet tint step, not medals.
  - There is no confetti or sound.
  - A new badge gets a one-time ring in the collection.
- **Swipes:** the collection is a wrapping grid, never a sideways scroller, so tab swipes need no
  `data-no-tab-swipe`.
- **Spec amendments:** FR-008 changes to "starting target", and the back-dating edge case is
  rewritten. Both are in this change.

### Constitution re-check (post-design)

Still **PASS**. There is no new dependency. The five touched modules gain one exported read each,
which returns plain facts.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| `badge_awards` collection (stored facts) | Earned must be permanent (FR-005), and some sources (friendship) are erased by later actions | Fully derived badges would be revoked by deleting meals or unfriending |
| `badge_selections` collection | The equip choice belongs to badges, not to Social's identity row | A field on `social_profiles` would make Social write badge state, and its validation (earned, accessible) would need Badges, which would create a cycle |
| `selfAllowed` on notification types | The first system notification, whose actor is the recipient | A separate delivery path would duplicate preferences, collapse rules and the iOS rule |
