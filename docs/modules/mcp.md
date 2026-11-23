# Module: MCP (Model Context Protocol)

AI assistant integration for the nutrition widget. Lets external AI apps (ChatGPT, Claude, Amazon Q, etc.) read and write food data on behalf of the user.

**Code:** `apps/api/src/mcp/`
**Web:** `apps/web/src/app/settings/mcp/page.tsx`

## Authentication

MCP supports OAuth authorization-code sign-in with S256 PKCE, dynamic client registration,
rotating refresh tokens and revocation, plus legacy long-lived tokens. OAuth is enabled only
when `MCP_OAUTH_ISSUER` is set to the canonical API origin. It never derives issuer URLs from
request Host/forwarded headers. See [deployment and plugin setup](../integrations/mcp-oauth.md).

Legacy MCP tokens (1 year) remain separate from the normal JWT session:

1. Manual-token clients do not need a browser session
2. The token is scoped to MCP operations only (`typ: 'mcp'` in the payload)
3. Users generate tokens explicitly from Settings → AI Assistant

The token is verified on every `/mcp/call` and Streamable HTTP request, including GET and
DELETE for existing sessions. Session IDs never authorize a request; sessions also belong to
the authenticated user. Invalid or expired credentials return 401, with an OAuth discovery
challenge on the Streamable HTTP endpoint when OAuth is enabled.

## Endpoints

All under `/api/mcp`.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `ALL` | `/` | MCP/OAuth token | Standard MCP Streamable HTTP endpoint. |
| `GET` | `/oauth/status` | JWT | Whether OAuth sign-in is enabled. |
| `POST` | `/oauth/revoke` | JWT | Revoke all OAuth connections for the current user. |
| `POST` | `/token` | JWT | Generate an MCP token. Requires normal login. |
| `GET` | `/tools` | Public | List available tools for AI discovery. |
| `POST` | `/call` | MCP token | Execute a tool. Token in request body. |

## Available Tools

### Reading

| Tool | Description |
| --- | --- |
| `get_nutrition_day` | Full nutrition data for a day: meals, macros, targets, week balance. |
| `list_foods` | Search the food database by name/brand. |
| `get_profile` | Nutrition profile and calculated targets. |
| `get_weigh_ins` | Weight history. |

### Writing

| Tool | Description |
| --- | --- |
| `log_meal` | Log a meal entry (requires food ID, day, slot, amount). |
| `update_meal` | Edit an existing entry's amount, slot, day, or note. |
| `delete_meal` | Remove a meal entry. |
| `create_food` | Add a food to the database. |
| `update_food` | Edit a food's name, macros, or settings. |
| `delete_food` | Delete or archive a food. |
| `update_profile` | Change goals, activity level, or manual overrides. |
| `log_weight` | Record a weigh-in. |

## Request Format

```json
POST /api/mcp/call
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "tool": "get_nutrition_day",
  "arguments": {
    "day": "2025-01-15"
  }
}
```

## Response Format

```json
{
  "result": {
    "day": "2025-01-15",
    "totals": { "energyKcal": 1850, "proteinMg": 142000, ... },
    "slots": [...],
    "targets": { ... }
  }
}
```

Errors return standard HTTP status codes with a message body.

## Security Notes

- Tokens are user-scoped: a token can only access its owner's data
- The token type (`mcp`) is checked on every call — a normal access token cannot be used
- Foods that have been logged are archived, not deleted, preserving history
- The snapshot rule applies: logged meals keep their facts frozen at log time

## Example AI Prompts

Once connected, users can say things like:

- "What did I eat today?"
- "Log 200g of chicken breast for lunch"
- "Add a new food: Greek yogurt, 170g serving, 100 kcal, 17g protein"
- "Update my goal to fat loss"
- "Log my weight: 75.5 kg"

The AI translates these into tool calls using the schema from `GET /mcp/tools`.

## OAuth persistence and boundaries

