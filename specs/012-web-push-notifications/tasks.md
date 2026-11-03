---
description: "Tasks for 012 push notifications"
---

# Tasks: Push notifications for the installed app

**Input**: `specs/012-web-push-notifications/` (plan, spec, research, data-model, contracts, quickstart)

**Tests**: The constitution requires unit tests for domain logic. API service specs are also
included for authorization and privacy rules, following the project's existing `*.spec.ts`
practice. UI-only work has no tests.

## Phase 1: Setup

- [X] T001 Add the `web-push` dependency and `@types/web-push` dev dependency in package.json
- [X] T002 [P] Add optional `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` to .env.example, with a generation note (`npx web-push generate-vapid-keys`)
- [X] T003 [P] Add `push?: {publicKey, privateKey, subject}` to `AppConfig`, with all-or-nothing validation (a partial set throws naming the missing variable; the subject must start with `mailto:` or `https:`) in apps/api/src/config/configuration.ts

## Phase 2: Foundational (blocks every story)

- [X] T004 Add `'push'` to `FEATURE_IDS` and a feature list entry ("Push notifications") in libs/shared/types/src/lib/portal.ts. Add `push` to `FeatureOverridesDto` in apps/api/src/access/access.module.ts
- [X] T005 [P] Create libs/shared/types/src/lib/notifications.ts with `NOTIFICATION_TYPES`, `NotificationType`, `NotificationEvent`, `PushPayload`, `ActivityItem`, `ActivityPage`, `NotificationPreferences`, `PushDeviceSummary`, `NotificationsConfig`, and export it from libs/shared/types/src/index.ts
- [X] T006 Create the pure functions `shouldNotify`, `collapseDecision`, `notificationText` and `groupActivity` (now passed explicitly) in libs/shared/domain/src/lib/notifications.ts, and export them from libs/shared/domain/src/index.ts
- [X] T007 Unit tests for T006 in libs/shared/domain/src/lib/notifications.spec.ts. They cover: own action, preferences missing or off, type off, flags missing, blocked or muted; first send, inside the window, after the window with the skipped count; text for each type with previews on and off, title truncation, and no other fields leaking; likes grouped per post
- [X] T008 Create apps/api/src/notifications/push-sender.ts wrapping `web-push`: VAPID details from config, a 5-second timeout, TTL of 24 hours, `Topic` = base64url of a SHA-256 hash of the collapse key cut to 32 characters. It returns `'ok' | 'gone' | 'failed'` (404/410 → gone)
- [X] T009 Create apps/api/src/notifications/notifications.schemas.ts with `push_devices`, `notification_preferences` and `notification_deliveries` (TTL 1 day), per data-model.md, with no Mongo defaults on optional fields
- [X] T010 Create apps/api/src/notifications/notifications.service.ts with:
  - `register(def)` and `registerActivitySource(src)`;
  - `notify(event)`, which never throws and follows the decision order in data-model.md;
  - atomic collapse via `findOneAndUpdate`, with a retry on duplicate key;
  - device fan-out, deleting a device on `gone`.
- [X] T011 Create apps/api/src/notifications/notifications.dto.ts with the preferences, subscription (HTTPS plus an allow-listed push host, at most 1024 characters), unregister and activity cursor DTOs
- [X] T012 Create apps/api/src/notifications/notifications.module.ts: an `@Global()` module exporting `NotificationsService`, and a controller with `GET /config` (no flag required), `GET/PUT /preferences`, `POST /offer/dismiss`, `POST/GET /devices`, `DELETE /devices/:id` and `POST /devices/unregister` under `@RequireModule('push')`, all no-store. Register it in apps/api/src/app/app.module.ts
- [X] T013 Service spec in apps/api/src/notifications/notifications.service.spec.ts. It covers:
  - nothing is sent without config;
  - the skip rules;
  - collapse counts;
  - a gone device is deleted;
  - a failure is swallowed;
  - registering moves an endpoint to its new owner;
  - the 11th device evicts the least recently used;
  - DTO host allow-list rejection.

## Phase 3: US1 + US2, friend notifications and opting in (P1, MVP)

**Goal**: friend requests and acceptances notify, permission is asked only on a tap, and Safari tabs get Add-to-Home-Screen guidance.
**Independent test**: quickstart sections 1 and 2, steps 1–3 and 8.

- [X] T014 [US1] Make `SocialGraphService.act` return `boolean` (state changed). Set `acceptedAt` on accept, and unset it on unfriend, decline, cancel or block, in apps/api/src/social-graph/social-graph.module.ts. Update its spec
- [X] T015 [US1] In apps/api/src/social/social.module.ts:
  - register the `friendRequest` (opens `/friends`) and `friendAccepted` (opens `/people/:actorId`) types, both requiring `social`, with no collapse window and keyed by actor;
  - in `act`, call `notify` without awaiting it, after a state-changing `request` or `accept`, with the actor's display name.
