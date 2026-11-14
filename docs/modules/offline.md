# Offline (spec 027, issue #16)

The foundation for using parts of the app without a connection: a durable outbox for writes, an
allowlisted per-account cache for reads, server-side idempotency, and the controls around them
(sync pill, guarded logout, Settings → "Offline data on this device"). Training's set logging is
the first consumer; #17 and #18 extend it to training and nutrition.

## What may be stored on a device

| Allowed | Never |
|---|---|
| `training`, `nutrition`, `social` (outbox kinds `<module>.<what>`, cache keys `<module>:<what>`) | loans, cash flow, stocks, items, spending, banking, boards (work), personal, settings |
| the exact cache key `shell:portal` (portal state: module access, widget order, setup progress — no records) | any `/api` response in the service worker cache |

`OFFLINE_MODULES` and `CACHE_SHELL_KEYS` (`apps/web/src/lib/offline/types.ts`) enforce it: an
enqueue or `put` for anything else **throws**. `outbox.spec.ts` asserts money keys are refused.
Adding a module to the list is a privacy decision; record it in `docs/DECISIONS.md`.

Storage is the browser's IndexedDB, database `lp-offline:<userId>` (stores `outbox`, keyPath
`id`; `cache`, keyPath `key`, index `touchedAt`). It is **not encrypted at rest** by the app.
Settings says so, and says iOS may evict it.

## Outbox (`lib/offline/outbox.ts`)

An item: `id` (also the `Idempotency-Key`), `seq`, `kind`, `method`, `path`, `body`, `meta` (what
the UI draws while pending), `dependsOn?`, `label?`, `state`, `attempts`, `nextAttemptAt`,
`lastError?`, `createdAt`.

- Sent in `seq` order. A transient failure — no answer (`NetworkError`), 5xx, 408, 429, or 409
  `IDEMPOTENCY_IN_PROGRESS` — stops the run; the item retries after
  `min(60 s, 1 s × 2^(attempts−1)) × (0.5–1.0 random)`. An earlier waiting item holds back every
  later one: order is never broken.
- Other 4xx → `error`; other 409 → `conflict`. Kept, never dropped; the run carries on with items
  that do not depend on them. The person retries or discards (discard cascades to dependents).
- 401 → `auth`; everything pauses until `resumeAuth()`, which `AuthProvider` calls only after the
  server confirmed the same account.
- An item leaves the store only after a 2xx. "Saved" in the UI means acknowledged.
- Cross-tab: the run holds the Web Lock `lp-outbox:<userId>` and reloads the store under it;
  changes are announced on a `BroadcastChannel` of the same name.
- Sync triggers (`runtime.ts`): enqueue, `online`, `focus`, `visibilitychange` to visible, and a
  30 s interval while something is pending and the page is visible. **No Background Sync API**
  (iOS has none); nothing is sent while the app is closed.
- `navigator.storage.persist()` is asked once, on the first stored write.

## Cache (`lib/offline/cache.ts`, `use-offline-copy.ts`)

`get` / `put` / `remove` / `prune`. Reading or writing refreshes `touchedAt`; entries untouched for
30 days (`CACHE_TTL_MS`) are pruned when the account's store opens. Unsynced writes are never
pruned. `useOfflineCopy(key, swrResult)` keeps every successful answer and, only when the request
got **no answer at all**, returns the kept copy with `offlineCopy: true` (a server refusal is never
hidden behind an old copy). It never returns another account's copy.

## Accounts and sign-in (`lib/auth-context.tsx`, `lib/offline/account.ts`)

- `localStorage['lp.offline.user']` remembers the last confirmed `User` (id, name, email — what
  `/auth/me` returns). When `/auth/me` gets no answer, the app opens as that user with
  `offlineSession: true`; an `ApiError` still signs out.
- `lib/api.ts`: a token refresh that gets no answer (network error or 5xx) keeps the tokens and
  throws `NetworkError`; only a refusal clears them.
- One store per account. Switching accounts closes the old store without deleting it, so A's
  paused writes wait for A; B never sees them.
- **Logout** with anything in the outbox opens `PendingLogout`: the count, "Sync now" (continues
  by itself once empty), "Stay signed in", and "Discard pending changes and log out" behind a
  second confirmation. Logging out deletes the account's database and the remembered user.
- Settings → "Clear offline data" uses the same dialog when something is pending.

## Idempotency (API, `apps/api/src/idempotency/`)

A global interceptor. A request carrying `Idempotency-Key` that is an authenticated
POST/PUT/PATCH/DELETE is run at most once per `(userId, key)`:

| Situation | Answer |
|---|---|
| first time | runs; a 2xx body or a 4xx refusal (other than 409) is stored |
| same key, same method + path + body | the stored answer, header `Idempotent-Replayed: true` |
| same key, different write | 422 `IDEMPOTENCY_KEY_REUSED` |
| same key while the first still runs | 409 `IDEMPOTENCY_IN_PROGRESS` (the outbox retries) |
| running for over 2 minutes | taken over (the first attempt died) |
| a 5xx | the key is deleted, so a retry runs again |
| a 409 conflict | the key is deleted too (spec 028): a conflict depends on the state at the time, and Retry after resolving it must run the write, not replay the refusal |
| key not matching `^[A-Za-z0-9_:-]{8,100}$` | 422 `IDEMPOTENCY_KEY_INVALID` |

