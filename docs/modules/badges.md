# Badges (profile badges)

Small, understated marks earned from what a person already does in the portal, and shown on their
profile. Badges are a platform module, like Notifications. They have no Home card and no route of
their own; the UI is a tab on your own profile.

- **Code:** `apps/api/src/badges/`, `apps/web/src/components/badges.tsx`, `apps/web/src/lib/badges.ts`
- **Rules:** `libs/shared/domain/src/lib/badges.ts`
- **Catalogue and contracts:** `libs/shared/types/src/lib/badges.ts`
- **Spec:** `specs/022-profile-badges/` (spec, plan, research R1–R10, data model, API contract)

**Status (2026-11-12):** all five stories built:
- **US1:** standard and food badges, earned from history and shown privately in the owner's
  collection.
- **US2:** equipping up to three.
- **US3:** other people's view.
- **US4:** training badges.
- **US5:** the "badge earned" notification and Activity row.

## Catalogue

`BADGE_CATALOGUE` is a constant in the shared types, so the web can name any badge without a
request. It can only grow, and ids are never reused.

| id | family | tiers | needs (besides `social`) |
|---|---|---|---|
| `setup` | standard | 1 | none |
| `firstPost` | standard | 1 | `foodPosts` |
| `firstFriend` | standard | 1 | none |
| `connected` | standard | 10 friends | none |
| `earlyMember` | standard | 1 | none. Everyone qualifies while `EARLY_MEMBER_CUTOFF` is `null`. |
| `loggingStreak` | food | 7 / 30 / 100 / 365 days | `nutrition` |
| `onTargetStreak` | food | 7 / 30 days | `nutrition` |
| `daysOnTarget` | food | 30 / 100 / 365 days | `nutrition` |
| `firstWorkout` | training | 1 | `training` |
| `workouts` | training | 10 / 50 / 100 / 250 finished workouts | `training` |
| `consistency` | training | 4 / 12 / 26 / 52 weeks | `training` |

## Collections

Two collections; nothing else about badges is stored.

| Collection | What it holds, and why it exists |
|---|---|
| `badge_awards` | **The one stored fact:** a person reached a tier, with `{userId, badgeId, tier, earnedOn, source: 'rule' \| 'challenge', sourceId?}`. It is unique on `(userId, badgeId, tier)` and written once with `$setOnInsert`. It is never edited or deleted. It has to be stored because history can be erased later: deleting meals, or unfriending (which unsets `acceptedAt`), must not revoke a badge (FR-005). |
| `badge_selections` | Equipped badge ids, in display order (US2). The tier is not stored; the highest earned tier is always shown. |

Progress, streak lengths and "on target" are computed on every evaluation and never stored
(principle III).

## Evaluation

`BadgesService.evaluate(userId, today)` collects facts through **exported reads only**. Badges
never queries another module's collections.

| Read | Owner | Returns |
|---|---|---|
| `NutritionService.badgeInputs(userId, today)` | Nutrition | `{days: {day, eatenKcal, targetKcal?}[], cheatDays}` |
| `PostsService.originalPostDays(userId)` | Posts | the UTC creation day of each live original post |
| `SocialGraphService.acceptedSince(userId)` | SocialGraph | the `acceptedAt` day of each current friendship (`undefined` for old rows) |
| `PortalService.get(userId).setupCompleted` | Portal | whether setup is complete |
| `SessionsService.finishedDays(userId)` | Training | the `day` of each finished workout (open ones never count) |
| `users.createdAt` | Auth | the day the account was created |

- **What gets loaded.** A family whose every tier is already awarded is skipped. Setup and posts
  are skipped once earned.
- **What gets awarded.** Every reached tier without an award is inserted. Inaccessible badges
  are still awarded, so nothing is lost while a feature is off; they are hidden on read instead.

**When it runs.** There is no event bus, and the free tier has no worker, so evaluation runs:
- on `GET /api/badges/me` (opening the Badges tab);
- on `POST /api/badges/check`, which the browser fires:
  - once when the app starts;
  - after any successful write that can complete a badge (logging a meal by any route,
    publishing a post, finishing a workout), matched in `lib/badges.ts` through the API client's
    `onSuccessfulWrite` hook;
  - after accepting a friend request.

  It is throttled to once per 30 s per tab, with a trailing call so a quick second action is
  still checked. Meals logged through MCP or a Shortcut are picked up at the next app start.

**Earned date (research R7).** An award is dated the day the history reached the tier: the day
the streak or count crossed it, the post's day, the acceptance day, or the account's creation
day. Setup, and a friendship without `acceptedAt`, use `today`. The date is clamped between the
account's creation day and today.

## Rules and their basis (principle VI)

- **Food days** are the eater's days: entries carry the `dayStartHour`-shifted `day`, and
  `today` comes from the browser.
- **The current day never breaks a streak.** A streak counts through yesterday, plus today if
  today already qualifies.
