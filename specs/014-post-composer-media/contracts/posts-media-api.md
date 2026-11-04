# Contract: posts media (all routes need social + nutrition + foodPosts; media routes also postMedia)

`GET /api/posts/media/config` → `{available, maxItems: 10, maxVideoSeconds: 30}`. `available` = flag on and storage configured.

`POST /api/posts/media` `{kind, contentType, bytes, width, height, durationMs?, poster?: {bytes}}`
- image: `image/jpeg` ≤ 15 MB; video: `video/mp4`|`video/webm`|`video/quicktime` ≤ 60 MB, `durationMs` ≤ 30 500; poster `image/jpeg` ≤ 2 MB.
- 429 above 60 uploads an hour. → `{id, upload: {url, headers}, poster?: {url, headers}}`.

`POST /api/posts` `{requestId, title, caption, audience, source?, previewHash?, mediaIds?: string[] (≤10, unique)}`
- 400 when there is no text, media or source. `previewHash` required with `source`.
- Each media id must be the author's, pending (or already on this same request's post), and its object(s) must exist with the declared type and size, else 400 "Upload not finished".
- Same `requestId` retried with the same fields returns the original post.

`DELETE /api/posts/:id` and moderation also delete the media objects.