Collection `idempotency_keys`: `userId`, `key`, `fingerprint` (sha256 of method, path, body),
`state` (`running` / `done`), `errorStatus?`, `body?` (JSON, ≤ 512 KB; larger answers are not
replayable and the key is released), `startedAt`, `expiresAt`. Indexes: unique `{userId, key}`,
TTL on `expiresAt` (7 days). There is no account-erasure route today; when one is added it must
`deleteMany({ userId })` here too. Writes without the header behave exactly as before.

Module-level request ids (training's `requestId`) remain; the header is the general mechanism.

## Training on top of the outbox (spec 028, issue #17)

- **Client ids.** Every create carries the id it will have (`newObjectId()`, or for a plan start's
  rows `plannedRowId(requestId, planExerciseId)`, the same derivation as the API). The API checks
  the format and that no user has the id (409 `ID_TAKEN`). That is what makes later writes able to
  name a row before the server has answered (`dependsOn` the write that creates it).
- **Shown = cached copy + writes.** `lib/offline/training-overlay.ts` applies the outbox's
  training writes (`meta.op`) to the cached server copy, in order; each op is idempotent, so an
  acknowledged write stays applied ("settling") until the refetch lands. Refused writes (`error`)
  are not applied; `conflict` ones are, until the person resolves them.
- **Cached reads.** `lib/offline/reads.ts` maps the reads a workout needs to `training:*` /
  `nutrition:profile` cache keys; `useApi` goes through `getWithOfflineCopy()`, which answers from
  the device copy only on `NetworkError`.
- **Refusal details.** An item keeps `lastErrorCode` and the string fields of the error body
  (`lastErrorData`, e.g. `openSessionId`), so the sync sheet can offer a fix, not only Discard.
- **Never computed on the device:** records, ranks, levels, 1RM, tournaments.

## Food on top of the outbox (spec 029, issue #18)

- Same pattern as training: client ids on creates (`id`, `ids`), `dependsOn` the write that
  creates a meal, a pure overlay (`nutrition-overlay.ts`), and `settling.ts` (shared by both) to
  keep acknowledged writes applied until the refetch lands.
- The Food day `GET /nutrition?today=&day=` is the one read kept with a query string: one copy per
  day within 14 days of today, plus `nutrition:day:latest` for a day never opened. At most 2,000
  foods are kept with it; waiting meals carry their own provisional facts, so the cap never drops
  one they need.
- Withdrawing a meal (or weigh-in) that was never sent discards its queued create instead of
  sending a delete.
- `useAction` reports a `NetworkError` as "This needs a connection" for every online-only action.

## Edits from two devices (spec 030, issue #19)

- **Row versions.** Sets, workout exercises, workouts, meals and weigh-ins carry `version` (missing
  = 0), bumped by every edit (`apps/api/src/common/row-version.ts`). Every edit from the web sends
  `baseVersion`, the version of the row as shown; the overlays advance it for queued edits
  (`max(version, base + 1)`), so a second edit of a row is made against what the first produces.
  A later edit of a row also `dependsOn` the earlier one, so it never overtakes it.
- **Refusals.** A stale edit is 409 `STALE_EDIT` with `current`, the row as it is now, kept as the
  item's `lastErrorCurrent`. An edit of a row deleted elsewhere is 409 `ROW_DELETED`. Deleting a
  row already gone succeeds. An edit without `baseVersion` is not checked (MCP, Shortcuts).
- **Choices** (`lib/offline/conflicts.ts`, pure; `lib/sync-conflicts.ts`): Keep mine (the same
  edit against `current.version`, edits stacked on it rebased after it), Keep theirs (discard; the
  stacked edits go too), Combine notes (a preview of both, edited and confirmed), and for a
  deleted set, meal or weigh-in Add it again (a new row with the change). A weigh-in choice can be
  undone while the sheet is open. Nothing is merged on its own.
- **`Outbox.replace(id, …)`** sends a resolved write in the old one's place with a new id: an
  `Idempotency-Key` belongs to one body (`IDEMPOTENCY_KEY_REUSED` otherwise). Its dependents move
  onto the new id.

## Service worker

`public/sw.js` (v3) still caches only HTML navigations and hashed assets, never `/api`. A
navigation offline falls back to the same page with any query, then to `/`.

## UI

- `components/sync-status.tsx`: the header pill (left of the title). Nothing when the outbox is
  empty; otherwise "N waiting", "Offline · N waiting", "Syncing N", "N need attention" or "Sign in
  to sync". Tapping opens the list with Retry and Discard (confirmed) per item and "Sync now". A
  workout refused with `SESSION_CONFLICT` also offers "Finish the other, send this" (spec 028).
  An edit refused with `STALE_EDIT` or `ROW_DELETED` shows yours against theirs and the choices
  above instead of Retry (spec 030).
- `components/pending-logout.tsx`, `components/offline-data-settings.tsx`.

## Dependencies

None added. `idb` and `fake-indexeddb` were approved in principle, but installing either rewrote
about 1,400 unrelated lockfile entries; the adapter is four operations on two stores
(`idb-store.ts`), and the queue is tested against `memory-store.ts` behind the same interface.
