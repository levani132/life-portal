# Quickstart: verifying direct messages

Use the setup from `specs/012-web-push-notifications/quickstart.md`: local MongoDB, the built
API with VAPID keys, three internal-cohort test accounts (Ana and Ben are friends; Cat is not
friends with Ben).

1. **Only friends can message.**
   - Ana `POST /messages/conversations {userId: Ben}` returns an id. Repeating it returns the
     same id.
   - Ben → Cat returns 403.
2. **Send, retry and read.**
   - Ana sends a text with requestId X twice. Ben's page has one message.
   - Ben's inbox shows `unread: 1` with Ana's preview, and `/unread` returns 1.
   - Ben syncs, and his `/unread` returns 0. Ana's `GET /conversations/:id` shows
     `otherLastReadAt` after her message, so her bubble reads "Seen".
3. **Unsend.** Ana unsends. Ben's page shows `kind: 'unsent'` with no text, and the inbox
   preview reads "Message unsent". Ben trying to unsend Ana's message gets a 404.
4. **Shared posts.**
   - Ana sends her own friends-only post to Ben: he gets a card with the title.
   - Ana sends Cat's friends-only post (Ana and Cat are friends) to Ben: he gets
     `unavailable`.
   - Ana deletes her post: the card becomes `unavailable` for both.
5. **Losing the friendship.**
   - Ana unfriends Ben. Both can still read, `canSend` is false, and sending returns 403.
   - They become friends again and can send.
   - Ana blocks Ben: sending returns 403.
6. **Rate limit.** 31 quick sends: the 31st returns 429.
7. **Notifications** (with a fake FCM device, the delivery attempt can be seen in the logs or
   as the device being removed):
   - While Ben syncs within 15 seconds, Ana's message makes no attempt.
   - After 15 seconds without syncing, it does.
   - Muted: no attempt.
8. **Web.** Open `/messages` and the conversation in the in-app browser:
   - bubbles, separators, "Seen";
   - optimistic sending;
   - the Send picker on a post;
   - no console errors.
9. `npm run check`, and both apps build.
