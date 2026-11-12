---
description: "Task list for 022 profile badges"
---

# Tasks: Profile badges

**Input**: Design documents from `specs/022-profile-badges/` (plan, spec, research R1–R10,
data-model, contracts/api.md, quickstart).

**Tests**: The constitution requires a unit test for every domain branch. Those tests, and the
API service specs listed in the quickstart, are included. UI-only changes have no test tasks.

**Organization**: Tasks are grouped by user story (US1–US5 from spec.md). Each story can be
tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks).
- **[Story]**: US1–US5.

---

## Phase 1: Setup (shared contracts)

- [ ] T001 [P] Create `libs/shared/types/src/lib/badges.ts`:
  - **Types:** `BadgeFamily`, `BadgeId`, `BadgeDefinition`, `BadgeView`, `MyBadges`,
    `PublicBadge`, `PersonBadges`, `EquipBadgesBody`.
  - **Catalogue:** `BADGE_CATALOGUE`, the eleven entries exactly as in the data-model table.
    Each entry has its name, its description with a `{tier}` placeholder, its `unit`, its
    ascending `tiers` (`[1]` when untiered), its `requires` (always `'social'`, plus
    `nutrition`, `training` or `foodPosts`) and its icon key.
  - **Constants:** `EARLY_MEMBER_CUTOFF: string | null = null` and `MAX_EQUIPPED_BADGES = 3`.
  - **Export** everything from `libs/shared/types/src/index.ts`.
- [ ] T002 [P] Create `libs/shared/domain/src/lib/badges.ts` with the exported function
  signatures from data-model.md: `loggingStreak`, `onTargetDays`, `weeklyConsistency`,
  `countMilestones`, `evaluateBadges` and the `BadgeInputs` type. Bodies throw
  `not implemented`. Export from `libs/shared/domain/src/index.ts`.

---

## Phase 2: Foundational (blocks every story)

- [ ] T003 Create `apps/api/src/badges/badges.schemas.ts`:
  - **`BadgeAward`** (`badge_awards`): `userId`, `badgeId`, `tier`, `earnedOn` via
    `requiredDayField`, `source` enum `rule|challenge`, optional `sourceId` with **no
    default**, and `baseSchemaOptions`.
    - Unique index `{userId:1, badgeId:1, tier:1}`.
    - Index `{userId:1, createdAt:-1}`.
  - **`BadgeSelection`** (`badge_selections`): unique `userId`, and `equipped: string[]`.
- [ ] T004 Create `apps/api/src/badges/badges.module.ts`:
  - **Imports:** `MongooseModule.forFeature` (both schemas), `NutritionModule`, `PostsModule`,
    `PortalModule` and `TrainingModule`. `AccessService`, `SocialGraphService` and
    `NotificationsService` are global or imported as other modules do; check how
    `social.module.ts` gets them.
  - **Controller:** an empty `BadgesController` at `badges` with **no** `@RequireModule`, and
    `Cache-Control: private, no-store` on every route, the same way `social.module.ts` does it.
  - **Registration:** import `BadgesModule` in `apps/api/src/app/app.module.ts`.
  - **Check:** `npm run dev:api` boots, with no DI or cycle error. PostsModule must not import
    BadgesModule.
- [ ] T005 Create `apps/api/src/badges/badges.service.ts`:
  - The constructor takes both models, `AccessService`, `NutritionService`, `PostsService`,
    `PortalService`, `SessionsService`, `SocialGraphService`, `NotificationsService` and the
    `users` model, or whatever exported read exposes `createdAt`.
  - **Helper `accessible(def, access)`:** true when every `requires` flag is on.
  - **Helper `award(userId, badgeId, tier, earnedOn)`:** `updateOne` with `$setOnInsert` only
    and `upsert: true`. It returns `true` iff `upsertedCount === 1`, and treats a duplicate-key
    error (E11000) as `false`.

**Checkpoint**: the API boots with an empty badges module.

---

## Phase 3: User Story 1 — Earn badges and see my collection (P1) 🎯 MVP

**Goal**: The standard and food badges are evaluated from history, awarded permanently, and
shown in the owner's collection with private progress.

**Independent test**:
1. Seed setup, one post, one friend and 8 consecutive food days.
2. Open Profile.
3. "Set up", "First post", "First friend", "Early member" and "7-day logging streak" are earned,
   with dates from history, and "30-day" shows 8/30.

### Tests (write first, see them fail)

