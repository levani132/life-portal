# MCP OAuth sign-in

Users connecting Life Portal from ChatGPT on iPhone must sign in and explicitly grant
nutrition access without copying an API token. Existing manually generated MCP tokens
continue to work. OAuth credentials must never open normal dashboard/finance routes.

Acceptance: discover metadata; register a client; authenticate on Life Portal; approve or
cancel; exchange a single-use PKCE-bound code; call tools as that user; refresh/revoke;
reject wrong client, redirect, audience, expired credentials and cross-user sessions.
