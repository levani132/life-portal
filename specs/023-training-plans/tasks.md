---

description: "Task list for spec 023: training workout plans (phase 2)"
---

# Tasks: Training — workout plans

**Input**: `specs/023-training-plans/` (spec, plan, research, data-model, contracts/api.md, quickstart)

**Tests**: The constitution requires a unit test for every domain-logic branch, so domain tests
are included. API service specs are included where the plan names an invariant (frozen
suggestions, ownership of shared rows, id preservation, retries, the seed check). UI has no test
tasks. API specs use `apps/api/src/training/fake-model.testing.ts`, as spec 020's do.

**Organization**: by user story; story numbers match spec.md. The foundational phase seeds the
ready-made plans and gives a read-only plan list and detail, so US1 (training from a ready-made
plan) is testable without US2 (own plans) or US3 (progress).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1–US3 from spec.md

---

## Phase 1: Setup

- [X] T001 Add the plan types to `libs/shared/types/src/lib/training.ts` per `contracts/api.md`: `PlanTargetType = 'warmup' | 'working'`, `PlanTarget {type, reps?, repsMax?, weightGrams?, assistGrams?, durationSeconds?, distanceMeters?}`, `PlanExerciseInput`, `PlanWorkoutInput`, `PlanInput`, `PlanListItem`, `PlanDetail` (workouts with `lastDoneDay?`, `isNext`, exercises with resolved `exercise {name, measure, equipmentType, archived}`), `SessionPlan {planId, planWorkoutId, planName, workoutName}`, `PlannedExercise {restSeconds?, note?, targets}`; extend `SessionDetail` with `plan?`, `SessionExercise` with `planned?`, `openTargets: PlanTarget[]`, `skipped: boolean`, `SessionListItem` with `plan?: {planName, workoutName}`; add constants `PLAN_LIMITS = {name: 80, description: 1000, workouts: 14, exercises: 30, targetsMin: 1, targetsMax: 20, restMax: 900, note: 200, ownPlans: 100}`
- [X] T002 [P] Write the ready-made plans file `apps/api/src/training/catalogue/plans.json`: `{version: 1, plans: [...]}` with the four plans of research R11, each `{seedKey: 'plan:<slug>', name, description, workouts: [{key: '<slug>:<workout>', name, exercises: [{exercise: 'fedb:<catalogue id>', restSeconds, targets: [...]}]}]}`. Use only ids present in `apps/api/src/training/catalogue/free-exercise-db.json` (e.g. `fedb:Barbell_Bench_Press_-_Medium_Grip`, `fedb:Wide-Grip_Lat_Pulldown`, `fedb:Butt_Lift_Bridge`, `fedb:Bodyweight_Walking_Lunge`, `fedb:Inverted_Row`); rep ranges as `reps`/`repsMax`, Plank as `durationSeconds: 45`; descriptions are our own one or two sentences

---

## Phase 2: Foundational (blocks every story)