- [ ] T006 [P] [US1] Write `libs/shared/domain/src/lib/badges.spec.ts` for `loggingStreak` and
  `countMilestones`:
  - a gap breaks the run;
  - today without entries does not break a run that ended yesterday;
  - today with entries extends it;
  - a tier reached in an earlier run still counts, with `reachedOn` from the earliest run;
  - duplicate days are ignored;
  - unsorted input works;
  - `countMilestones` dates are the n-th event's day.
- [ ] T007 [P] [US1] In the same spec, cover `onTargetDays`:
  - the ±10% boundary, inclusive, checked in integers (`|e−t|*10 <= t`);
  - no target means the day neither counts nor qualifies, and breaks the streak;
  - a day without entries breaks the streak;
  - a cheat weekday (0 = Sunday, using `weekdayOf`) is skipped in the streak whether or not it
    was on target;
  - the total counts any on-target day, including a cheat day that was on target;
  - today never breaks a streak.
- [ ] T008 [P] [US1] In the same spec, cover `evaluateBadges` for the standard and food
  families:
  - progress `{current, next}` toward the lowest unreached tier;
  - badges with every tier reached carry no progress;
  - `earlyMember` with `EARLY_MEMBER_CUTOFF` null (everyone) and with a date;
  - a `reachedOn` before `accountCreatedOn` or after `today` is clamped (R7).

### Implementation

- [ ] T009 [US1] Implement `loggingStreak`, `onTargetDays` and `countMilestones` in
  `libs/shared/domain/src/lib/badges.ts` until T006–T007 pass. Use existing date helpers from
  `nutrition.ts` (`weekdayOf`, day arithmetic); never `new Date()` without an argument.
- [ ] T010 [US1] Implement `evaluateBadges(input, today)` for the standard and food families in
  the same file, until T008 passes.
  - **Inputs:**
    - `accountCreatedOn`
    - `setupCompleted`
    - `postDays[]`
    - `friendAcceptedDays (string|undefined)[]`
    - `food?: {days: {day, eatenKcal, targetKcal?}[], cheatDays}`
    - `training?` (US4)
  - **Missing dates:** a missing `acceptedAt` or setup date becomes `today`.
- [ ] T011 [P] [US1] Add `badgeInputs(userId, today)` to `apps/api/src/nutrition/nutrition.service.ts`:
  - **Reads:** entries with `day <= today`, projected to what `decorateEntry` needs for kcal,
    summed per day into whole kcal; weigh-ins via `weighInsUpTo`; and the profile.
  - **Targets:** compute `nutritionTargets({profile, weighIns, today: day})` once per distinct
    current-weigh-in period, not per day. Use the starting target
    (`activity?.startingTargetKcal ?? energyKcal?.value`, as at :1247), but do **not** apply
    `activityTargets`.
  - **Returns** `{days, cheatDays}`. Add a case to `nutrition.service.spec.ts`: two weigh-ins
    give two different targets, and the result has no activity adjustment.
- [ ] T012 [P] [US1] Add `originalPostDays(userId): Promise<string[]>` to
  `apps/api/src/posts/posts.service.ts`. Filter on `{userId, deleted:false, repostOf:{$exists:false}}`,
  project `createdAt`, and map to UTC day strings. Document in the posts doc that this
  approximates the day.
- [ ] T013 [P] [US1] Add `acceptedSince(userId): Promise<(string|undefined)[]>` to
  `SocialGraphService` in `apps/api/src/social-graph/social-graph.module.ts`. It covers accepted
  rows with an empty `blockedBy`, mapping `acceptedAt` to a day string or `undefined`.
- [ ] T014 [US1] Implement `BadgesService.evaluate(userId, today)` in `badges.service.ts`:
  1. Load the existing awards.
  2. Skip loading any family whose every tier is already awarded.
  3. Gather the inputs (T011–T013, `PortalService.get(userId).setupCompleted`, and the user's
     `createdAt`).
  4. Call `evaluateBadges`.
  5. For each reached tier without an award, call `award()`.
  6. Return `{newAwards, evaluations}`.

  Inaccessible badges are still awarded (R10). The nutrition inputs are loaded only if the user
  has ever had nutrition data, which is cheap to check.
