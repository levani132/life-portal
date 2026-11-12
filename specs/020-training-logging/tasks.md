---

description: "Task list for spec 020: training catalogue and workout logging"
---

# Tasks: Training — exercise catalogue and workout logging

**Input**: `specs/020-training-logging/` (spec, plan, research, data-model, contracts/api.md, quickstart)

**Tests**: The constitution requires a unit test for every domain-logic branch, so domain tests
are included. API service specs are included where the plan names a race or an invariant
(one open session, retries, snapshots, shared-row protection). UI has no test tasks.

**Organization**: by user story. Story numbers match spec.md. US1 and US2 are both P1; the
foundational phase seeds the catalogue and provides a basic list, so US1 (logging) can be
built and tested without US2 (search ranking and private additions).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup

- [X] T001 Add `'training'` to `MODULE_IDS` and a `MODULES` entry `{id: 'training', name: 'Training', description: 'Workouts, exercises and records', href: '/training'}` in `libs/shared/types/src/lib/portal.ts`; add `training` to `UpdateAccessDto` (same pattern as `forYou`) in `apps/api/src/access/access.module.ts`. Check `resolveFeatureAccess` in `libs/shared/domain/src/lib/portal.ts` gives internal/developer on, production off, and add a case for `training` to `libs/shared/domain/src/lib/portal.spec.ts`
- [X] T002 [P] Make `training` never shareable: exclude it wherever `epam` is excluded in `libs/shared/domain/src/lib/social.ts` (widget key map, ordering, the shareable filter) and in `apps/api/src/social/shared-widgets.service.ts`; hide its audience control in `apps/web/src/components/portal-preferences.tsx`; add a test in `libs/shared/domain/src/lib/social.spec.ts`
- [X] T003 [P] Vendor the catalogue: download `exercises.json` from yuhonas/free-exercise-db, keep **only** `id, name, force, level, mechanic, equipment, primaryMuscles, secondaryMuscles, category` per entry (drop `instructions` and `images`, research R1), write it to `apps/api/src/training/catalogue/free-exercise-db.json` with a top-level `{version: 1, source: 'free-exercise-db (Unlicense)', exercises: [...]}`

---

## Phase 2: Foundational (blocks every story)

- [X] T004 Create `libs/shared/types/src/lib/training.ts`: `MUSCLES`, `EQUIPMENT_TYPES`, `MEASURES`, `SET_TYPES`, `WEIGHT_UNITS`, `RECORD_KINDS` constants and types, and the response shapes from `contracts/api.md` (`Exercise`, `ExerciseListItem`, `Machine`, `TrainingProfile`, `SessionDetail`, `SessionListItem`, `SessionExercise`, `WorkoutSet`, `Estimate`, `RecordSet`, `ExerciseHistory`, `TrainingSummary`); export from the lib's `index.ts`
- [X] T005 Create `libs/shared/domain/src/lib/training.ts` with `setFieldsFor(measure)` (allowed/required fields per measure, data-model.md) and `catalogueMeasure(entry)` (dataset category/equipment → measure, research R2) and `normaliseSearch(text)` (lower-case, accents folded, punctuation removed); export from the lib's index
- [X] T006 [P] Tests for T005 in `libs/shared/domain/src/lib/training.spec.ts`: every measure's allowed/required set, each dataset category mapping including `body only` and `cardio`, normalisation of accents and punctuation
- [X] T007 Create the six schemas with the indexes in data-model.md in `apps/api/src/training/training.schemas.ts`: `Exercise`, `TrainingMachine`, `TrainingProfile`, `WorkoutSession` (partial unique `{userId}` where `status: 'open'`), `WorkoutExercise`, `WorkoutSet`; optional numbers without defaults; `image.key` excluded from `toJSON`
- [X] T008 Create `apps/api/src/training/catalogue.seeder.ts`: on `onModuleInit`, if the count of shared rows with `seedVersion === file.version` differs from the file's length, bulk-upsert by `seedKey = 'fedb:' + id` (name, aliases `[]`, muscles, `equipmentType` mapped to `EQUIPMENT_TYPES`, `measure` via `catalogueMeasure`, mechanic, level, `searchName`, `seedVersion`); never touch rows with a `userId`; log the counts. Spec in `apps/api/src/training/catalogue.seeder.spec.ts`: idempotent on a second run, user rows untouched
- [X] T009 Create `apps/api/src/training/catalogue.service.ts` with the read side used by every story: `list(userId, {q, muscle, equipment, limit, skip})` and `get(userId, id)` using the `$or` shared/own filter (data-model.md access rule), never extending `OwnedCrudService` (comment why)
- [X] T010 Create `apps/api/src/training/training.module.ts` (controller class with `@RequireModule('training')`, `@Controller('training')`, `Cache-Control: private, no-store` on every route, `GET /exercises` and `GET /exercises/:id`), `apps/api/src/training/training.dto.ts`, and import `TrainingModule` in `apps/api/src/app/app.module.ts`
- [X] T011 Add `TrainingProfile` read/upsert (`GET`/`PUT /profile`) in `apps/api/src/training/profile.service.ts`, seeding only fields the caller did not send (CLAUDE.md `$set`/`$setOnInsert` trap)
- [X] T012 [P] Add the web route shell `apps/web/src/app/training/page.tsx` with tabs Workout · History · Exercises and a `useTraining*` SWR hooks file `apps/web/src/lib/training.ts` (fetchers for the contract, `today`/`day` from `lib/local-day.ts`)

