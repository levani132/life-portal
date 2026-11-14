# Plan 035

- C1: `apps/api/src/app/configure-app.ts`; `integration/` (harness, jest config, tsconfig,
  smoke test); `npm run test:integration`; typecheck includes `integration/`; the CI workflow.
- C2: `integration/sync-server.integration.ts`.
- C3: `apps/web/src/lib/offline/send.ts` (moved from runtime); `integration/sync-client.integration.ts`.
- C4: shared types and domain `sync-health` (tested); `apps/api/src/sync-health/`; interceptor
  counting; `X-Queued-Age`; the developer page and menu link; `integration/sync-health.integration.ts`.
- C5: runbook and docs.

No new dependencies.
