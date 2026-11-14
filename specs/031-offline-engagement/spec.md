# Spec 031: Likes, reposts and comments without a connection (issue #20, S1)

Builds on specs 027–030. Owner-approved on #20: social split into S1 (queued likes, reposts,
comments), S2 (post drafts) and S3 (cached reading, deferred: only the user's own content may be
kept until the owner confirms a policy for other people's posts). This spec is S1 only.

## User stories

1. **Like, repost and comment with no signal.** On a post already on screen, a like, a repost or
   a comment works at once and says "Not sent yet" until the server has it. It is sent once, in
   order, when the connection is back.
2. **Changing my mind costs nothing.** Liking and unliking (or reposting and undoing it) with no
   connection cancel out: nothing is sent and the author is never notified.
3. **Never shown to others before the server accepts it.** The author is notified by the server,
   only when it accepts the write, as before.
4. **A post that went away.** A like, repost or comment removal for a post that is gone, private
   now, blocked or reported is dropped quietly. A comment on one stays in the sync sheet with its
   full text, to copy, until discarded.
5. **No offline measurement.** For You metrics are not recorded for interactions made offline.

## Requirements

- FR-001 `POST /posts/:id/comments` accepts an optional `id` (a Mongo id chosen by the device);
  a new comment must not take an id any comment already has (`ID_TAKEN`); a retry with the same
  `requestId` returns the original, as before.
- FR-002 `DELETE /posts/:id/comments/:commentId` of a comment already removed answers success,
  for the same people allowed to remove it (author or post owner); otherwise 404 as before.
- FR-003 Every "post not readable now" 404 carries `code: 'POST_GONE'` (same message, one answer
  for every reason).
- FR-004 Web writes are outbox kinds `social.like`, `social.repost`, `social.comment`,
  `social.comment.remove`; the post shows the server's figures with the waiting writes applied
  (`offline/social-overlay.ts`).
- FR-005 A toggle withdraws a waiting opposite toggle for the same post instead of queuing,
  only if that write never left the device (`maybeSent` unset) and the outbox is not sending.
- FR-006 `api.ts` answers `NetworkError(notSent)` without fetching when the browser is offline;
  the outbox records `maybeSent` on any other transient failure.
- FR-007 Deleting a comment not sent yet withdraws it; deleting a saved one is queued.
- FR-008 The post page keeps a post already on screen when a refetch cannot reach the server;
  only the server's refusal (`ApiError`) shows "unavailable". The comment list's network failure
  is a muted note, not an error.

## Out of scope

S2 (drafts), S3 (keeping posts for offline reading), saves/bookmarks. Reading a feed with no
connection is unchanged: only what is already on screen can be interacted with.
