# Tasks

- [x] Implement persistent provider, login/consent, discovery, refresh and revocation.
- [x] Wire OAuth and legacy tokens into MCP authentication on every request.
- [x] Add protocol/security regression tests and exercise the HTTP flow.
- [x] Document environment, deployment and plugin reconnection; run quality gates.

## Validation

- Node 22: `npm run check` passed (360 existing domain tests + 8 new HTTP/security tests).
- Node 22: API and web production builds passed. A temporary empty local fork-ts-checker
  config avoided an unreadable configuration directory belonging to the parent macOS account;
  the temporary file was removed afterward. No build configuration change was needed.
- Disposable local MongoDB + real built Nest app: account sign-in and consent, confidential
  DCR client exchange, nutrition tool access, dashboard rejection, preserved dashboard refresh,
  code replay rejection, refresh rotation, user revocation and legacy-token compatibility passed.
- Production deployment, installed plugin update and physical iPhone sign-in are pending.
