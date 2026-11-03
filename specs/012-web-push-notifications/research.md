# Research: Push notifications for the installed app

Each entry: decision, why, and what else was considered.

## R1. Delivery protocol and library

- **Decision**: Standard Web Push (VAPID + `aes128gcm` payload encryption), sent with the
  `web-push` npm package from the API.
- **Why**: It is the only push channel a PWA has. Apple (iOS/iPadOS 16.4+ Home Screen apps,
  Safari 16+ on macOS), Google (FCM endpoints for Chrome/Android) and Mozilla all accept the
  same protocol, so one code path covers every platform. `web-push` is the reference Node
  implementation, has no native parts and does the encryption and VAPID signing. Writing that
  by hand is about 300 lines of crypto we would have to maintain. This one dependency is
  justified in `docs/modules/notifications.md` (constitution, Governance). Version 3.6.7 has had
  no release since January 2024. That is acceptable because the protocol it implements (RFC
  8030/8291/8292) is frozen. All of it sits behind `push-sender.ts`, so replacing it touches
  one file.
- **Alternatives**:
  - Firebase Cloud Messaging SDK: adds a Google account and an SDK on both sides, and on iOS it
    only wraps Web Push anyway.
  - OneSignal and similar hosted services: a paid managed service once usage grows, and the
    notification text would pass through a third party.
  - Native APNs: needs a native app, which comes later.

## R2. iOS constraints that shape the design

- **Push works only in the installed app.** On iOS, `PushManager` exists only when the app runs
  standalone from the Home Screen. A Safari tab has no push. We detect this with
  `matchMedia('(display-mode: standalone)')` or `navigator.standalone`, together with
  `isIOSDevice()` from `lib/ios-device.ts`, and show "Add to Home Screen" guidance instead
  (FR-003).
- **Permission needs a tap.** `Notification.requestPermission()` must run inside a user
  gesture's handler. Called anywhere else it is refused silently, and a refusal cannot be asked
  again from the page. So the only call site is the click handler of the "Turn on
  notifications" button (FR-001).
- **No silent push.** Every `push` event must end in `showNotification`, or Safari may revoke
  the subscription. **Consequence**: "skip when the user is already looking at it" (FR-030) can
  never be decided in the service worker. It must be decided on the server, *before* sending.
  The plan therefore puts that check in the type definition (`suppress` hook) and runs it
  server-side. No current type uses it; chat will use it with a presence signal.
- **Badges**: `navigator.setAppBadge(n)` works in iOS 16.4+ installed apps, including inside the
  service worker's `push` handler, and in Chromium installed apps. Every call is wrapped in a
  feature check (FR, US5 scenario 4).
- **`pushsubscriptionchange` is unreliable on Safari.** Instead, each time the installed app
  starts with permission granted, it calls `getSubscription()` and re-registers. Registering is
  idempotent and also refreshes `lastUsedAt` (used by the 10-device eviction).
- **Opening the right screen**: in `notificationclick`, `clients.matchAll({type:'window',
  includeUncontrolled:true})` finds an open app window. We `focus()` it and `postMessage` the
  target path so the Next router navigates client-side. With no window open,
  `clients.openWindow(path)` opens the installed app (not Safari) because the path is inside the
  manifest scope. `WindowClient.navigate()` is not used: its Safari behaviour is inconsistent,
  and a full reload would lose app state.

## R3. Sending without a worker

- **Decision**: The module that caused the event calls `notifications.notify(event)` after its
  write succeeds, **without awaiting it** (`void …catch(log)`). Sending has a 5-second timeout
  per device.
