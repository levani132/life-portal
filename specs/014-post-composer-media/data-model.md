# Data model: 014

## `post_media` (PostsModule) — the upload ledger
| Field | Notes |
|---|---|
| `userId` | uploader, indexed |
| `kind` | `image` \| `video` |
| `key` | `media/{userId}/{_id}.{jpg\|mp4\|webm}` |
| `posterKey?` | video still, `media/{userId}/{_id}-poster.jpg` |
| `contentType`, `bytes` | declared; checked against the object on attach |
| `width`, `height`, `durationMs?` | facts about the file |
| `postId?` | set on attach; absent = pending |
| `createdAt` | cleanup after 24 h while pending |

Indexes: `(userId, createdAt)` for the rate limit; `(postId)`; partial `(createdAt)` where `postId` absent.

## `food_posts` changes
- `publication` becomes optional (text and media posts have none). `previewHash` optional with it.
- `media?: [{id, kind, key, posterKey?, contentType, width, height, durationMs?}]`, a copy of the ledger's facts so reads need no join (facts about immutable files, not derived values).

## Response: `FoodPost`
- `kind?`, `contentLabel?` absent without food; `itemCount` 0 and `items` [].
- `media: PostMedia[]` with `{id, kind, width, height, durationMs?, url, posterUrl?}`.