- [X] T003 Create `libs/shared/domain/src/lib/training-plans.ts` with `validatePlanTarget(measure, target)` (fields allowed by `setFieldsFor(measure)`, `reps` required for rep measures, `repsMax > reps` and only with `reps`, `durationSeconds` required for `duration`, distance or time for `distance_duration`, ranges from data-model.md) and `validatePlan(plan, measureOf: (exerciseId) => Measure | undefined)` returning `{path, message}[]` against `PLAN_LIMITS`; plus `describeTarget(measure, target, unit)` (`8–12`, `+10 kg × 8`, `−20 kg × 8`, `45 s`, `1 km in 5:00`, warm-up marked) using `training-format.ts`; export from `libs/shared/domain/src/index.ts`
- [X] T004 [P] Tests for T003 in `libs/shared/domain/src/lib/training-plans.spec.ts`: each measure's allowed/required target fields, `repsMax` equal/below/without `reps`, every `PLAN_LIMITS` edge (0 and 14 workouts ok, 15 refused; 30/31 exercises; 0/1/20/21 targets; rest 900/901), unknown exercise id, `describeTarget` per measure in kg and lb
- [X] T005 Add to `apps/api/src/training/training.schemas.ts`: `TrainingPlan` (collection `training_plans`) with embedded `PlanWorkout {id, name, exercises}`, `PlanExercise {id, exerciseId, restSeconds?, note?, targets}`, `PlanTarget` (optional ints via `optionalInt`, no defaults), `userId?`, `name`, `description?`, `seedKey?`, `seedVersion?`, `copiedFrom? {planId, name}`, `requestId?`, `archived` (default false), timestamps; indexes from data-model.md (`{userId, archived, updatedAt: -1}`, partial unique `seedKey`, partial unique `{userId, requestId}`, `{userId, 'workouts.exercises.exerciseId'}`). On `WorkoutSession` add optional `plan {planId, planWorkoutId, planName, workoutName}` and index `{userId: 1, 'plan.planId': 1, day: -1}`; on `WorkoutExercise` add optional `planned {planExerciseId, restSeconds?, note?, targets}` and optional `skipped`. Register the model in `apps/api/src/training/training.module.ts`
- [X] T006 Create `apps/api/src/training/plan.seeder.ts`: a method `seed()` that, when the number of shared plans with `seedVersion === file.version` differs from the file's plan count, resolves each `fedb:` key to an exercise `_id` (shared rows only), logs and skips a plan naming a missing exercise, validates targets with `validatePlanTarget`, upserts by `seedKey` (workout `id` = the file's `key`, exercise `id` = `<workoutKey>:<index>`), and sets `archived: true` on shared plans whose `seedKey` is no longer in the file. Never touches rows with a `userId`. Call it at the end of `CatalogueSeeder.onModuleInit` in `apps/api/src/training/catalogue.seeder.ts` (so the catalogue exists first, plan.md note) and provide it in `training.module.ts`
- [X] T007 [P] Spec `apps/api/src/training/plan.seeder.spec.ts`: reads the real `plans.json` and `free-exercise-db.json` and asserts every `fedb:` key exists and every target passes `validatePlanTarget` for that exercise's mapped measure (`catalogueMeasure`); at least four plans incl. one using no equipment; a second `seed()` at the same version writes nothing; a plan naming a missing exercise is skipped and the others still seeded; a plan dropped from the file is archived; user rows untouched
- [X] T008 Create `apps/api/src/training/plans.service.ts` read side: `list(userId)` returning `{shared, own}` (shared not archived in file order by `seedKey` order, own newest `updatedAt` first; filters written explicitly with `$or` shared/own, not `OwnedCrudService`, comment why as in `catalogue.service.ts`), `detail(userId, id)` resolving each `exerciseId` to `{name, measure, equipmentType, archived}` in one query, answering 404 for malformed, foreign or missing ids (archived shared plans readable). Leave `lastDoneDay`/`isNext`/`nextWorkout` empty until US3
- [X] T009 Add routes `GET /training/plans` and `GET /training/plans/:id` to the controller in `apps/api/src/training/training.module.ts` (`private, no-store`, under the existing `@RequireModule('training')`), declaring `plans/suggested` before `plans/:id` for later
- [X] T010 [P] Web: add a Plans tab to `apps/web/src/app/training/page.tsx` (Workout · Plans · History · Exercises); `apps/web/src/lib/training.ts` gains `PLANS_KEY = '/training/plans'`, `planKey(id)` and re-exports `describeTarget`; create `apps/web/src/components/training/plans-list.tsx` (ready-made and own sections, name, description, workout count) and `apps/web/src/components/training/plan-detail.tsx` (workouts in order, each exercise with its targets via `describeTarget` and rest via `formatDuration`; no actions yet)

**Checkpoint**: four ready-made plans seeded idempotently and browsable in Training → Plans.

---

## Phase 3: User Story 1 — Train from a ready-made plan (P1) 🎯 MVP

