# Moderation: what strangers should not see

Spec 039. `apps/api/src/moderation` (the image check), `apps/api/src/posts/post-moderation.service.ts`
(holding, reports, the queue), suspension in `apps/api/src/auth`, web `app/settings/reports`.

## Holding a post

`food_posts.heldAt` set means only the author can read the post. `canReadFoodPost({held})` is the
rule, so feeds, links, reposts, messages and previews all follow it; the two direct queries
(the public preview and the For You candidates) filter on it as well. The author's own copy
carries `held: 'checking' | 'review'`; nobody else ever learns a post is held.

| `heldReason` | Set when | Ends when |
|---|---|---|
| `checking` | A post with photos becomes reachable by others and a checker is configured | The check passes (released) or flags it (`check`) |
| `check` | The automatic check flagged the photos; `checkCategories` says what | The reviewer keeps or removes it |
| `reports` | `reportsHoldPost()`: one `child_safety` report, or 3 open reports | The reviewer keeps or removes it |

Other fields: `mediaCheck: 'ok' | 'flagged'` (absent: never checked), `checkedAt` and `checkScores`
(the service's score per category, 0 to 1, kept so the rule can be tuned;
`GET /posts/moderation/checks` lists the latest 30 to the developer as numbers only), `reviewedAt` (a reviewer
kept it: reports no longer hide it, though they still reach the queue).

## The automatic check

- `IMAGE_CHECKER` is an `ImageChecker` or `null`. Configured by `IMAGE_CHECK_PROVIDER=openai` and
  `OPENAI_API_KEY` (both or neither; a partial pair refuses to boot).
- `OpenAiImageChecker` calls OpenAI's moderation endpoint (`omni-moderation-latest`), one image
  link per request. It is free of charge. It is sent a read link that works for about an hour,
  and nothing else: no account, no caption.
- **Only photos other people can reach are sent**: a post that is public, for friends, or
  link-only. A private post is checked when its audience is opened (`onVisible()`).
- A video is judged by its still image.
- `imageHoldCategories()` (pure, in `libs/shared/domain`) decides what hides a post: sexual,
  graphic violence and self-harm. Plain `violence` does not: sport and food photos trip it.
- A check that fails leaves the post held. `retryChecks()` runs every ten minutes; after thirty
  minutes a post still waiting shows in the queue.
- Profile photos: `SocialService.setAvatar()` checks before saving. Flagged → 422
  `PHOTO_REFUSED`; the service unreachable → 503 `PHOTO_CHECK_DOWN`.

### What it does not catch

- **Known child-abuse images.** The endpoint classifies what a picture shows. It does not
  compare pictures with the databases of known abuse material, and its child-related category
  is for text only. Matching known images needs a hash-matching service: Cloudflare's CSAM
  Scanning Tool covers files served through a Cloudflare domain (ours are read from R2 with
  signed links, so it does not apply as things are), and others (PhotoDNA, Thorn's Safer) need
  an application. Until one is in place, the report reason "puts a child at risk" hides a post
  on the first report.
- Food pictures, brand logos, comments, profile text, messages, and video beyond its still.

## Reports

`POST /posts/:id/report {reason}` as before (007): it hides the post from the reporter at once.
Reasons: `nudity`, `violence`, `child_safety`, `spam`, `harassment`, `privacy`, `misleading`,
`other` (`REPORT_REASON_LABELS`). After each report `onReport()` applies `reportsHoldPost()`.
`post_reports` gained `resolution: 'removed' | 'kept'`.

## The review queue (developer only)

- `GET /posts/moderation` → `ModerationQueue`: held posts (`check`, `reports`, and `checking`
  older than 30 minutes) and posts with open reports, at most 100, held first. Each item is the
  post itself: text, signed media, author, audience, why it is there. **The reviewer may read a
  reported or held post whatever its audience**; that is a deliberate exception to "private
  means private" (DECISIONS, 2026-11-22).
- `POST /posts/moderation/:postId/keep`: unhold, set `reviewedAt`, close its reports as `kept`.
- `DELETE /posts/moderation/:postId`: erase content and files like an author's delete, close its
  reports as `removed`.
- The older `GET /posts/reports` and `DELETE /posts/reports/:id/post` still answer.
- The author gets an email when the reviewer removes their post (their own title, the date, a
  link to the rules and how to object), and a person gets one when their account is suspended.
- The developer gets an email when a post is flagged, hidden by reports, or first reported. It
  names no post and no person.

## Suspension (developer only)

`POST /auth/accounts/:id/suspend {reason}` and `/unsuspend`. `users.suspendedAt` and
`suspendedReason`. A suspended account: every session revoked, sign-in refused with 403
`ACCOUNT_SUSPENDED` (password and Google), refresh refused, and `AccessService.forUser()` answers
every feature off, which is what hides its posts from everyone. The developer account cannot be
suspended. Nothing is deleted; restoring brings it all back.

## Tests

`post-moderation.service.spec.ts` (holding, the check, retry, reports, the queue, keep and
remove), `image-checker.spec.ts`, the moderation cases in `libs/shared/domain/src/lib/posts.spec.ts`,
`posts.service.spec.ts` (a held post is the author's alone), `social.service.spec.ts` (profile
photos), `access.module.spec.ts` (a suspended account has nothing on).
