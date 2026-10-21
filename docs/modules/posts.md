# Food posts and Wall

Explicit publishing is separate from live widget sharing: a private Food widget can still have an intentionally shared food post. Every post requires a preview, a title and an explicit audience. New posts start **Only me** in the composer. Public means authenticated Life Portal users with the required features, not anonymous web access.

## Ownership and schema

`PostsModule` owns `food_posts` and `post_reports`; `NutritionModule` alone reads tracking records and creates imported foods/saved meals through `NutritionPublicationService`. These collections preserve explicit publication events and reports without exposing private tracking collections.

- `food_posts`: owner `userId`, unique `(userId, requestId)` UUID for retry safety, SHA-256 `previewHash`, title (120), caption (1000), audience private/friends/public, version 1, timestamps, deletion tombstone. Index `(userId, createdAt desc, _id desc)` supports stable feeds.
- `publication`: kind, label, optional day/slot, and 1–1000 server-created food snapshots. Item keys are local ordinals, not tracking IDs. Snapshots contain name/brand, unit, serving size/label, nutrition facts, optional eaten amount/slot, attribution. No source record IDs, notes, favourites, barcodes, targets or measurements.
- `post_reports`: unique `(userId, postId)`, reason, timestamp and optional `resolvedAt`. The queue lists unresolved reports; moderation resolves all reports for the removed post. A report immediately hides that post from its reporter. Developer review returns report metadata; it grants no access to a private post's contents. A developer may remove a reported post by report ID.
- `foods.attribution`, `foods.postImportKey`: provenance and unique per-user publication/food-facts key (partial unique index). Existing documents require no backfill. `saved_meals.postImportKey` similarly makes repeat whole-meal imports idempotent. These are independent recipient-owned copies, never links into an author's tracking data.

Deletion erases the stored food snapshot and caption while retaining an owner/request tombstone so a retried publish cannot resurrect it. Previously imported copies remain recipient-owned; the composer and import UI explain this.

## API

Authenticated `/api/posts` routes require **social + nutrition + foodPosts**, evaluated server-side. Production still has Food only by default; internal and developer accounts receive the new flag. Author feature access is also rechecked on every read/import. All responses use `Cache-Control: private, no-store`.

- `POST /preview {source}` returns a strict food projection and fingerprint.
- `POST / {source, previewHash, requestId, title, caption, audience}` rebuilds the source and rejects a changed fingerprint with 409. Matching UUID retries return the original post; mismatched reuse and deleted requests fail with 409.
- `GET /?authorId=&cursor=&preview=normal|friend|stranger` lists 10 visible posts. Wall includes self and accepted, unmuted friends; other public posts are reached through profiles. A feed teaser contains at most three foods. Owner-only audience previews restrict their own results; another viewer cannot elevate their relationship using a query parameter.
- `GET /:id` returns the complete permitted snapshot.
- `PATCH /:id {title,caption,audience}` and `DELETE /:id` are owner-only; food facts stay immutable.
- `GET /:id/import` previews already-imported foods and matching names.
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

## Screens

Wall is the fourth bottom tab when all three features are enabled. Food offers entry/meal/day/food/database share actions plus the full composer; logging offers a dismissible share action afterward. Profiles open Posts, with About alongside for permitted live widgets. Posts can be reviewed, edited, deleted, imported, reported or hidden. Developer Menu includes the report queue.

## Verification and boundaries

Domain tests cover source selection, canonicalisation, duplicates, calorie calculation and the audience matrix. API tests cover owned allowlists, historical snapshots, invalid combinations and private/import retry behavior. Isolated API/browser checks exercise the complete publication/import flow with separate accounts. Comments, reactions, images, financial posts, automatic posting, public web links and collection updates are future work.

Related: [social](social.md), [nutrition](nutrition.md), [portal](portal.md), [007 specification](../../specs/007-food-posts/spec.md).
