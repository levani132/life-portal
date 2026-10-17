# Connect Life Portal from ChatGPT on iPhone

## Deploy the API

1. Deploy this repository's API changes using its existing Render deployment.
2. Set `MCP_OAUTH_ISSUER=https://life-portal.onrender.com` in that service's environment
   (use the actual public API origin if different). Keep `JWT_SECRET` unchanged.
3. Restart/redeploy. No database migration is needed: Mongoose creates the OAuth collections
   and indexes. They live beside the existing data, not in a separate external service.
4. Verify `GET /.well-known/oauth-authorization-server` and
   `GET /.well-known/oauth-protected-resource/api/mcp` return JSON on the public API origin.
   An unauthenticated request to `/api/mcp` should return 401 with `WWW-Authenticate`.

## Register a hosted connection and update the existing plugin

An imported plugin containing `mcp.json` / `.mcp.json` remains **Desktop only**, even for
remote HTTPS servers. OAuth in those files alone does not make the imported plugin mobile.

1. In ChatGPT Plugins, choose Add → Add custom MCP server. Use the public MCP URL above,
   OAuth, Dynamic Client Registration and the `nutrition` scope. Create the hosted connection
   and sign in. Copy its resulting `plugin_asdk_app_...` ID from the browser URL.
2. Preserve the existing Life Portal Nutrition Assistant plugin identity and skills. Add
   `.app.json` referencing the **verified** `asdk_app_...` ID from that hosted connection,
   with `required: true`.
3. Set `extensions.com.openai.apps` in `plugin.json` to `./.app.json`, and `apps` in the
   compatibility `.codex-plugin/plugin.json` to the same path. Remove the compatibility
   `mcpServers` reference and delete both bundled MCP files. Do not invent an App ID or leave
   either MCP declaration behind, since that retains the desktop-only restriction.
4. Save a new version of the same plugin. Verify its connection dependency and confirm that
   the web/mobile entry no longer says Desktop only. Start a fresh Work chat and execute a
   read-only tool through that hosted connection.

`life-portal-oauth.mcp.json` remains a server-configuration reference for local desktop
clients and OAuth discovery; it is not the mobile plugin package.

The SDK validates exact registered redirect URIs. Use the exact callback shown by the host;
there is no wildcard callback allowlist. This server uses DCR, rather than CIMD, and does not
advertise RFC 9207 issuer identification, so ChatGPT may use its callback-specific redirect.

## Connect on iPhone

Open the Life Portal plugin connection in ChatGPT, choose Connect, sign in on the Life Portal
page, and approve nutrition access. Start a fresh chat after updating the plugin and ask for
today's meals and macros, specifying your local day. No manual token entry is needed.

To disconnect, open Life Portal → Settings → AI Assistant → Disconnect all signed-in
assistants. This leaves manual tokens active. Individual grants can also be revoked through
`POST /revoke` by the authenticated OAuth client.

## Local verification

Use a disposable Mongo database, not the production URI:

```
MONGODB_URI=mongodb://127.0.0.1:27019/lp-oauth-test
MCP_OAUTH_ISSUER=http://localhost:3333
DISABLE_SCHEDULES=true
```

Keep the other required variables from `.env.example`. Run `npm run check` and `npm run build`.
The API tests exercise the real SDK HTTP endpoints, invalid PKCE/client/redirect/resource,
CSRF, cancellation, code replay, refresh rotation, expiry, revocation and MCP session ownership.
A full deployed iPhone link still needs verification after deployment and plugin refresh.

References: [OpenAI MCP OAuth](https://developers.openai.com/plugins/build/auth),
[plugin authentication configuration](https://developers.openai.com/plugins/build/plugins).

Mobile packaging reference: [ChatGPT plugin management](https://learn.chatgpt.com/docs/enterprise/plugin-management#desktop-only-plugins).
