# Spec 035: Sync integration tests and observability (issue #22)

Phase C of #19. The owner pre-approved Mongo-backed CI tests and content-free aggregate metrics
on #19; the defaults are in the review comment on #22.

## User stories

1. As the developer, I know the sync guarantees hold against a real database, not only fakes,
   on every push.
2. As the developer, I can see whether offline writes are being refused, replayed or arriving
   late, without seeing anyone's data.
3. As whoever debugs a sync problem, I have one page that says where to look.

## Requirements

- FR-001 `npm run test:integration` boots the real API in-process (`configureApp`, shared with
  `main.ts`) against `INTEGRATION_MONGODB_URI`. Each file uses `lp-int-<random>` and drops it.
  It is not part of `npm run check`.
- FR-002 Server scenarios cover:
  - two-device edits (`STALE_EDIT`, `ROW_DELETED`, weigh-ins);
  - a retry after a lost response, sequential and concurrent;
  - key reuse, and keys kept per account;
  - `ID_TAKEN`, `SESSION_CONFLICT` (released, not replayed) and `CLIENT_TIME_TOO_OLD`;
  - cross-account isolation.
- FR-003 Client scenarios drive the web app's own `Outbox` and `sendAs` against the API:
  - dependent writes;
  - repeated replay after lost answers;
  - account switching, through the identity guard;
  - sign-out;
  - refusals kept with their code and `current`.
- FR-004 CI: `.github/workflows/integration.yml` with a `mongo:7` service and no secrets.
- FR-005 `sync_health_daily` stores `{day, metric, key, count, expiresAt}` and nothing else.
  - **Metrics:** `writes`, `replays`, `refusals` (allowlisted code or `http_<status>`) and `age`
    (a bucket of `X-Queued-Age`).
  - **Who counts:** only writes with an `Idempotency-Key`, counted by `IdempotencyInterceptor`,
    never awaited and never throwing.
  - **Retention:** a 90-day TTL.
- FR-006 `GET /sync-health?range=7|30|90` and `/settings/sync-health` are for the developer only
  (`requireDeveloper`).
- FR-007 `docs/runbooks/offline-sync.md` covers symptoms, codes, replay, migrations, data-loss
  risks and privacy.

## Out of scope

- Per-account diagnostics, alerting, and external monitoring services.
- An opt-out, since nothing personal is stored.