- **Why**: The constitution requires the app to run on free tiers with no always-on worker
  (Technology Constraints). The Render instance stays awake (the user's cron), so a promise
  that finishes after the response is sent still completes. Not awaiting it means a slow or
  failing push service never slows down or fails the like, comment or friend request (SC-007,
  edge case "delivery failure never fails the action").
- **Trade-off**: a push in flight when the process restarts is lost. That's acceptable: the
  item is still in Activity and still counted in the badge, both of which are derived on read.
- **Alternatives**: a BullMQ/Redis queue adds a paid or always-on service, which the
  constitution rules out at this tier. It is the obvious step at Tier 1 of the architecture
  plan, and `notify()` is the single place it would plug in.

## R4. Collapsing bursts without a timer

- **Decision**: `notification_deliveries` holds one row per (recipient, type, collapse key),
  with `lastSentAt` and `suppressed`. One atomic `findOneAndUpdate` decides the outcome:
  - If `lastSentAt` is older than the type's window (or there is no row): set `lastSentAt=now`
    and `suppressed=0`, read the previous `suppressed` value, and send. The text then reads
    "Ana and N others…".
  - Otherwise: `$inc suppressed` and don't send.

  On the device, the notification `tag` equals the collapse key, so a newer notification
  replaces the older one instead of stacking. The `Topic` header also lets push services drop
  an undelivered older message with the same key.
- **Why**: There is no timer, no worker and no race between likes arriving at once, thanks to
  a unique index and a retry on duplicate key (FR-012, FR-014). The decision itself is a pure
  function in `libs/shared/domain`, so it can be unit-tested.
- **Accepted gap**: likes that arrive inside a window with no later like after it never produce
  a second push. They still show in Activity and in the badge. This matches the spec's
  "at most 2 per burst" goal.
- **Windows**: likes 15 min, keyed by post; comments 2 min, keyed by post (each comment after
  the window sends; inside the window it replaces the previous one via the same tag); friend
  request and accepted request: no window, keyed by person.

## R5. Activity and unread count without storing them

- **Decision**: Activity and the unread count are computed on read from rows the owning modules
  already have. Each module registers an **activity source** with the notifications service:
  - Posts: likes and comments on my posts.
  - Social: incoming pending requests, and accepted requests I sent.

  The notifications module stores only `activitySeenAt`.
- **Why**: Principle III. It also means a withdrawn like, deleted comment, cancelled request
  or new block disappears from Activity with no cleanup code (US5 scenario 3). The notifications
  module never queries another module's collections (principle I). A future chat module
  registers a source for unread messages, which covers FR-030's "module-supplied unread count".
- **Schema addition**: `social_connections.acceptedAt` is set on accept, so "accepted your
  request" has a time to sort by. `updatedAt` would move when someone mutes. Rows accepted
  before this change have no `acceptedAt`. They don't appear in Activity, which is correct
  because they are old news. No backfill.
- **Scale note**: the posts source looks at the recipient's posts from the last 30 days and
  their likes and comments since then, using the existing indexes. At Tier 1 scale this should
  move to a per-recipient query; the source interface stays the same.

## R6. Where preferences live

- **Decision**: a new `notification_preferences` collection owned by the notifications module.
  Settings › Notifications is a new page under `/settings/notifications`.
- **Why**: Principle I: one concern, one collection family. The existing `settings` document
  belongs to the settings module and holds display preferences, so putting push state there
  would make two modules write one document.
- **Defaults without the `default: 0` trap**: a missing preferences row means "never turned
  on". Type switches are a `types` object, and a missing key means on (FR-023). Reading treats
  `undefined` explicitly, never through Mongo defaults.

## R7. Lock-screen text

- **Decision**: the text is built server-side by a pure function `notificationText(type,
  input, {showCommentPreviews})`:

  | Type | Title | Body |
  |---|---|---|
  | friend request | actor's display name | "sent you a friend request" |
  | request accepted | actor's display name | "accepted your friend request" |
  | comment | actor's display name | "commented on “post title”" (preview on: followed by ": <first 80 chars>") |
  | likes | actor's display name | "liked “post title”", or "and N others liked “post title”" |

  The post title is cut to 60 characters.
- **Why**: FR-016–FR-018. The function has no access to nutrition data at all: post titles are
  the only post text it ever receives, so nothing else can leak in by accident.

## R8. Keys and configuration

- **Decision**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a `mailto:` or
  `https:` contact URL, required by push services) are optional in `AppConfig`. If any is
  missing, `GET /api/notifications/config` answers `{available:false}` and the web hides
  everything. If one is set but others are missing, or a key is malformed, the API refuses to
  boot, as with other half-configured secrets.
- **Key generation**: `npx web-push generate-vapid-keys`. Rotating keys makes every existing
  subscription invalid. Documented in the module doc.

## R9. Sign-out and shared devices

- **Decision**: `logout()` in `auth-context.tsx` first calls
  `POST /api/notifications/devices/unregister {endpoint}` (best-effort, 2-second limit), then
  `subscription.unsubscribe()`, then the existing logout (FR-006, SC-008). A registration's
  `endpoint` is unique. Registering an endpoint that belongs to another user moves it to the
  current user (FR-008), which covers a shared device whose previous user didn't sign out.
