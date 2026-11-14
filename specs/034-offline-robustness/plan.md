# Plan 034: Offline robustness

Staged commits on one change, each with tests:

- **B1** `sessions.service.ts` `MAX_CLIENT_BACKDATE_MS`; web `offline/too-old.ts` (pure:
  `tooOldStart`, `movedToToday`), `training-offline.ts` `saveMovedWorkout`, sync sheet choice.
- **B2** outbox `held` state, `HOLD_AFTER_MS`, `confirm(id)`; sync sheet "Send anyway".
- **B3** `offline/schema.ts` (`OUTBOX_SCHEMA`, `CACHE_SCHEMA`, `MIGRATIONS`, `readOutboxRecord`);
  outbox and cache write and check `schema`; `incompatible` state in the sheet and drafts.
- **B4** `offline/device-meta.ts`; outbox `track` callback; runtime notices store and identity
  guard (`mayReplayAs`); sync sheet notices.

No new dependencies, no IndexedDB version bump, no API schema change.