**Goal**: start a plan's workout, log its suggestions in one tap, skip, swap, add, remove, finish.

**Independent test**: quickstart scenarios 1–6 and 10.

### Tests

- [X] T011 [P] [US1] Add `openTargets(planned, loggedSetCount, skipped)` and `prefillFor(measure, target, previousSets, position)` to `libs/shared/domain/src/lib/training-plans.ts` with tests in `training-plans.spec.ts`: targets consumed by count (0, some, all, more than planned), skipped gives `[]`, deleting a set brings one back; prefill from the same-position previous set, from the last previous set when last time had fewer, from the target when no history (low end of range, weight empty when none, `durationSeconds` for time), set `type` from the target, fields limited to `setFieldsFor(measure)`
- [X] T012 [P] [US1] Spec cases in `apps/api/src/training/sessions.service.spec.ts`: start with `{planId, planWorkoutId}` creates `plan` and one workout exercise per planned exercise in order with server-built `snapshot` and `planned`; a retried start `requestId` creates no duplicates; an open session is returned with `resumed: true` and gets no planned rows; unknown plan/workout → 404, empty workout → 400 `EMPTY_WORKOUT`; editing or deleting the plan afterwards leaves `planned` and `plan` unchanged; DTOs reject a `planned` or `plan` field; `skipped` refused on a row without `planned`; swap with no sets keeps `order` and carries `planned` for the same measure, gives that many empty working targets for another measure, and swap with sets → 409 `HAS_SETS`; finish deletes planned rows with no sets (skipped or not), keeps hand-added ones, and still 409 `EMPTY_SESSION` when nothing is logged; detail returns `openTargets`

### Implementation

- [X] T013 [US1] DTOs in `apps/api/src/training/training.dto.ts`: `StartSessionDto` gains optional `planId`, `planWorkoutId` (both or neither, validated in the service); `UpdateWorkoutExerciseDto` gains optional `skipped: boolean`; new `SwapExerciseDto {requestId, exerciseId, machineId?}`
- [X] T014 [US1] In `apps/api/src/training/sessions.service.ts`, start from a plan: load the plan through `PlansService.detail` access rules (shared or own), find the workout, 400 `EMPTY_WORKOUT` if it has no exercises, otherwise create the session with `plan` frozen and insert workout exercises with `requestId = <session requestId>:<planExerciseId>`, `order` by position, the usual snapshot builder and `planned {planExerciseId, restSeconds, note, targets}`; on retry, fetch rather than duplicate. Keep the existing open-session path (`resumed: true`, nothing added)
- [X] T015 [US1] In `apps/api/src/training/sessions.service.ts`: `SessionDetail` and `SessionListItem` include `plan`; each `SessionExercise` includes `planned`, `skipped` (default false) and `openTargets` from the domain function; `PATCH` accepts `skipped` only when `planned` exists; new `swap(userId, sessionId, weId, dto)` (409 `HAS_SETS`, 409 on a finished session, replace at the same order, new snapshot, carry or reshape `planned`, retried `requestId` returns the new row); `finish` deletes planned rows with no sets before its empty check
- [X] T016 [US1] Route `POST /training/sessions/:id/exercises/:weId/swap` in `apps/api/src/training/training.module.ts`
- [X] T017 [P] [US1] Web `apps/web/src/components/training/suggestion-row.tsx`: an unlogged suggestion line showing the target (`describeTarget`) and its pre-filled values from `prefillFor` with "last time" or "plan" as their source; one tap logs it through the existing set create (with the retry queue and a new `requestId`), tap the values to edit them in the set-row fields first; uses `Input` so comma decimals and 16px apply
- [X] T018 [US1] Web `apps/web/src/components/training/workout-session.tsx`: header shows `workoutName · planName` when `plan` is set; each planned exercise lists logged sets then its `openTargets` as `suggestion-row`s (position = logged count + index); menu actions Skip/Unskip (collapsed when skipped), Swap (opens the existing exercise picker, hidden once a set is logged) and Remove; the rest timer uses `planned.restSeconds` when present, else the profile default; History list items show the plan label in `apps/web/src/app/training/page.tsx` or its history component
- [X] T019 [US1] Web `apps/web/src/components/training/plan-detail.tsx`: a Start button per workout (disabled with a reason when it has no exercises) posting `{requestId, day, planId, planWorkoutId}`; on `resumed: true` show "<workout> is in progress" and open the Workout tab on the open session; revalidate with `revalidateTraining()`

