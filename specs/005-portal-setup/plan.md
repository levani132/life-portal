# Implementation plan

1. Add shared module registry, cohort access resolution and safe preference contracts.
2. Add server access checks, developer administration and selected dashboard construction.
3. Add idempotent private migration in nutrition, and server-owned setup progress/preferences.
4. Build Home/Menu shell, setup wizard and reusable module/privacy settings.
5. Verify policy and migration boundaries with tests; run typecheck, lint, tests, builds and
   isolated database/browser smoke flows. Update module docs, decisions and changelog.

No new dependencies or external flag service: the current database stores overrides, and
shared pure policy functions make the small cohort rules testable without a paid service.
