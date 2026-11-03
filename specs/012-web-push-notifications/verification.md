# Verification: 012 push notifications (2026-11-03)

## Automated

`npm run check` passes:

- Typecheck passes.
- Lint: no errors and no new warnings.
- Tests: 419 domain, 116 API and 54 web, all passing.

New tests:

- `libs/shared/domain/src/lib/notifications.spec.ts`: skip rules, text and privacy, grouping,
  endpoint allow-list.
- `apps/api/src/notifications/notifications.service.spec.ts`: sending, collapse and its race,
  gone devices, never rejecting, the suppress hook, device ownership and eviction, preferences
  without `$set`/`$setOnInsert` conflicts, Activity merging and blocks, DTO validation, VAPID
  config.
- Additions to the engagement and social-graph specs: notify only on new rows; `act()` reports
  changes; `acceptedAt` is set and cleared.

## Built API against a local MongoDB 7 (quickstart §1–2, API level)

- **Boot:**
  - With no VAPID keys it boots and `/notifications/config` returns `{available:false}`.
  - With only `VAPID_PUBLIC_KEY` it refuses to boot and names the two missing variables.
- **Feature flag:** production-cohort accounts get 403 on the push routes. Internal accounts
  get `available:true` and the key, with `Cache-Control: private, no-store`.
- **Endpoint allow-list:** a device pointing at `https://169.254.169.254/latest` is rejected
  with a 400.
- **Real delivery path:**
  - A friend request sent an actual VAPID-signed, encrypted push to Google's push service
    (`fcm.googleapis.com`) for a made-up subscription.
  - The service answered that the subscription was gone, and the device row was deleted after
    that single attempt.
  - The friend request itself answered 200 straight away.
- **Activity and badge:**
  - The request appeared as `friendRequest:Ben`, unseen, with a badge of 1.
  - After acceptance, the requester's Activity showed `friendAccepted:Ana`, and the request
    left the recipient's Activity.
  - Marking Activity seen returned a count of 0.
- **Preferences:**
  - Turning off one type kept the others.
  - An unknown type got a 400.
  - The main switch off kept the type choices.
  - Dismissing the offer hid it for 14 days.
- **Devices:**
  - Another user deleting someone's device got a 404, while the owner could delete it.
  - An endpoint registered by a second user moved to them.
  - Unregistering at sign-out left that user with 0 devices.
- **Blocks:** a request from Cat showed in Activity, and disappeared once Cat was blocked.
- **Likes and comments** on a real friends-only food post:
  - The like and the comment each reached the owner.
  - A second like arriving while the first push was in flight was suppressed (`postLike:1`).
  - Activity grouped likes as `postLike:Cat,Ben` and listed the comment with the post title.

## Web (in-app browser, development build)

- The header bell showed the unseen count. Opening `/activity` listed both items and cleared
  the count.
- `/settings/notifications` rendered the switches and devices. The browser denies notification
  permission, so it showed the "blocked on this device" help, which is the correct branch.
- The development service worker was registered as `/sw.js?mode=push` and created no caches.
- No console errors.

## Not verified here

- **Showing a notification on a real device**, and opening the app from it, on iPhone (Home
  Screen app), Android and desktop Chrome. This needs the deployed HTTPS origin, keys set on
  Render, and a real device: quickstart §3.
- **Whether iOS honours `renotify`, `Topic` and badges set from the service worker.** All are
  feature-checked. The worst case is a stacked notification or a missing badge.
