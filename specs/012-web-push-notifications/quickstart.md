# Quickstart: verifying push notifications

## Setup

```bash
npx web-push generate-vapid-keys
# put the pair into .env as VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, and
# VAPID_SUBJECT=mailto:<your address>
docker run -d --name lp-mongo -p 27019:27017 mongo:7
MONGODB_URI=mongodb://127.0.0.1:27019/lp-dev JWT_SECRET=$(openssl rand -hex 32) \
  npm run seed && npm run dev
```

Create a second account. Both accounts should be in the internal cohort, so `push`, `social`
and `foodPosts` are on.

## 1. Gate and boot (no device needed)

- Unset the VAPID variables and restart. The API boots, `GET /api/notifications/config` returns
  `{available:false}`, and Settings has no Notifications section.
- Set only `VAPID_PUBLIC_KEY`. The API refuses to boot and names the missing variable.
- A production-cohort account gets `available:false`, and `POST /devices` returns 403.

## 2. Desktop Chrome on localhost (push works on localhost)

1. Account A: open Settings › Notifications and tap **Turn on notifications**. The browser
   prompt appears only after the tap. Reloading any page never shows it.
2. Account B (another browser profile) sends A a friend request. A notification appears within
   10 seconds. Clicking it focuses A's existing tab on `/friends`, with no new tab.
3. A accepts. B is notified, and clicking opens A's profile.
4. A publishes a post. B likes it, unlikes it and likes it again quickly, and three more
   accounts (or a script using B's token on other posts) like A's post. A sees at most 2 like
   notifications, the second saying "and N others".
5. B comments twice within a minute. A's second notification replaces the first rather than
   stacking.
6. A mutes B, and B comments. No notification arrives. A turns off Likes in Settings, and a like
   from another account sends nothing.
7. A blocks B. Nothing B does sends anything.
8. A signs out. Further actions send nothing to that browser (check that the `push_devices`
   row is gone).

## 3. iPhone (needs the deployed HTTPS origin)

1. Open the site in Safari. Settings › Notifications shows "Add to Home Screen" steps, not a
   switch.
2. Add it to the Home Screen, open it and turn notifications on.
3. Lock the phone and send a friend request from another account. The notification shows a
   name and "sent you a friend request", with no food or health data. Tapping it opens the
   **installed app** on `/friends`, never Safari.
4. Receive three items without opening the app. The icon shows **3**. Open Activity, and the
   badge clears.

## 4. Failure isolation

- Set `VAPID_SUBJECT` to a valid value but point one device row at a dead endpoint (edit
  `endpoint` in Mongo to a known-gone FCM URL). The like still answers 200 quickly, and the row
  is deleted after one attempt.
- Run `npm run check`. Domain tests cover `shouldNotify`, `collapseDecision`,
  `notificationText` and `groupActivity`.
- Check `apps/web/public/sw.js` by inspection: there is still no cache write for `/api`.
