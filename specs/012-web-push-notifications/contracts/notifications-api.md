# Contract: `/api/notifications`

All routes need a signed-in account and the `push` feature (`@RequireModule('push')`), except
`GET /config`, which answers for everyone so the web knows whether to show anything at all.
All responses send `Cache-Control: private, no-store`. Every write takes a `class-validator`
DTO.

## `GET /config`

```json
{ "available": true, "publicKey": "<VAPID public key, base64url>" }
```

`available` is false when the keys are not configured, or the caller lacks `push` or `social`.
In that case `publicKey` is omitted.

## Preferences

`GET /preferences`

```json
{
  "enabled": false,
  "types": { "friendRequest": true, "friendAccepted": true, "postComment": true, "postLike": true },
  "showCommentPreviews": false,
  "offerHiddenUntil": "2026-11-17T09:00:00.000Z"
}
```

`types` is always complete in the response (a missing stored key reads as `true`).
`offerHiddenUntil` is omitted when the offer may show.

`PUT /preferences {enabled?, types?: Partial<Record<type,boolean>>, showCommentPreviews?}`
merges the fields it is given. It creates the row if needed and seeds only the fields the
caller did not send, so a field never appears in both `$set` and `$setOnInsert`. Unknown type
keys get a 400. Returns the full preferences.

`POST /offer/dismiss` sets `offerDismissedAt=now` and returns the preferences.

## Devices

`POST /devices`

```json
{ "subscription": { "endpoint": "https://…", "keys": { "p256dh": "…", "auth": "…" } }, "label": "iPhone" }
```

- `endpoint` must be HTTPS and at most 1024 characters. Its host must be a known push service:
  `*.push.apple.com`, `fcm.googleapis.com`, `*.notify.windows.com`, `updates.push.services.mozilla.com`.
  This stops a client from making the server POST to arbitrary URLs.
- Also sets `enabled=true` the first time.
- Returns `{ "id": "<device id>" }`. The web stores the id in `localStorage` so Settings can mark
  "This device".

`GET /devices` returns `PushDeviceSummary[]`, newest use first. It never includes endpoints or
keys.

`DELETE /devices/:id` is owner-only, and answers 404 when the device isn't the caller's.

`POST /devices/unregister {endpoint}` removes the caller's row with that endpoint. It is used
at sign-out, and is safe to repeat.

## Activity

`GET /activity?before=<ISO time>` returns
`{ "items": ActivityItem[], "nextBefore"?: string }`: 20 items newest first, merged from every
registered source. Likes on one post are grouped into one item with `othersCount`.

`GET /activity/unseen` returns `{ "count": 3 }`. This is the badge number.

`POST /activity/seen` sets `activitySeenAt=now` and returns `{ "count": 0 }`.

## Server-side use by other modules (not HTTP)

`NotificationsService.notify(event: NotificationEvent): Promise<void>`. Callers don't await it
and it never throws. Calls are added in:

| Caller | After | Event |
|---|---|---|
| `SocialService.act` | `request` succeeded and changed state | `friendRequest` to target |
| `SocialService.act` | `accept` succeeded | `friendAccepted` to the original requester |
| `PostEngagementService.setLike` | a new like row was inserted (not a repeat) | `postLike` to post owner |
| `PostEngagementService.add` | a new comment was inserted (not a retried `requestId`) | `postComment` to post owner |

`SocialGraphService.act` returns whether the state changed, so a retried request doesn't
notify twice.

# Contract: push payload and service worker

The payload is encrypted JSON read only by `apps/web/public/sw.js`:

```json
{ "title": "Ana", "body": "liked “Tuesday lunch”", "url": "/posts/66f…", "tag": "postLike:66f…", "badge": 3 }
```

- **`push`**: always calls `showNotification(title, {body, tag, data:{url}, icon:'/icon-192.png',
  badge:'/icon-192.png', renotify: tag starts with "postComment"})`. Calls
  `navigator.setAppBadge(badge)` when present and supported. It never fetches `/api` and never
  writes to a cache.
- **`notificationclick`**: closes the notification. If an app window exists, it focuses that
  window and posts `{type:'navigate', url}` to it. Otherwise it calls
  `clients.openWindow(url)`. A `url` not starting with `/` is ignored, so the service worker
  only ever opens same-origin paths.
- **Page side**: `ServiceWorkerRegistrar` listens for `navigate` messages and calls
  `router.push(url)`.
