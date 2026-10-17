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

## Update the existing plugin

The server change alone does not change the installed plugin's API-key declaration.
Update the existing Life Portal plugin, preserving its identity and skills:

- Use `life-portal-oauth.mcp.json` in this directory as the OAuth MCP configuration.
- In its `mcp.json`, change `extensions.com.openai.auth` from `api_key` to `oauth` with
  `client.mode: dcr`, resource `https://life-portal.onrender.com/api/mcp` and scope `nutrition`.
- If the package also contains `.mcp.json`, keep its declaration consistent. Remove legacy
  literal Authorization headers; do not put tokens or passwords in the package.
- Save/upload the new version through the plugin's owning editor and refresh its connection.
  Select OAuth / dynamic client registration if the connection UI asks. The server advertises
  authorization, token, registration and revocation URLs automatically.

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
