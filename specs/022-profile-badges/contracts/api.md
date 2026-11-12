# API contract: Badges

**Common rules.**
- All routes are under `/api/badges`, authenticated by the global guard, and answer
  `Cache-Control: private, no-store`.
- The controller has no `@RequireModule`, because awarding must keep working while `social` is
  off (spec edge case). Each route applies its own gate, as listed.

## `GET /badges/me?today=YYYY-MM-DD`

Evaluates first, then returns the owner's collection.

- **Gate:** the caller has `social`, otherwise 403 (`MODULE_DISABLED`).
- **`today`:** required, a day string decided by the browser using `dayStartHour`.
- **200** returns `MyBadges`.
  - Only badges whose `requires` the caller has.
  - Locked badges carry `progress`.
  - `isNew` marks awards created by this call.

## `POST /badges/check?today=YYYY-MM-DD`

The trigger fired by the web after qualifying actions. It is not awaited.

- **Gate:** none beyond authentication. It awards even when a feature is off.
- **200** returns `{ newBadgeIds: BadgeId[] }`.
- **Side effect:** sends one `badgeEarned` notification when awards were created.

## `PUT /badges/me/equipped`

- **Body:** `{ badgeIds: BadgeId[] }`, validated as follows:
  - an array of 0–3 items;
  - unique;
  - each id in `BADGE_CATALOGUE`.
- **Gate:** `social`.
- **400** `BADGE_NOT_EARNED` for a badge with no award, or one the caller cannot access.
- **200** returns `{ equipped: BadgeId[] }`.

## `GET /badges/people/:userId`

The equipped badges shown on someone's profile, including your own (used by "View as").

- **Gate:** the same as `/social/profiles/:userId`:
  - the caller has `social`;
  - the target exists and has `social`;
  - no block in either direction. Otherwise 404, the same as the profile, so the response does
    not reveal whether the person exists.
- **200** returns `PersonBadges`: equipped ids that are both earned and accessible **to the
  target**, in order, each with its highest tier and that tier's `earnedOn`. It never includes
  progress, locked badges or unequipped awards.

## Cross-module touch points

| Module | Change |
|---|---|
| Nutrition | Export `badgeInputs(userId, today)`, returning `{days: {day, eatenKcal, targetKcal?}[], cheatDays}`. It computes `targetKcal` with `nutritionTargets` per distinct weigh-in period, so only the facts leave the module (R6). |
| Training | `SessionsService.finishedDays(userId): string[]`. |
| Posts | `PostsService.originalPostDays(userId): string[]`, covering non-deleted originals only. |
| SocialGraph | `acceptedSince(userId): (string \| undefined)[]`, the `acceptedAt` days of current accepted, unblocked connections. Also an existing block check for the people route. |
| Portal | `PortalService.get(userId).setupCompleted` (already exported). |
| Notifications | `selfAllowed` on `NotificationTypeDef`; `badgeEarned` added to `NOTIFICATION_TYPES`, `notificationText` and the web activity label switch. |
| Web | `components/badges.tsx`: `BadgeMark`, `EquippedBadges`, `BadgeCollection`, `BadgeSheet`. `lib/badges.ts`: `checkBadges()`, throttled. `ProfileView` adds the header row and the own collection. Call sites: after a meal log, workout finish, post publish, friend accept, and on app start. |
