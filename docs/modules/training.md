# Module: training (Widget 10 — Training)

Answers *what did I do in the gym, and what did I do last time?* Phase 1 of the training roadmap
item: an exercise catalogue and workout logging. Ranks, levels, sharing and programs are later
phases and must be computable from what this module records.

**Code:** `apps/api/src/training/` · `apps/web/src/app/training/page.tsx` ·
`apps/web/src/components/training/`
**Domain logic:** `libs/shared/domain/src/lib/training.ts`
**Contracts:** `libs/shared/types/src/lib/training.ts`
**Spec:** `specs/020-training-logging/` (spec, plan, research R1–R11, data model, API contract)

**Status (2026-11-12):** built: the catalogue, workout logging and history (MVP, T001–T021), and
search ranking, private exercises and machines (US2, T022–T028), and progress: per-exercise
history, personal records and labelled 1RM estimates (US3, T029–T034). Not built yet: the Home
card (US4), kg/lb display and the "from weigh-in" label on bodyweight set rows (US5).

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
(`forbidNonWhitelisted` turns one into a 400); `exerciseId` is not editable.

The one part a PATCH may set is the **machine**: `PATCH …/exercises/:weId {machineId}` sets
`machineId` and copies that machine's current name and brand into the snapshot (`null` clears all
three). Which machine was used is a correction to what happened, not a refresh of the catalogue,
so renaming the machine later still leaves past workouts alone. The exercise part is never
refreshed. A set's `exerciseId` is copied from its workout exercise at creation, as an immutable
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
`visible()` is the one place the shared-or-own filter is written; writes go through `own()`
(`{_id, userId}`), so a shared row or someone else's answers 404 to PATCH and DELETE.

### Search

`searchName` is the name and every alias, each normalised (`normaliseSearch`), joined by ` | `
(`searchNameFor`). Mongo filters by a contains-regex plus the muscle and equipment filters; the
service then ranks every match in memory (`rankExercises`, capped at 2,000 rows, so paging with
`skip` happens after ranking):

1. a name or alias that starts with the query,
2. one with a word that starts with it ("bent over **row**"),
3. one that merely contains it ("th**row**");

within each tier, exercises the caller logged in the last 90 days first (`recent: true`, from
`workout_sets.distinct('exerciseId')` on `(userId, exerciseId, loggedAt)`), then by name.

### Own exercises and machines

A person can create exercises (private rows in `exercises`) and machines (`training_machines`,
always private in this phase). Both may carry a photo, copied by `MediaService.copyForTraining`
from an upload under `training/<userId>/<exercises|machines>/`, exactly as a food's; responses carry
a signed `image.url`, never the key. If the photo cannot be copied on create, the new row is
removed again so a retry starts clean.

- **Delete** removes the row (and its photo) when no workout refers to it, and **archives** it
  when one does (`{id, archived: true}`): hidden from search and machine lists, still readable by
  id for the history that names it.
- **Measure is locked** once an exercise is in any workout: changing it is a 409
  `MEASURE_LOCKED`, because past sets were validated against the old measure.
- A machine's `exerciseIds` (≤ 20) must all be readable by its owner. When adding an exercise to
  a workout, the picker offers machines linked to it first, then the person's other machines of
  the same equipment type; it skips the question when the person has no machines and the
  exercise is not machine, cable or Smith machine work.

## Endpoints

