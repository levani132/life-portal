# Posts and Wall

Explicit publishing is separate from live widget sharing: a private Food widget can still have an intentionally shared food post. A post is any combination of text, up to 10 photos and videos, and one Food attachment, and needs at least one of them (spec 014). A Food attachment is always previewed before publishing; every post has an explicit audience. The composer starts at the Food profile's default visibility (**Only me** unless changed). Public means authenticated Life Portal users with the required features, not anonymous web access.

## Ownership and schema

`PostsModule` owns `food_posts`, `post_media`, `post_reports`, `post_likes` and `post_comments`; `NutritionModule` alone reads tracking records and creates imported foods/saved meals through `NutritionPublicationService`. These collections preserve explicit publication events and reports without exposing private tracking collections.

- `food_posts`: owner `userId`, unique `(userId, requestId)` UUID for retry safety, SHA-256 `previewHash` (only with a Food attachment), title (120), caption (1000), audience private/friends/public, version 1, timestamps, deletion tombstone. Index `(userId, createdAt desc, _id desc)` supports stable feeds.
- `media` (optional): the attached files' facts in order: `{id, kind, key, posterKey?, contentType, width, height, durationMs?}`. A copy of the ledger row, so a read needs no join; the files never change. Storage keys never leave the API.
- `post_media`: the upload ledger. `userId`, `kind` image/video, `key` `media/{userId}/{id}.{jpg|mp4|webm|mov}`, `posterKey`/`posterBytes` for a video's still, declared `contentType`/`bytes`/`width`/`height`/`durationMs`, `requestId` once a publish reserves it, `postId` once the post exists. Pending rows (no `postId`) older than 24 hours are deleted with their files by an hourly job. Indexes `(userId, createdAt)` for the upload rate limit, `(postId)`, partial `(createdAt)` where pending.
- `publication` (optional; absent for text and media posts): kind, label, optional day/slot, and 1–1000 server-created food snapshots. Item keys are local ordinals, not tracking IDs. Snapshots contain name/brand, unit, serving size/label, nutrition facts, optional eaten amount/slot, attribution. No source record IDs, notes, favourites, barcodes, targets or measurements.
- `post_reports`: unique `(userId, postId)`, reason, timestamp and optional `resolvedAt`. The queue lists unresolved reports; moderation resolves all reports for the removed post. A report immediately hides that post from its reporter. Developer review returns report metadata; it grants no access to a private post's contents. A developer may remove a reported post by report ID.
- `post_likes`: one row per `(postId, userId)` (unique index), so liking twice is a no-op and a duplicate-key race is tolerated. Unliking deletes the row.
- `post_comments`: `postId`, author `userId`, client `requestId` UUID (unique per `(postId, userId, requestId)` for retry safety), text (1–1000, trimmed) and a `deleted` flag. Deleting clears the text and keeps the row. Index `(postId, deleted, _id desc)` serves the newest-first list.
- Like and comment counts are never stored on the post; `PostEngagementService` counts rows on read (principle 3).
- `foods.attribution`, `foods.postImportKey`: provenance and unique per-user publication/food-facts key (partial unique index). Existing documents require no backfill. `saved_meals.postImportKey` similarly makes repeat whole-meal imports idempotent. These are independent recipient-owned copies, never links into an author's tracking data.

Deletion erases the stored food snapshot, caption and media list, deletes the media files from storage (also on moderation), while retaining an owner/request tombstone so a retried publish cannot resurrect it. Previously imported copies remain recipient-owned; the composer and import UI explain this.

## API

Authenticated `/api/posts` routes require **social + nutrition + foodPosts**, evaluated server-side. Production still has Food only by default; internal and developer accounts receive the new flag. Author feature access is also rechecked on every read/import. All responses use `Cache-Control: private, no-store`.

