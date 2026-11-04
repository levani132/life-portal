# Messages (direct messages between friends)

One-to-one conversations between accepted friends, Instagram-style but small. It is a platform
module, so it has no Home card. It is reached from the **Messages** bottom tab (after Home, with
the unread count), a friend's profile (**Message**) and a post's **Send** button.

Spec, research and contracts: [specs/013-direct-messages](../../specs/013-direct-messages/spec.md).

## Gates

- **Feature flag `messages`.** On for internal and developer accounts, off in production by
  default.
- **Sending** needs both members to have `messages` and `social`, to be accepted friends, and
  to have no block in either direction (`canMessage` in `libs/shared/domain/src/lib/messages.ts`).
- **History stays readable** after unfriending or blocking. Only sending stops.

## Collections

Schemas are in `apps/api/src/messages/messages.schemas.ts`. Nothing derived is stored
(principle III): inbox order, last message, unread counts and "Seen" are all worked out on read.

- **`conversations`**:
  - Fields: `kind: 'direct'`, `pair` (sorted member IDs; partial unique index, so one per
    pair), `memberIds` (indexed) and per-member `members[{userId, lastReadAt?, viewingAt?,
    muted?}]`.
  - A future group conversation keeps the members shape and has no `pair`.
- **`messages`**:
  - Fields: `conversationId`, `senderId`, `requestId` (client UUID; unique per conversation and
    sender), `kind: 'text' | 'post'`, `text?` (at most 2,000 characters), `postId?`, `unsentAt?`,
    `createdAt`.
  - Indexes: `(conversationId, _id desc)` for pages, last message and unread counts;
    `(senderId, createdAt desc)` for the rate limit.

Why these two collections: conversations hold the pair and each member's own state; messages
are the event rows. There are no new dependencies.

**Privacy.** Messages are encrypted at rest by the database provider. They are **not**
end-to-end encrypted, which matters for a health app and is stated here so nobody assumes
otherwise. Every response is `private, no-store`, and the service worker never caches `/api`.

## API (`/api/messages`, `@RequireModule('messages')`)

| Route | Notes |
|---|---|
| `GET /conversations` | Inbox, at most 50: newest last message first; only conversations with messages |
| `GET /unread` | `{count}`: conversations with unread messages (the Messages tab count) |
| `POST /conversations {userId}` | Get-or-create with a friend. 403 otherwise, and nothing is created |
| `GET /conversations/:id` | The other person, `canSend` (and why not), `muted`, `otherLastReadAt` |
| `GET /conversations/:id/messages?before=` | 30 per page, oldest first within the page |
| `POST /conversations/:id/sync {after?, since?}` | The poll: messages after `after`, IDs unsent since `since`, the other member's read time, `canSend`, `serverTime`. **Records that the caller has read and is viewing the conversation** |
| `POST /conversations/:id/messages {requestId, text \| postId}` | A retried `requestId` returns the original. 403 when they can't message, 400 for a post the sender can't see, 429 above 30 per minute |
| `DELETE /conversations/:id/messages/:messageId` | Unsend, sender only. Erases the text or post reference and keeps a tombstone |
| `PUT /conversations/:id/mute {muted}` | Only the caller's own notifications |

A conversation the caller isn't in answers 404, exactly like a missing one.

## Shared posts

A post message stores only `postId`. Each time it is shown, `PostsService.detail(viewer, id)`
runs, which is the same audience, friendship, block and deletion check as opening the post. The
result is a card (title, author, calories) or `{unavailable: true}`. Sending requires that the
sender can see the post. Nothing is copied, so deleting a post or narrowing its audience
updates every card (principle IV).

## Live updates and presence

- **While a conversation is on screen and the page is visible**, the web calls `sync` every 3
  seconds and once more when the app returns from the background. The inbox and the tab's
  count refresh every 15 seconds while visible. Nothing polls in the background.
- **Viewing means** a sync within the last 15 seconds (`isViewing`). This is the presence
  signal the notification `suppress` hook reads, and it works across devices because it is
  stored per member.
- **Upgrade path**: a WebSocket gateway with Redis fan-out at Tier 1. The `sync` payload stays
  the contract, so the UI won't need to change.

## Notifications

`MessagesService.onModuleInit` registers the `message` type with the shared system
([notifications](notifications.md)):

| Field | Value |
|---|---|
| `requires` | `['messages']` |
| Window | none |
| Collapse key | the conversation, so a newer message replaces the older notification and `renotify` makes it alert again |
| `url` | `/messages/:id` |
| `suppress` | the recipient muted it, or is viewing it |

- **Text**: "Ana · sent you a message" or "shared a post". With **Show message previews** on (off
  by default) it shows up to 80 characters of the message.
- **Badge**: a badge source adds the number of unread conversations to the app icon.

## Web

`apps/web/src/components/messages.tsx`:

- `useUnreadMessages`: the unread conversation count shown on the Messages tab.
- `Inbox`: friends as a sideways row of round avatars (tap to open the conversation; each is a
  fixed slot so stories can add a ring later), then conversations as flat rows with no title or
  card.
- `Conversation`:
  - bubbles and time labels for gaps over 15 minutes;
  - optimistic sending (a failed bubble retries on tap with the same `requestId`);
  - "Sent"/"Seen" under your last message;
  - unsend from the "…" menu;
  - "Load earlier messages", with the scroll position kept;
  - a mute toggle.
- `SendPostDialog`: the friend picker for posts.

`/messages/:id` hides the app header, the bottom tabs and pull-to-refresh; the chat's own
header (back, the person, mute) is the only header.

## Limits and open questions

- The inbox runs one unread count per conversation (at most 50, each stopping at 99). A read
  model at Tier 1 replaces it, which needs a constitution amendment.
- "Seen" can't be turned off yet.
- Out of scope for now: groups, message requests from non-friends, reactions, photos and voice,
  typing indicators, editing, search.
- No account deletion exists yet. When it is added, it must remove the member's messages, or
  turn them into "Former member" tombstones, and their conversation state.