**Checkpoint**: MVP. Quickstart 1–6 and 10 pass; push to main.

---

## Phase 4: User Story 2 — Make and edit my own plans (P2)

**Goal**: create, edit, reorder, copy and delete private plans; start them like ready-made ones.

**Independent test**: quickstart scenarios 7 and 8.

### Tests

- [X] T020 [P] [US2] Spec `apps/api/src/training/plans.service.spec.ts`: create assigns ids and `userId`, a retried `requestId` returns the original; `PUT` keeps sent workout/exercise ids, assigns new ones to items without, removes left-out items, refuses an id not in the plan (400); validation messages name the field; an exercise id that is someone else's own exercise → 400; shared plan `PUT`/`DELETE` → 404, another user's plan → 404 on read and write; copy of shared and own plans gives `<name> (copy)` trimmed to 80, new ids, `copiedFrom`; the 101st own plan (create or copy) → 409 `PLAN_LIMIT`; delete leaves sessions untouched. Add to `catalogue.service.spec.ts`: deleting an own exercise used only by an own plan archives it

### Implementation

- [X] T021 [US2] DTOs in `apps/api/src/training/training.dto.ts`: `CreatePlanDto {requestId, name, description?, workouts: PlanWorkoutDto[]}`, `ReplacePlanDto` (same without `requestId`, items may carry `id`), `PlanWorkoutDto {id?, name, exercises}`, `PlanExerciseDto {id?, exerciseId, restSeconds?, note?, targets: PlanTargetDto[]}`, `PlanTargetDto` (ints with `@IsInt`/`@Min`/`@Max`, `type` in `warmup|working`), `CopyPlanDto {requestId}`; nested `@ValidateNested` + `@Type`, array sizes from `PLAN_LIMITS`
- [X] T022 [US2] Write side of `apps/api/src/training/plans.service.ts`: `create`, `replace`, `copy`, `remove` per `contracts/api.md`; check exercise ids (shared or the caller's own, archived allowed), then `validatePlan`; the 100-plan limit counted on own plans; writes always filter by `userId`
- [X] T023 [US2] Routes `POST /training/plans`, `PUT /training/plans/:id`, `POST /training/plans/:id/copy`, `DELETE /training/plans/:id` in `apps/api/src/training/training.module.ts`
- [X] T024 [US2] In `apps/api/src/training/catalogue.service.ts` `remove()`: also archive (not delete) an own exercise found in `training_plans` with `userId` and `workouts.exercises.exerciseId`
- [X] T025 [US2] Web `apps/web/src/components/training/plan-editor.tsx`: name, description, workouts (add, rename, remove, move up/down), exercises per workout (add via the existing exercise picker, remove, move up/down, rest, note), targets per exercise shaped by the exercise's measure (add/remove sets, reps or range, weight in the person's unit via `parseWeight`, assistance, time via `parseDuration`, distance, warm-up toggle); errors from `validatePlan` shown inline before saving; saves with `POST` or `PUT`. Up/down buttons, not drag (tab swiping)
- [X] T026 [US2] Web: "New plan" in `plans-list.tsx`; in `plan-detail.tsx` Copy for every plan (opens the copy), Edit and Delete (with confirm) for own plans only, and "Based on <name>" when `copiedFrom` is set; archived own exercises shown with an "archived" note in plan detail and the editor

**Checkpoint**: quickstart 7 and 8 pass; push to main.

---

## Phase 5: User Story 3 — Know which workout is next (P3)

