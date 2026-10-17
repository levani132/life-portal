# Module: MCP (Model Context Protocol)

AI assistant integration for the nutrition widget. Lets external AI apps (ChatGPT, Claude, Amazon Q, etc.) read and write food data on behalf of the user.

**Code:** `apps/api/src/mcp/`
**Web:** `apps/web/src/app/settings/mcp/page.tsx`

## Authentication

MCP uses long-lived tokens (1 year) separate from the normal JWT session. This is deliberate:

1. AI assistants cannot hold a browser session or refresh tokens
2. The token is scoped to MCP operations only (`typ: 'mcp'` in the payload)
3. Users generate tokens explicitly from Settings → AI Assistant

The token is verified on every `/mcp/call` request. Invalid or expired tokens return 401.

## Endpoints

All under `/api/mcp`.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
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