- `mcp_oauth_clients`: client ID and AES-256-GCM-encrypted registration metadata. The
  encryption key derives from `JWT_SECRET`; rotating it requires reconnecting OAuth clients.
- `mcp_oauth_credentials`: SHA-256 hashes of browser tickets, single-use authorization codes,
  access and refresh tokens; client, user, resource, scopes, grant ID and expiry. Mongo TTL
  cleans expired rows; every lookup checks expiry explicitly, without waiting for cleanup.
- These two collections preserve registrations and grants across Render restarts. The existing
  MCP SDK owns OAuth parsing, redirect validation, PKCE verification and protocol rate limits.
  `express-rate-limit` is now a direct dependency for the password/consent endpoint's limit.
- Consent uses `Referrer-Policy: strict-origin`: native form POSTs retain their Origin while
  the ticket URL is never sent in Referer. Missing, null and foreign origins remain rejected.
  Its CSP permits form submission to self and navigation back to only that validated request's
  callback origin, because browsers may also enforce form-action on the OAuth redirect.
  Consent requires an HttpOnly SameSite browser-binding cookie and exact form Origin, expires
  after ten minutes and is consumed once. Credentials are checked through AuthService without
  rotating or replacing the dashboard refresh token. The page names the callback origin rather
  than trusting a self-reported client display name.
- Codes expire after 60 seconds, access tokens after one hour, refresh tokens after 30 days.
  Refresh tokens rotate and may only narrow scopes. Refresh requests may omit `resource` to
  inherit the original audience; an explicit different audience is rejected. Revocation invalidates the entire grant,
  including outstanding access tokens; the settings action revokes all the user's OAuth grants.
- Tokens are opaque and scoped to `nutrition` and the exact `/api/mcp` resource. They never
  authorize normal JWT dashboard/finance routes. The MCP server resolves the account from the
  verified credential, never from tool arguments.
- Dashboard sign-out/password changes retain their existing behavior; assistant connections
  are independently revoked from Settings → AI Assistant. Legacy manual tokens are unchanged.
- Rate limits are process-local, appropriate for the existing single free-tier API instance;
  horizontally scaled deployments need a shared rate-limit store.

## Pages (spec 041)

`apps/api/src/mcp/page-assistant.ts`. An assistant can act as a page its person manages. The
tools are defined once (`PageAssistantService.tools()`, zod shapes) and offered by both
endpoints; a refusal comes back with a `code` the assistant can relay.

**Consent, checked on every call (`PagesService.assistantActingAs`):**

1. the person switched on "Let a connected assistant manage my pages" (`users.assistantPages`,
   `PUT /pages/assistant`, shown in `GET /pages` as `assistant`); otherwise `ASSISTANT_OFF`;
2. they still manage the page (`NOT_A_MANAGER`) and it is not suspended (`PAGE_SUSPENDED`);
3. the page is marked "run with AI" (`PAGE_NOT_AI`). A page made with `create_page` is marked.

This is a switch on the account, not an OAuth scope: every connection the person made gets it
together. A separate `pages` scope on the grant is the stricter design and is not built.

**Tools.** Every one but `list_my_pages` and `create_page` takes `pageId`.

