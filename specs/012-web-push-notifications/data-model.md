# Data model: Push notifications

All three collections belong to `NotificationsModule`. Timestamps are real `Date`s: these are
instants, not calendar days. Nothing here stores a count that could be derived. `suppressed` is
the number of sends we skipped, which is a fact about delivery, not a projection of other data.

## `push_devices`

One browser push subscription for one member.

| Field | Type | Rules |
|---|---|---|
| `userId` | string | required, indexed |
| `endpoint` | string | required, **unique**, HTTPS URL, at most 1024 characters. Never returned in responses (it acts as a capability). |
| `keys.p256dh` | string | required, base64url |
| `keys.auth` | string | required, base64url |
| `label` | string | 1–60 characters, e.g. "iPhone", "Mac · Chrome". Supplied by the client and shown in Settings. |
| `lastUsedAt` | Date | set on every register call; used for 10-device eviction |
| `lastSuccessAt` | Date? | set after a 2xx from the push service |
| `createdAt`, `updatedAt` | Date | timestamps |

- Index `(userId, lastUsedAt desc)`.
- **Register** is an upsert by `endpoint` that sets `userId`, keys, label and `lastUsedAt`.
  This moves a shared device to its current user (FR-008). After it, if the user has more than
  10 devices, the one with the oldest `lastUsedAt` is deleted.
- **Removed when**: the push service answers 404 or 410 (FR-007); the member deletes it; the
  device signs out (`unregister`); the account is deleted.
- **Not removed** on a 429 or 5xx: those are logged and the device is kept.

## `notification_preferences`

One row per member, created the first time they turn notifications on.

| Field | Type | Rules |
|---|---|---|
| `userId` | string | **unique** |
| `enabled` | boolean | main switch. With no row, the member has never enabled notifications, which counts as off. |
| `types` | `Partial<Record<NotificationType, boolean>>` | a missing key means **on** (FR-023). No Mongo `default` is used, so a missing key really reads as missing. |
| `showCommentPreviews` | boolean? | missing means off |
| `activitySeenAt` | Date? | when Activity was last opened; missing means everything counts as unseen |
| `offerDismissedAt` | Date? | the in-app offer stays hidden for 14 days after this (FR-002) |

Turning the main switch off keeps `types` (US4 scenario 2).

## `notification_deliveries`

State used only for collapsing. It's safe to lose.

| Field | Type | Rules |
|---|---|---|
| `recipientId` | string | |
| `type` | NotificationType | |
| `collapseKey` | string | e.g. a post ID or the actor's user ID |
| `lastSentAt` | Date | |
| `suppressed` | number | sends skipped since `lastSentAt` |

- **Unique** `(recipientId, type, collapseKey)`.
- TTL index on `lastSentAt`, expiring after 1 day.
- Updated only through the atomic collapse step (research R4).

## Change to an existing collection

`social_connections.acceptedAt?: Date` is `$set` when a request is accepted and `$unset` when
the pair returns to `none`. It has no default and no backfill. The doc update goes in
`docs/modules/social.md`.

## Types in code (`libs/shared/types/src/lib/notifications.ts`)

- `NOTIFICATION_TYPES = ['friendRequest', 'friendAccepted', 'postComment', 'postLike'] as const`.
  Later types (`message`, `challenge…`) are added here.
- `NotificationEvent`: `{ type, recipientId, actorId, actorName, targetId, postTitle?,
  commentText? }`. This is the only input `notify()` takes, and senders fill it from data they
  already loaded.
- `PushPayload` (encrypted, read only by the service worker): `{ title, body, url, tag,
  badge? }`.
- `ActivityItem`: `{ id, type, actors: {userId, displayName}[], othersCount, url, postTitle?,
  createdAt }`.
- `NotificationPreferences`, `PushDeviceSummary` (`{id, label, createdAt, lastUsedAt}`),
  `NotificationsConfig` (`{available, publicKey?}`).
- `FEATURE_IDS` gains `'push'`. Through the existing `resolveFeatureAccess`, this defaults on
  for internal and developer accounts and off for production.

## Type registry (`NotificationsService.register`)

Each type is defined once, by the module that owns the event:

```ts
interface NotificationTypeDef {
  type: NotificationType;
  requires: FeatureId[];                // e.g. ['social'] or ['social','foodPosts']
  collapse: { windowMs: number; key: (e) => string } | { windowMs: 0; key: (e) => string };
  url: (e) => string;                    // path inside the app
  canStillSee?: (e) => Promise<boolean>; // e.g. recipient can still read the post
  suppress?: (e) => Promise<boolean>;    // FR-030: e.g. recipient is viewing the conversation
  countsTowardBadge: boolean;
}
interface ActivitySource {
  types: NotificationType[];
  items(userId: string, since: Date, limit: number): Promise<ActivityItem[]>;
  unseen(userId: string, since: Date | undefined): Promise<number>;
}
```

The text comes from `notificationText()` in the domain lib, keyed by type. A new type adds a
case there, with a test.

## `notify(event)` decision order

These steps are pure where possible. The `shouldNotify()` domain function covers 2–4.

1. Resolve the type definition. If there is none, or push is not configured, stop.
2. Skip if `actorId === recipientId`.
3. Skip if the recipient's preferences are missing, `enabled` is false, or `types[type]` is
   false.
4. Skip if the recipient lacks `push` or any feature in `requires`. The same check applies to
   the actor's `social` access.
5. Skip if the pair is blocked in either direction, or the recipient has muted the actor
   (`SocialGraphService.between`).
6. Skip if `canStillSee` or `suppress` say so.
7. Run the atomic collapse step. If the send is suppressed, stop.
8. Build the payload (`notificationText`, and `badge` = sum of `unseen()` over the sources) and
   send it to every device the recipient has, in parallel. Each send has a 5-second limit, a
   message TTL of 24 hours, and `Topic` set to a hash of the collapse key.
9. On a 404 or 410, delete that device. On a 2xx, set `lastSuccessAt`.
