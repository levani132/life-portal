# Spec 032: Posts written without a connection (issue #20, S2)

Builds on specs 027–031. Owner-approved on #20 (S2):
- photos only, re-encoded;
- at most 4 photos and 50 MB per draft;
- video online-only;
- upload links asked for at publish time;
- a meal the post depends on syncs first;
- explicit draft / publishing / posted states.

S3 (keeping posts for reading) stays deferred.

## User stories

1. With no connection, I write a post with photos (and optionally a food I ate) and tap
   "Post later". It is kept on this device and posted when I am back online.
2. Above my feed I can see where it stands: a draft, being posted (with progress), not accepted
   (with the reason, Retry and Discard), or posted (with a link). Nobody else sees it before the
   server has it.
3. If I logged the meal offline too, the post waits for the meal to be saved, and its numbers are
   the ones the server has when it posts.
4. A post interrupted halfway is never doubled, and photos already uploaded are not uploaded again.

## Requirements

- FR-001 A draft is one outbox item, kind `social.post`. Its body holds:
  - the post's `requestId`, `title`, `caption` and `audience`;
  - an optional `source`;
  - the photos as blobs, with their size, and a `mediaId` once uploaded.

  Nothing derived is stored, and no upload link.
- FR-002 Publishing proceeds in this order:
  1. Upload each photo not yet uploaded (`POST /media`, then a PUT to storage), saving its
     `mediaId` onto the item as it lands (`Outbox` `send(item, save)`).
  2. Preview the food, if there is one.
  3. `POST /posts` with the draft's `requestId`.

  No Idempotency-Key is sent: `requestId` already returns the same post on a repeat.
- FR-003 A refusal with code `MEDIA_GONE` (now set by `MediaService.reserve`) makes the draft
  upload its photos again, once, within the same attempt.
- FR-004 A draft holds photos only: at most 4, 50 MB in all. A video, or a new food typed in the
  composer, needs a connection, and the composer says so.
- FR-005 A draft of a logged meal, a meal slot or a day `dependsOn` every waiting
  `nutrition.entry.*` / `nutrition.meal.*` write on the device.
- FR-006 The composer offers "Post later" when the device is offline, when a request got no
  answer, or when a photo is still waiting to upload. Photos already uploaded keep their ids in
  the draft, so a post that did reach the server is not doubled.
- FR-007 `PostDrafts` above the home feed shows each draft's state. The note "Posted" with a link
  appears once the server accepts it.

## Out of scope

- Keeping posts for reading offline (S3).
- Offline video.
- Creating a food offline from the composer.
- Background Sync: a draft is sent only while the app is open, like every outbox write.
