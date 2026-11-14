# Runbook: offline sync

For when someone says "my workout/meal/post didn't save", "it saved twice", or the sync pill
won't go away. Background: `docs/modules/offline.md` (how it works), specs 027–035.

## How a write travels

1. The web app puts it in the **outbox** (IndexedDB `lp-offline:<userId>`, store `outbox`), with
   a random id. Only `training.*`, `nutrition.*` and `social.*` writes may be stored; money,
   banking, investments and work are online-only.
2. It is sent with that id as `Idempotency-Key` and `X-Queued-Age` (seconds it waited).
3. The API's `IdempotencyInterceptor` claims the key (`idempotency_keys`, per account, 7-day
   TTL), runs the write once, and stores the answer. A repeat gets the stored answer back with
   `Idempotent-Replayed: true`.
4. The item leaves the outbox **only after a 2xx**. Anything else keeps it on the device.

## Symptoms → where to look

| Symptom | Likely cause | Look at |
|---|---|---|
| Pill says "N waiting", nothing happens | offline, or backing off after 5xx/timeout | Device network; API logs for 5xx; it retries with backoff up to 1 min |
| "Sign in to sync" | 401, or signed in as another account (spec 034 identity guard) | Ask them to sign in as the account that made the change |
| "N need attention" | a refusal (4xx) or conflict (409) | The sync sheet shows the code and choices; table below |
| "Waiting for you" | queued more than 30 days ago (`held`) | They choose Send anyway or Discard |
| "Can't be sent by this version" | `incompatible`: written by a newer app, or a bad shape | Update the app; the record is kept untouched until then |
| "N changes lost" | the browser evicted IndexedDB (best effort, rarely seen on iOS) | Nothing to recover; see Data-loss risks |
| Saved twice | a write without `Idempotency-Key`, or a different key per retry | `idempotency_keys` for the account; check the client sent the item id |
| Developer page shows a spike in one code | a bug or a release changing a contract | `/settings/sync-health`, then the code below |

## Refusal codes

| Code | Status | Meaning | What the person sees / does |
|---|---|---|---|
| `STALE_EDIT` | 409 | Edited against an old `version`; carries `current` | Yours vs theirs; Keep mine / Keep theirs / Combine notes |
| `ROW_DELETED` | 409 | Edited a row deleted on another device | Discard, or Add it again |
| `SESSION_CONFLICT` | 409 | Another workout is open | Finish the other, send this |
| `ID_TAKEN` | 409 | The device-chosen id already exists (any account); should be near impossible | Shown as a conflict; Discard. A spike means ids are not random |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | The first attempt is still running | Retried automatically (transient) |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different write: a client bug | Discard; report it |
| `CLIENT_TIME_TOO_OLD` | 422 | Workout start more than 14 days ago | Save with today's date (shows both times, confirmed) or Discard |
| `PLAN_CHANGED` | 409 | The plan day changed since the person reviewed the update | Review the plan update again; nothing is merged |
| `EMPTY_SESSION` | 409 | Finishing a workout with no sets | "Finish the other" discards it instead |
| `FOOD_GONE` / `MEAL_CHANGED` | 4xx | Food deleted, or meal changed elsewhere | The meal stays visible as refused |
| `MEDIA_GONE` | 4xx | An uploaded photo expired before the post was sent | Uploaded again once, automatically |
| `POST_GONE` | 404 | Liked/commented post is gone | Like dropped; comment kept to copy |
| `http_<status>` | | Anything else (validation etc.) | Shown with the server's message |

A 409 is never stored by the interceptor, so the same write can be sent again after the person
resolves it. Other 4xx answers are stored and replayed: retrying them without changing the
write gives the same refusal.

## Replay and idempotency

- Keys are per account: the same key from two accounts runs two writes.
- A `running` key older than 2 minutes is taken over (the first attempt died).
- An answer over 512 KB is not stored; the key is dropped, and a retry runs again.
- Keys expire after 7 days. An outbox item older than that may run twice if its first answer was
  lost. Creates carry device-chosen ids and `requestId`s, which still make them single.

## Migrations

- **IndexedDB version** (`idb-store.ts`) changes stores and indexes only.
- **Record `schema`** (`offline/schema.ts`) changes a record's shape. To change an outbox
  item's shape: bump `OUTBOX_SCHEMA` and add `MIGRATIONS[old]`, with a test in `schema.spec.ts`.
  Never rewrite incompatible records, and never drop unsent work in a migration.
- **Cache entries** of another schema are just dropped and fetched again.
- **Server contracts.** An old outbox item may arrive after a deploy. Keep accepting old request
  shapes for at least as long as items can wait (30+ days), or refuse them with a code that the
  sync sheet explains.

## Data-loss risks

- **Eviction.** Browsers may clear IndexedDB. iOS clears site data after about 7 days without a
  visit in a Safari tab, or under storage pressure. The installed home-screen app is exempt from
  the 7-day rule but not from storage pressure. The "changes lost" warning compares a count in
  localStorage, which iOS usually clears too, so loss there is often silent. Advice: open the app
  when back online.
- **Discard.** Discarding an item also discards what depends on it, and it is confirmed.
- **Logout.** A guarded logout lists unsent changes and asks before deleting them.
- **"Delete offline data"** removes the account's database and counters immediately.
- **Not encrypted at rest** by the app; this relies on the device's own encryption.

## Privacy boundaries

- Never stored on a device: other people's posts or photos, or any money, banking, investment or
  work data.
- Other accounts' unsent writes on a shared device are only counted, never shown or sent.
- **Sync-health counters** (`sync_health_daily`) hold a day, a metric, a bounded key and a count.
  - Keys are allowlisted codes, `http_<status>` or an age bucket.
  - There is no account, hash, path, body or value; the raw `X-Queued-Age` is never stored.
  - Rows expire after 90 days.
  - With very few accounts, a day can still mirror one person's activity. Only the developer
    account can read the page.
- Don't add a field to a counter, or a new key source, without updating this page and
  `docs/DECISIONS.md`.

## Tests

- `npm run check`: unit tests, including the outbox against a memory store. No database needed.
- `npm run test:integration`: the real API and the real web outbox against MongoDB. Each test
  file creates and drops `lp-int-<random>`.

  ```bash
  docker run -d --name lp-int-mongo -p 27020:27017 mongo:7
  INTEGRATION_MONGODB_URI=mongodb://127.0.0.1:27020 npm run test:integration
  ```

  Never point it at a database you care about. CI runs it in `.github/workflows/integration.yml`
  with a Mongo service container.