**Goal**: last done per workout, the next workout, and recently used plans on the Workout tab.

**Independent test**: quickstart scenario 9.

### Tests

- [ ] T027 [P] [US3] Add `planProgress(workoutIds, sessions)` and `recentPlanIds(sessions, today, days = 28, max = 3)` to `libs/shared/domain/src/lib/training-plans.ts` (sessions as `{planId, planWorkoutId, day, startedAt}`), with tests in `training-plans.spec.ts`: none done → first is next; most recent by day then `startedAt`; wraps after the last; an open session counts; a session for a workout no longer in the plan does not move `next` past a missing id (falls back to the first); 28-day edge inclusive; at most three, most recent first, one entry per plan

### Implementation

- [ ] T028 [US3] In `apps/api/src/training/plans.service.ts`: load the caller's sessions with `plan` for the listed plan ids (index `{userId, 'plan.planId', day}`, projection of the four fields), fill `PlanListItem.lastDoneDay` and `nextWorkout`, and `PlanDetail` workouts' `lastDoneDay` and `isNext`; add `suggested(userId, today)` (validate `today` as `YYYY-MM-DD`) leaving out archived and deleted plans
- [ ] T029 [US3] Route `GET /training/plans/suggested?today=` in `apps/api/src/training/training.module.ts`, declared before `plans/:id`; spec cases in `plans.service.spec.ts` for progress on list/detail and for a deleted session no longer counting
- [ ] T030 [US3] Web: plan detail shows each workout's last done relative to today ("3 days ago", "yesterday", "not yet", using `formatDay`/the local day) and marks the next one; plans list shows the next workout; the Workout tab with no open session (`apps/web/src/components/training/workout-session.tsx` or a new `workout-start.tsx`) shows "Start empty workout" plus up to three "Start <workout> · <plan>" rows from `/training/plans/suggested?today=<local day>`

**Checkpoint**: quickstart 9 passes; push to main.

---

## Phase 6: Polish and cross-cutting

- [ ] T031 [P] Update `docs/modules/training.md`: the `training_plans` schema and indexes, the `plan`/`planned`/`skipped` session fields, the plan endpoints and swap, the pure functions and their rules (positional consumption, pre-fill, next wraps), the seeder and its catalogue check, and that shared plans bypass `OwnedCrudService` like the catalogue
- [ ] T032 [P] Append to `docs/DECISIONS.md` (suggestions copied at start as a third snapshot; positional consumption instead of a per-set link; whole-plan PUT with stable ids), to `docs/CHANGELOG.md` (workout plans), and mark phase 2 built in `docs/ROADMAP.md`; extend the CLAUDE.md workout-exercise "trip you up" line with `planned` (server-built, never from a request, never refreshed)
- [ ] T033 Run `npm run check` and `npm run build`; fix what fails
- [ ] T034 Run every scenario in `specs/023-training-plans/quickstart.md` against a local Mongo and the dev servers at phone width; confirm Food unchanged (SC-007) and an empty start still one tap (SC-006); record results under a Progress section in this file

---

## Progress

- 2026-11-12: US2 done (T020–T026); `npm run check` passes (933 tests), and the API and the web
  editor were run against a local Mongo at phone width. Differences from the task text:
  - The list and plan view stay in `components/training/plans.tsx`; Copy, Edit and Delete sit in a
    row under the plan's title (as header actions they squeezed the title at 375px).
  - Copy opens the copy straight in the editor, since a copy is made to be changed.
  - A rep range is typed in one field, `8-12` (or `8–12`); the API still stores `reps`/`repsMax`.
  - A 400 also returns `problems: [{path, message}]`; the editor shows the same problems from
    `validatePlan` before sending, located as `Workout A · Barbell Squat · set 1`.
  - The fake model's dotted paths now reach through arrays, as Mongo's do, for the
    `workouts.exercises.exerciseId` lookups.
  - Checked locally: copy (and a retried copy) of Push / Pull / Legs; `PUT` reordering workouts
    kept their ids; an empty target, an unknown id and an extra field → 400; `PUT`/`DELETE` of a
    shared plan → 404; a workout started from the copy kept its names after the plan was
    deleted; deleting an own exercise used by a plan archived it and the plan still showed it.

