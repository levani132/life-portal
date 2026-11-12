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
history, personal records and labelled 1RM estimates (US3, T029–T034), and the Home card (US4,
T035–T037), and units and effective loads (US5, T038–T040). Phase 1 is complete apart from the
polish tasks (T041–T044).

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
facts. kg/lb is a display preference (`training_profiles.weightUnit`, set from the gear on
`/training`); nothing converted is stored. Conversion is `gramsToDisplay` / `displayToGrams` in
`libs/shared/domain/src/lib/training-format.ts`: 1 lb = 453.59237 g exactly, a typed value is
rounded to whole grams **once**, and display shows two decimals (225 lb → 102 058 g → "102.06 kg",
and back to "225 lb"). Switching the unit rewrites nothing; a set form open during a switch
re-fills its weights from grams so a kg number is never sent as lb.

## Collections

| Collection | Purpose (and why it exists) |
| --- | --- |
| `exercises` | The catalogue. Shared rows have no `userId` and are written only by the seeder; private rows have one. One catalogue for everyone instead of a copy per account. |
| `training_machines` | Specific machines, private to their creator (US2). The dataset only knows generic equipment. |
| `training_profiles` | One row per user: `weightUnit`, `defaultRestSeconds`. Upserted on first read, seeding only fields the caller did not send. |
| `training_plans` | Workout plans (spec 023). An exercise may carry `superset` (spec 025). One document per plan with `workouts[] → exercises[] → targets[]` embedded, because a plan is read and saved whole. Shared (ready-made) plans have no `userId`, a `seedKey` and `seedVersion`, and are written only by `PlanSeeder`; own plans have a `userId`. Workout and exercise `id`s are stable strings (seed keys like `push-pull-legs:push` for shared plans) because sessions point at them. `archived` marks a shared plan dropped from the seed file. |
| `workout_sessions` | One workout: `day`, `status`, `startedAt`, `endedAt?`, `notes?`, `requestId`, and `plan? {planId, planWorkoutId, planName, workoutName}` when started from a plan (frozen). |
| `workout_exercises` | An exercise within a session, in `order`, with a frozen `snapshot`; from a plan also `planned {planExerciseId, restSeconds?, note?, targets}` (frozen) and `skipped?`. Spec 025: `restSeconds?` (this workout's choice, 0–900) and `superset?` (copied from the plan, then editable). |
| `workout_sets` | **The event row.** One performed set. Everything about progress derives from these. |

Sessions, exercises and sets are three collections, not one document with arrays, so two devices
logging into one workout never overwrite each other, and per-exercise history is an index scan
on `(userId, exerciseId, loggedAt)`.

### Indexes worth knowing

- `workout_sessions` `one_open_session`: unique `{userId}` where `status: 'open'`. The database
  enforces "at most one open workout". `status` is stored beside `endedAt` only because Mongo
  cannot build a partial index on a field being absent.
- Unique `(userId, requestId)` on sessions, workout exercises and sets: retry safety.
- `exercises.seedKey` unique where present: the seeder's upsert key. Same for `training_plans.seedKey`.
- `workout_sessions {userId, 'plan.planId', day}`: plan progress (spec 023 US3).
- `training_plans {userId, 'workouts.exercises.exerciseId'}`: is an own exercise used by a plan.

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

### Third instance: a plan's targets (spec 023)

Starting a plan's workout copies each planned exercise's targets onto its workout exercise as
`planned`, and the plan and workout names onto the session as `plan`. Editing or deleting the
plan afterwards changes neither an open nor a finished workout. Same rules as the snapshot: built
by the server from the plan, no DTO field for either, never refreshed. `skipped` is the only
plan-related field a PATCH sets.

## Plans (spec 023)

**Ready-made plans** live in `apps/api/src/training/catalogue/plans.json` (our own content;
exercises named by catalogue `seedKey`, e.g. `fedb:Barbell_Squat`). `PlanSeeder` runs at the end
of `CatalogueSeeder.onModuleInit`, because it resolves those keys to exercise ids: when fewer
shared plans carry the file's version than the file has, it upserts each by `seedKey`; a plan
naming a missing exercise or a target its measure does not allow is logged and skipped; a shared
plan dropped from the file is archived, never deleted. `plan.seeder.spec.ts` checks the real file
against the vendored catalogue, so a bad plan fails the tests before it can be skipped in
production. Like the catalogue, shared plans bypass `OwnedCrudService` (`PlansService` writes its
`$or` filters itself).

**Own plans** (US2) are created, copied, replaced and deleted whole. `PUT` replaces the plan (last
write wins): a workout or exercise that carries an `id` keeps it, so sessions keep pointing at
their workout; an `id` not in the plan, or sent twice, is a 400; items without one get a new
ObjectId hex string; items left out are removed. Exercise ids must be shared or the caller's own
(archived own ones too, so a plan keeps working after its exercise is deleted); anything else is a
`validatePlan` problem at `workouts.N.exercises.M.exerciseId`. A 400 carries `problems: [{path,
message}]` as well as the messages. Copy works on any plan the caller can read, names it
`<name> (copy)` within 80 characters, gives every item a new id and records `copiedFrom {planId,
name}`, which is never followed (the original may change or go). A person keeps at most 100 own
plans (409 `PLAN_LIMIT` on create or copy). Deleting a plan leaves sessions alone: they carry their
own frozen `plan` names. Deleting an own exercise that one of the person's own plans uses archives
it instead (`CatalogueService.remove`), as a logged one is.

**Targets** carry the same fields as a set, plus `repsMax` for a range and `type`
(`warmup`/`working`). `validatePlanTarget` requires reps for rep measures, time for `duration`
and distance or time for `distance_duration`; weight is optional (the person fills it in).
`validatePlan` checks `PLAN_LIMITS` (name 80, description 1000, 14 workouts, 30 exercises a
workout, 1–20 targets, rest 0–900 s). Both live in `libs/shared/domain/src/lib/training-plans.ts`.

**Progress** (US3) is derived on every read from the caller's sessions that carry `plan`, open
ones included, and never stored, so deleting a session simply stops it counting
(`planProgress` in `training-plans.ts`). Each workout's `lastDoneDay` is the latest `day` of a
session for it; the next workout is the one after the most recent session from that plan (by
`day`, then `startedAt`), wrapping, or the first when none was done or the latest one names a
workout no longer in the plan. `PlanListItem` carries `lastDoneDay` (the plan's latest) and
`nextWorkout {id, name}`; `PlanDetail` workouts carry `lastDoneDay` and `isNext`.
`GET /plans/suggested?today=` lists up to three plans with a session in the 28 days up to and
including `today` (`recentPlanIds`), most recent first, leaving out deleted and archived plans;
the Workout tab shows them, with nothing open, as "Start <next workout> · <plan>". Queries use
the `{userId, 'plan.planId', day}` index.

**Suggestions** in a started workout are derived, never stored as sets:
- `openTargets(planned, loggedSetCount, skipped)` = `targets.slice(loggedSetCount)`: logged sets
  use targets up in order, whatever their values; deleting a set brings its target back.
- `prefillFor(measure, target, previousSets, position)`: last time's set at the same position,
  else last time's last set, else the target (low end of a range, planned weight if any). The web
  carries a weight logged earlier in the same workout into a target without one, so the second
  set of a new exercise is still one tap.
- **Swap** (`POST …/exercises/:weId/swap`) replaces a workout exercise that has no sets with a new
  row in the same `order` (409 `HAS_SETS` otherwise): `exerciseId` stays immutable. Targets carry
  over when the measure matches; otherwise the same number of empty targets of the same types.
- **Finish** deletes workout exercises with `planned` and no sets (skipped or not), after the
  `EMPTY_SESSION` check, so a workout with nothing logged keeps its suggestions.
- A plan start's exercise rows get `requestId = <session requestId>:<planExerciseId>`, so a
  retried start fills in what is missing and never doubles. Starting while a workout is open
  returns it with `resumed: true` and adds nothing. A workout with no exercises answers 400
  `EMPTY_WORKOUT`.

## Workout flow (spec 025)

**Supersets.** A plan exercise and a workout exercise may carry a `superset` key
(`[A-Za-z0-9_-]{1,40}`, opaque; the web makes 8-character ones). Only **neighbours** with the
same key form a superset (`supersetRuns`), labelled A, B, … by position and numbered A1, A2. So
moving an exercise away takes it out without touching the others, and a stray key on a lone
exercise means nothing. `linkWithNext` and `unlinkFromNext` (domain) compute the new keys; the
plan editor sends them with the plan, a workout PATCHes each exercise whose key changed
(`superset: null` clears). Starting from a plan copies the key; swap keeps it. Sets are still
logged per exercise, so history, records and 1RM are untouched by supersets.

**Rest.** The rest after a set is `workout_exercises.restSeconds` (chosen in this workout), else
`planned.restSeconds`, else the profile's `defaultRestSeconds`. `planned` is never edited; "Also
save to plan" in the web PUTs the person's own plan with the new rest. `restAfter` (domain): 0
mid-way through a superset round (the current exercise is a later member of the last set's
superset), else the superset's last member's rest, else the exercise's own. The timer's −15 s,
+15 s and Skip change the current rest only, in memory (`useRestControls`, shared with the bar).

**Done and current** (`workoutFocus`, derived on every render, sets still being sent included):
a planned exercise is done once its planned sets are logged (extra sets keep it done); one added
by hand is done once it has a set and the last set was in another exercise outside its superset.
Skipped exercises are neither. Current: in the last set's superset, the next member not done,
round and round; else the last set's exercise while not done; else the first neither done nor
skipped. Done exercises collapse to one green line and expand on tap; finished workouts are
shown expanded.

**Rest over push** (`rest-alarm.service.ts`). The browser alone knows when a rest ends (the
superset rule, ±15 s, Skip), so `RestAlarmSync` (mounted with the workout bar, on every page)
sends `PUT /sessions/:id/rest-alarm {at}` whenever that time changes, and `{at: null}` when the
rest is skipped or is 0. The server keeps **one in-memory timer per person** and sends the
`restOver` reminder through `NotificationsService.remind()` when it fires. `at` must be at most
20 minutes ahead; a time already past sets nothing; the session must be the caller's open one
(404 otherwise). Finishing or discarding the workout clears the timer. Nothing is stored: a
restart loses a pending alarm, and the next set sets a new one. Several open devices send the
same time, which just replaces the timer.

**The workout bar.** `components/training/workout-bar.tsx`, inside the app header (so
`--header-offset` counts it and the rest timer still sticks under it), on every page while a
session is open: current exercise, time, rest countdown. It reads `sessions/current` (revalidated
on focus) and hides while the Training page's Workout tab shows (`setWorkoutOnScreen`); tapping
it opens `/training`, or switches the tab there (`OPEN_WORKOUT_EVENT`).

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
| `PATCH`/`DELETE` | `/sessions/:id/exercises/:weId` | `{notes?, machineId?, restSeconds?, superset?}` (`null` clears the machine, rest or superset; spec 025); delete removes its sets. |
| `POST` | `/sessions/:id/exercises/:weId/sets` | Validated against the snapshot's measure. Returns `{set, records}`; bodyweight and assisted sets carry `effectiveLoad` when a weigh-in exists. |
| `PATCH`/`DELETE` | `/sets/:setId` | `null` clears an optional field. PATCH returns `{set, records}`. |
| `GET` | `/plans` | `{shared, own}`; shared in seed-file order, archived left out (spec 023). |
| `GET` | `/plans/suggested` | `?today=YYYY-MM-DD` (400 otherwise): up to 3 `PlanListItem`s used in the 28 days to `today`, most recent first. Declared before `/plans/:id`. |
| `GET` | `/plans/:id` | Workouts with each exercise's name, measure and targets. Archived shared plans still readable. |
| `POST` | `/plans` | `{requestId, name, description?, workouts}` → the new own plan; a retried `requestId` returns it. 409 `PLAN_LIMIT` at 100. |
| `PUT` | `/plans/:id` | Replaces an own plan whole, keeping sent ids (see Plans). Shared or someone else's → 404. |
| `POST` | `/plans/:id/copy` | `{requestId}` → an own copy of any readable plan, with `copiedFrom`. |
| `DELETE` | `/plans/:id` | Own plans only. Sessions started from it are unchanged. |
| `POST` | `/sessions` `{…, planId, planWorkoutId}` | Spec 023: both or neither; copies the workout's exercises and targets. |
| `PATCH` | `/sessions/:id/exercises/:weId` `{skipped}` | Only for an exercise with `planned` (400 otherwise). |
| `POST` | `/sessions/:id/exercises/:weId/swap` `{requestId, exerciseId, machineId?}` | 409 `HAS_SETS` once a set is logged. |
| `PUT` | `/sessions/:id/rest-alarm` `{at: ISO \| null}` | Spec 025: 204. Sets, moves or cancels the person's rest-over push (in memory). |
| `GET` | `/summary?today=` | The Home card's figures (`TrainingSummary`, with `weightUnit`, read without creating a profile); also in `GET /api/dashboard`. |

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
- **Effective load on a set** (`WorkoutSet.effectiveLoad`, US5): bodyweight and assisted sets
  in a session detail, a set response and history carry `{grams, bodyWeightDay}`, shown as
  "85 kg load · from weigh-in 1 Nov". Without a weigh-in on or before the day it is absent and
  only the reps show. Weight × reps sets never carry it (their load is their weight).
- **Session figures**: `bestSetOf` (highest 1RM, else load, reps, distance, time) and
  `sessionVolumeGrams`; `SessionExercise.oneRepMax` is the best estimate in that session.

### The Home card (US4)

`weekSummary` (domain) over what `TrainingSummaryService` gathers; nothing stored.

- **Workouts** and **time** (the subtitle says "this week"): sessions whose `day` is from this Monday to
  `today`, open ones included, timed with `sessionDurationSeconds`. Weeks start on Monday.
- **Third figure**: the newest record **set** (a marked set, not a current best) within the last
  14 days, e.g. "PR · Bench press: 100 kg". When one set holds several, the first in
  `RECORD_KINDS` order is shown (heaviest before an estimate). With no recent record: days since
  the last workout ("today", "yesterday", "N days ago"; amber after a week).
- **One action**: *Resume workout* when a session is open (opens `/training`), else *Start
  workout* (starts one for the browser's day, then opens `/training`).
- The dashboard calls the summary only when the account has `training` and selected it. Card
  `order` 30, icon `dumbbell`. Formatting (`formatRecordValue` and friends) lives in
  `libs/shared/domain/src/lib/training-format.ts`, so the server-built card reads like the page.

## Day and time

A session's `day` is decided in the browser from the local clock and the Food profile's
`dayStartHour`, exactly like meals, and sent explicitly. `startedAt`, `endedAt` and `loggedAt` are
real instants set by the server, because durations need them.

## Cross-links

- [badges](badges.md): `SessionsService.finishedDays(userId)` exports the `day` of each finished
  workout for the training badges. Badges never read training collections directly.

- **Food / Apple Health:** none in this phase, on purpose. Training produces **no burned-energy
  figure** and never changes Food's targets or activity adjustment, which Apple Health's Active
  Energy owns. Who owns burned energy when Health is not connected is a later decision.
- **Weigh-ins:** bodyweight and assisted loads read Nutrition's weigh-ins through
  `NutritionService.weighInsUpTo(userId, day)` (one query per request; `TrainingModule` imports
  `NutritionModule`), never a copy, so a corrected weigh-in corrects every figure.

## Web

`/training` has four tabs: Workout (the open session, or Start empty workout and Choose a plan),
Plans (ready-made and own plans; a plan's workouts each with Start; Copy on every plan and Edit /
Delete on own ones, with `plan-editor.tsx` editing a whole plan and reordering by up/down buttons,
never drag, because the tabs swipe; spec 023), History (past sessions,
each opening for reading and editing) and Exercises (the catalogue with filters and a detail view,
where own exercises can be edited or deleted, and My machines). Adding an exercise to a workout is
two steps: the exercise (with "Create exercise" for what the catalogue lacks), then which machine
(with "New machine"); a workout exercise's machine can be changed from its card. Sets go through
`lib/training-queue.ts`: each is shown at once as a pending row, sent in order, and retried on
`online`, focus and every 5 s after a network or server error. The queue is in memory only:
closing the app with writes still pending loses them. Weight fields use `Input` with
`inputMode="decimal"`, so a comma from a Georgian keyboard works.

**Colour system (spec 024, display only).** Training is colourful by derivation, never by stored
data. `lib/training-colors.ts` maps each muscle to a group (push: chest, shoulders; pull: back,
traps, neck; legs; core: abdominals; arms; cardio for any `distance_duration` exercise; `other`
when there is no primary muscle) and each group to literal Tailwind classes (`text`, `tint`,
`border`, `solid`, `gradient`, `edge`) and a lucide icon. Exercise tiles, workout exercise cards,
muscle filter chips and History all use these. A plan's colour comes from its position among the
ready-made plans (so the four seeded plans are always distinct) or, for own plans, a hash of its
id: stable on every device, nothing stored. `usePlanStyle(id)` reads the cached plan list so a
plan's workout header matches its card. The colours are `--train-<hue>` (text, themed in all
three theme blocks of `global.css` for 4.5:1 contrast) and `--train-<hue>-solid` (fills that carry
white text in both themes). Class strings must stay literal, because Tailwind only generates
classes it finds as text. The page opens with `training-hero.tsx`, this week from
`GET /training/summary` (hidden on the Workout tab while a workout is open, whose own gradient
header shows time, sets and a progress bar of planned sets logged over planned, skipped exercises
left out). History is grouped by Monday-start week with totals summed from the loaded sessions.

**The rest timer sticks under the header (issue #4, display only).** `rest-timer.tsx` counts down
from `lastSetAt` on the client; nothing about it is stored. It is a direct child of the workout's
list (below the header card, above the exercises), because a `position: sticky` element only
sticks within its parent, and it is one element that changes position, never a second copy, so
its countdown and controls keep their state and there is never a duplicate. It sticks at
`--header-offset`, which `ScrollHeader` publishes (its height while shown, `0px` once hidden), on a
solid `bg-surface` band. With no header showing it pads itself by `--header-band`
(`var(--top-chrome)`), so it fills the iOS status-bar band instead of leaving it hollow. It
renders nothing when there is no rest to show, so no empty bar stays pinned.

## Deletion

There is no account deletion feature yet (as for messages and notifications). When one is added,
it must remove the user's `workout_sessions`, `workout_exercises`, `workout_sets`,
`training_profiles`, own `training_plans`, private `exercises` and `training_machines`, and the photos those two
reference in storage. Shared catalogue rows and ready-made plans have no `userId` and stay.

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