- [X] T016 [P] [US1] Add `push` and `notificationclick` handlers to apps/web/public/sw.js per contracts/notifications-api.md: always show a notification, set the badge when supported, open same-origin paths only, never fetch or cache `/api`. Bump `VERSION`
- [X] T017 [P] [US2] Create apps/web/src/lib/push.ts with:
  - `pushSupport()`, returning `'installed' | 'browser' | 'ios-tab' | 'unsupported'` (using `isIOSDevice`);
  - `enablePush()`, which must be called from a click: permission, subscribe with `urlBase64ToUint8Array(publicKey)`, register, store the device id;
  - `resyncSubscription()`, `unregisterThisDevice()` and `setBadge(n)`.
- [X] T018 [US1] In apps/web/src/components/service-worker.tsx, handle `{type:'navigate'}` messages with `router.push`, and call `resyncSubscription()` on start when permission is granted
- [X] T019 [US2] In apps/web/src/lib/auth-context.tsx, have `logout` await `unregisterThisDevice()` (2-second limit, errors ignored) before the existing logout call
- [X] T020 [P] [US2] Create apps/web/src/components/notification-offer.tsx. It is a dismissible card shown after a first friend request, post or comment, when the feature is available, notifications are not yet on, and the offer isn't hidden. It shows iOS Add-to-Home-Screen steps for `'ios-tab'` and calls `POST /offer/dismiss` when dismissed
- [X] T021 [US2] Show `NotificationOffer` after sending a friend request (apps/web/src/components/social.tsx), after publishing (apps/web/src/components/post-composer.tsx) and after commenting (apps/web/src/components/post-engagement.tsx)
- [X] T022 [US2] Create apps/web/src/app/settings/notifications/page.tsx with a main switch and support, blocked or unsupported states, and link it from Menu (apps/web/src/app/menu/page.tsx), where the other settings links live. Hide it when `available` is false
- [X] T023 [P] [US1] Add SWR hooks `useNotificationsConfig` and `useNotificationPreferences` in apps/web/src/lib/hooks.ts

## Phase 4: US3, likes and comments (P2)

**Goal**: post owners are notified of comments and likes, and bursts collapse.
**Independent test**: quickstart section 2, steps 4–7.

- [X] T024 [US3] Register `postLike` (15-minute window, keyed by post) and `postComment` (2-minute window, keyed by post), both requiring `social` and `foodPosts`, opening `/posts/:id`, in apps/api/src/posts/posts.module.ts
- [X] T025 [US3] In apps/api/src/posts/post-engagement.service.ts, notify the post owner without awaiting it, only when a like row was newly inserted (`upsertedCount`) or a comment was newly inserted (not a retried `requestId`). Include the post title and comment text. Extend its spec

## Phase 5: US4, choices and devices (P2)

**Independent test**: quickstart section 2, step 6, and removing a device.

- [X] T026 [US4] Add per-type switches, "Show comment previews" and the device list (marking "This device", with removal) to apps/web/src/app/settings/notifications/page.tsx

## Phase 6: US5, Activity and badge (P3)

**Independent test**: quickstart section 3, step 4 (and desktop: the unseen count updates).

- [X] T027 [US5] Add `GET /activity`, `GET /activity/unseen` and `POST /activity/seen` to the notifications controller and service. They merge the sources, apply `groupActivity` and a 30-day floor, and add the badge count to every payload. Files: apps/api/src/notifications/notifications.module.ts and notifications.service.ts
- [X] T028 [US5] Register an Activity source in apps/api/src/social/social.module.ts (pending incoming requests and accepted requests I sent, using `acceptedAt`, excluding blocks)
- [X] T029 [US5] Register an Activity source in apps/api/src/posts/post-engagement.service.ts (likes and comments by others on my posts from the last 30 days that aren't deleted, excluding blocked users)
- [X] T030 [US5] Create apps/web/src/app/activity/page.tsx (calls `seen` on open, then clears the badge), and add a bell with the unseen count to apps/web/src/components/app-shell.tsx. Call `setBadge` on app start

## Phase 7: Polish

- [X] T031 [P] Create docs/modules/notifications.md: purpose, schemas, endpoints, registry, decision order, dependency and collection justifications, how to add a type (chat)
- [X] T032 [P] Update docs/modules/social.md (`acceptedAt`, notifications) and docs/modules/posts.md (notification hooks, Activity source)
- [X] T033 [P] Append to docs/DECISIONS.md (no worker; suppression is decided on the server because iOS forbids silent pushes; derived Activity) and docs/CHANGELOG.md. Add one trip-wire line to CLAUDE.md
- [X] T034 Run `npm run check` and fix anything it reports
- [X] T035 Boot against local Mongo with generated keys and run quickstart sections 1 and 2 (desktop Chrome on localhost). Record the results in specs/012-web-push-notifications/verification.md

## Dependencies

- Setup → Foundational → US1/US2 → US3 → US4 → US5 → Polish.
- US3 needs only the Foundational phase and T016–T018 (receiving on the device). US4 builds on the T022 page. US5 needs T014 (`acceptedAt`).
- Can run in parallel: T002/T003; T005 with T008/T009; T016, T017, T020 and T023; T031–T033.

## Implementation strategy

The MVP is Phases 1–3: friend notifications end to end on desktop and iPhone. Then add likes
and comments, then the settings detail, then Activity and the badge. Each phase stays behind
the `push` flag and the VAPID config, so main stays shippable throughout.