**Checkpoint**: flag works, catalogue seeded and listable, `/training` renders.

---

## Phase 3: User Story 1 — Log a workout in the gym (P1) 🎯 MVP

**Goal**: start, fill, finish and resume a workout; nothing is lost.

**Independent test**: quickstart scenarios 2, 3, 9 and 10.

### Tests

- [X] T013 [P] [US1] Service spec `apps/api/src/training/sessions.service.spec.ts`: two concurrent `POST /sessions` give one open session (duplicate-key race answered with the existing row); a retried `requestId` for session/exercise/set returns the original; a set with a field its measure disallows is rejected; the snapshot is server-built and unchanged after renaming the exercise; PATCH cannot change `exerciseId`; finishing an empty session gives 409 `EMPTY_SESSION`; deleting a session deletes its exercises and sets; another user's ids answer 404

### Implementation

- [X] T014 [US1] Implement `apps/api/src/training/sessions.service.ts`: `start` (returns open session with `resumed: true`), `current`, `list` (cursor), `detail` (exercises in order with sets, `previous` sets of each exercise from the most recent earlier session, derived `durationSeconds`, `isStale` > 12 h since last activity), `update` (day, notes), `finish` (`now` | `lastSet`), `remove`
- [X] T015 [US1] In the same service: `addExercise` (builds `snapshot` from the exercise and optional machine, checks both are readable/owned), `updateExercise` (notes, machine → refresh machine name only), `reorderExercises` (full id array), `removeExercise`; `addSet`/`updateSet`/`removeSet` validated with `setFieldsFor(snapshot.measure)` and the bounds in data-model.md, `loggedAt` set by the server
- [X] T016 [US1] Wire the session routes from `contracts/api.md` in `apps/api/src/training/training.module.ts` with DTOs in `training.dto.ts` (no snapshot or `exerciseId` fields on PATCH DTOs)
- [X] T017 [P] [US1] Client retry queue `apps/web/src/lib/training-queue.ts`: writes keyed by `requestId`, optimistic rows, retried on `online`/focus, never duplicated
- [X] T018 [US1] `apps/web/src/components/training/workout-session.tsx`: start/resume, stale-session prompt (finish at last set / discard), add exercise via a basic picker over `GET /exercises`, reorder, notes, finish (empty → offer discard), using the queue
- [X] T019 [P] [US1] `apps/web/src/components/training/set-row.tsx`: fields from `setFieldsFor(measure)`, pre-filled from the last set (or `previous`), `Input` with `inputMode="decimal"` for weights and `numeric` for reps, set type and RPE selectors, previous result shown alongside
- [X] T020 [P] [US1] Rest timer in `apps/web/src/components/training/rest-timer.tsx`: counts from the last set's `loggedAt` using `defaultRestSeconds`; client-only
- [X] T021 [US1] History tab list of past sessions with a session view (read and edit) in `apps/web/src/app/training/page.tsx`

**Checkpoint**: a full workout can be logged, reloaded, resumed, finished and edited.

---

## Phase 4: User Story 2 — Find or add the right exercise or machine (P1)

**Goal**: fast search with recent first; private exercises and machines.

**Independent test**: quickstart scenario 1, plus creating, using, renaming and deleting a private exercise and machine.

### Tests

- [X] T022 [P] [US2] Spec `apps/api/src/training/catalogue.service.spec.ts`: prefix before contains, recent (90 days) first, muscle/equipment filters, aliases match; private rows invisible to others; shared rows cannot be patched or deleted (404); deleting a logged private exercise/machine archives it and history still resolves it; changing `measure` on a logged exercise gives 409

### Implementation