- [ ] T015 [US1] Implement `BadgesService.mine(userId, today): MyBadges` in
  `badges.service.ts`:
  - Call `evaluate`, then filter the catalogue by `accessible`.
  - Build each `BadgeView`:
    - its highest tier, plus `tiersEarned`;
    - `progress` for locked badges and partially earned tiered badges;
    - `isNew` for this call's awards.
  - Return them with the selection's `equipped` list, filtered to ids that are earned and
    accessible.
- [ ] T016 [US1] Add routes to `BadgesController`:
  - **`GET /badges/me?today=`:** the `social` gate (`AccessService.require`) and a validated
    `today` DTO.
  - **`POST /badges/check?today=`:** returns `{newBadgeIds}`.
- [ ] T017 [US1] Write `apps/api/src/badges/badges.service.spec.ts` (mocks as in
  `social.service.spec.ts`). It covers:
  - two concurrent `evaluate` calls create one award each;
  - awards survive when the inputs later shrink (meals deleted, friend removed);
  - nutrition access off hides food badges from `mine` but keeps their rows;
  - `mine` never includes unearned ids in `equipped`.
- [ ] T018 [P] [US1] Create `apps/web/src/components/badges.tsx`:
  - **`BadgeMark`:** a small rounded pill with a lucide icon (from the icon key), the name and
    the tier label ("30-day streak"). Tiers are told apart by a quiet tint step, with no medals.
  - **`BadgeCollection`:** a wrapping grid of earned badges (with dates), then locked badges
    (muted, with "8 of 30 days"). Badges with `isNew` get a one-time ring. It must not scroll
    sideways.
  - **Tone (FR-018):** no confetti, no sound.
- [ ] T019 [P] [US1] Create `apps/web/src/lib/badges.ts`:
  - **`checkBadges()`:** fire-and-forget `POST /badges/check?today=<localDay>`, throttled to once
    per 30 s per tab. Take `today` from the same helper meals use with `dayStartHour`.
  - **On a non-empty `newBadgeIds`:** SWR `mutate` the `/badges/me` keys and the own
    `/badges/people/<me>` key.
- [ ] T020 [US1] In `apps/web/src/components/social.tsx`, fetch `/badges/me?today=` for your own
  profile and render a "Badges" section with `BadgeCollection` on your own profile. Put it in
  the About tab, or below the header when the Posts/About tabs are absent. Add a "Badges" count
  link to `OwnStats` that scrolls to it.
- [ ] T021 [US1] Call `checkBadges()`:
  - after a successful meal create in `apps/web/src/components/log-food-modal.tsx` and
    `apps/web/src/app/nutrition/page.tsx`, wherever they POST entries;
  - after a successful publish in `apps/web/src/components/post-composer.tsx`;
  - after an accept in `useConnection` in `apps/web/src/components/social.tsx`;
  - once on app start, in the root shell (`PortalShell`, `apps/web/src/components/app-shell.tsx`),
    behind the user being signed in.

**Checkpoint**: US1 quickstart scenarios 1 (without the notification) and 5 pass.

---

## Phase 4: User Story 2 — Equip badges on my profile (P1)

**Goal**: up to 3 earned badges are equipped in order and shown under the name.

**Independent test**: equip two, reorder them and reload, and the header shows them in that
order. Equipping a fourth asks which one to replace.

- [ ] T022 [US2] Add `PUT /badges/me/equipped` to `BadgesController` with an `EquipBadgesDto`:
  - **Validation:** `@IsArray`, `@ArrayMaxSize(MAX_EQUIPPED_BADGES)`, `@ArrayUnique`, and
    `@IsIn` over the catalogue ids.
  - **`BadgesService.equip(userId, ids)`:** require `social`, check that each id has an award
    and is accessible (otherwise 400 `BADGE_NOT_EARNED`), then upsert the selection with `$set`
    only.
  - **Returns** `{equipped}`.
- [ ] T023 [US2] Add equip cases to `badges.service.spec.ts`: an unearned badge returns 400; an
  inaccessible badge returns 400; a 4th id is rejected by the DTO; order is preserved; an
  equipped tiered badge reports its highest tier.
- [ ] T024 [US2] In `apps/web/src/components/badges.tsx`, add `BadgeSheet` for your own earned
  badges:
  - **Details:** name, description with the tier filled in, and the earned date.
  - **Equip / Unequip.** When 3 are already equipped, it lists the equipped three to pick one to
    replace.
  - **`EquippedBadges`:** the row of `BadgeMark`s. When it is your own, add move-left and
    move-right controls in the sheet.
  - **Saving** does an optimistic SWR update with `PUT`.
