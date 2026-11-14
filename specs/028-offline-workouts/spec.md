# Spec 028: Offline workouts (issue #17)

Builds on spec 027 (the outbox, the per-account cache, `Idempotency-Key`). Owner-approved
defaults on #17: client-chosen ObjectId ids, a user-resolvable conflict for two open workouts,
cached plan / recent history / custom exercises, provisional records, conditional plan-day update.

## User stories

1. **A whole plan workout with no signal.** Start a cached plan, log, edit, untick and remove sets,
   add, swap, skip, reorder and remove exercises, change rests and supersets, write notes and
   finish. Everything shows at once and is kept on the device.
2. **A reload changes nothing.** The workout, its timers (from `startedAt` and `lastSetAt`) and its
   sets are rebuilt from the cached server copy plus the writes still on the device.
3. **Exactly once in effect.** Every write is sent once in order; a retry after a lost answer is
   replayed by the server (`Idempotency-Key`), and every create carries the id it will have, so
   nothing is duplicated and nothing flickers when the server's copy replaces the local one.
4. **Errors are reviewable.** The sync sheet lists every refused write; "Discard changes not
   accepted" on the workout drops them (confirmed).
5. **Two open workouts.** A workout started offline while another is open (another device) is
   never merged or dropped silently: the sync sheet offers "Finish the other, send this" or
   Discard. An *online* start that collides with nothing logged on it is dropped and the open
   workout shown, as starting always did.
6. **Exercises offline.** The picker searches the exercises kept on the device (own, used in the
   last 90 days, in visible plans); anything else is labelled unavailable offline.
7. **Records are the server's.** Records, ranks, levels, 1RM and tournaments are never computed on
   the device; while writes are waiting the workout says they update once synced.
8. **Plan-day update (#15).** Reviewed online and confirmed with no signal, it is sent later with
   the revision it was reviewed against. If the day changed meanwhile the server refuses
   (`PLAN_CHANGED`) and the card offers "Review again".

## Requirements

- FR-001 Creates accept an optional client `id` (24 hex). The API checks it is a valid ObjectId
  and not used by **any** user (409 `ID_TAKEN`); ownership is the route's usual check.
- FR-002 A start with an `id` while another workout is open → 409 `SESSION_CONFLICT` with
  `openSessionId`. A start without one still resumes (unchanged).
- FR-003 Rows copied from a plan get ids derived from the start's `requestId` and the plan
  exercise id (`sha256("lp-planned:<requestId>:<planExerciseId>")`, first 24 hex), so the device
  knows them before the server answers.
- FR-004 Client times (`startedAt`, set `loggedAt`, finish `endedAt`) are clamped by the server:
  never in the future, never more than 48 h back, a set never before its workout started, a
  finish never before the start or the last set.
- FR-005 `GET /training/exercises/offline` returns at most 1000 exercises for the device copy.
- FR-006 Only training writes use this; the spec 027 allowlist is unchanged.
