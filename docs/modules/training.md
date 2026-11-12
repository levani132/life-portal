# Module: training (Widget 10 — Training)

Answers *what did I do in the gym, and what did I do last time?* Phase 1 of the training roadmap
item: an exercise catalogue and workout logging. Ranks, levels, sharing and programs are later
phases and must be computable from what this module records.

**Code:** `apps/api/src/training/` · `apps/web/src/app/training/page.tsx` ·
`apps/web/src/components/training/`
**Domain logic:** `libs/shared/domain/src/lib/training.ts`
**Contracts:** `libs/shared/types/src/lib/training.ts`
**Spec:** `specs/020-training-logging/` (spec, plan, research R1–R11, data model, API contract)

**Status (2026-11-12):** the MVP (spec 020 tasks T001–T021) is built: the catalogue, workout
logging, history. Not built yet: search ranking and private exercises/machines (US2), records and
1RM (US3), the Home card (US4), kg/lb and bodyweight loads (US5).

## Access

`training` is a `ModuleId`, so the existing policy applies with no extra code: on for internal
and developer accounts, off for production, overridable per cohort or user. Every route is
`@RequireModule('training')` and answers `Cache-Control: private, no-store`. Training is
**never shareable** in this phase: `UNSHAREABLE_MODULES` (with EPAM) removes it from profiles
and hides its audience control. A module released after an account's first Portal read is not
auto-selected; existing accounts add it from Manage modules.

## Units — read this first

| Quantity | Stored as | Field |
| --- | --- | --- |
| Weight, added load | whole **grams** | `weightGrams` |
| Assistance (assisted machines) | whole **grams** | `assistGrams` |
| Distance | whole **metres** | `distanceMeters` |
| Time | whole **seconds** | `durationSeconds`, `restSeconds` |
| RPE | 1–10 in half steps (a scale, not a quantity) | `rpe` |

Optional numbers have **no default**: "no added weight" and "weight not recorded" are different
facts. kg/lb is a display preference (`training_profiles.weightUnit`); nothing converted is
stored. The web turns grams into "80 kg" in `apps/web/src/lib/training.ts` only.

## Collections

| Collection | Purpose (and why it exists) |
| --- | --- |
| `exercises` | The catalogue. Shared rows have no `userId` and are written only by the seeder; private rows have one. One catalogue for everyone instead of a copy per account. |
| `training_machines` | Specific machines, private to their creator (US2). The dataset only knows generic equipment. |
| `training_profiles` | One row per user: `weightUnit`, `defaultRestSeconds`. Upserted on first read, seeding only fields the caller did not send. |
| `workout_sessions` | One workout: `day`, `status`, `startedAt`, `endedAt?`, `notes?`, `requestId`. |
| `workout_exercises` | An exercise within a session, in `order`, with a frozen `snapshot`. |
| `workout_sets` | **The event row.** One performed set. Everything about progress derives from these. |

Sessions, exercises and sets are three collections, not one document with arrays, so two devices
logging into one workout never overwrite each other, and per-exercise history is an index scan
on `(userId, exerciseId, loggedAt)`.

### Indexes worth knowing

- `workout_sessions` `one_open_session`: unique `{userId}` where `status: 'open'`. The database
  enforces "at most one open workout". `status` is stored beside `endedAt` only because Mongo
  cannot build a partial index on a field being absent.
- Unique `(userId, requestId)` on sessions, workout exercises and sets: retry safety.
- `exercises.seedKey` unique where present: the seeder's upsert key.

## The snapshot rule (second instance, after `meal_entries`)

`workout_exercises.snapshot` holds `{name, equipmentType, measure, primaryMuscles, machineName?,
machineBrand?}` as they were when the exercise was added. Renaming or correcting a catalogue row
never rewrites a past workout. The service builds it; DTOs have no field for it
(`forbidNonWhitelisted` turns one into a 400); it is never refreshed on PATCH; `exerciseId` is not
editable. A set's `exerciseId` is copied from its workout exercise at creation, as an immutable
reference for history queries.

## Measures

Each exercise has one `measure`, which decides the fields a set carries (`setFieldsFor`, shared
by the API, the form and the tests). Fields that do not apply are rejected, not ignored.

| Measure | Required | Also allowed |
| --- | --- | --- |
| `weight_reps` | reps, weightGrams | |
| `bodyweight_reps` | reps | weightGrams (added load) |
| `assisted_reps` | reps, assistGrams | |
| `duration` | durationSeconds | weightGrams |
| `distance_duration` | distanceMeters, durationSeconds | |

Limits (`SET_LIMITS`): reps 1–1000, weight 0–1,000,000 g, assistance 1–500,000 g, time
1–86,400 s, distance 1–1,000,000 m.

## The catalogue