- [ ] T025 [US2] Render `EquippedBadges` in the profile header in `apps/web/src/components/social.tsx`,
  under the name or @username line. Render nothing when the list is empty, and wrap at 375 px
  without pushing the name. Tapping a badge in your own collection opens `BadgeSheet`.

**Checkpoint**: quickstart scenarios 3 and 4 pass.

---

## Phase 5: User Story 3 — See other people's equipped badges (P2)

**Goal**: viewers see only equipped, accessible badges, behind the profile's gate.

**Independent test**: B sees A's equipped badges and their details. The response contains no
progress. A blocked pair gets a 404.

- [ ] T026 [US3] Add `GET /badges/people/:userId` to `BadgesController`, with
  `BadgesService.forPerson(viewerId, targetId)`:
  - **Gate:**
    - the viewer has `social` (otherwise 403);
    - the target exists and has `social`;
    - no block in either direction, via `SocialGraphService` (the same check
      `SocialService.profile` uses).
    - Any failure returns 404.
  - **Returns** `PersonBadges`: the target's equipped ids, filtered by the **target's** access
    and their awards, each as `{badgeId, tier: highest, earnedOn}`.
  - **No evaluation** runs here.
- [ ] T027 [US3] Add people-route cases to `badges.service.spec.ts`:
  - only equipped badges are returned;
  - no `progress` key appears anywhere (assert on the serialized JSON);
  - a blocked pair gets a 404 both ways;
  - when the target loses nutrition, their equipped food badges are dropped;
  - a viewer without `social` gets a 403.
- [ ] T028 [US3] In `apps/web/src/components/social.tsx`, fetch `/badges/people/<id>` in
  parallel with the profile for other people, and for yourself while "View as" is active. Render
  it with `EquippedBadges`. A tapped badge opens a read-only `BadgeSheet` (name, rule, earned
  date). With no badges, render nothing.

**Checkpoint**: quickstart scenarios 6, 7 and 8 pass.

---

## Phase 6: User Story 4 — Training badges (P2)

**Goal**: first workout, workout totals and weekly consistency from finished sessions.

**Independent test**: 10 finished workouts, with 2 or more in each of 4 consecutive weeks, earn
"First workout", "10 workouts" and "4-week consistency". An open session does not count.

- [ ] T029 [P] [US4] Add `weeklyConsistency` cases to `badges.spec.ts`:
  - weeks start on Monday (match `weekStart` in `nutrition.ts`);
  - a week with 1 session breaks the run;
  - the current week with fewer than 2 sessions neither breaks nor extends the run, and with 2
    it extends it;
  - `reachedOn` is the day of the session that completed the tier's week;
  - tiers come from earlier runs.

  Add `evaluateBadges` training cases too.
- [ ] T030 [US4] Implement `weeklyConsistency` and the training family in `evaluateBadges` in
  `libs/shared/domain/src/lib/badges.ts`.
- [ ] T031 [P] [US4] Add `finishedDays(userId): Promise<string[]>` to
  `apps/api/src/training/sessions.service.ts`, covering `status: 'finished'` only, projecting
  `day`.
- [ ] T032 [US4] Load the training inputs in `BadgesService.evaluate` when the training family is
  not complete. Add a service-spec case where an open session is not counted.
- [ ] T033 [US4] Call `checkBadges()` after a successful finish in
  `apps/web/src/components/training/workout-session.tsx`.

**Checkpoint**: quickstart scenario 9 passes.

---

## Phase 7: User Story 5 — Be told when I earn a badge (P3)

**Goal**: one notification per evaluation that creates awards, and a deep link to the badge.

**Independent test**: completing a 7-day streak sends one notification. The launch backfill
sends one "You earned n badges". Turning the type off sends nothing, but the badges are still
awarded.

- [ ] T034 [P] [US5] In `libs/shared/types/src/lib/notifications.ts`, add `'badgeEarned'` to
  `NOTIFICATION_TYPES` and optional `count?: number` to `NotificationEvent`.
- [ ] T035 [US5] In `libs/shared/domain/src/lib/notifications.ts`:
  - **`shouldNotify`:** takes the type's `selfAllowed` (as an argument or as a set of types) and
    skips the `'self'` rule only for such types.
  - **`notificationText`:** for `badgeEarned`, "You earned <name>" when `count` is 1 (resolved
    from `BADGE_CATALOGUE` via `targetId`), otherwise "You earned <count> badges".
  - **Tests:** in that module's spec file, `'self'` is still blocked for every other type.
