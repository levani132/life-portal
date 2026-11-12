# Notifications (push and Activity)

One shared system that any module sends through: Web Push to installed devices, an Activity
list, and the app icon badge. It is a platform module like Access or SocialGraph, not a widget,
so it has no Home card. Activity is reached from the header bell, and choices are under
Menu › Notifications.

Spec, research and contracts: [specs/012-web-push-notifications](../../specs/012-web-push-notifications/spec.md).

## Gates

- **Feature flag `push`.** It is on for internal and developer accounts and off in
  production by default, and can be changed per cohort or user in Feature access. Every type
  also needs the recipient's `social`, plus whatever its definition `requires`.
- **VAPID keys.** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`, all three or
  none. With none, `GET /api/notifications/config` answers `{available:false}` and the web hides
  everything. With only some, the API refuses to boot.
  - Generate the keys once with `npx web-push generate-vapid-keys`.
  - **Changing the keys invalidates every subscription.** Each app re-registers on its next
    start (`resyncSubscription`), so it recovers, but only after each device opens the app.

## Collections

The schemas are in `apps/api/src/notifications/notifications.schemas.ts`. Every collection
holds only facts. Activity and unread counts are derived on read (principle III).

- **`push_devices`**: one browser subscription.
  - Fields: `userId`, `endpoint` (unique), `keys`, `label`, `lastUsedAt`, `lastSuccessAt`.
  - **Registering is an upsert by `endpoint`,** so a shared device moves to whoever signed in
    last.
  - Each member keeps at most 10 devices, evicting the least recently used.
  - **Removed** on a 404/410 from the push service (after the first one), on removal in
    Settings, and on sign-out. Never removed on a 429 or 5xx.
  - **The endpoint is a capability URL.** It is never returned in a response and never logged.
- **`notification_preferences`**: per member.
  - Fields: `enabled` (main switch), `types` (a missing key means on), `showCommentPreviews`
    and `showMessagePreviews` (missing means off), `activitySeenAt`, `offerDismissedAt`.
  - No Mongo defaults are used.
- **`notification_deliveries`**: collapse state per (recipient, type, collapse key):
  `lastSentAt` and `suppressed`. It has a 1-day TTL, and losing it at worst sends one extra
  notification.

Why each collection exists, as the constitution asks: devices are the delivery addresses,
preferences are the member's own choices, and deliveries make collapsing possible without a
timer or worker.

**Dependency: `web-push`.** It does VAPID signing and payload encryption (RFC 8030/8291/8292).
Only `push-sender.ts` imports it.

## API (`/api/notifications`, all `Cache-Control: private, no-store`)

| Route | Notes |
|---|---|
| `GET /config` | No feature check, so the web knows whether to show anything |
| `GET`/`PUT /preferences` | `PUT` merges the fields given. Unknown type keys get a 400. Only `userId` is seeded on insert |
| `POST /offer/dismiss` | Hides the in-app offer for 14 days |
| `POST /devices` | `{subscription, label, enable?}`. The endpoint must be HTTPS on a known push service host (`PUSH_SERVICE_HOSTS`), so it cannot be used to make the server request arbitrary URLs. `enable:true` (from a tap) turns notifications on; a background re-sync never does |
| `GET /devices` | Labels and dates only |
| `DELETE /devices/:id` | Owner only, otherwise 404 |
| `POST /devices/unregister` | `{endpoint}`, used at sign-out. No feature check |
| `GET /activity?before=` | 20 grouped items, newest first, from the last 30 days |
| `GET /activity/unseen` | `{count}`: the badge number |
| `POST /activity/seen` | Sets `activitySeenAt` |

## Sending: `NotificationsService.notify(event)`

Callers fire it **without awaiting**. It never rejects, so a failing push service cannot fail
the like, comment or request. It runs inside the request process with a hard 5-second limit
per device, and needs no worker or queue (constitution: free-tier deployable).

The decision order (`shouldNotify` in `libs/shared/domain/src/lib/notifications.ts` covers
steps 2–5):

1. A registered type exists, and keys are configured.
2. The actor is not the recipient, unless the type is registered with `selfAllowed` (only
   `badgeEarned`, which is about the recipient's own doing).
3. The main switch is on and the type is not off.
4. The recipient has `push` plus the type's `requires`, and the actor has `social`.
5. The pair is not blocked in either direction, and the recipient has not muted the actor.
6. The type's `canStillSee` and `suppress` hooks allow it.
7. The atomic collapse step:
   - If the window has passed (or this is the first), send and report how many were skipped.
   - Otherwise, count this one as skipped and stop.
   - A duplicate-key race between two simultaneous likes is decided again.
8. Send the payload `{title, body, url, tag, badge}` to every device of the recipient.

**Lock-screen text** comes from `notificationText()`. It can only ever receive names, the
action, the recipient's own post title and (if previews are on) up to 80 characters of a
comment. Food, nutrition, weight, activity and money never reach it.

## Adding a type

Messages ([messages](messages.md)) was added exactly this way and is the worked example.

1. Add the type to `NOTIFICATION_TYPES` in `libs/shared/types/src/lib/notifications.ts`, and
   add a `notificationText` case with a test.
2. In the owning module's `onModuleInit`, call `notifications.register({type, requires,
   windowMs, collapseKey, url, canStillSee?, suppress?})`.
   - For chat, `collapseKey` is the conversation.
   - `suppress` returns true when the recipient is viewing that conversation. **This must be
     decided on the server.** iOS revokes subscriptions that receive pushes which show nothing,
     so `sw.js` always shows what it receives.
3. Call `notify()` after the write, without awaiting it.
4. If the unread state is not Activity, for example unread messages, register a
   `registerBadgeSource({unseen})` so it is added to the icon badge.
5. Add an Activity source with `registerActivitySource({rows})` if the events belong in
   Activity. Rows come from the module's own collections. The service removes the member's own
   actions (except for a `selfAllowed` type) and anyone blocked.

Current types:

| Type | Registered by | Window | Collapse key | Opens |
|---|---|---|---|---|
| `friendRequest` | SocialService | none | actor | `/friends` |
| `friendAccepted` | SocialService | none | actor | `/people/:actor` |
| `postComment` | PostEngagementService | 2 min | post | `/posts/:id` |
| `postLike` | PostEngagementService | 15 min | post | `/posts/:id` |
| `postRepost` | PostEngagementService | 15 min | post | `/posts/:id` |
| `message` | MessagesService | none (replaces per conversation) | conversation | `/messages/:id` |
| `badgeEarned` | BadgesService (`selfAllowed`) | none (one per evaluation) | recipient | `/profile?badge=:id` |

## Web

- **`apps/web/public/sw.js`**:
  - `push` always calls `showNotification`, and sets the badge when the browser supports it.
  - `notificationclick` focuses an open app window and posts `{type:'navigate', url}`, or calls
    `openWindow(url)`, which opens the installed app rather than a browser tab.
  - Only same-origin paths are honoured.
  - **The worker still never caches `/api`.**
  - Development registers `/sw.js?mode=push`, which handles pushes but caches nothing.
- **`lib/push.ts`**:
  - `enablePush()` is the only caller of `Notification.requestPermission()`, and runs only from
    a button tap. iOS refuses a prompt without a gesture, and a refusal cannot be re-asked from
    the page.
  - `pushSupport()` tells an iPhone Safari tab (show "Add to Home Screen") from an unsupported
    browser.
  - Sign-out calls `unregisterThisDevice()` first, limited to 2 seconds.
- **`components/notifications.tsx`**:
  - `NotificationsBridge` (in AppShell) re-syncs the subscription, keeps the badge current and
    hosts the offer.
  - `requestNotificationOffer()` runs after sending a friend request, publishing and
    commenting.
  - Also provides the header bell, the Settings page and the Activity list.

## Open questions and limits

- A push in flight during a process restart is lost. The item still shows in Activity and the
  badge.
- Likes inside a window with no later like never produce a second push. They still appear in
  Activity.
- There is no account deletion feature yet. When one is added, it must delete the member's rows
  in all three collections.
- The posts Activity source reads the owner's 500 most recent posts. Moving to a per-recipient
  query is the obvious change at larger scale. The source interface stays the same.
