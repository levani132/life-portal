# Implementation Plan: Push notifications for the installed app

**Branch**: `012-web-push-notifications` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/012-web-push-notifications/spec.md`

## Summary

A new global `NotificationsModule` that any module sends through. It holds the devices,
preferences and collapse state, and a **registry** where each module declares its notification
types and an Activity source. Social registers friend request and accepted request; Posts
registers like and comment. Chat and challenges will later register their own types and
sources without touching this module (FR-029, FR-030).

Delivery is standard Web Push with VAPID via `web-push`. It is sent right after the causing
write without awaiting it, so no worker is needed (constitution: free tier). The service
worker gains `push` and `notificationclick` handlers that open the installed app on the target
path. The web gains a permission offer at the right moments, Settings › Notifications, an
Activity page and the icon badge. The whole feature is gated by a new `push` feature flag and by
VAPID keys being present.

## Technical Context

**Language/Version**: TypeScript (strict), Node 20+

**Primary Dependencies**: NestJS 11, Mongoose 9, Next.js 16 App Router, SWR. **New:**
`web-push` (API only, research R1).

**Storage**: MongoDB. New `push_devices`, `notification_preferences` and
`notification_deliveries` (TTL) collections, plus `social_connections.acceptedAt`.

**Testing**: Jest (`libs/shared/domain`, `apps/api` specs, `apps/web` with next/jest). Manual
device checks per [quickstart.md](quickstart.md).

**Target Platform**: iOS/iPadOS 16.4+ Home Screen app, Android Chrome, desktop Chromium,
Safari and Firefox.

**Project Type**: Web app (Nx monorepo: `apps/api`, `apps/web`, `libs/shared/*`)

**Performance Goals**: notification visible within 10 seconds (SC-002). Response time of a
like, comment or friend request unchanged (SC-007).

**Constraints**: no always-on worker; no cached `/api` responses in the service worker; every
push visible; lock-screen text limited to names, the action and the recipient's own post title.

**Scale/Scope**: current testing cohort. Up to 10 devices per member. Activity scans the last
30 days.

## Constitution Check

*GATE: must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle / constraint | How the plan satisfies it |
|---|---|
| I. Bounded module | Notifications is its own module with its own collections. It never reads another module's collections. Social and Posts give it data through registered type definitions and Activity sources. It is a platform module (like Access or SocialGraph), not a widget, so it gets no Home card. Activity is reached from the header. |
| II. Integer money | Not applicable. No money appears in notifications at all (FR-017). |
| III. Derived never persisted | Activity and the unread count are derived on read from likes, comments and connections. Stored state is limited to facts: devices, the member's choices, when Activity was opened, and when a push was sent and how many were skipped. |
| IV. Single-sourced links | Notifications reference posts and people by ID and URL. Nothing is copied except the post title, and only into the encrypted push payload, which is not stored. |
| V. Pure functions | `shouldNotify`, `collapseDecision`, `notificationText` and `groupActivity` go in `libs/shared/domain/src/lib/notifications.ts`, with "now" passed explicitly. Unit-tested. |
| VI. Estimates labelled | Not applicable. |
| Free-tier deployable | Sending is not awaited, happens in the request, and has a 5-second limit per device. No queue or worker (research R3). |
| External APIs degrade gracefully | Without VAPID keys the feature is hidden and the app works. A failing push service never fails the user's action. |
| Secrets via env | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` go in `.env.example`. A partial configuration refuses to boot. |
| Validation and auth | DTOs on every write. `@RequireModule('push')`. Push endpoints are allow-listed to known push services, so a client cannot make the server send requests to other hosts. |
| Complexity justified | One dependency (`web-push`: VAPID signing and payload encryption). Three collections (devices, choices, collapse state), each justified in `docs/modules/notifications.md`. |

**Result**: passes, with no violations, so there is no Complexity Tracking table. The design
re-check found the same.

## Project Structure

### Documentation (this feature)

```text
specs/012-web-push-notifications/
├── spec.md
├── plan.md                       # this file
├── research.md                   # R1–R9 decisions
├── data-model.md                 # collections, types, registry, notify() order
├── quickstart.md                 # manual and device verification
├── contracts/notifications-api.md
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source code

```text
libs/shared/types/src/lib/
├── notifications.ts              # NEW: types, event, payload, activity, preferences
└── portal.ts                     # FEATURE_IDS += 'push'; feature name entry
libs/shared/domain/src/lib/
├── notifications.ts              # NEW: shouldNotify, collapseDecision, notificationText, groupActivity
└── notifications.spec.ts         # NEW

apps/api/src/
├── config/configuration.ts       # optional VAPID trio, all-or-nothing validation
├── access/access.module.ts       # FeatureOverridesDto.push
├── notifications/                # NEW, @Global()
│   ├── notifications.module.ts   # controller, schemas, module wiring
│   ├── notifications.service.ts  # register(), registerActivitySource(), notify(), activity
│   ├── push-sender.ts            # wraps web-push: timeout, TTL, Topic, 404/410 handling
│   ├── notifications.dto.ts
│   └── *.spec.ts
├── social-graph/social-graph.module.ts  # act() returns changed; acceptedAt
├── social/social.module.ts       # registers friend types and source; calls notify()
└── posts/
    ├── post-engagement.service.ts # calls notify() on a new like or comment
    └── posts.module.ts            # registers like and comment types and source

apps/web/
├── public/sw.js                  # push + notificationclick (still no /api caching)
└── src/
    ├── lib/push.ts               # NEW: support detection, subscribe, register, unregister, badge
    ├── lib/auth-context.tsx      # logout unregisters this device first
    ├── components/service-worker.tsx   # handle 'navigate' messages; re-register on start
    ├── components/notification-offer.tsx  # NEW: contextual offer / Add-to-Home-Screen guide
    ├── components/app-shell.tsx  # Activity bell with unseen count
    ├── app/settings/notifications/page.tsx  # NEW
    └── app/activity/page.tsx     # NEW

docs/modules/notifications.md     # NEW module doc
docs/modules/social.md, posts.md  # acceptedAt; notification hooks
docs/DECISIONS.md, docs/CHANGELOG.md, .env.example, CLAUDE.md (one trip-wire line)
```

**Structure decision**: the existing Nx layout. The new API module follows the
`SocialGraphModule` pattern (`@Global()`, exported service). Notifications depends only on
`AccessService`, `SocialGraphService` and `CONFIG`, which are all global, so Social and Posts
can import it without a cycle.

## Phases for `/speckit-tasks`

Each phase leaves the app shippable behind the flag.

1. **Foundation**: types, `push` flag, VAPID config, domain functions and their tests, and the
   NotificationsModule (schemas, registry, `notify()`, sender, config/preferences/devices
   routes).
2. **US1 + US2 (P1)**: social types and notify calls, `acceptedAt`, service worker handlers,
   `lib/push.ts`, the offer component and the minimal Settings page with the main switch,
   unregister on logout.
3. **US3 (P2)**: like and comment types with collapse, notify calls in `PostEngagementService`.
4. **US4 (P2)**: per-type switches, comment previews, the device list with removal.
5. **US5 (P3)**: Activity sources, `/activity` page, header bell, badge in the payload and on
   app start.
6. **Docs and verification**: module docs, DECISIONS, CHANGELOG, `.env.example`, the CLAUDE.md
   trip-wire ("every push must show a notification; never decide suppression in sw.js"),
   `npm run check`, quickstart sections 1–2 locally, and section 3 on the deployed app.

## Risks

- **iOS details vary by version**, for example `renotify`, `Topic` support and badges in the
  service worker. Each call is feature-checked, so the worst case is a stacked notification or
  a missing badge, never a lost one.
- **Process restart mid-send** drops that push. Activity still shows the item (research R3).
- **Changing the VAPID keys** invalidates every subscription. Documented, and each app
  re-registers on its next start.
