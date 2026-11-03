# Feature Specification: Direct messages between friends

**Feature Branch**: `013-direct-messages`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "Direct messaging between friends, Instagram-style but simple. One-to-one conversations between accepted friends; history stays readable after unfriending but no new messages. Inbox with preview and unread state; header message icon; start a chat from a friend's profile. Bubbles, time separators, optimistic sending with retry and no duplicates, Seen, unsend. Share a food post into a chat, with the post's audience still deciding who can see it. Mute a conversation. Notifications through the existing system, suppressed while the conversation is open, previews opt-in; unread adds to the badge. Short polling, no always-on worker. Behind a `messages` feature flag."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Message a friend (Priority: P1)

From a friend's profile, a member taps **Message**. A conversation opens (the same one every
time with that friend). They type and send. The message appears at once in a bubble on the
right. The friend, with the conversation open, sees it on the left within a few seconds and can
reply. Messages are grouped by time, with a time label when there is a gap.

**Why this priority**: This is the feature. Everything else builds on a working one-to-one
conversation.

**Independent Test**: With two friend accounts in two browsers, open the conversation in both,
send a message from each, and confirm each appears for the other within 5 seconds, in order.

**Acceptance Scenarios**:

1. **Given** two friends, **When** one taps Message on the other's profile, **Then** their single shared conversation opens. Tapping it again later opens the same conversation, never a second one.
2. **Given** an open conversation, **When** the member sends a message, **Then** it shows immediately in a sending state, then as sent. The other member sees it within 5 seconds if their conversation is open.
3. **Given** a send that fails (no connection), **When** the member taps the failed message, **Then** it retries. However many retries happen, the friend receives it exactly once.
4. **Given** messages more than 15 minutes apart, **When** the conversation is shown, **Then** a time label separates them.
5. **Given** a long conversation, **When** the member scrolls up, **Then** older messages load in pages, and their scroll position does not jump.

---

### User Story 2 - Inbox and unread state (Priority: P1)

A message icon in the header shows how many conversations have unread messages. It opens the
inbox: conversations newest first, each with the friend's name, a short preview of the last
message, its time, and a bold unread marker with a count. Opening a conversation marks it read.

**Why this priority**: Without an inbox, a member cannot find their conversations or know a
reply arrived.

**Independent Test**: Send three messages to a member who has the app closed. Confirm their
header icon shows 1 and the inbox shows the conversation at the top with 3 unread. Open it and
confirm both clear.

**Acceptance Scenarios**:

1. **Given** unread messages in two conversations, **When** the member looks at the header, **Then** the message icon shows 2.
2. **Given** the inbox, **When** it loads, **Then** conversations are ordered by their latest message. Each shows the friend's name, a preview of at most one line, a relative time and the unread count.
3. **Given** the last message is a shared post, **When** it is shown in the inbox, **Then** the preview reads "Shared a post". If it was unsent, it reads "Message unsent".
4. **Given** a conversation with unread messages, **When** the member opens it, **Then** it is marked read and the header count drops.

---

### User Story 3 - Seen and unsend (Priority: P2)

Under their most recent message, a member sees "Sent". Once the friend has read it, it becomes
"Seen". A member can unsend their own message. It disappears for both people and is replaced by
"Message unsent".

**Why this priority**: These are expected in a modern messenger, and unsending matters for
mistakes and privacy, but the chat works without them.

**Independent Test**: Send a message, open the conversation as the friend, and confirm the
sender sees "Seen". Unsend another message and confirm the friend sees "Message unsent" in its
place.

**Acceptance Scenarios**:

1. **Given** the member's last message is unread by the friend, **When** they look, **Then** it reads "Sent". After the friend opens the conversation, it reads "Seen" within 5 seconds.
2. **Given** the member's own message, **When** they choose Unsend and confirm, **Then** the text is erased for both people and the bubble reads "Message unsent".
3. **Given** a friend's message, **When** the member looks for Unsend, **Then** it is not offered.

---

### User Story 4 - Share a food post in a chat (Priority: P2)