- [ ] T036 [US5] In `apps/api/src/notifications/notifications.service.ts`, add
  `selfAllowed?: true` to `NotificationTypeDef` and pass it into `shouldNotify`.
- [ ] T037 [US5] In `BadgesService.onModuleInit`, register the type: `badgeEarned`, `requires:
  ['social']`, `windowMs: 0`, `selfAllowed: true`, collapse key on the recipient, and `url` set
  to `/profile?badge=<targetId>`. Also register an Activity source over `badge_awards` (by
  `createdAt`, newest first). After `evaluate` creates n > 0 awards, `void notify(...)` once with
  `count: n`. Add spec cases: one notify per evaluation, none when there are no new awards.
- [ ] T038 [P] [US5] Add the `badgeEarned` label and icon to the activity label switch in
  `apps/web/src/components/notifications.tsx`, and the toggle label wherever the per-type
  preferences are listed.
- [ ] T039 [US5] In `apps/web/src/components/social.tsx`, read `?badge=` on `/profile`. Scroll to
  the collection, open that badge's `BadgeSheet` once, then clear the parameter with
  `router.replace`.

**Checkpoint**: quickstart scenarios 1 (notification) and 2 pass.

---

## Phase 8: Polish and cross-cutting

- [ ] T040 [P] Write `docs/modules/badges.md`:
  - purpose, catalogue, collections (with one sentence each on why they exist), API and access;
  - the evaluation triggers (R4);
  - the on-target basis (the starting target with the current goal, R6), labelled as the basis;
  - earned dates (R7) and `selfAllowed`;
  - cross-links to social, nutrition, training, posts and notifications.
- [ ] T041 [P] Update the module docs for the new exported reads and behaviour:
  - `docs/modules/nutrition.md`: `badgeInputs`.
  - `docs/modules/training.md`: `finishedDays`.
  - `docs/modules/posts.md`: `originalPostDays`.
  - `docs/modules/social.md`: `acceptedSince`, and the badges row on profiles fetched
    separately.
  - `docs/modules/notifications.md`: the `badgeEarned` type, `selfAllowed`, and the first
    self-notification.
- [ ] T042 Append to `docs/DECISIONS.md`:
  - "Badge awards are stored facts; progress is derived."
  - "Equipping a badge is consent to show it (training stays unshareable)."
  - "On-target uses the starting target."
  - "Badges are fetched separately from the profile (module cycle)."

  Append "Profile badges" to `docs/CHANGELOG.md`.
- [ ] T043 Add a "things that will trip you up" line to `CLAUDE.md`. Awards are written with
  `$setOnInsert` only and never edited or deleted. Badges never query another module's
  collections, only the exported reads. `POST /badges/check` is fired by the browser, because
  there is no event bus.
- [ ] T044 Run `npm run check` and fix anything it finds. Then run the quickstart manual
  scenarios on a local Mongo at 375 px, in light and dark mode. Expect non-zero streaks and
  dates from history, not today.

---

## Dependencies and execution order

- **Setup (T001–T002)** comes first. **Foundational (T003–T005)** blocks every story.
- **US1 (T006–T021)** comes first: the MVP.
- **US2** needs US1's awards and collection.
- **US3** needs US2's selection. Its API (T026–T027) can be built as soon as T003 is done.
- **US4** needs only Foundational plus T010's `evaluateBadges` shape, so it can run alongside
  US2 and US3.
- **US5** needs `evaluate` (T014). T034–T036 can start any time.
- **Polish** comes last.

Within US1: T006–T008 → T009–T010. T011, T012 and T013 can run in parallel. Then T014 → T015 →
T016 → T017. The web tasks T018 and T019 can run in parallel, then T020 → T021.

## Parallel examples

- **US1:** T006, T007 and T008 (one spec file, so write them together or one after another),
  then T011, T012, T013, T018 and T019 together.
- **US4:** T029 and T031 together.
- **US5:** T034 and T038 together.

## Implementation strategy

1. **MVP:** Phases 1–3. You earn badges and see them privately. That is useful on its own and
   exposes nothing.
2. **Showing them:** add US2 and US3. Equipping and other viewers ship together, so badges never
   become public half-built.
3. **Training and notifications:** add US4 (training is flag-gated anyway) and US5.
4. **Finish:** Polish. Commit and push to `main` after each checkpoint, with `npm run check`
   green.
