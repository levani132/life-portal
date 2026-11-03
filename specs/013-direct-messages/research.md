# Research: Direct messages

## R1. Live updates: short polling now, sockets later

- **Decision**: While a conversation is on screen and the page is visible, the web calls
  `POST /conversations/:id/sync {after}` every 3 seconds. That one call returns new messages
  and the other member's read time, and records that the caller has read and is viewing the
  conversation. The inbox and header icon refresh every 15 seconds while visible. Everything
  pauses on `visibilitychange` to hidden.
- **Why**:
  - The constitution requires no always-on worker or paid service.
  - A socket gateway needs sticky connections and a pub/sub layer (Redis) once there is more
    than one API instance, which is Tier 1 of the architecture plan.
  - Polling one indexed query every 3 seconds per open conversation is negligible at the
    current scale.
  - Polling is also the presence signal: "viewing" means a sync in the last 15 seconds. That
    gives notification suppression (spec FR-018, FR-020) for free, and covers several devices
    because the timestamp is per member, not per device.
- **Upgrade path**: replace the polling loop with a WebSocket or server-sent-events gateway
  that has Redis fan-out. The `sync` contract (messages after X, plus read state) stays the
  payload, so the UI does not change.
- **Alternatives**:
  - Server-sent events: `EventSource` cannot send an `Authorization` header, and putting the
    access token in the URL leaks it into logs.
  - Long polling: holds connections open on a single small instance, for little gain.

## R2. One conversation per pair; groups not ruled out

- **Decision**: `conversations` has `kind: 'direct'`, a `memberIds` array, a unique `pair` key
  (the sorted IDs joined by `:`) and embedded per-member state
  `members[{userId, lastReadAt?, viewingAt?, muted?}]`. "Get or create" is an upsert on
  `pair`.
- **Why**: The unique index enforces FR-002 even when both friends tap Message at the same
  moment. Embedded per-member state is one document per conversation, updated with the
  positional operator. A future `kind: 'group'` drops `pair` (it is partial-unique) and keeps
  the same members shape.

## R3. Inbox without stored "last message"

- **Decision**: The inbox is derived on read:
  1. Load the member's conversations (capped at 50).
  2. One aggregation over `messages` (`$match` on conversation, `$sort createdAt desc`,
     `$group` taking the first) gets each conversation's last message.
  3. One `countDocuments` per conversation counts the other member's messages newer than this
     member's `lastReadAt`, stopping at 99.

  Conversations with no messages are left out, as in Instagram.
- **Why**: Principle III, derived never persisted. Storing `lastMessageAt` or unread counters
  would be a second source of truth that unsending and retries can corrupt. Index
  `(conversationId, createdAt desc)` keeps each query cheap.
- **Scale note**: at Tier 1 an inbox projection maintained from an event stream replaces this.
  That would need a constitution amendment (a derived read model), recorded in DECISIONS.

## R4. Shared posts are references, checked at read

- **Decision**: A post message stores only `postId`. Rendering calls
  `PostsService.detail(viewerId, postId)`, the same authorization as opening the post, and
  turns success into a card `{id, title, authorName, totalKcal}`. Any refusal becomes
  `{unavailable: true}`.
- **Why**: Principle IV (single-sourced links) and FR-010. Deleting a post, narrowing its
  audience, unfriending or blocking all change what the card shows with no extra code. The
  sender must also pass `detail()` when sending (FR-009).
- **Cost**: at most 30 detail calls per page. They run in parallel and are acceptable at this
  scale.

## R5. Idempotent sends and rate limit

- **Decision**: Messages are unique on `(conversationId, senderId, requestId)`. A send is an
  upsert with `$setOnInsert`. A retry returns the original message, and only a newly inserted
  message notifies.
- **Rate limit**: count the sender's messages in the last 60 seconds
  (`(senderId, createdAt)` index). If there are 30 or more, refuse with a 429 "You're sending
  messages too fast." The count lives in the database, so it holds across instances without
  Redis.

## R6. Unsend

- **Decision**: `$set {unsentAt: now}` and `$unset {text, postId}`. The row stays (a tombstone)
  so ordering, "Seen" and the inbox preview stay consistent. Only the sender can unsend.
- **Why**: FR-006. Erasing the content rather than hiding it matches what members expect from
  "unsend for everyone".

## R7. Notifications through the shared system

The `message` type is registered by MessagesService, as `docs/modules/notifications.md` says to
do:

| Field | Value |
|---|---|
| `requires` | `['messages']` |
| `windowMs` | `0`: every message may notify |
| `collapseKey` | the conversation ID, so the device tag replaces the previous notification and `renotify` makes it alert again |
| `url` | `/messages/:id` |
| `suppress` | true when the recipient muted the conversation, or synced it within 15 seconds |

- **Badge**: a badge source adds the number of conversations with unread messages.
- **Text**: `notificationText` gets a `message` case: "sent you a message", or "shared a
  post". With the new `showMessagePreviews` setting it adds up to 80 characters of text. Block
  and mute between members are already handled by `shouldNotify`.
- **Service worker**: `renotify` is extended to tags starting with `message:`.
