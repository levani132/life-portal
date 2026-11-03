# Data model: Direct messages

Both collections belong to `MessagesModule`. Timestamps are instants (`Date`).

## `conversations`

| Field | Type | Rules |
|---|---|---|
| `kind` | `'direct'` | groups later |
| `pair` | string | sorted member IDs joined by `:`. **Unique, partial** (only for direct) |
| `memberIds` | string[2] | indexed. Membership checks use `{_id, memberIds: userId}` |
| `members` | `{userId, lastReadAt?, viewingAt?, muted?}[]` | per-member state, updated with `members.$` |
| `createdAt`, `updatedAt` | Date | timestamps |

There is no last message and no unread count: both are derived (research R3).

## `messages`

| Field | Type | Rules |
|---|---|---|
| `conversationId` | string | |
| `senderId` | string | |
| `requestId` | string (UUID) | client-chosen. **Unique** `(conversationId, senderId, requestId)` |
| `kind` | `'text' \| 'post'` | |
| `text` | string? | 1–2,000 characters after trimming. Removed on unsend |
| `postId` | string? | a reference only (research R4). Removed on unsend |
| `unsentAt` | Date? | set once |
| `createdAt` | Date | |

Indexes:

- `(conversationId, createdAt desc, _id desc)`: pages, last message, unread counts.
- `(senderId, createdAt desc)`: the rate limit.

## Shared types (`libs/shared/types/src/lib/messages.ts`)

- `MAX_MESSAGE_LENGTH = 2000`, `MESSAGE_PAGE = 30`.
- `ChatPerson {userId, displayName, username}`.
- `SharedPostCard {id, title, authorName, totalKcal?} | {unavailable: true}`.
- `ChatMessage {id, requestId?, mine, kind: 'text' | 'post' | 'unsent', text?, post?,
  createdAt}`. `requestId` is returned only for your own messages, so optimistic bubbles can be
  matched up.
- `ConversationView {id, other, canSend, cannotSendReason?, muted, otherLastReadAt?}`.
- `MessagesPage {messages (oldest → newest), nextBefore?}`.
- `SyncResult {messages, otherLastReadAt?, canSend}`.
- `InboxEntry {id, other, preview, lastMessageAt, unread, lastFromMe}`.

The notification types gain `'message'`. `NotificationEvent` gains `messageText?` and
`messageKind?`. `NotificationPreferences` gains `showMessagePreviews`. `FEATURE_IDS` gains
`'messages'`.

## Domain (`libs/shared/domain/src/lib/messages.ts`, pure and tested)

- `pairKey(a, b)`.
- `canMessage({connection, a, b, accessA, accessB})` returns `null`, or a reason:
  `'not-friends' | 'blocked' | 'feature'`.
- `messagePreview({kind, text, unsent, fromMe})` returns e.g. "You: Shared a post", clipped to
  80 characters.
- `isViewing(viewingAt, now)`: within 15 seconds.
- `seenLabel(lastMine, otherLastReadAt)` returns `'Seen' | 'Sent'`.
- `timeSeparators(messages)`: which indexes start a new group (a gap of more than 15 minutes).