| Group | Tools |
| --- | --- |
| Pages | `list_my_pages`, `create_page`, `update_page`, `disable_page` (off, not deleted; only the app switches it on), `get_assistant_activity` |
| Library | `list_page_foods`, `create_page_food`, `update_page_food`, `delete_page_food`, `list_page_recipes`, `create_page_recipe`, `delete_page_recipe`, `list_page_meal_plans`, `create_page_meal_plan`, `update_page_meal_plan`, `delete_page_meal_plan`, `list_page_programmes`, `create_page_programme`, `update_page_programme`, `delete_page_programme`, `update_page_recipe`, `update_page_plan`, `list_page_exercises`, `create_page_exercise`, `list_page_plans`, `get_page_plan`, `create_page_plan`, `delete_page_plan` |
| | `create_page_meal_plan` takes `rules` (spec 043) in the units people use (g, kcal, g or kcal per kg, %), each for the whole plan or one `dayIndex`, and converts them to stored integers (mg); a plan may be rules alone. `list_page_meal_plans` returns rules as sentences |
| Photos | `prepare_page_media_upload`, `finish_page_media_upload`, `set_page_photo` (the page's profile photo, from a checked upload) |
| Posts | `create_page_post` (text; one food, recipe or meal plan and/or one training plan or exercise; `mediaIds`; `draft`), `publish_page_draft`, `update_page_post`, `delete_page_post`, `list_page_posts` |
| Reading | `get_for_you`, `get_following`, `get_post`, `get_post_comments`, `get_account_profile`, `get_suggested_pages` |
| Engaging | `follow_page`, `unfollow_page`, `like_post`, `unlike_post`, `repost_post`, `unrepost_post`, `comment_on_post`, `delete_page_comment`, `get_page_notifications`, `block_account`, `unblock_account`, `list_page_conversations`, `get_conversation_messages`, `reply_in_conversation` |

A draft is a post with audience `private`; publishing sets it to `public`. There is no tool to
delete a page or to open a conversation.

**Photos.** The server generates nothing and fetches nothing; the assistant uploads its own
file, the way a browser does, in three steps:

1. `prepare_page_media_upload {pageId, kind: 'image', bytes, width, height}` answers a one-time
   upload link (`MediaService.assistantTicket`, the ordinary upload ledger with `viaAssistant`).
   The link is signed for `image/jpeg` and that exact size, for 15 minutes. Counted against the
   `media` cap (20 a day by default).
2. The assistant PUTs the file to the link. Whether it can depends on the assistant: it needs
   somewhere to run an HTTP request with the file (ChatGPT's agent mode, Claude with code
   execution), and that place must be allowed to reach the storage host.
3. `finish_page_media_upload {pageId, mediaId}`: the server reads the file once
   (`StorageService.read`, capped at the photo limit), requires a real JPEG (`cleanJpeg()` in
   `libs/shared/domain`), replaces the declared size with the true one, and removes Exif (GPS),
   XMP, IPTC and comments, which a device's re-encoding would have dropped. Anything else is
   deleted and refused (`NOT_A_PHOTO`). Only then does `create_page_post` accept the id in
   `mediaIds` (`MEDIA_NOT_CHECKED` otherwise).

JPEG only: the app shows, shares and checks JPEGs and the server has no image library to
convert. The photo check runs on the post as for any photo. `kind` is in the tool so video can
join the same flow; video is not accepted yet.

**Caps.** `assistantCap()` in `libs/shared/domain`: per page, per UTC day, per kind (`post`,
`comment`, `like`, `follow`, `message`, `library`, `media`). Defaults 10/30/100/30/30/200/20, stored by the
owner in `assistant_settings` (`GET/PUT /page-assistant/caps`); one person's override in
`users.assistantCaps` (`PUT /page-assistant/caps/:personId`, `null` clears); `-1` is no cap; the
owner's own account has none. A capped call answers 429 `CAP_REACHED`. Reading, unfollowing and
unliking are not counted.

**The log.** `page_assistant_actions {pageId, personId, kind, tool, targetId?, day, createdAt}`:
no content. Written after a counted action succeeds; counted for the caps; read by the page's
managers (`GET /page-assistant/activity/:pageId`, and `get_assistant_activity`). Kept 90 days
(TTL on `createdAt`), and deleted with the page (`ACCOUNT_PLAN`: owned by `pageId`).

Pages of the same person are not treated differently: they may follow, like, comment on and
message each other (owner's decision, 2026-11-23; a refusal was built first and removed).

Everything else is the ordinary services run as the page, so moderation, blocks, audiences and
the messaging rule (`page-first`) apply unchanged. Tested in
`integration/page-assistant.integration.ts`.

### Doing things later (`at`)

An assistant usually runs on its own timetable (an hourly job), so it cannot post at 09:17
itself. `create_page_post`, `publish_page_draft`, `comment_on_post`, `like_post`, `follow_page`
and `reply_in_conversation` take an optional `at` (ISO date and time with offset). With it the
call is stored in `page_scheduled_actions {pageId, personId, tool, args, runAt, status, error?,
startedAt?, doneAt?}` and answered `{scheduled, actionId, at}`; a clock in `PageAssistantService`
(`tick()`, every minute) claims each due row and runs the same tool.

- Up to 7 days ahead; a post with photos 20 hours (an unattached upload is deleted after a day).
  At most 500 waiting per page.
- Checked when scheduled: the page, the time, the photos. Checked when it runs: the consent, the
  page's state and that day's caps. A refusal is stored as `failed` with its code.
- A post, comment or message carries a request id fixed at scheduling, and a row is claimed
  before it runs, so nothing happens twice. A row cut off by a restart is failed, not retried.
- `list_scheduled_actions`, `cancel_scheduled_action`; the page's managers see what is waiting
  in the same panel as the log. Finished rows, with their text, are removed after a week
  (TTL on `doneAt`); deleting the page removes them at once (`ACCOUNT_PLAN`).

### The managers' overview

`GET /page-assistant/overview` (person): every page they manage with `postsToday` (the
assistant's posts this UTC day, from the log), `queued` (pending scheduled actions), `failed`
(scheduled actions failed in the last 24 hours) with the latest reason, and `lastActionAt`. Web:
Menu → **All pages at a glance** (`/settings/pages`), failures first. For the developer the
screen also offers **Mark all official** (`PUT /page-assistant/official`: every page they
manage). Changing a post's photos is not supported for anyone; the assistant deletes the post
and creates it again.

### Parity with the app (2026-11-23)

Everything a page can do in the app, its assistant can do, except changing a post's photos after
it exists (delete and post again) and the managers' own settings (official mark, co-managers,
caps), which stay with people. Edits mirror creates: a meal plan or training plan is replaced
whole (`update_page_meal_plan` takes the same fields as create), a recipe or programme by the
fields sent. `get_page_notifications` is the page's activity list (`NotificationsService.activity`
as the page); `delete_page_comment` follows the app's rule (own comments anywhere, anyone's on
the page's own posts); `block_account` is the app's block, which ends follows both ways.
`repost_post` is schedulable with `at`.

### Worker instructions (2026-11-23)

`get_worker_instructions {worker: A–E}` returns the instructions for one of the owner's page
workers, with a version hash. Only the developer account (`DEVELOPER_USER_ID`) may call it
(`NOT_THE_OWNER` otherwise). The text is generated with the worker files by
`docs/playbooks/build-workers.py` into `apps/api/src/mcp/worker-instructions.ts`; each ChatGPT task
holds only a short block that loads it, so a push changes what every worker does on its next run.
`list_my_pages` says `hasPhoto` for each page; the instructions require a profile photo first.

### Surviving a restart (2026-11-23)

Sessions live in the API's memory, and every push to `main` restarts the server. A request that
names a session the server no longer holds, from an account its token signs in, is answered on
its own (`handleStateless`: a server and transport for that request, closed with it) instead of
404 `Session not found`; ChatGPT does not start a new session on a 404 and reported `-32603`
mid-run. A session that belongs to another account is still a 404. Tools keep no session state,
so nothing is lost.

### A full session table (2026-11-23)

The server holds at most 100 sessions. It used to refuse a new one with 503 `Too many sessions`
once full, and a session only left the table after 30 idle minutes with no stream open. ChatGPT
keeps a listening stream (GET) open, so its sessions never left, and with five workers the table
filled during a day: every new connection was refused, which ChatGPT shows as `-32603`, for
every worker at once. Now a new session evicts the longest-idle one (sessions with no open stream
first). A later call on the evicted session is answered statelessly, as after a restart.
