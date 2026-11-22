# Errors

Error monitoring: the developer finds out that something broke in production without a person
having to say so. Built in-house, in the same spirit as sync health: counted, scrubbed, and with
nothing about who it happened to.

## What is recorded

`error_events`, one row per kind of error per day:

| Field | Meaning |
| --- | --- |
| `day` | `YYYY-MM-DD` (UTC) |
| `fingerprint` | a hash of source, name, scrubbed message and place: what makes it "the same error" |
| `source` | `api` (a request failed on the server) or `web` (something broke on a page) |
| `name`, `message` | the error's name and message, **scrubbed** |
| `where` | a route pattern (`GET /posts/:id`) or a page pattern (`/posts/:id`), never an address |
| `status` | the HTTP status answered, for `api` |
| `stack` | the first 12 lines of the most recent stack, scrubbed, without query strings |
| `count`, `lastAt` | how often that day, and when last |
| `expiresAt` | Mongo deletes the row after 30 days |

**No account, no request body, no query string, no address with ids.** Never add one.

## Scrubbing (pure, `libs/shared/domain/src/lib/error-reports.ts`)

`scrubErrorText` removes email addresses, 24-hex ids, UUIDs, long tokens, numbers of four or
more digits, and anything in quotes (a quoted value is usually the input that failed). It is
applied in `ErrorsService.record()` to everything, whatever the caller passed. `pagePattern`
turns a page's path into a pattern and drops its query and hash (a link-only post's key is in
the query). Each has tests with the kinds of text that must not survive.

## Where errors come from

- **The server:** `RecordingExceptionFilter`, a global filter. It records a request that failed
  with no HTTP status (a crash) or a 5xx, then calls Nest's own filter, so **the response is
  exactly what it was before**. A 4xx is the caller's doing (a refusal, `STALE_EDIT`, a bad
  form) and is not recorded. Tested over real HTTP.
- **The page:** `ErrorWatch` listens for uncaught errors and unhandled rejections, and
  `app/error.tsx` (the screen shown when a page crashes while drawing) reports what it caught.
  `reportError()` sends each kind once per visit, at most ten per visit, never an `ApiError`, a
  `NetworkError` or an `AbortError`, and ignores a failed report.

## Limits

- 200 different kinds a day per server process; known kinds keep counting.
- `POST /errors/client`: ten reports a minute per account (in memory); the rest are dropped.
- Recording is never awaited and never throws.

## Endpoints

| Route | Who | What |
| --- | --- | --- |
| `POST /errors/client` | any signed-in account | `{ name, message, stack?, page }`. Who sent it is not kept |
| `GET /errors?range=1\|7\|30` | developer | kinds over the range, most frequent first |

The admin page is `/settings/errors` (Menu → Errors).

## Not covered

Errors before sign-in (the route needs a session), a server that cannot start, and alerts: the
log is read, it does not notify. A hosted service (Sentry) remains the Tier 1 choice in the
roadmap if those matter.
