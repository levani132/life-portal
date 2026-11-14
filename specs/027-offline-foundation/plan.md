# Plan: Offline-first foundation (spec 027)

## API

- `apps/api/src/idempotency/`: a global `APP_INTERCEPTOR` and the `idempotency_keys` collection
  (unique `{userId, key}`, TTL on `expiresAt`). Triggered only by the header on an authenticated
  write. Fingerprint = sha256 of method, path and body; 2xx bodies and 4xx refusals are stored, a
  5xx deletes the key so a retry runs again. A running key older than 2 minutes is taken over.

## Web

- `lib/offline/`: `types.ts` (allowlist), `outbox.ts` (pure queue), `cache.ts` (allowlisted,
  30-day TTL), `idb-store.ts` (hand-written IndexedDB), `memory-store.ts` (tests and fallback),
  `account.ts` (remembered user for offline boot), `runtime.ts` (per-account session, triggers,
  Web Locks + BroadcastChannel across tabs), `use-offline-copy.ts` (a read with a kept copy).
- `lib/api.ts`: `NetworkError` for "no answer"; a refresh that gets no answer no longer clears
  tokens; `ApiError.code`; extra request headers.
- `lib/auth-context.tsx`: offline boot, store per account, logout guard, delete on logout.
- `components/sync-status.tsx` (header pill and sheet), `components/pending-logout.tsx`,
  `components/offline-data-settings.tsx`.
- `lib/training-queue.ts` now rides the outbox; sets send `requestId` as `Idempotency-Key`.
- `public/sw.js` v3: navigation fallback ignores the query string.

## Why no `idb` / `fake-indexeddb`

Approved in principle on the issue, but installing either rewrote ~1,400 unrelated lockfile
entries in this workspace. The adapter needs four operations on two stores, and the queue logic
is tested against an in-memory store behind the same interface, so neither package earns its
place. Constitution, Governance: no dependency without a reason that outweighs it.

## Verification

Unit: `outbox.spec.ts` (order, backoff, reload, refusals, dependencies, auth pause, allowlist,
TTL) and `idempotency.interceptor.spec.ts`. Runtime: a throwaway Mongo, a replayed key via curl,
and a set logged offline surviving a reload in the browser.
