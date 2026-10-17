# Plan

Use the installed MCP SDK's OAuth routers (discovery, registration, PKCE, token exchange,
revocation and rate limits). Add a Nest provider with Mongo persistence so Render restarts
do not lose client registrations or grants. Serve a small mobile sign-in/consent page on
the API origin with browser-bound CSRF protection and limited login attempts. Reuse the
existing account password verification without replacing dashboard refresh tokens.
Require an explicit canonical public issuer URL; never trust request Host headers.
Validate MCP credentials on every transport request and enforce session ownership.
Keep generated token compatibility and supply an OAuth plugin manifest example.
