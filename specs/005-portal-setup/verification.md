# Verification — 2026-10-22

- `npm run check`: typecheck and lint pass; 364 domain tests and 12 API tests pass.
- `npm run build`: API and web production builds pass.
- `git diff --check`: pass.

Isolated runtime: ephemeral MongoDB, API port 4333, web port 4200. Temporary verification
packages live outside the repository. The configured real database was not used.

HTTP scenarios verified:
- New registration is production/Food-only; module and admin endpoints deny access.
- Crafted module preferences cannot grant feature access; unexpected fields are rejected.
- Setup progress/skip/completion and empty Home persist through API round trips.
- Cohort policies and per-user false overrides apply without issuing a new JWT.
- Developer identity has every module; EPAM is denied to internal users by slug and child ID.
- Unversioned public food rows are undiscoverable; migration resets legacy sharing to private
  and does not overwrite later deliberate visibility changes.
- Disabling Food denies both normal API reads and legacy MCP tool calls.

Mobile Chrome (390×844): real UI registration → Food-only module selection → private defaults →
reload/resume → finish later → resume → complete → Menu → remove/add module → empty Home →
revisit setup → create first food from logger → record meal → 120 kcal displayed on Home.
No page errors or failed API requests; no horizontal overflow.

Desktop Chrome (1440×1000): developer login → consolidated Money card → cohort policy edit →
reload confirms saved policy → create project → open project detail. No page errors.

Release configuration: set server `DEVELOPER_USER_ID` to the owner's account ID (authenticated
`GET /api/auth/me`). This is required for EPAM and developer feature controls. Other existing
accounts retain internal module availability and get a setup invitation; new registrations
start with production policy. Social publishing and shared profile views remain future work.