A food post has a **Send** button. It opens a list of friends. Choosing one sends the post into
that conversation as a card showing the post's title, author and calories. Tapping the card
opens the post. The post's audience still applies: if the recipient isn't allowed to see it
(for example, a friends-only post by someone they aren't friends with), the card reads "Post
unavailable". If the author deletes the post, the card reads "Post unavailable" for everyone.

**Why this priority**: This is what makes the messenger part of Life Portal rather than a
generic chat. Friends use it to plan meals and diet together.

**Independent Test**: Send a friends-only post by person C from A to B, where B isn't C's
friend. Confirm B sees "Post unavailable". Send A's own friends-only post to B and confirm B
sees the card and can open it.

**Acceptance Scenarios**:

1. **Given** a post the member can see, **When** they tap Send and pick a friend, **Then** the post appears in that conversation as a card, and they get a confirmation with a link to the conversation.
2. **Given** a recipient the post's audience does not include, **When** they view the card, **Then** it reads "Post unavailable" and reveals no title, author or numbers.
3. **Given** the post is later deleted or its audience narrowed, **When** either person views the card, **Then** it reflects the current state, not the state when it was sent.

---

### User Story 5 - Notifications and muting (Priority: P2)

When a message arrives and the recipient doesn't have that conversation open, they get a push
notification naming the sender ("Ana · sent you a message", or "shared a post"). Several
messages from one conversation replace each other on the device, so one conversation shows as
one notification. Tapping it opens the conversation. Unread conversations add to the app icon
badge. A member can mute a conversation to stop its notifications. With "Show message previews"
on, the notification includes the start of the message.

**Why this priority**: A messenger nobody hears from is a messenger nobody uses. This builds
directly on the notification system.

**Independent Test**: With notifications on and the app closed, receive two messages. Confirm
one notification, updated, that opens the conversation. Open the conversation, receive another,
and confirm no notification. Mute it, receive another, and confirm no notification.

**Acceptance Scenarios**:

1. **Given** the conversation isn't open on any of the recipient's devices, **When** a message arrives, **Then** a notification appears, replacing any earlier one from that conversation, and tapping it opens the conversation.
2. **Given** the recipient has the conversation open (within the last 15 seconds), **When** a message arrives, **Then** no notification is sent.
3. **Given** the recipient muted the conversation, or turned off message notifications, **When** messages arrive, **Then** no notification is sent, but the unread count still updates.
4. **Given** "Show message previews" is off (the default), **When** a notification shows, **Then** it contains no message text.

---

### Edge Cases

- **Unfriending:** both people can still read the history. The composer is replaced by "You can't reply to this conversation". Becoming friends again re-enables replying in the same conversation.
- **Blocking (either direction):** both keep the history read-only, and neither can send. Notifications stop at once. Unblocking doesn't restore replying, because blocking also ends the friendship; they must become friends again.
- **Feature access:** if either member lacks `messages` or `social`, sending is refused. A member without `messages` sees no inbox, icon or Send button.
- **Retries:** each message carries an ID chosen by the sender's device. Repeating a send with the same ID returns the original message and creates no duplicate.
- **Empty or oversized text:** sending is refused for empty text (whitespace only) and for more than 2,000 characters.
- **Former member:** a deleted or deactivated friend's messages show as "Former member".
- **Offline:** an open conversation shows the "no connection" state, unsent messages stay marked as failed, and nothing private is served from a cache.
- **Polling cost:** polling only runs while the conversation or inbox is on screen and the app is visible. It pauses in the background.
- **Rate:** a member can send at most 30 messages per minute. Beyond that, sending is refused with a "slow down" message.

## Requirements *(mandatory)*

### Functional Requirements

**Who can message**

- **FR-001**: A member MUST be able to message only an accepted friend, with no block in either direction, where both have the `messages` and `social` features.
- **FR-002**: There MUST be exactly one conversation per pair of members. Opening a chat with a friend MUST return the existing conversation if one exists.
- **FR-003**: When members stop being friends or one blocks the other, the conversation MUST stay readable to both and MUST refuse new messages, until they are friends again with no block.

**Messages**

- **FR-004**: A message MUST be either text (1–2,000 characters after trimming) or a shared post.
- **FR-005**: Every send MUST carry an ID chosen by the client. Repeating that ID MUST return the original message without creating another (FR, US1 scenario 3).
- **FR-006**: A member MUST be able to unsend their own message. Unsending MUST erase the stored text or post reference and show "Message unsent" to both people. It cannot be undone.
- **FR-007**: Messages MUST be listed newest first in pages of 30, with a way to load older ones and a way to fetch only messages newer than the newest one shown.
- **FR-008**: A member MUST be able to send at most 30 messages per minute.

**Shared posts**

- **FR-009**: Sending a post MUST require that the sender can currently see it.
- **FR-010**: A shared post MUST be shown by checking the viewer's access to the post at that moment. If the viewer can't see it, or it was deleted, they MUST see "Post unavailable" with no post details.
- **FR-011**: A shared post card MAY show the title, author and total calories, because those are already visible to anyone allowed to see the post.

**Inbox and read state**

- **FR-012**: The inbox MUST list the member's conversations ordered by latest message, each with the other member's name, a one-line preview, the time of the last message and the unread count.
- **FR-013**: The unread count MUST be the number of the other member's messages newer than the time the member last read the conversation. It MUST be worked out when read, not stored as a running total.
- **FR-014**: Opening or viewing a conversation MUST record that the member read it at that moment.
- **FR-015**: The sender MUST see "Seen" under their most recent message once the other member's read time is at or after it, and "Sent" otherwise.
- **FR-016**: The header MUST show a message icon with the number of conversations that have unread messages.

**Live updates**

- **FR-017**: While a conversation is on screen and the app is visible, new messages and the other member's read state MUST appear within 5 seconds. Polling MUST stop while the app is in the background.
- **FR-018**: Keeping a conversation on screen MUST count as "viewing it". The member is considered present in it for 15 seconds after the last update.

**Notifications**

- **FR-019**: A new message MUST notify the recipient through the shared notification system as type `message`, collapsing per conversation, so a newer notification replaces the previous one on the device.
- **FR-020**: No notification MUST be sent when the recipient is viewing that conversation (FR-018), has muted it, has turned off message notifications, or is blocked in either direction.
- **FR-021**: Notification text MUST be the sender's name and "sent you a message" or "shared a post". With the new "Show message previews" setting on (off by default), it MAY include the first 80 characters of a text message.
- **FR-022**: The number of conversations with unread messages MUST be added to the app icon badge.
- **FR-023**: A member MUST be able to mute and unmute a conversation. Muting affects only their own notifications.

**Rollout and privacy**

- **FR-024**: The feature MUST sit behind a new `messages` feature flag, on for internal and developer accounts and off in production.
- **FR-025**: Message responses MUST never be cached, by the browser, the service worker or any intermediary.
- **FR-026**: A member MUST only ever be able to read conversations they belong to. Asking for any other conversation MUST behave exactly like asking for one that doesn't exist.

### Key Entities

- **Conversation**: one per pair of members. It stores the members, and each member's own state: when they last read it, whether they muted it, and when they last had it open.
- **Message**: belongs to one conversation. It stores the sender, the client's ID for the send, the kind (text or shared post), the text or the post reference, when it was sent, and when it was unsent.
- **Inbox entry** (not stored): worked out from conversations and their latest messages.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A message sent to a friend with the conversation open appears for them within 5 seconds in at least 95% of attempts.
- **SC-002**: Retrying a failed send any number of times never produces a duplicate message.
- **SC-003**: A member can never read or post into a conversation they aren't part of, or message someone who isn't their friend, in testing.
- **SC-004**: A shared post never reveals its title, author or numbers to a recipient the post's audience excludes.
- **SC-005**: No notification arrives for a conversation the recipient has open or has muted.
- **SC-006**: Starting a chat from a friend's profile and sending a first message takes under 10 seconds.
- **SC-007**: With the app in the background, it makes no message requests.

## Assumptions

- Friends-only messaging fits a private-by-default app holding health data. Message requests from non-friends are deliberately left for later.
- Short polling (about every 3 seconds in an open conversation, 15 seconds in the inbox, only while visible) is fast enough at the current scale and needs no always-on service. A realtime connection is the upgrade path at the next infrastructure tier.
- "Seen" is always on in this version. A setting to hide read receipts can come later.
- Messages are stored encrypted at rest by the database provider, not end-to-end encrypted. That is stated in the module doc.
- Group chats, reactions, photos and voice, typing indicators, message editing, search and message requests are out of scope. The design must not prevent groups: a conversation has a list of members.