All under `/api/training`. Full contract: `specs/020-training-logging/contracts/api.md`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET`/`PUT` | `/profile` | Upserted on first read. |
| `GET` | `/exercises?q=&muscle=&equipment=&limit=&skip=` | Shared + own, not archived, by name. |
| `GET` | `/exercises/:id` | Includes attribution on shared rows, signed `image.url` on own ones. |
| `GET` | `/exercises/:id/history?before=` | Sessions newest first, 20 a page, each with sets (with record marks), best set, volume, 1RM; `records` over every set. |
| `POST` | `/exercises` | A private exercise. |
| `PATCH`/`DELETE` | `/exercises/:id` | Own rows only (shared → 404). Measure locked once logged (409). Delete archives a logged one. |
| `GET` | `/machines?exerciseId=` | Own, not archived. |
| `GET`/`POST`/`PATCH`/`DELETE` | `/machines`, `/machines/:id` | Like exercises: archive when a workout names it. |
| `POST` | `/sessions` `{requestId, day}` | Returns the open session with `resumed: true` instead of a second one. |
| `GET` | `/sessions/current` | 204 when none is open. |
| `GET` | `/sessions?cursor=` | 20 a page, newest day first. |
| `GET`/`PATCH`/`DELETE` | `/sessions/:id` | Detail includes each exercise's `previous` sets. Delete removes its exercises and sets. |
| `POST` | `/sessions/:id/finish` `{at?: now\|lastSet}` | 409 `EMPTY_SESSION` when it has no sets. |
| `POST` | `/sessions/:id/exercises` `{requestId, exerciseId, machineId?}` | Builds the snapshot, with the machine's name and brand. |
| `POST` | `/sessions/:id/exercises/order` `{ids}` | The complete id array. |
| `PATCH`/`DELETE` | `/sessions/:id/exercises/:weId` | `{notes?, machineId?}` (`null` clears the machine); delete removes its sets. |
| `POST` | `/sessions/:id/exercises/:weId/sets` | Validated against the snapshot's measure. Returns `{set, records}`. |
| `PATCH`/`DELETE` | `/sets/:setId` | `null` clears an optional field. PATCH returns `{set, records}`. |

## Derived values (computed on read, never stored)

- `sessionDurationSeconds`: to `endedAt`, else to the last set, **never to now**, so an
  abandoned session does not keep growing.
- `isStaleSession`: open and no activity for more than 12 hours. The UI then offers *Finish at
  last set* or *Discard*; nothing finishes silently.
- `previous`: per exercise, the person's sets of it from their most recent session that started
  before this one.
- Set counts and exercise names in the history list.

### Progress and records (US3)

Pure functions in `libs/shared/domain/src/lib/training.ts`; `ProgressService` only gathers rows.
Nothing is stored, so correcting or deleting a set moves every figure at once.

- **Done order.** An exercise's sets are ordered by session `day`, then session `startedAt`, then
  set `order`: not by `loggedAt`, because a set added to an old workout later still happened
  then. Only sets whose workout exercise's snapshot has the exercise's current measure count.
- **Effective load** (`effectiveLoadGrams`): weight × reps → the weight; bodyweight reps → body
  weight + added load; assisted → body weight − assistance, floored at 0; none for timed or
  distance work. Body weight is the weigh-in **on or before** the session's day
  (`bodyWeightOn`), read from `NutritionService.weighInsUpTo` (Training never reads `weigh_ins`).
  Without a weigh-in a bodyweight set has no load, so no volume, heaviest or 1RM: no figure
  rather than a wrong one. Load-based figures carry `bodyWeightDay`.
- **Estimated 1RM** (`estimateOneRepMax`): Epley, `load × (1 + reps / 30)`, one rep = the load,
  whole grams rounded once, only from working sets of 1–12 reps. Always returned as
  `{valueGrams, basis: {formula: 'epley', fromSetId, weightGrams, reps, bodyWeightDay?}}` and
  shown as "est. 1RM 116.67 kg · Epley, from 100 kg × 5".
- **Volume**: load × reps over working sets with a known load.
- **Records** (`personalRecords`), warm-ups never count. Kinds per measure: weight × reps →
  heaviest, best est. 1RM, most reps; bodyweight and assisted → most reps, heaviest, best 1RM
  (the last two need a weigh-in); time → longest time; distance → longest distance, longest time,
  fastest pace (seconds per km, lower is better).
  - A set is **marked** (`records` on the set) for a kind when it strictly beats every earlier
    working set, and only once an earlier *session* exists, so a first workout is not a page of
    "PR"s. Later sets never change an earlier set's marks.
  - **Most reps** on weight × reps means more reps than any earlier set **at this load or
    heavier**: 10 × 80 kg after 8 × 80 kg is a record even if 12 × 60 kg came before. The
    current best of that kind is simply the most reps in one set, with its load.
  - **Current bests** (`records` in history) are over every set ever, the earliest on a tie.
- **Session figures**: `bestSetOf` (highest 1RM, else load, reps, distance, time) and
  `sessionVolumeGrams`; `SessionExercise.oneRepMax` is the best estimate in that session.

## Day and time

A session's `day` is decided in the browser from the local clock and the Food profile's
`dayStartHour`, exactly like meals, and sent explicitly. `startedAt`, `endedAt` and `loggedAt` are
real instants set by the server, because durations need them.

## Cross-links

- **Food / Apple Health:** none in this phase, on purpose. Training produces **no burned-energy
  figure** and never changes Food's targets or activity adjustment, which Apple Health's Active
  Energy owns. Who owns burned energy when Health is not connected is a later decision.
- **Weigh-ins:** bodyweight and assisted loads read Nutrition's weigh-ins through
  `NutritionService.weighInsUpTo(userId, day)` (one query per request; `TrainingModule` imports
  `NutritionModule`), never a copy, so a corrected weigh-in corrects every figure.

## Web

`/training` has three tabs: Workout (the open session, or Start workout), History (past sessions,
each opening for reading and editing) and Exercises (the catalogue with filters and a detail view,
where own exercises can be edited or deleted, and My machines). Adding an exercise to a workout is
two steps: the exercise (with "Create exercise" for what the catalogue lacks), then which machine
(with "New machine"); a workout exercise's machine can be changed from its card. Sets go through
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
facts-only file) `catalogue.service.spec.ts` (ranking tiers, recent use, filters, aliases,
privacy, 404 on shared rows, measure lock, delete-or-archive, photo rollback, machines and the
machine part of the snapshot). Progress: the domain spec (Epley bounds, loads per measure,
weigh-in on or before, records per kind, warm-ups, fallback after removal, pace) and the
`ProgressService` block in `sessions.service.spec.ts` (marks in set responses and detail,
history paging, deletion and lowering moving records, weigh-in loads, other users). The specs run on `fake-model.testing.ts`, an in-memory stand-in for the query
shapes these services use. Manual checks: `specs/020-training-logging/quickstart.md`.