- `POST /preview {source}` returns a strict food projection and fingerprint.
- `POST / {source?, previewHash?, mediaIds?, requestId, title, caption, audience}`. 400 when there is no text, media or source. With `source`, rebuilds it and rejects a changed fingerprint with 409. Each media id must be the author's and unclaimed (or reserved by this same `requestId`), and its file(s) must exist in storage with the declared size and type, else 400 "Upload not finished". Matching UUID retries (same text, audience, fingerprint and media list) return the original post; mismatched reuse and deleted requests fail with 409.
- `GET /media/config` → `{available, maxItems: 10, maxVideoSeconds: 30}`; `available` is the `postMedia` flag and configured storage together.
- `POST /media {kind, contentType, bytes, width, height, durationMs?, poster?: {bytes}}` (needs `postMedia`) returns `{id, upload: {url, headers}, poster?}`: signed PUT links straight to storage, valid 15 minutes. Photos are `image/jpeg` up to 15 MB; videos `video/mp4|webm|quicktime` up to 60 MB and 30.5 s, with a JPEG still up to 2 MB. The type and exact size are signed into the link, so storage itself refuses any other file. 60 links per person per hour (429 beyond).
- `GET /?authorId=&cursor=&preview=normal|friend|stranger` lists 10 visible posts. Wall includes self and accepted, unmuted friends; other public posts are reached through profiles. A feed teaser contains at most three foods. Owner-only audience previews restrict their own results; another viewer cannot elevate their relationship using a query parameter.
- `GET /:id` returns the complete permitted snapshot. Every read (detail, feed, a message's post card) signs fresh `media[].url`/`posterUrl` read links only after the audience check. They are signed at the start of the hour and valid for two, so a URL is stable (cacheable) for an hour and dies within two; someone dropped from the audience can never get a new one.
- `PATCH /:id {title,caption,audience}` and `DELETE /:id` are owner-only; food facts and media stay immutable. A post with neither food nor media cannot be edited down to no text. `PATCH /:id/audience {audience}` is the header's quick audience switch, also owner-only.
- `GET /:id/engagement` returns `{likeCount, commentCount, liked}`. `PUT /:id/like` and `DELETE /:id/like` set the viewer's like and return the new counts.
- `GET /:id/comments?before=` lists 20 comments newest first, with `nextCursor` (a comment ID) when more exist. Comments by someone blocked in either direction are left out. Authors who have left show as "Former member".
- `POST /:id/comments {text, requestId}` adds a comment; a retried `requestId` returns the original. `DELETE /:id/comments/:commentId` is allowed for the comment's author and the post's owner.
- Every engagement route first runs the same read authorization as `GET /:id`, so a viewer who cannot read a post cannot like it, comment on it or see its counts.
- A newly inserted like or comment notifies the post owner, without awaiting it. Repeats and retried `requestId`s never notify. `PostEngagementService` registers `postLike` (15-minute collapse per post) and `postComment` (2 minutes), plus the Activity source for others' likes and live comments on the owner's 500 most recent posts. See [notifications](notifications.md).
- `GET /:id/import` previews already-imported foods and matching names. A post without food answers 400.
- `POST /:id/import {itemKeys,duplicatePolicy:skip|copy,saveAsMeal,mealName?}` copies selected foods privately. `skip` is the default for matching name/brand/unit. Whole meals/combinations can additionally become saved meals; select every item and explicitly copy conflicting names. No import logs a meal.
- `POST /:id/report {reason}` reports and hides a readable, non-owned post. Repeats are safe.
- `GET /reports`, `DELETE /reports/:reportId/post` are developer-only.

Read authorization always checks audience, the current friendship, blocks in either direction, author/viewer flags and reporter hiding. Mute excludes an author from Wall without changing direct/profile access. Unfriend revokes friends-only posts. Unblock restores no friendship. Feed cursors are opaque AES-GCM tokens keyed from JWT configuration, so scanning hidden rows does not reveal their IDs or dates. Bounded scans (100 rows/request) may return a short page with an Older posts cursor.

## Publication types and derived values

1. Entry: one owned log entry, using its historical facts and amount.
2. Meal: all owned entries in one day/slot.
3. Day: all owned entries in one day.
4. Food: one active owned catalogue food, without invented amounts.
5. Combination: explicit owned foods/amounts or an active saved meal, using current facts at publishing.
6. Database: all active owned catalogue foods, frozen as collection v1. Larger databases must be split into selections (maximum 1000 per post).

`publicationCalories` derives portion calories only when every amount exists; catalogue collections do not invent a calorie total. `canonicalPublication` includes exact presentation, nutrition, portions and attribution. Imported-food identity ignores local ordinal/slot/portion so the same food eaten twice becomes one catalogue copy; a saved meal adds its amounts. Optional unknown nutrients remain unknown. Open Food Facts attribution survives sharing/importing; ordinary copies credit the post author. Repeated imports never overwrite a recipient's subsequent edits. Concurrent food/saved-meal upserts use unique indexes and tolerate duplicate-key races.

## Media storage

Files live in a private Cloudflare R2 bucket (S3 API), configured by `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: all four or none (none hides photos and video; a partial set refuses to boot). `StorageService` (`apps/api/src/storage`) signs links with `aws4fetch` and never proxies a file. The bucket needs a CORS rule allowing `PUT` and `GET` with the `content-type` header from the web origins, or browsers cannot upload. R2's free tier (10 GB, free egress) covers Tier 0.

The browser prepares files before uploading (`apps/web/src/lib/media.ts`): photos are decoded with their EXIF rotation, drawn to a canvas at most 2048 px on the long side and re-encoded as JPEG 0.85, which drops location and camera metadata. Video only comes from the in-app camera (`MediaRecorder`, MP4 where supported, else WebM, 2.5 Mbps, 30 s cap) with a still drawn from its first frame. Library videos are not accepted: their length, size and origin are unknown and there is no transcoding.

## Screens

The header's **+** (left) opens the composer from anywhere; LifePortal is centred and Activity is on the right. The composer is a full-screen sheet: text first, then attached photos and videos (each uploads the moment it is added, with a progress ring and retry), then the Food attachment's preview. Its toolbar has **+** (Add from Food: Diary by day with whole day, meals and single entries; Foods; Saved meals; Database), Photos (library, photos only), Camera (tap for a photo, hold to record up to 30 s with a ring filling around the shutter, flip camera; falls back to the system camera for a photo), and the audience. Share is enabled once something is there and every upload has finished. Opened from the header, the audience starts at the Food profile's default; from Food it starts at that page's.

Posts show media in a swipeable carousel framed by the first item (clamped to 4:5–1.91:1), with a counter and dots; videos play muted and looping while at least 60% on screen, and a tap toggles the sound. A post without food has no food card and no Import option; a short text-only post is shown larger.

Wall is the fourth bottom tab when all three features are enabled. Food offers entry/meal/day/food/database share actions, each opening the same composer with that selection attached; logging offers a dismissible share action afterward. Profiles open Posts, with About alongside for permitted live widgets. Posts can be reviewed, edited, deleted, imported, reported or hidden. Each post's footer has Like, Comment, Send (with the `messages` feature: sends the post to a friend as a reference, so its audience still applies; see [messages](messages.md)) and Share. Share uses the system share sheet, falling back to copying the `/posts/:id` link. The link opens only for signed-in viewers the post's audience already allows. Developer Menu includes the report queue.

## Verification and boundaries

Domain tests cover source selection, canonicalisation, duplicates, calorie calculation and the audience matrix. API tests cover owned allowlists, historical snapshots, invalid combinations and private/import retry behavior. Isolated API/browser checks exercise the complete publication/import flow with separate accounts. Engagement tests cover idempotent likes and comments, delete rights, blocked commenters and notifying only on new rows. Reactions beyond a like, comment replies, image moderation before public launch, library video, financial posts, automatic posting, public web links and collection updates are future work.

Related: [social](social.md), [nutrition](nutrition.md), [portal](portal.md), [007 specification](../../specs/007-food-posts/spec.md).
