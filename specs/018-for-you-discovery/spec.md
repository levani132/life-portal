# For You discovery API

Issue #2. Approved order #2 → #1 → #3 (owner, 2026-11-12). The tabs are #1; ranking is #3.

A separate, authenticated candidate source for a For You feed: live, **public**, **original**
posts from across Life Portal, newest first, as `PostPage` cards. `GET /posts` (Wall and
profiles) is unchanged.

## Rules

- Behind a new `forYou` feature flag (off for production, on for internal and developer), on top
  of social + nutrition + foodPosts.
- Authors must have opted in to being found (`social_profiles.discoverable`). Someone who chose
  not to appear in search does not appear in a stranger's feed either.
- Never the viewer's own posts, authors blocked in either direction, or authors the viewer muted.
- Every row passes the same live `readable()` check as Wall and detail: audience, blocks,
  author access, reporter hiding, deletion.
- Reposts are not candidates (their original is). No duplicates within a page.
- At most 2 posts per author per page; extras are skipped, not deferred.
- Opaque AES-GCM cursor with its own key, so a Wall cursor is refused. Position is
  `(createdAt, _id)`, which never changes: edits do not move a post, a post deleted or made
  non-public between pages is simply absent, and pages never repeat.
- Bounded: at most 100 rows scanned per request; a short page can carry a cursor.
- Cold start: an empty page with no cursor.

## Out of scope

Ranking and signals (#3), the Home tabs (#1), image moderation (a launch gate: the flag stays
off in production until it exists).
