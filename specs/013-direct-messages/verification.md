# Verification: 013 direct messages (2026-11-03)

## Automated

`npm run check` passes:

- Domain: 431 tests, including new `messages.spec.ts` and the message cases in
  `notifications.spec.ts`.
- API: 129 tests, including new `messages.service.spec.ts`.
- Web: 54 tests.

New code lints clean. Both apps build.

## Built API against local MongoDB 7 (quickstart steps 1–7)

**1. Who can message**
- Ana → Ben and Ben → Ana return the same conversation (201, `private, no-store`).
- Ben → Cat, who aren't friends, gets a 403.
- Cat reading Ana and Ben's conversation gets a 404.

**2. Send, retry and read**
- Sending the same `requestId` twice produces one message, with the text trimmed.
- Whitespace-only text gets a 400.
- On Ben's side the message has `mine: false` and no `requestId`.
- Ben's inbox shows Ana, "Lunch at 1?" and 1 unread; `/unread` returns 1.
- One sync later Ben's unread is 0, and Ana's view shows Ben read after her message ("Seen").
- Ana's inbox preview reads "You: Lunch at 1?", and Ana's sync picks up Ben's reply.

**3. Unsend**
- Ben unsending Ana's message gets a 404.
- Ana unsends it. Ben's next sync lists the ID, and his page shows `kind: 'unsent'` with no
  text.

**4. Shared posts**
- Ana's own friends-only post reaches Ben as a card.
- Cat's friends-only post (Ana can see it; Ben isn't Cat's friend) reaches Ben as
  `{unavailable: true}`.
- Ben's inbox reads "Shared a post".
- Ben sending Cat's post, which he can't see, gets a 400.

**5. Friendship ends**
- After unfriending: the view shows `canSend: false` with reason `not-friends`, sending gets a
  403, and the history (7 messages) is still readable.
- After becoming friends again, sending succeeds.

**6. Rate limit**
- The 31st quick send gets a 429 with "You’re sending messages too fast. Wait a moment."
- The page reports older messages.

**7. Notifications**
- With a fake Google push subscription on Ben's account:
  - while Ben was syncing, a message made no delivery attempt (the device was kept);
  - while muted, also no attempt;
  - once Ben was away and unmuted, a delivery was attempted and Google's answer removed the
    fake device.
- Ben's badge count included the unread conversation.

**Timing**: send 18 ms, sync 8 ms, inbox 6 ms.

## Web (in-app browser at phone size, 375×812, dev build)

- The inbox listed Ben with a preview and unread count, and the header icon showed 1.
- Opening the conversation hid the bottom tabs, scrolled to the newest message and cleared the
  icon.
- A typed message showed "Sending…", then "Sent".
- Ben's reply, sent by a script, appeared within the 3-second poll.
- "Load earlier messages" showed the time label, "Message unsent", both post cards (Ana can see
  Cat's post) and the options menus on Ana's own messages.
- A friend's profile shows **Message**.
- A post shows **Send**. Its picker listed Ben and Cat, and the four footer buttons fit at
  375px.
- Console errors were only dev-server leftovers: hot-reload socket, an earlier API restart,
  and a token refresh.

## Not verified here

- A real phone: receiving a message notification, and the keyboard and composer behaviour in
  the iOS Home Screen app.
