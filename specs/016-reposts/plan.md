# Plan: Reposts

**Spec**: [spec.md](spec.md)

## Technical context

Same stack as 007/014. No new collection: a repost is a `food_posts` row with `repostOf`, no
publication, media, title or caption, and `requestId = "repost:<originalId>"`, so the existing
unique `(userId, requestId)` index makes reposting idempotent. Undo deletes the row (it holds no
content, likes or comments, so it needs no tombstone).

## Constitution check

1. Bounded module: all in `posts`; notifications through the registry. ✓
3. Derived never persisted: `repostCount` is counted on read. ✓
4. Single-sourced: the repost references the original; nothing is copied (FR-007). ✓
5. Pure rule: `canRepost()` lives in `libs/shared/domain` with tests. ✓

## Design

- `PostsService.repost(userId, id)` / `unrepost(userId, id)`; routes `PUT|DELETE /posts/:id/repost`.
- `read()` and every owner write ignore repost rows, so a repost id is never addressable.
- `list()` resolves a repost row: the repost must pass `readable()` for its own author, then the
  original is loaded and must pass `readable()` too; the DTO is the original's plus
  `repost: { id, by, createdAt }`. Duplicates within a page are skipped.
- `ownTitles()` skips reposts. Engagement gains `reposted` and `repostCount`.
- Notifications: `postRepost` type, Activity rows from `PostsService.repostRows()`.
- Web: the Share sheet's second row gets Repost/Reposted (hidden for own or private posts); the
  card shows "↻ <name> reposted" and keys on `repost.id ?? id`.