Seeded from **free-exercise-db** (Unlicense), **facts only**: name, muscles, equipment, category,
force, mechanic, level. Its images have no stated source and an open copyright dispute, and its
instruction text has the same unknown origin, so neither is in the repository (research R1). The
vendored file is `apps/api/src/training/catalogue/free-exercise-db.json` (876 exercises).
Shared rows show a credit (`CATALOGUE_CREDIT`).

`CatalogueSeeder` runs at boot (`onModuleInit`): production needs the catalogue and the free tier
has no job runner. It costs one count query when the stored rows already carry the file's
`version`; otherwise it bulk-upserts by `seedKey`. It never writes a row with a `userId` and never
deletes. **To change the catalogue, edit the file and bump `version`.**

Mapping (`catalogueMeasure`): cardio → distance and time; stretching or a static hold → time;
no equipment or "body only" → bodyweight reps; everything else → weight × reps.

`CatalogueService` does not extend `OwnedCrudService`: its `scoped()` would hide shared rows.
`visible()` is the one place the shared-or-own filter is written.

## Endpoints

All under `/api/training`. Full contract: `specs/020-training-logging/contracts/api.md`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET`/`PUT` | `/profile` | Upserted on first read. |
| `GET` | `/exercises?q=&muscle=&equipment=&limit=&skip=` | Shared + own, not archived, by name. |
| `GET` | `/exercises/:id` | Includes attribution on shared rows. |
| `POST` | `/sessions` `{requestId, day}` | Returns the open session with `resumed: true` instead of a second one. |
| `GET` | `/sessions/current` | 204 when none is open. |
| `GET` | `/sessions?cursor=` | 20 a page, newest day first. |
| `GET`/`PATCH`/`DELETE` | `/sessions/:id` | Detail includes each exercise's `previous` sets. Delete removes its exercises and sets. |
| `POST` | `/sessions/:id/finish` `{at?: now\|lastSet}` | 409 `EMPTY_SESSION` when it has no sets. |
| `POST` | `/sessions/:id/exercises` `{requestId, exerciseId}` | Builds the snapshot. |
| `POST` | `/sessions/:id/exercises/order` `{ids}` | The complete id array. |
| `PATCH`/`DELETE` | `/sessions/:id/exercises/:weId` | Notes only; delete removes its sets. |
| `POST` | `/sessions/:id/exercises/:weId/sets` | Validated against the snapshot's measure. |
| `PATCH`/`DELETE` | `/sets/:setId` | `null` clears an optional field. |

## Derived values (computed on read, never stored)

- `sessionDurationSeconds`: to `endedAt`, else to the last set, **never to now**, so an
  abandoned session does not keep growing.
- `isStaleSession`: open and no activity for more than 12 hours. The UI then offers *Finish at
  last set* or *Discard*; nothing finishes silently.
- `previous`: per exercise, the person's sets of it from their most recent session that started
  before this one.
- Set counts and exercise names in the history list.

## Day and time

A session's `day` is decided in the browser from the local clock and the Food profile's
`dayStartHour`, exactly like meals, and sent explicitly. `startedAt`, `endedAt` and `loggedAt` are
real instants set by the server, because durations need them.

## Cross-links

- **Food / Apple Health:** none in this phase, on purpose. Training produces **no burned-energy
  figure** and never changes Food's targets or activity adjustment, which Apple Health's Active
  Energy owns. Who owns burned energy when Health is not connected is a later decision.
- **Weigh-ins:** bodyweight loads (US5) will read Nutrition's weigh-ins through an exported
  method, never a copy.

## Web

`/training` has three tabs: Workout (the open session, or Start workout), History (past sessions,
each opening for reading and editing) and Exercises (catalogue search). Sets go through
`lib/training-queue.ts`: each is shown at once as a pending row, sent in order, and retried on
`online`, focus and every 5 s after a network or server error. The queue is in memory only:
closing the app with writes still pending loses them. Weight fields use `Input` with
`inputMode="decimal"`, so a comma from a Georgian keyboard works.

## Deletion

Account deletion must remove the user's `workout_sessions`, `workout_exercises`, `workout_sets`,
`training_profiles`, private `exercises` and `training_machines`, and the photos those two
reference in storage.

## Verification

`libs/shared/domain/src/lib/training.spec.ts` (measures, validation, durations, staleness,
catalogue mapping), `apps/api/src/training/sessions.service.spec.ts` (one open session including
the race, retries, snapshots, measure validation, finish rules, history paging, cascades, 404s for
other users) and `catalogue.seeder.spec.ts` (idempotent seed, user rows untouched, version bumps,
facts-only file). The specs run on `fake-model.testing.ts`, an in-memory stand-in for the query
shapes these services use. Manual checks: `specs/020-training-logging/quickstart.md`.
