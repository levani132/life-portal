# Contract: `/api/messages`

Every route requires the `messages` feature and sends `Cache-Control: private, no-store`. A
conversation the caller doesn't belong to answers 404, exactly like one that doesn't exist.

| Route | Body / query | Returns |
|---|---|---|
| `GET /conversations` | | `InboxEntry[]`, newest first, at most 50, conversations with messages only |
| `GET /unread` | | `{count}`: conversations with unread messages |
| `POST /conversations` | `{userId}` | `{id}`. Get-or-create. 403 unless `canMessage` passes; no conversation is created otherwise |
| `GET /conversations/:id` | | `ConversationView` |
| `GET /conversations/:id/messages` | `?before=<messageId>` | `MessagesPage`, 30 at a time |
| `POST /conversations/:id/sync` | `{after?: messageId}` | `SyncResult`. Sets the caller's `lastReadAt` and `viewingAt` to now |
| `POST /conversations/:id/messages` | `{requestId, text}` or `{requestId, postId}` | `ChatMessage` (201). Codes: 403 (can't send), 400 (bad text or post), 429 (rate limit). A retried `requestId` returns the original |
| `DELETE /conversations/:id/messages/:messageId` | | `{success}`. Sender only; otherwise 404 |
| `PUT /conversations/:id/mute` | `{muted}` | `{muted}` |

**Side effects of sending**: after a new insert, `notify({type:'message', recipientId,
actorId, actorName, targetId: conversationId, messageKind, messageText})` runs without being
awaited.

**Web routes**:

- `/messages`: the inbox.
- `/messages/:id`: the conversation. It hides the bottom tabs and pull-to-refresh, and the
  composer sticks to the bottom.
- Header: a message icon with the `/unread` count.
- A friend's profile gets a **Message** button.
- Post footers get a **Send** button that opens a friend picker.
