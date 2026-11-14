# Spec 029: Offline food (issue #18)

Builds on spec 027 (outbox, per-account cache, `Idempotency-Key`) and spec 028 (client ids, the
overlay pattern, the shared settling list). Owner-approved defaults on #18: server-authoritative
snapshots at sync with provisional offline figures, a 2,000-food cap, no public catalogue on the
device, offline weigh-ins, refused writes kept and explained.

## User stories

1. **Log food with no signal.** From a day this device has opened (or, with no copy of that day,
   from the latest copy with an empty day), log a food, a suggestion or a saved meal; correct or
   remove a meal; weigh in. The day's totals, macros and the week move at once.
2. **Never shown as saved before it is.** A meal waiting on the device says "Not saved yet"; the
   totals say how many meals they include that are not saved; a waiting meal cannot be shared
   (a post needs the server's row).
3. **Server-authoritative snapshot.** The server snapshots the food when the meal arrives, as it
   always has. If its numbers differ from the ones shown offline (the food was corrected
   meanwhile), the meal says "Updated after sync" with both figures.
4. **Exactly once.** Every create carries the id chosen on the device and every write its
   `Idempotency-Key`; a weigh-in is one per day by design.
5. **Refusals stay visible.** A meal whose food was deleted meanwhile is refused (`FOOD_GONE`) and
   stays listed on the day with the reason and Discard, never dropped. A saved meal changed
   meanwhile is refused with `MEAL_CHANGED`.
6. **Online-only says so.** Product search, barcode, public foods, imports, creating or editing
   foods, saved meals, the cheat queue, repeating a day and the profile need a connection and say
   "needs a connection" instead of "something went wrong" or an empty list.

## Requirements

- FR-001 `POST /nutrition/entries` accepts `id`; `POST /nutrition/meals/:id/log` accepts `ids`
  (one per component, in order; a count mismatch is 409 `MEAL_CHANGED`). Both are checked free
  across all users (409 `ID_TAKEN`). `facts` is still never accepted from a request.
- FR-002 Logging a missing food answers 404 `FOOD_GONE` with a message the person can act on.
- FR-003 The device keeps the Food day (`GET /nutrition?today=&day=`) for days within 14 days of
  today, one copy per day plus the latest, with at most 2,000 foods (most recently used first).
  Waiting meals carry their own provisional facts, so the cap never drops a food one needs.
- FR-004 The public catalogue and product lookups are never kept on the device.
- FR-005 Totals are computed with the shared domain functions (`decorateEntry`, `dayTotals`).
