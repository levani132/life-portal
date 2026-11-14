# Spec 033: Your own posts, readable offline (issue #20, S3)

The owner chose option (a) on #20: keep only the signed-in person's own posts for offline reading,
and never other people's posts or media. Caching other people's content would be a separate,
explicitly approved feature.

## User stories

1. With no connection, I can open my own profile and see my latest posts, and open one of them.
2. Nothing anyone else wrote (including a post of theirs I reposted) is on my device.
3. A post I deleted on another device disappears from the kept copy the next time I am online.
4. Signing out, or "Delete offline data", removes all of it.

## Requirements

- FR-001 These reads keep a filtered copy (`offline/reads.ts` `FILTERED`, `offline/own-posts.ts`):
  - **`/posts/<id>`:** only when `isOwner` and not a repost.
  - **`/posts?authorId=<id>&preview=<p>`:** the first page, with only own non-repost posts and no
    `nextCursor`.
  - **`/social/me?preview=<p>&today=<d>`:** identity fields only, with `widgets: []`, because a
    shared widget can show money.
- FR-002 If an answer has nothing to keep, any older copy is removed. A refusal from the server
  (`ApiError`, e.g. `POST_GONE`) also removes the copy. Only "no answer at all" (`NetworkError`)
  is answered from the device.
- FR-003 No photo is copied. Kept posts carry the signed links the server sent, which expire within
  2 hours, so offline a photo shows only if the browser still has it.
- FR-004 Copies live in the account's own database `lp-offline:<userId>`, which logout and
  "Delete offline data" delete (spec 027). Another account never sees them.

- FR-005 Offline, the profile reads the shell's kept portal state, so its Posts tab still shows.
  A post's like and comment counts are not kept; their absence offline is not shown as an error.

## Out of scope

- Other people's posts and photos, the Wall, For You, and comments.
