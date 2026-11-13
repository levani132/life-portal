# Posts and Wall

Explicit publishing is separate from live widget sharing: a private Food widget can still have an intentionally shared food post. A post is any combination of text, up to 10 photos and videos, and one Food attachment, and needs at least one of them (spec 014). A Food attachment is always previewed before publishing; every post has an explicit audience. The composer starts at the Food profile's default visibility (**Only me** unless changed). Public means authenticated Life Portal users with the required features, not anonymous web access.

## Ownership and schema

`PostsModule` owns `food_posts`, `post_reports`, `post_likes` and `post_comments`; `MediaModule` (`apps/api/src/media`, global, since 015) owns the `post_media` upload ledger and the `/media` routes, because foods attach photos too; `NutritionModule` alone reads tracking records and creates imported foods/saved meals through `NutritionPublicationService`. These collections preserve explicit publication events and reports without exposing private tracking collections.

- `food_posts`: owner `userId`, unique `(userId, requestId)` UUID for retry safety, SHA-256 `previewHash` (only with a Food attachment), title (120), caption (1000), audience private/friends/public, version 1, timestamps, deletion tombstone. Index `(userId, createdAt desc, _id desc)` supports stable feeds; `(audience, deleted, createdAt desc, _id desc)` serves For You (reposts are filtered after it, because Mongo cannot build a partial index on a field being absent).
- **Reposts (016)** are `food_posts` rows too, with `repostOf` (the original's id) and nothing else of their own: empty title and caption, no food, no media, `audience` copied from the original at repost time, and `requestId = "repost:<original id>"`, so the unique `(userId, requestId)` index allows one repost per member per post. Undo deletes the row; it holds no content, likes or comments, so it needs no tombstone. Index `(repostOf, createdAt desc)` (sparse) serves counts and Activity. Every read path for a single post (`read()`, owner edits, delete, `ownTitles`) filters `repostOf: {$exists: false}`, so a repost is never addressable by its own id.
- `media` (optional): the attached files' facts in order: `{id, kind, key, posterKey?, contentType, width, height, durationMs?}`. A copy of the ledger row, so a read needs no join; the files never change. Storage keys never leave the API.
- `post_media`: the upload ledger. `userId`, `kind` image/video, `key` `media/{userId}/{id}.{jpg|mp4|webm|mov}`, `posterKey`/`posterBytes` for a video's still, declared `contentType`/`bytes`/`width`/`height`/`durationMs`, `requestId` once a publish reserves it, `postId` once the post exists. Pending rows (no `postId`) older than 24 hours are deleted with their files by an hourly job. Indexes `(userId, createdAt)` for the upload rate limit, `(postId)`, partial `(createdAt)` where pending.
- `publication` (optional; absent for text and media posts): kind, label, optional day/slot, and 1–1000 server-created food snapshots. Item keys are local ordinals, not tracking IDs. Snapshots contain name/brand, unit, serving size/label, nutrition facts, optional eaten amount/slot, attribution. No source record IDs, notes, favourites, barcodes, targets or measurements.
- `post_reports`: unique `(userId, postId)`, reason, timestamp and optional `resolvedAt`. The queue lists unresolved reports; moderation resolves all reports for the removed post. A report immediately hides that post from its reporter. Developer review returns report metadata; it grants no access to a private post's contents. A developer may remove a reported post by report ID.
- `post_likes`: one row per `(postId, userId)` (unique index), so liking twice is a no-op and a duplicate-key race is tolerated. Unliking deletes the row.
- `post_comments`: `postId`, author `userId`, client `requestId` UUID (unique per `(postId, userId, requestId)` for retry safety), text (1–1000, trimmed) and a `deleted` flag. Deleting clears the text and keeps the row. Index `(postId, deleted, _id desc)` serves the newest-first list.
- `feed_feedback` (#3 task A): `userId`, `kind` post/author, `targetId` (a post or user id), unique `(userId, kind, targetId)`. A viewer's "Not interested" posts and authors hidden from For You. It only shapes For You (the one collection this needs; it records the person's own choice, not derived data). Deleted with the account.
- `for_you_sessions` (#9): `userId` (unique), random `seed`, `mode` ranked/chronological, `entries: [{postId, reasons: [{code, topicId?}]}]` (at most 300) and `expiresAt` with a TTL index (30 minutes). The order of one viewer's ranked For You session and nothing else: no content, no scores, no interaction data. A new first page replaces it. It is the one stored derived value in posts, a documented exception to principle 3 (DECISIONS 2026-11-13). There is no account deletion yet; when there is, it must delete this row too, though it expires within 30 minutes anyway.
- `feed_preferences` (#10): `userId` (unique), `interests` (catalogue ids, ≤ 20) and optional `recommendationsResetAt`. The viewer's own explicit choices, not an inferred profile: private, never on a profile or shared, used by For You only. There is no account deletion yet; when there is, it must delete this row.
- `feed_metric_keys` (#11): `key` (unique), `owner`, optional `count`, `expiresAt` (TTL). Short-lived keys for For You measurement: one per account, post, event and UTC day for de-duplication (2 days), one per account and day for visits (8 days) and one per account and day holding the daily event count (2 days). `key` and `owner` are HMAC-SHA256 values keyed by a secret derived from `JWT_SECRET`; no account id, post id or event is stored in clear. See *For You measurement* below.
- `feed_metrics_daily` (#11): `day` (UTC), `postId` (`''` for the day's totals), `counts` per event, `visitors`, `returningVisitors` (totals row only), `expiresAt` (TTL, 90 days); unique `(day, postId)`. Aggregate counts only: no account, no key, no time of day.
- `feed_preferences.metricsOptOut` (#11): the account opted out of For You measurement. Absent means not opted out.
- Like and comment counts are never stored on the post; `PostEngagementService` counts rows on read (principle 3).
- `foods.attribution`, `foods.postImportKey`: provenance and unique per-user publication/food-facts key (partial unique index). Existing documents require no backfill. `saved_meals.postImportKey` similarly makes repeat whole-meal imports idempotent. These are independent recipient-owned copies, never links into an author's tracking data.

Deletion erases the stored food snapshot, caption and media list, deletes the media files from storage (also on moderation), while retaining an owner/request tombstone so a retried publish cannot resurrect it. Previously imported copies remain recipient-owned; the composer and import UI explain this.

`originalPostDays(userId)` returns the UTC creation day of each live original post (reposts and
removed posts excluded), for the [badges](badges.md) "First post" badge.

## API

Authenticated `/api/posts` routes require **social + nutrition + foodPosts**, evaluated server-side. Production still has Food only by default; internal and developer accounts receive the new flag. Author feature access is also rechecked on every read/import. All responses use `Cache-Control: private, no-store`.

- `POST /preview {source}` returns a strict food projection and fingerprint.
- `POST / {source?, previewHash?, mediaIds?, requestId, title, caption, audience}`. 400 when there is no text, media or source. With `source`, rebuilds it and rejects a changed fingerprint with 409. Each media id must be the author's and unclaimed (or reserved by this same `requestId`), and its file(s) must exist in storage with the declared size and type, else 400 "Upload not finished". Matching UUID retries (same text, audience, fingerprint and media list) return the original post; mismatched reuse and deleted requests fail with 409.
- `GET /api/media/config` (MediaModule) → `{available, maxItems: 10, maxVideoSeconds: 30}`; `available` is the `postMedia` flag and configured storage together.
- `POST /api/media {kind, contentType, bytes, width, height, durationMs?, poster?: {bytes}}` (needs `postMedia`) returns `{id, upload: {url, headers}, poster?}`: signed PUT links straight to storage, valid 15 minutes. Photos are `image/jpeg` up to 15 MB; videos `video/mp4|webm|quicktime` up to 60 MB and 30.5 s, with a JPEG still up to 2 MB. The type and exact size are signed into the link, so storage itself refuses any other file. 60 links per person per hour (429 beyond).
- `GET /?authorId=&cursor=&preview=normal|friend|stranger` lists 10 visible posts. Wall includes self and accepted, unmuted friends; other public posts are reached through profiles. A feed teaser contains at most three foods. Owner-only audience previews restrict their own results; another viewer cannot elevate their relationship using a query parameter.
- `GET /for-you?cursor=` (018) is the For You candidate source, separate from Wall. It also needs the `forYou` flag (off for production, on for internal and developer). It pages live, **public**, **original** posts newest first from authors who are `discoverable`, leaving out the viewer, anyone blocked in either direction and anyone the viewer muted; every row then passes the same `readable()` check as Wall (audience, blocks, author access, reports, deletion). Reposts are not candidates. A page holds at most 2 posts per author (`FOR_YOU_AUTHOR_CAP`); extras are skipped, not deferred, and stay on the profile. Its cursor has its own key, so a Wall cursor answers 400. Position is `(createdAt, _id)`, so an edit never moves a post, a post deleted or made non-public between pages is simply absent, and pages never repeat. Same 100-row scan bound and short-page cursor as Wall; no public posts gives `{posts: []}`. No ranking yet (that is #3).
- `GET /:id` returns the complete permitted snapshot. Every read (detail, feed, a message's post card) signs fresh `media[].url`/`posterUrl` read links only after the audience check. They are signed at the start of the hour and valid for two, so a URL is stable (cacheable) for an hour and dies within two; someone dropped from the audience can never get a new one.
- `PATCH /:id {title,caption,audience}` and `DELETE /:id` are owner-only; food facts and media stay immutable. A post with neither food nor media cannot be edited down to no text. `PATCH /:id/audience {audience}` is the header's quick audience switch, also owner-only.
- `GET /:id/engagement` returns `{likeCount, commentCount, liked, reposted, repostCount}`. `PUT /:id/like` and `DELETE /:id/like` set the viewer's like and return the new counts.
- `PUT /:id/not-interested` and `PUT /:id/hide-author` (#3 task A, needs `forYou`) record that the viewer doesn't want this post, or this post's author, in For You; the matching `DELETE`s undo. Only for another member's post the viewer can read now (404 otherwise, 400 for your own). Repeats are no-ops. For You leaves hidden authors out in the query and Not-interested posts in the scan; Friends, profiles and links are unchanged. Hiding an author is an exclusion, not a down-weight, even with ranking (#9): an explicit "don't show me" stays absolute.
- **What may shape For You:** only published post content and in-app interactions with posts. Private nutrition logs, weight, targets, Apple Health and other health tracking never drive recommendations (owner decision on #3, 2026-11-12).
- `PUT /:id/repost` reposts a post the viewer can read and returns the new counts. 400 for your own post or a private one (`canRepost()` in the domain lib). A repeat is a no-op. `DELETE /:id/repost` takes it back.
- In `GET /`, a repost row is shown only when the viewer passes `readable()` for the **repost** (its reposter and copied audience) **and** for the **original**, loaded fresh: the original's audience, blocks, author access, reports and deletion always win. The card is the original's DTO plus `repost: {id, by, isMine, createdAt}`, so likes, comments, shares and reposts from it all target the original. A post already shown in a page (as itself or another repost) is skipped.
- `GET /:id/comments?before=` lists 20 comments newest first, with `nextCursor` (a comment ID) when more exist. Comments by someone blocked in either direction are left out. Authors who have left show as "Former member".
- `POST /:id/comments {text, requestId}` adds a comment; a retried `requestId` returns the original. `DELETE /:id/comments/:commentId` is allowed for the comment's author and the post's owner.
- Every engagement route first runs the same read authorization as `GET /:id`, so a viewer who cannot read a post cannot like it, comment on it or see its counts.
- A newly inserted like or comment notifies the post owner, without awaiting it. Repeats and retried `requestId`s never notify. `PostEngagementService` registers `postLike` (15-minute collapse per post), `postComment` (2 minutes) and `postRepost` (15 minutes, only for a newly created repost), plus the Activity source for others' likes, live comments and reposts on the owner's 500 most recent posts. See [notifications](notifications.md).
- `GET /:id/import` previews already-imported foods and matching names. A post without food answers 400.
- `POST /:id/import {itemKeys,duplicatePolicy:skip|copy,saveAsMeal,mealName?}` copies selected foods privately. `skip` is the default for matching name/brand/unit. Whole meals/combinations can additionally become saved meals; select every item and explicitly copy conflicting names. No import logs a meal.
- `POST /:id/report {reason}` reports and hides a readable, non-owned post. Repeats are safe.
- `GET /reports`, `DELETE /reports/:reportId/post` are developer-only.
- `GET /api/public/posts/:id/preview` (017) is the **one `@Public()` posts route**: it answers only for a live, original, **public** post whose author still has the features, and 404s for everything else (friends-only, private, deleted, reposts, bad ids) without saying which. It returns `PublicPostPreview {id, title, caption (≤200 chars), authorName, label?, macros?, photoUrl?}`: the first photo (or a video's still) signed like any read, and never comments, likes, other media, food facts beyond the totals, or a storage key. The web app's link previews are its only caller.

Read authorization always checks audience, the current friendship, blocks in either direction, author/viewer flags and reporter hiding. Mute excludes an author from Wall without changing direct/profile access. Unfriend revokes friends-only posts. Unblock restores no friendship. Feed cursors are opaque AES-GCM tokens keyed from JWT configuration, so scanning hidden rows does not reveal their IDs or dates. Bounded scans (100 rows/request) may return a short page with an Older posts cursor.

## Publication types and derived values

1. Entry: one owned log entry, using its historical facts and amount.
2. Meal: all owned entries in one day/slot.
3. Day: all owned entries in one day.
4. Food: one active owned catalogue food, without invented amounts.
5. Combination: explicit owned foods/amounts or an active saved meal, using current facts at publishing.
6. Database: all active owned catalogue foods, frozen as collection v1. Larger databases must be split into selections (maximum 1000 per post).

`publicationCalories` derives portion calories only when every amount exists; catalogue collections do not invent a calorie total. `canonicalPublication` includes exact presentation, nutrition, portions and attribution. Imported-food identity ignores local ordinal/slot/portion so the same food eaten twice becomes one catalogue copy; a saved meal adds its amounts. Optional unknown nutrients remain unknown. Open Food Facts attribution survives sharing/importing; ordinary copies credit the post author. Repeated imports never overwrite a recipient's subsequent edits. Concurrent food/saved-meal upserts use unique indexes and tolerate duplicate-key races.

### Topics (#8, For You task B)

Every post the API returns carries `topics: PostTopic[]` (`{id, kind: 'diet' | 'hashtag', label, basis}`), computed on read by `postTopics()` (`libs/shared/domain/src/lib/post-topics.ts`) from the **whole** publication (never the 3-item feed teaser) and the caption. Nothing is stored and nothing is edited by hand. Ids are stable (`diet:high-protein`, `tag:pasta`) for ranking (#C) and interests (#D). The public link-preview route is unchanged and does not carry them.

**Only published content is read**, meaning the publication and the caption: never meal logs, weigh-ins, targets, Apple Health or any other private tracking.

Diet tags use EU nutrition-claim definitions (Regulation 1924/2006) where one exists:

| Id | Rule |
| --- | --- |
| `diet:high-protein` | ≥ 20 % of energy from protein (EU "high protein") |
| `diet:low-carb` | < 26 % of energy from carbohydrate (common definition; no EU claim) |
| `diet:low-fat` | ≤ 3 g fat / 100 g, ≤ 1.5 g / 100 ml (EU "low fat") |
| `diet:low-calorie` | ≤ 40 kcal / 100 g, ≤ 20 kcal / 100 ml (EU "low energy") |
| `diet:low-sugar` | ≤ 5 g sugar / 100 g, ≤ 2.5 g / 100 ml (EU "low sugar") |
| `diet:high-fibre` | ≥ 6 g fibre / 100 g, or ≥ 3 g / 100 kcal (EU "high fibre") |

- Energy shares come from the summed macros with `macroShares()` (4/4/9 kcal per gram). Items are weighed by `amount`. A lone item without an amount (food and collection-of-one posts) uses its per-100 values. A post with several items where any lacks an amount gets **no** diet tags.
- Per-100 rules need one unit across all items, because grams and millilitres are never converted. They don't apply to `day` posts (a whole day "per 100 g" means nothing), which can still be high protein or low carb.
- Sugar and fibre tags need the value on **every** item: a missing nutrient means no tag, never a guess.
- **Plant-based is not offered:** no published fact says it. It needs a real ingredient or category field first.

Hashtags: a `#` at the start or after anything but a letter, digit, `_`, `/`, `&` or `#` (so not inside words, URLs or entities). Then 1–50 Unicode letters, marks, digits or `_` with at least one letter. NFC-normalised, lower-cased, deduplicated in order of first appearance, at most 10 per post (`MAX_POST_HASHTAGS`). Any interest is allowed, not only food.

The card shows diet tags as small chips under the nutrition summary, each with its basis on hover and for screen readers (`DietTopicChips` in `posts.tsx`). Hashtags are not repeated as chips because they are already in the caption; they become links once Explore exists.

### For You ranking (#9, task C)

Behind `forYouRanking` (off for production, on for internal and developer; independent of the
`forYou` moderation gate, which still applies). Without it `GET /posts/for-you` is the newest-first
feed above, unchanged. With it, `ForYouService` (`apps/api/src/posts/for-you.service.ts`) answers:

- **First page (no cursor)** builds a session. The pool is the newest 400 rows matching the plain
  feed's query, filtered by `PostsService.forYouEligible()` (discoverable author, not excluded or
  hidden, not Not-interested, not reported by the viewer, `readableAuthor()` once per author), first
  300 kept. **Eligibility is decided before scoring and again for every page.**
- **Signals**: only the viewer's own likes, comments (not deleted) and reposts since
  `signalSince(now, resetAt)` (90 days, or a later "Reset recommendations" from #10), at most 500
  of each, joined to the target post's author and `postTopics()`. Interactions with deleted posts
  and own posts don't count. **Never imports** (they live in private nutrition rows; owner decision
  on #9), food logs, weight, targets, Apple Health or impressions.
- **Engagement** per candidate: distinct members who liked, commented on or reposted it, never the
  author, the viewer or anyone the viewer blocked or muted; each member once.
- **Ranking**: `rankForYou()` (`libs/shared/domain/src/lib/for-you-ranking.ts`), pure, `now` and
  `seed` explicit, weights in the documented `FOR_YOU_CONFIG`:
  - affinity per topic and per author = Σ kind weight (like 1, comment 2, repost 3) × ½^(age/30 d);
    a chosen interest (#10) adds 2 to its topic.
  - score = 1 × ln(1 + Σ topic affinity) + 1.2 × ln(1 + author affinity)
    + 1 × ½^(age hours/72) + 0.5 × ln(1 + min(engaged members, 50)).
  - **Sparse fallback**: fewer than 3 interactions in the window and no interests → newest first,
    no reasons, no exploration.
  - **Exploration**: every 5th slot goes to a post with no affinity to the viewer (author or topics)
    and fewer than 3 engaged members, in a seeded order (FNV-1a of seed + post id): stable for a
    session, different between sessions and viewers.
  - **Diversity** per page of 10: at most 2 per author and 3 per topic. When nothing left fits, the
    topic limit gives way first, then the author limit; posts are deferred, never dropped.
- **Reasons** (≤ 2, codes stored, words made per read by `forYouReasonText()`): *Matches your
  interest: X*, *Because you engaged with posts tagged X*, *You've engaged with N's posts before*
  (≥ 2 interactions), *Popular with members* (≥ 5 engaged members), *Something new, outside what
  you usually engage with* (an exploration slot), *Posted recently* (≤ 48 h, when nothing else
  applies). A reason that would need a missing label is left out rather than made vague.
- **Paging**: the cursor is an encrypted `{seed, offset}` under its own key. A page re-reads its
  posts, re-runs `forYouEligible()` and the full `readable()`, and skips anything no longer
  eligible, so mid-session deletions, audience changes, blocks, reports and Not interested win, and
  nothing repeats or is skipped. An unknown or expired session answers `{posts: [], expired: true}`;
  a tampered cursor is 400.
- **Web**: For You does not poll (`refreshInterval: 0`, no revalidate on focus), because a first
  page starts a new session. A ranked card shows its first reason under the header (`ForYouReasons`
  in `posts.tsx`), opening to all reasons and what they are based on. An expired page offers
  *Back to the top*.
- **Budget (Atlas M0)**: a session row is ≈ 300 × (24-byte id + short codes) ≈ 15 KB, one per viewer
  for 30 minutes: 1,000 concurrent viewers ≈ 15 MB. A first page reads ≤ 400 posts, ≤ 1,500 own
  interaction rows and the pool's like/comment/repost rows; later pages read ≤ 20 posts each.
  New indexes: `post_likes (userId, createdAt)` and `post_comments (userId, createdAt)`.

### For You interests and reset (#10, task D)

The catalogue is `FOR_YOU_INTERESTS` in `libs/shared/types/src/lib/posts.ts` (version
`FOR_YOU_INTERESTS_VERSION`): the six diet topics plus twelve broad interests (home cooking, quick
meals, meal prep, baking, desserts, breakfast, vegetarian, vegan, fitness, running, food on the
road, budget eats). **An interest matches posts only through their computed topics** (#8): a diet
interest matches its `diet:*` tag; a broad one matches a few caption hashtags (Baking →
`#baking`, `#bread`, `#cake`). Hashtags are matched exactly after the caption parser's lowercase,
NFC normalisation. Ids are stable; retiring one means removing it from the catalogue, and it is then
ignored on read (never an error).

- `GET /posts/for-you/preferences` → `{interests, recommendationsResetAt?}` (known ids only).
- `PUT /posts/for-you/preferences {interests}` replaces the list (`[]` clears it). Unknown ids or
  more than 20 → 400. Needs the For You features like the feed.
- `POST /posts/for-you/reset` sets `recommendationsResetAt` to now and drops the current ranked
  session, so the next first page is rebuilt without earlier likes, comments and reposts. Interests
  are kept; the likes themselves are untouched.

How they shape ranking (#9, only with `forYouRanking`): each chosen interest adds a fixed 2 to the
topic affinity of the topics it maps to, and any interest counts as enough signal to leave the
chronological fallback. A matching post's reason names the interest: *Matches your interest:
Baking*. **When few or no posts match**, nothing is filtered out: interests only add to a score,
so the rest of the pool still fills the feed by freshness and engagement, and the exploration share
(every 5th slot, posts unrelated to the viewer's interests and history) keeps it varied. Without
`forYouRanking` interests are stored and editable but change nothing, and the copy says so.

Web: `components/for-you-preferences.tsx`. The setup step `interests-v1` (skippable, never
blocking Home) and Settings → *For You* share the `InterestPicker` (each tap saves); Settings adds
*Clear interests* and *Reset recommendations* (with a confirmation saying what it does and doesn't
forget). Both appear only for accounts with For You.

### For You measurement (#11)

Behind **`forYouMetrics`, off for every cohort and for the developer** until a group policy or an
account override turns it on (`DEFAULT_OFF_FEATURES`; the developer follows the *internal* group's
value for these). Building it was approved; **collecting production data was not**, and is a
separate rollout decision. Nothing here is read by ranking (#9): `ForYouService` never touches it.

What is counted, per UTC day, in total and per post: `impression` (at least half the card, or half
the screen for a taller card, visible for 1 s), `videoStart`, `video25/50/75/100` (the first loop),
`quickSkip` (left the screen after less than 2 s of play, before finishing), and `like`, `comment`,
`repost` and `notInterested` made on a For You card; plus `visitors` and `returningVisitors` (also
visited on one of the previous 7 days). Only on For You; Wall, profiles and post pages are never
measured.

- `GET /posts/for-you/metrics` → `{enabled, optedOut, active}`; `PUT … {optedOut}` sets the opt-out.
  Opting out stops counting at once (every request re-checks it) and deletes the account's keys.
- `POST /posts/for-you/metrics/events {events: [{postId, type}] (≤ 50), visit?}` → `{accepted,
  dropped}`, always 2xx for a valid body. An event counts only if: the flag is on and the account
  has not opted out; the post passes the same `forYouEligible()` check as the feed **at the time it
  is counted** (public, live, original, discoverable author, not blocked, muted, hidden, reported
  or Not interested); a `like`, `comment` or `repost` matches the stored row and `notInterested`
  matches the stored feedback; the same account has not counted that post and event today; and
  the account is under **2,000 events a day**. Everything else is dropped without saying why.
- `GET /posts/for-you/metrics/report?range=7|28` (developer only) → `FeedMetricsReport`: totals,
  one row per day and the 50 most-seen posts. Counts are always shown; **a rate is only shown over
  at least 30** impressions, video starts or visitors (`perMille()`, `null` below). Nothing is per
  account, and the view has no user list or history.
- Web: `lib/feed-metrics.ts` (tracker, impression hook) and the video hook in `post-media.tsx`.
  The browser checks the status first and creates nothing while measurement is inactive. It sends
  every 15 s and when the page is hidden or left, with `fetch(keepalive)` (a beacon cannot carry
  the token) and never retries. Settings → For You → *Measurement* says what is kept, how long and
  who sees it, and holds the opt-out, which can be set before measurement ever runs. Developer
  view: `/settings/for-you-metrics`.

**Privacy.** The keys are **pseudonymous, not anonymous**: the server holds the secret, so anyone
with it and a candidate account id can recompute an account's keys and see which posts it saw in
the last 2 days. That is why keys are HMAC'd (an unkeyed hash of guessable ids could be reversed by
anyone with the database), live at most 8 days, and are never shown. The daily aggregates hold no
account; a post's row is about the post, though **with very few viewers a count can still point to
a person** (one impression on a post with one known viewer), which is why rates need 30 and the
view is developer-only. Rotating `JWT_SECRET` makes all existing keys unlinkable (they then simply
expire). **Account deletion** (not built yet) must call `FeedMetricsService.forget()`, which deletes
every key for the account's last 9 days by `owner`; the aggregates need nothing. Because opting out deletes the visit key, opting back in on the same day counts that account as a visitor a second time.

**Abuse.** One account adds at most 1 to any post's count per event per day, at most 2,000 events a
day and 50 per request, and only for posts it may see in For You; engagement events cannot be
invented. Requests are authenticated like every route. There is no per-IP limit or bot detection:
a coordinated group of real accounts can still inflate counts, by at most one each.

**Atlas M0 budget (512 MB).** A key row is about 150 bytes with its indexes. At 100 active viewers
× 200 events a day, keys hold about 40,000 rows (≈ 6 MB) at steady state; daily rows are about
300 bytes per post seen per day, so 2,000 posts a day for 90 days is about 54 MB. Each counted
event costs a handful of small reads and writes; at the cap, one account's day is about 10,000
operations. Revisit before rolling out beyond a few hundred accounts.

## Media storage

Files live in a private Cloudflare R2 bucket (S3 API), configured by `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: all four or none (none hides photos and video; a partial set refuses to boot). `StorageService` (`apps/api/src/storage`) signs links with `aws4fetch` and never proxies a file. The bucket needs a CORS rule allowing `PUT` and `GET` with the `content-type` header from the web origins, or browsers cannot upload. R2's free tier (10 GB, free egress) covers Tier 0.

The browser prepares files before uploading (`apps/web/src/lib/media.ts`): photos are decoded with their EXIF rotation, drawn to a canvas at most 2048 px on the long side and re-encoded as JPEG 0.85, which drops location and camera metadata. Video only comes from the in-app camera (`MediaRecorder`, MP4 where supported, else WebM, 2.5 Mbps, 30 s cap) with a still drawn from its first frame. Library videos are not accepted: their length, size and origin are unknown and there is no transcoding.

## Screens

The tab bar is Home, Messages, **+**, Search, Menu (Friends moved into Menu in 015). The **+** opens `/new`, the new post page. It is not one of the swiping tabs: the shell shows no header or tab bar there, and closing goes back. The composer is on top and the live camera underneath, half and half. Dragging the camera up fills the screen with it, dragging it down puts it away (a flick moves one stop); focusing a text field puts it away too, and a capture in full screen drops back to half so the photo shows in the post. Tap the shutter for a photo, hold it to record up to 30 s; the camera runs only while visible and the microphone is asked for right after the camera opens, so the first hold records straight away. Captures and library photos upload while the person writes, with a progress ring and retry. The toolbar has **+** (Add from Food: Diary by day with whole day, meals and single entries; Foods; Saved meals; Database), **New food**, Photos, Camera (when put away) and the audience. A post carries at most one food: picking one replaces a new food and the other way round. Share is enabled once something is there and every upload has finished. The audience starts at the Food profile's default. Food's share buttons open `/new?source=<selection JSON>` with that item attached and the camera put away.

**New food** types a food in the composer: name, portion and unit, kcal, protein, carbs, fat (numbers for that portion). It is created as a `per_serving` food. Two checkboxes: *Save to my foods* (on) and *Log as {current slot} now* (off; disabled unless saving). The buttons follow `newFoodActions()` in `libs/shared/domain`: save only → **Save food** / **Save and Post**; save and log → **Save and log food** / **Save, Log and Post**; not saved → **Post** only. Saving sends the first finished upload as the food's photo (`imageMediaId`). Logging logs one serving into the slot `mealContextNow(dayStartHour)` gives. Posting shares the logged entry when there is one, else the food. A food posted without saving is created `archived` and without a photo: it exists only so the post can snapshot its numbers, and it never shows in the list or picker. Created ids are remembered, so a retry after a failure continues instead of making a second food or entry.

**Photo and food are one card.** In the composer and in a post, a food's photo sits flush on top of its numbers inside one rounded border, with no gap and no inner rounding. Food cards other than a whole day show `MacroRings`: calories split by source, and protein, carbs and fat each filled to its share of the calories (4/4/9 kcal per gram, `macroShares()`), not to anyone's targets, so the rings mean the same to every viewer.

Posts show media in a swipeable carousel framed by the first item (clamped to 4:5–1.91:1), with a counter and dots; videos play muted and looping while at least 60% on screen, and a tap toggles the sound. A post without food has no food card and no Import option; a short text-only post is shown larger.

Home shows the feed under the widgets. With the `forYou` flag (019) it is two tabs, **For You** (default, `GET /for-you`) and **Friends** (the Wall, unchanged; not "Following", since friendship is mutual), in `home-feed.tsx`: each keeps its own page and Older/Newer history, switching restores that tab's scroll once the feed is scrolled into, the choice lasts the browser session, an empty For You offers Friends, and the strip is tap/keyboard only (`data-no-tab-swipe`). The strip is **not sticky**: when the header hides on scroll, anything pinned to the top sits in the iPhone status-bar band and shows through hollow, so it scrolls away with the feed and the header brings navigation back on scroll up. A For You card's menu adds **Not interested** and **Hide {name} from For You**; either collapses the card into a one-line note with Undo, and hiding an author also removes their other cards from the page until Undo. Without the flag Home shows "From your friends" as before. Wall is the fourth bottom tab when all three features are enabled. Food offers entry/meal/day/food/database share actions, each opening `/new` with that selection attached; logging offers a dismissible share action afterward. Profiles open Posts, with About alongside for permitted live widgets. Posts can be reviewed, edited, deleted, imported, reported or hidden. Each post's footer has three buttons: Like, Comment and Share. Share opens a bottom sheet (`post-share-sheet.tsx`): with the `messages` feature, a row of chat heads (recent conversations first, then friends you have not talked to) where a tap sends the post as a reference, so its audience still applies (see [messages](messages.md)); below it, Repost/Reposted (only for another member's non-private post), Save foods (another member's post with food: closes the sheet and opens the import dialog), Copy link and, where the browser has one, More… for the system share sheet. A third row, **Share to** (017), scrolls sideways: Instagram and TikTok (share the Story image), WhatsApp, Messenger (touch devices only, it opens the app's URL scheme), Facebook and X (web share intents from `shareTargetUrl()`), and Save image. The image buttons appear only where `canShareImage()` allows it: your own posts, or public ones. A repost card shows "↻ <name> reposted · time" above the original's header and is keyed by `repost.id` in lists. The link opens only for signed-in viewers the post's audience already allows. Developer Menu includes the report queue.

## Sharing outside the app (017)

**Story image.** `apps/web/src/lib/share-image.ts` draws a 1080×1920 PNG in the browser: brand, a card with the first photo, author, title, and the macro rings with grams and shares. Nothing is uploaded or stored. The sheet renders it as soon as it opens, so `navigator.share({files})` runs inside the tap (iOS refuses a share started after an `await` that outlived the gesture); where files cannot be shared it downloads. The photo is loaded with `fetch(url, {mode: 'cors', cache: 'no-store'})` and `createImageBitmap`, **not** an `<img>`: the post already showed that URL without CORS, and the browser's cached copy taints the canvas. A tainted canvas is redrawn without the photo.

**Link previews.** `app/posts/[id]/layout.tsx` sets the page's Open Graph and Twitter metadata, and `opengraph-image.tsx` renders a 1200×630 card with `next/og`, both from the public preview route (`lib/public-preview.ts`, cached 5 minutes, `API_INTERNAL_URL` or an absolute `NEXT_PUBLIC_API_URL`). A post that is not public gets a generic "A post on Life Portal" title and image, so a link never reveals more than the audience allows; opening it still needs sign-in and the audience check. The OG card loads Noto Sans and Noto Sans Georgian from Google Fonts, subset to the text, because the built-in font has no Georgian glyphs.

## Verification and boundaries

Domain tests cover source selection, canonicalisation, duplicates, calorie calculation and the audience matrix. API tests cover owned allowlists, historical snapshots, invalid combinations and private/import retry behavior. Isolated API/browser checks exercise the complete publication/import flow with separate accounts. Engagement tests cover idempotent likes and comments, delete rights, blocked commenters and notifying only on new rows. Reactions beyond a like, comment replies, image moderation before public launch, library video, financial posts, automatic posting, a public web page for a post (previews exist, the page itself still needs sign-in), a native Instagram Stories sticker (needs the native app) and collection updates are future work.

Related: [social](social.md), [nutrition](nutrition.md), [portal](portal.md), [007 specification](../../specs/007-food-posts/spec.md).