- [X] T023 [US2] Extend `catalogue.service.ts`: search ranking (prefix, contains, recent-use from `workout_sets` by `(userId, exerciseId, loggedAt)`), create/update/delete-or-archive own exercises with `imageMediaId`/`removeImage` through `MediaModule` (as foods do), signed `image.url` on reads
- [X] T024 [US2] Machines in `apps/api/src/training/machines.service.ts`: CRUD with archive-on-delete, `exerciseIds` must be readable, photo via `MediaModule`; routes `GET/POST/PATCH/DELETE /machines`
- [X] T025 [US2] Exercise and machine routes in `training.module.ts` (`POST/PATCH/DELETE /exercises/:id`, machines)
- [X] T026 [P] [US2] `apps/web/src/components/training/exercise-picker.tsx`: debounced search, muscle and equipment filters, recent first, "Create exercise" and machine choice for the exercise; replaces the basic picker from T018
- [X] T027 [P] [US2] `apps/web/src/components/training/exercise-form.tsx` and `machine-form.tsx`: private additions with photo (reuse `food-photo-field.tsx` patterns)
- [X] T028 [US2] Exercises tab: catalogue browser, exercise detail (muscles, equipment, own instructions/photo, "Own" badge) and the dataset credit, in `apps/web/src/app/training/page.tsx`

**Checkpoint**: any exercise is findable in seconds, and a missing machine can be added and used.

---

## Phase 5: User Story 3 — Progress and personal records (P2)

**Goal**: per-exercise history, best set, volume, labelled 1RM, records that self-correct.

**Independent test**: quickstart scenario 4.

### Tests

- [X] T029 [P] [US3] Domain tests in `libs/shared/domain/src/lib/training.spec.ts`: Epley (1 rep = weight, 12 reps allowed, 13 → undefined, whole grams), `effectiveLoadGrams` for every measure with and without body weight (assisted floored at 0), `setVolumeGrams`, `bodyWeightOn` (on or before), `personalRecords` per kind with warm-ups excluded and a fallback after the record set is removed, fastest pace for distance

### Implementation

- [X] T030 [US3] Implement those functions in `libs/shared/domain/src/lib/training.ts`, each estimate returning `Estimate` with its basis
- [X] T031 [US3] Export `weighInsUpTo(userId, day)` (`{day, weightGrams}` ascending, one query) from `apps/api/src/nutrition/nutrition.service.ts`; document it in `docs/modules/nutrition.md`
- [X] T032 [US3] `apps/api/src/training/progress.service.ts`: `history(userId, exerciseId, before?)` (20 sessions a page, best set, volume, 1RM, records over all sets) and per-set `records` for `SessionDetail` and set create/update responses; wire `GET /exercises/:id/history`
- [X] T033 [P] [US3] `apps/web/src/components/training/exercise-history.tsx`: sessions newest first, best set, volume, 1RM shown as "est." with "Epley, from 85 kg × 6", records list
- [X] T034 [US3] Record badges on set rows in the session (`set-row.tsx`, `workout-session.tsx`)

**Checkpoint**: history and records match a hand calculation, including after deleting a record set.

---

## Phase 6: User Story 4 — Training at a glance on Home (P2)

**Goal**: the card with three figures and Start/Resume.

**Independent test**: quickstart scenarios 2 (card) and 8 (flag off).

- [X] T035 [P] [US4] `weekSummary(sessions, records, today)` in `libs/shared/domain/src/lib/training.ts` (Monday-based week, latest record within 14 days else days since last) with tests in `training.spec.ts`
- [X] T036 [US4] `TrainingService.summary` and `GET /summary` in `apps/api/src/training/`; add `training` to the dashboard types in `libs/shared/types/src/lib/dashboard.ts` and call it from `apps/api/src/dashboard/dashboard.service.ts` when the account has the module and selected it
- [X] T037 [US4] `apps/web/src/components/training/training-card.tsx` and its registration in `apps/web/src/components/home-widget.tsx` / `home-dashboard.tsx`: three figures, one action (Start workout / Resume workout), card opens `/training`; add Training to `menu-content.tsx`

**Checkpoint**: Home shows the card for flagged accounts and nothing for others.

---

## Phase 7: User Story 5 — Units and bodyweight (P3)

**Goal**: kg/lb display, bodyweight and assisted loads from weigh-ins.

**Independent test**: quickstart scenarios 5 and 6.

- [ ] T038 [P] [US5] `gramsToDisplay`/`displayToGrams` in `libs/shared/domain/src/lib/training.ts` (1 lb = 453.59237 g, rounded once) with tests (225 lb → 102 058 g → 102.1 kg)
- [ ] T039 [US5] Units setting (kg/lb, default rest) on the training page, using `PUT /profile`; every weight input and display in `set-row.tsx`, `exercise-history.tsx` and `training-card.tsx` goes through the conversion
- [ ] T040 [US5] Bodyweight and assisted sets show the effective load labelled "from weigh-in <day>", and nothing load-based without a weigh-in, in `set-row.tsx` and `exercise-history.tsx`

---

## Phase 8: Polish and cross-cutting