- 2026-11-12: MVP done (T001–T019); `npm run check` passes (888 tests across the three projects), and the flow was run against
  a local Mongo with the API and web at phone width. Differences from the task text:
  - The plans list and plan view are one file, `components/training/plans.tsx`, not
    `plans-list.tsx` + `plan-detail.tsx`.
  - Swap opens the exercise search only (no machine step); the machine can be set afterwards
    from the card, as for any exercise. The API does not refuse a swap on a finished workout; the
    UI only offers it on an open one, for an exercise from the plan with no sets.
  - The rest timer uses the plan's rest of the exercise whose set was logged last.
  - Running the app found two bugs the unit tests (on the in-memory fake) could not: the target
    `type` needed `type: String` (the API refused to boot), and the nested plan classes needed
    `@Schema()` (workouts were stored as `{}`). Both fixed; see `docs/DECISIONS.md`.
  - Checked locally: 4 ready-made plans seeded (876 exercises first), counts 8/11/15/7
    exercises; Push starts with 5 exercises and 4/3/3/3/3 suggestions; a retried start makes no
    duplicates; starting Pull while Push is open resumes Push; logging uses one suggestion up;
    skip empties them; swap keeps position and targets, and is refused (409 `HAS_SETS`) once a set
    is logged; a `planned` field in a request is a 400; finishing kept only the logged exercise;
    History shows "Push · Push / Pull / Legs"; the next Push pre-fills bench from last time; an
    empty start has no plan; an unknown plan is 404. In the browser at 375 px: Plans tab, plan
    view, Start, one-tap log, skip and finish, with no sideways scroll and no console errors.
  - Quickstart scenarios 7–9 (own plans, progress) belong to US2 and US3.

## Dependencies and execution order

- **Setup (T001–T002)** → **Foundational (T003–T010)** → stories.
- **US1** needs only Foundational. **US2** needs Foundational for the service and detail view; starting an own plan reuses US1's T014/T019, so its quickstart scenario 7 needs US1. **US3** needs US1 (sessions carry `plan`).
- **Polish** last; docs (T031–T032) must land with the first push that adds the schema (CLAUDE.md rule), so write T031's schema part with US1.

Within a story: tests → domain → service → routes → UI.

## Parallel opportunities

- Setup: T002 alongside T001.
- Foundational: T004 alongside T005–T009; T007 once T006's interface is fixed; T010 once T001 exists.
- US1: T011, T012 and T017 together; then T013 → T014 → T015 → T016; T018 and T019 after T015.
- US2: T020 and T025 together (the editor against the contract); T021 → T022 → T023; T024 alone.
- US3: T027 alongside T028's query work.
- Polish: T031 and T032 together.

### Example: User Story 1

```text
In parallel:  T011 training-plans.ts openTargets/prefillFor + tests
              T012 sessions.service.spec.ts cases
              T017 suggestion-row.tsx
Then:         T013 → T014 → T015 → T016 → T018 → T019
```

## Implementation strategy

**MVP = Setup + Foundational + US1**: the four ready-made plans, browsable and startable, with
one-tap suggestions, skip, swap and the frozen snapshot. Stop there and train from a plan once:
how the suggestions feel with a barbell in hand decides what US2's editor and phase 3's UI
overhaul need.

Then US2 → US3, each followed by its quickstart scenarios and a push to main.

## Notes

- 34 tasks: Setup 2, Foundational 8, US1 9, US2 7, US3 4, Polish 4.
- The spec's edge case "a workout with no exercises can be saved but not started" is reflected in
  data-model.md and contracts/api.md (0–14 workouts; Start answers 400 `EMPTY_WORKOUT`), corrected
  while writing these tasks.
