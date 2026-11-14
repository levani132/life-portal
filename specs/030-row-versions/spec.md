# Spec 030: Edits from two devices (issue #19, phase A)

Builds on specs 027–029 (outbox, client ids, overlays). Owner-approved on #19: optimistic version
checks with 409 `STALE_EDIT` carrying the current row; explicit mine/theirs for numbers; text
preserved and combined only through a preview the person confirms; weigh-ins never overwritten
without a choice (with undo); deleting what is already gone succeeds; editing a deleted row is a
recoverable conflict. Device robustness and observability/integration tests are follow-up phases.

## User stories

1. **No silent lost update.** A set, a workout exercise (rest, superset, skip, notes), a workout's
   notes or day, a meal or a weigh-in edited on two devices: the second edit to arrive is refused,
   never applied over the first, and the person sees both.
2. **Choose, never merged on its own.** The sync sheet shows "Yours (this device)" against
   "Theirs (saved)", field by field, with **Keep mine** and **Keep theirs**. A free-text note can
   also be **combined**: a preview with both, which the person edits and confirms before it saves.
3. **Weigh-ins.** One recorded on another device for the same day is never overwritten: both are
   shown, the person picks, and can undo the pick while the sheet is open.
4. **Deleted elsewhere.** Deleting something already deleted is simply done. Editing something
   deleted elsewhere offers **Discard my change** or, for a set, a meal or a weigh-in,
   **Add it again** with the change.
5. **Edits queued on one device stay in order.** A second edit of a row waits for the first and
   is made against the version the first produces; "keep mine" carries both through, "keep
   theirs" drops both.

## Requirements

- FR-001 `workout_sets`, `workout_exercises`, `workout_sessions`, `meal_entries` and `weigh_ins`
  carry `version` (missing = 0), bumped by `$inc` on every edit of what the person typed. Reorder,
  finish and plan bookkeeping do not bump it.
- FR-002 `PATCH /training/sets/:id`, `PATCH /training/sessions/:id/exercises/:weId`,
  `PATCH /training/sessions/:id`, `PATCH /nutrition/entries/:id` and `PUT /nutrition/weigh-ins`
  accept `baseVersion`. A mismatch is 409 `STALE_EDIT` with `current` (the row as the endpoint
  returns it). Without `baseVersion` nothing is checked (MCP tools, Shortcuts, older clients).
- FR-003 A checked edit of a missing row is 409 `ROW_DELETED`; an unchecked one stays 404. The
  update itself is filtered on the version, so a race between check and write is caught too.
- FR-004 For a weigh-in, `baseVersion: 0` means "this device saw none for that day"; a new one is
  created at version 1, so a weigh-in recorded meanwhile elsewhere is a `STALE_EDIT`.
- FR-005 `DELETE` of a set, workout exercise, workout, meal or weigh-in that is not there answers
  `{ id, deleted: true }`. It only ever deletes the caller's own rows.
- FR-006 The web sends `baseVersion` from the row as shown (the overlay advances it for queued
  edits: `max(version, base + 1)`), keeps the refusal's `current` with the outbox item, and makes
  a later edit of the same row depend on the earlier one.
- FR-007 Resolving changes the write: `Outbox.replace()` gives it a new id (an idempotency key
  belongs to one body), keeps its place, and moves its dependents onto it.
- FR-008 Retry is not offered for a clashing edit; it would only clash again.

## Out of scope (follow-up phases, owner-approved)

14-day device-time window and confirmation past 30 days, cache/outbox schema versions, eviction
warning, signing in as another account with unsent changes, Mongo-backed integration tests in CI,
content-free sync metrics. Plans already carry a revision (#15) and are unchanged here.
