# Spec 034: Offline robustness (issue #21)

The owner approved all five proposed defaults on #21, with two refinements: moving a too-old
workout must show the recorded time against the new one and be confirmed, and a write this
version cannot read is preserved in storage and discarded only with confirmation.

## User stories

1. A workout I logged offline and synced weeks later keeps its real times, or, if that is too far
   back, I am told and choose what happens; history is never rewritten without me seeing it.
2. Something I queued more than a month ago is not sent until I say so.
3. Updating the app never throws away or garbles my unsent work.
4. If the browser deleted my unsent work, I am told how many changes were lost, when it can tell.
5. Another account's unsent work on a shared device is neither shown to me nor sent as me.

## Requirements

- FR-001 (B1) `POST /training/sessions` with a `startedAt` more than 14 days before the server's
  now answers 422 `CLIENT_TIME_TOO_OLD` with `recordedAt`. Up to 14 days, device times are kept
  as recorded. A retry of a start the server already has is answered as before.
- FR-002 (B1) The sync sheet offers "Save with today's date" for that refusal: it shows "Recorded"
  and "Will be saved as" and requires confirmation. The whole workout moves (start, sets, finish)
  so it ends now with its spacing kept; each write is replaced with a new id. Or Discard.
- FR-003 (B2) A write queued more than 30 days ago that is still pending becomes `held` and is not
  sent; "Send anyway" sends it once (`sendConfirmed`). Held writes count as needing attention.
- FR-004 (B3) Outbox items and cache entries carry `schema`. Outbox records are migrated step by
  step in memory; one with no migration path or a bad shape is `incompatible`: never sent, never
  rewritten in storage, discardable only with a confirmation naming that. A cache entry of another
  schema is dropped and fetched again.
- FR-005 (B4) `lp.offline.meta:<userId>` in localStorage holds the account's unsent count and a
  time, nothing else. A durable database that opens with fewer writes than that shows "N changes
  lost". Best effort; iOS usually clears both together (see `docs/modules/offline.md`).
- FR-006 (B4) Other accounts' unsent writes are shown as a total only. A write is never sent with
  a token issued for another account.

## Out of scope

- Recovering an evicted outbox; server-side backups of unsent work.
- Moving food or weigh-in times (their day is chosen by the person and sent explicitly).
