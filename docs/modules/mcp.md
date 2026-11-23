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
| Pages | `list_my_pages`, `create_page`, `update_page`, `get_assistant_activity` |
| Library | `list_page_foods`, `create_page_food`, `update_page_food`, `delete_page_food`, `list_page_recipes`, `create_page_recipe`, `delete_page_recipe`, `list_page_exercises`, `create_page_exercise`, `list_page_plans`, `get_page_plan`, `create_page_plan`, `delete_page_plan` |
| Posts | `create_page_post` (text, one library item, `draft`), `publish_page_draft`, `update_page_post`, `delete_page_post`, `list_page_posts` |
| Reading | `get_for_you`, `get_following`, `get_post`, `get_post_comments`, `get_account_profile`, `get_suggested_pages` |
| Engaging | `follow_page`, `unfollow_page`, `like_post`, `unlike_post`, `comment_on_post`, `list_page_conversations`, `get_conversation_messages`, `reply_in_conversation` |

A draft is a post with audience `private`; publishing sets it to `public`. There is no tool to
delete a page, to upload a photo, or to open a conversation.

**Caps.** `assistantCap()` in `libs/shared/domain`: per page, per UTC day, per kind (`post`,
`comment`, `like`, `follow`, `message`, `library`). Defaults 10/30/100/30/30/200, stored by the
owner in `assistant_settings` (`GET/PUT /page-assistant/caps`); one person's override in
`users.assistantCaps` (`PUT /page-assistant/caps/:personId`, `null` clears); `-1` is no cap; the
owner's own account has none. A capped call answers 429 `CAP_REACHED`. Reading, unfollowing and
unliking are not counted.

**The log.** `page_assistant_actions {pageId, personId, kind, tool, targetId?, day, createdAt}`:
no content. Written after a counted action succeeds; counted for the caps; read by the page's
managers (`GET /page-assistant/activity/:pageId`, and `get_assistant_activity`). Deleted with
the page (`ACCOUNT_PLAN`: owned by `pageId`).

Pages of the same person are not treated differently: they may follow, like, comment on and
message each other (owner's decision, 2026-11-23; a refusal was built first and removed).

Everything else is the ordinary services run as the page, so moderation, blocks, audiences and
the messaging rule (`page-first`) apply unchanged. Tested in
`integration/page-assistant.integration.ts`.