- [ ] T041 [P] Write `docs/modules/training.md`: purpose, collections (with the one-sentence justification for each), units, the snapshot rule, endpoints, derived formulas, cross-links (Nutrition weigh-ins, Dashboard, Health boundary), catalogue source and licence, what account deletion must remove
- [ ] T042 [P] Append to `docs/DECISIONS.md` (training before programs; facts-only seed and why; one open session index; Epley; no burned energy) and `docs/CHANGELOG.md`; add training lines to `CLAUDE.md` (module list in Layout, and a "trip you up" entry for the workout snapshot rule beside the meal one)
- [ ] T043 Run `npm run check` and `npm run build`; fix anything they report
- [ ] T044 Run every scenario in `specs/020-training-logging/quickstart.md` against a local Mongo and the dev servers, on a phone-width viewport; confirm Food's targets are unchanged (SC-006) and fix what fails

---

## Progress

- 2026-11-12: MVP done (T001–T021), with `npm run check` passing and the API and UI checked
  against a local Mongo. Differences from the task text: T008's seeder spec is in
  `catalogue.seeder.spec.ts` with a `CatalogueService` list test; API specs run on
  `fake-model.testing.ts` (no in-memory Mongo in the repo); the Home card (US4) is not built, so
  `/training` is reached from Menu.
- 2026-11-12: US2 done (T022–T028). Differences from the task text: search ranks in three tiers
  (name or alias starts with the query, a word starts with it, it appears inside a word), not two,
  because "row" otherwise ranked "Ball throw" with the rows; the machine part of a workout
  exercise's snapshot is set by `PATCH machineId` (the contract's rule) and the exercise part
  never is; `Modal` renders a `<form>` only when it has `onSubmit`, so a form opened from the
  picker is not nested in another form. Photos were not checked end to end locally (no R2 here;
  the field hides itself and the API answers 503).
- 2026-11-12: US3 done (T029–T034). Decisions the tasks left open: sets are ordered by session
  day, start and set order (not `loggedAt`); a set is marked as a record only once an earlier
  session exists; "most reps" is "at this load or heavier". The per-set `records` and the
  session's `oneRepMax` are in `SessionDetail`; set create/update return `{set, records}`;
  `toSet` moved to `set-row.ts`. The "from weigh-in" label on set rows stays with US5 (T040);
  history and estimates already carry it.
- 2026-11-12: US4 done (T035–T037). Differences from the task text: the service is
  `TrainingSummaryService` (`summary.service.ts`), exported to the dashboard; there is no separate
  `training-card.tsx`: like Food, the card is built by `DashboardService.trainingCard` and drawn by
  `HomeWidget` (dumbbell icon, play-icon action); Menu already listed Training. The record
  formatters moved to `libs/shared/domain/src/lib/training-format.ts` so the server-built card
  matches the page.

## Dependencies and execution order

- **Setup (T001–T003)** → **Foundational (T004–T012)** → stories.
- **US1** needs only Foundational. **US2** needs Foundational; its picker (T026) replaces US1's basic picker, so do it after T018.
- **US3** needs US1's sets (T014–T015). **US4** needs US1 and uses US3's records for one figure (falls back to "days since last" without it). **US5** needs US1; its bodyweight part needs T031.
- **Polish** last; T043 before T044.

Within a story: tests → domain → service → routes → UI.

## Parallel opportunities

- Setup: T002 and T003 alongside T001.
- Foundational: T006 alongside T007–T011; T012 once T004 exists.
- US1: T013, T017, T019, T020 in parallel once T014's interfaces are fixed.
- US2: T022, T026, T027 in parallel.
- US3: T029 and T033 in parallel (T033 against the contract).
- US4 and US5's domain tasks (T035, T038) in parallel with anything.
- Polish: T041 and T042 together.

### Example: User Story 1

```text
In parallel:  T013 sessions.service.spec.ts
              T017 training-queue.ts
              T019 set-row.tsx
              T020 rest-timer.tsx
Then:         T014 → T015 → T016 → T018 → T021
```

## Implementation strategy

**MVP = Setup + Foundational + US1**: a working gym log over the seeded catalogue, behind the
flag. Stop there and use it in a real workout before going further; what is awkward with a
barbell in one hand decides what US2–US5 need to change.

Then deliver in order US2 → US3 → US4 → US5, each followed by its quickstart scenarios and a
push to main. Docs (T041–T042) may be written alongside, but must land with the first push that
adds a schema (CLAUDE.md rule).

## Notes

- 44 tasks: Setup 3, Foundational 9, US1 9, US2 7, US3 6, US4 3, US5 3, Polish 4.
- Every API route also needs the module flag guard; a test of the 403 is part of T044.
- Never accept `snapshot`, `loggedAt`, `userId` or `seedKey` from a request.