- **Logging streak:** consecutive days with at least one meal entry.
- **On target** means `|eaten − target| × 10 ≤ target`, in whole kcal.
  - **Which target:** the **starting** target (before the Apple Health activity adjustment) from
    `nutritionTargets` with the weigh-in in effect on that day and the age on that day. The
    activity adjustment depends on Health samples that are deleted on disconnect, so it cannot be
    reproduced for past days.
  - **Known limitation:** the Food profile (goal, activity level) is not versioned, so past days
    are judged against the current goal. This only matters for badges not yet earned, because
    awards are permanent. The badge description says so.
  - **No target:** a day without a computable target (no weigh-in yet, missing inputs) breaks
    the streak and does not count.
  - **Cheat weekdays** are skipped in the streak, whatever was eaten. The **total** counts any
    on-target day, a cheat day included.
- **Posts** use the UTC creation day, an approximation of the author's day that is fine for
  "first post".
- **Workouts** count finished sessions only, by their stored `day`.
- **Weekly consistency:** consecutive Monday-start weeks (the same `weekStart` as nutrition)
  with at least **2** finished workouts. There is no daily training streak on purpose: rest days
  are part of training. A tier is dated by the workout that completed its last week. The current
  week extends a run as soon as it has two, and never breaks one before it is over.

## Notification (US5)

`BadgesService` registers the `badgeEarned` type and an Activity source in `onModuleInit`
([notifications](notifications.md)).
- **One per evaluation.** An evaluation that creates awards calls `notify()` once, without
  awaiting: "You earned the 30-day logging streak" for one award (the highest new tier),
  otherwise "You earned n badges". The first check after launch therefore sends one summary,
  not one push per backfilled badge. Concurrent evaluations cannot both announce an award,
  because only the upsert that inserted it counts.
- **Only what the person can see.** Awards of a feature that is off are not counted in the push
  or listed in Activity.
- **The one self-notification.** Actor and recipient are the same person, so the type is
  registered with `selfAllowed: true`; every other type still drops a person's own actions.
- **Turning it off** (the Badges toggle in notification settings) stops the push only; badges
  are still awarded.
- **The link** is `/profile?badge=<id>`. The profile switches to the Badges tab, opens that
  badge's sheet, and removes the parameter.

## API

All routes are under `/api/badges` and answer `Cache-Control: private, no-store`. There is no
`@RequireModule`: awarding works with `social` off, and each route gates itself.

| Route | Gate | Returns |
|---|---|---|
| `GET /me?today=` | `social` | `MyBadges`: accessible badges, each earned one with its tiers and dates; locked ones with private `progress`; `isNew` for awards made by this call; `equipped`, filtered to earned and accessible badges |
| `POST /check?today=` | signed in | `{newBadgeIds}` |
| `PUT /me/equipped` `{badgeIds}` | `social` | `{equipped}`. The DTO allows 0–3 unique catalogue ids. Any id that is not earned, or whose feature is off, is refused with 400 `BADGE_NOT_EARNED` (listing the ids). |
| `GET /people/:id` | Same gate as `/social/profiles/:id`: the viewer has `social`; the target exists and has `social`; no block either way. Anything else is a 404. | `PersonBadges`: the target's equipped ids that are earned and accessible **to the target**, each `{badgeId, tier: highest, earnedOn}`. No progress, no locked or unequipped badges, and no evaluation. |

## UI

Your own profile gets a **Badges** tab (Posts · Badges · About). It is not shown while "View as"
is active, because the collection holds private progress.
- **Order:** earned badges first, with their dates, then "Still to earn" with "8 of 30 days".
- **New badges:** a badge awarded by this request, or by a background check in this tab, gets a
  quiet ring and "New".
- **Marks:** a lucide icon and a name. Tiers are told apart by a tint step, never medals,
  points or sound.

### Showing badges (US2, US3)

- **Equipping is consent.** Equipping a badge is the owner's explicit choice to show that badge.
  It exposes nothing else from its module: training stays unshareable, and meal audiences are
  unchanged.
- **The header row.** Equipped badges sit under the name and @username. Nothing renders when
  none are equipped.
- **On your own live profile:**
  - the row comes from `/badges/me`;
  - tapping an earned badge (in the row or the Badges tab) opens a sheet with **Show on
    profile**, **Move left / right** and **Remove from profile**;
  - with three already shown, the sheet lists the three to choose which to **replace**, so a
    fourth is never added silently.
  - **Saving** is optimistic, followed by a `/badges` revalidation.
- **"View as" and other people:** both read `/badges/people/:id`, so the preview is exactly what
  is sent to others. Tapping a badge shows its name, rule and earned date.
- **The tier is not stored with the choice**, so an equipped streak shows the higher tier as soon
  as it is earned.

## Cross-links

- [nutrition](nutrition.md) `badgeInputs`
- [posts](posts.md) `originalPostDays`
- [social](social.md) `acceptedSince`, and profiles
- [portal](portal.md) setup
- [training](training.md) `finishedDays`
- [notifications](notifications.md) `badgeEarned`, `selfAllowed`
