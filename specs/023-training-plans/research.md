# Research: Training — workout plans (spec 023)

Every open point from the spec, decided. Builds on spec 020's research R1–R11, which still hold.

## R1. A plan is one document with its workouts embedded

**Decision**: one `training_plans` collection. A plan document embeds its workouts, each workout
embeds its planned exercises, each planned exercise embeds its target sets. Shared (ready-made)
rows have no `userId`, like catalogue exercises; own rows have one.

**Rationale**: a plan is a template edited by one person, read and written as a whole: the editor
shows all of it and saves all of it. The worst case (14 workouts × 30 exercises × 20 sets) is a
few hundred KB, far under Mongo's 16 MB. Sessions needed three collections because two devices
log into one workout at once (spec 020 R6); plans have no such concurrency, so last write wins is
acceptable and is what a person editing a document expects.

**Alternatives considered**: four collections mirroring sessions (rejected: four writes per save,
ordering bookkeeping, no concurrency benefit); storing plans in `training_profiles` (rejected:
mixes a preference row with up to 100 documents).

## R2. Stable ids inside a plan

**Decision**: each plan workout has a stable string `id` (own plans: a generated ObjectId hex;
ready-made plans: a key from the seed file such as `ppl:push`). Planned exercises also carry an
`id` so the editor can reorder and edit them without positional confusion. Saving an own plan
keeps ids the client sends back and assigns new ones to new items; an id the client invents is
rejected.

**Rationale**: progress (FR-018/019) links a session to `planWorkoutId`. If workout ids changed
on every save, editing a plan would erase its progress; with ready-made plans, a new seed version
would. Deterministic keys for seeded workouts keep progress across versions, and a workout we
remove simply stops appearing (spec edge case).

**Alternatives considered**: positional indexes (rejected: reordering would reassign history);
names (rejected: renaming is allowed).

## R3. Ready-made plans are a vendored, versioned seed, checked against the catalogue

**Decision**: `apps/api/src/training/catalogue/plans.json` with `{version, plans: [...]}`, each
exercise named by the catalogue's `seedKey` (`fedb:Barbell_Squat`). A `PlanSeeder` runs after the
catalogue seeder at boot, upserts shared plans by `seedKey` when the file's version is ahead, and
never touches own plans. A unit test asserts that every `seedKey` in `plans.json` exists in
`free-exercise-db.json` and that every target fits its exercise's measure; the seeder also
refuses (logs and skips) a plan naming a missing exercise, rather than shipping a broken one. A
shared plan removed from the file is marked `archived` (it may have progress), not deleted.

**Rationale**: the same boot-time, idempotent pattern as the catalogue (production has no job
runner); the test catches a bad plan before deploy, and the seeder guard protects production if
a test was skipped.

**Alternatives considered**: plans in `npm run seed` (rejected: dev only); plans as code
constants (rejected: the version/upsert logic is already built around a file).

## R4. Suggestions are copied onto the session at start

**Decision**: `POST /sessions` with `{planId, planWorkoutId}` creates the session and, in the same
request, one `workout_exercises` row per planned exercise, each with the usual server-built
`snapshot` plus `planned: {restSeconds, note?, targets[]}` copied from the plan. The session gets
`plan: {planId, planWorkoutId, planName, workoutName}`, frozen. Neither is ever edited afterwards.

**Rationale**: FR-011 requires suggestions that survive the plan being edited or deleted, reloads
and other devices. That is the snapshot rule applied to targets: a deliberate copy of a template
taken at a moment, like `meal_entries.facts` and `workout_exercises.snapshot`. Reading the plan
live would let an edit rewrite a workout in progress.

**Alternatives considered**: storing only `planWorkoutId` and reading the plan on each view
(rejected: violates FR-011); creating `workout_sets` rows for suggestions with a `suggested` flag
(rejected: every history, record, volume and summary query would need to exclude them forever,
and SC-005 says they add zero).

## R5. Which suggestions are still open is derived: logged sets consume targets in order

**Decision**: a planned exercise shows `targets.slice(loggedSetCount)` as its open suggestions.
The first logged set fulfils the first target, the second the second, and so on, whatever values
were logged. Nothing links a set to a target.

**Rationale**: principle III (derived, not stored). It needs no extra field on sets, handles
deleting a set (the target reappears), and matches how people use a plan: "three sets of eight"
means three sets. Logging more sets than planned simply leaves no suggestions.

**Alternatives considered**: a `targetIndex` on each set (rejected: one more immutable field to
keep consistent through deletes and edits, for no visible difference).

## R6. Pre-fill is computed on read, from `previous` or the target

**Decision**: a pure `prefillFor(measure, target, previousSets, position)` in the domain lib. If
the person did this exercise in an earlier session, use the set at the same position from that
session, else that session's last set (the spec's "fewer sets last time" rule); otherwise the
target: `reps` (the low end of a range), and the target's weight, assistance, time or distance
if given. The set type comes from the target (warm-up or working). The web calls it with the
`previous` sets the session detail already returns (spec 020).

**Rationale**: principle V; and `previous` is already computed for "Last time", so pre-fill costs
no new query.

**Alternatives considered**: pre-filling on the server into the stored suggestion (rejected: the
values would be stale by the next session and would break the "fixed at start" meaning of
`planned`).

## R7. Skip, swap, remove

**Decision**:
- **Skip**: `PATCH .../exercises/:weId {skipped: true|false}`. A skipped exercise shows collapsed
  with no suggestions; it can be un-skipped.
- **Swap**: `POST .../exercises/:weId/swap {requestId, exerciseId, machineId?}`, allowed only while
  the exercise has no logged sets (409 `HAS_SETS` otherwise). It creates a new workout exercise in
  the same position (new snapshot, so the snapshot rule holds) and removes the old one. The
  `planned` block is carried over when the measures match; otherwise it becomes the same number
  of empty working targets for the new measure.
- **Remove**: the existing `DELETE .../exercises/:weId`.
- **Finish**: workout exercises that came from the plan (`planned` present) and have no logged
  sets are deleted, skipped or not (FR-016). Exercises added by hand keep spec 020's behaviour.

**Rationale**: `exerciseId` stays immutable on a workout exercise (spec 020); a swap is a
replacement. Restricting swap to unlogged exercises avoids a row whose sets belong to a different
exercise than its snapshot.

**Alternatives considered**: making `exerciseId` editable while there are no sets (rejected:
breaks the "never editable" rule other code relies on).

## R8. Progress and "next" are derived from sessions

**Decision**: a pure `planProgress(workouts, sessions, today)` returns, per workout, `lastDoneDay`
(the latest `day` of a session with that `planWorkoutId`) and `nextWorkoutId`: the workout after
the one in the most recent session from this plan (by day, then `startedAt`), wrapping, or the
first. Open sessions count as done (you are doing it now). "Recently used plans" are plans with a
session in the last 28 days, newest first, at most three, skipping archived and deleted plans.
Index: `workout_sessions {userId, 'plan.planId', day: -1}`.

**Rationale**: FR-021 and principle III. A deleted session drops out automatically.

## R9. Own exercises used by plans are archived, not deleted

**Decision**: `CatalogueService.remove` already archives an own exercise that a workout used; it
additionally checks `training_plans` for `workouts.exercises.exerciseId`. Archived exercises are
hidden from the picker but still resolve for plans and starts. Same for machines? No: plans name
exercises only; machine choice stays a per-session step.

## R10. API shape: whole-plan writes

**Decision**: `POST /plans` (create, with `requestId`), `PUT /plans/:id` (replace the whole own plan),
`POST /plans/:id/copy` (with `requestId`), `DELETE /plans/:id`, `GET /plans` (list with progress),
`GET /plans/:id` (detail with progress and exercise display names), `GET /plans/suggested?today=`.
Shared plans answer 404 to `PUT`/`DELETE`, as shared exercises do.

**Rationale**: the editor holds the whole plan; one validated write per save keeps ids, order and
limits checkable in one place (a pure `validatePlan` in the domain lib, shared with the web).

## R11. The ready-made plans (our own content)

Four plans, plain general-fitness structures written for this app, not taken from any published
program. Targets are reps (or time) only; no weights are prescribed, so pre-fill uses the person's
own history. Rest in seconds.

| Plan | Workouts | Exercises (sets × target, rest) |
|---|---|---|
| **Full body (3 days a week)** | A, B | **A**: Barbell Squat 3×6–8 (150), Barbell Bench Press – Medium Grip 3×6–8 (150), Bent Over Barbell Row 3×8–10 (120), Plank 3×45 s (60). **B**: Romanian Deadlift 3×8–10 (150), Standing Military Press 3×6–8 (150), Wide-Grip Lat Pulldown 3×8–12 (90), Dumbbell Lunges 2×10–12 (90) |
| **Upper / Lower** | Upper, Lower | **Upper**: Barbell Bench Press – Medium Grip 4×6–8 (150), Seated Cable Rows 4×8–10 (120), Seated Dumbbell Press 3×8–10 (90), Wide-Grip Lat Pulldown 3×10–12 (90), Dumbbell Bicep Curl 2×10–12 (60), Triceps Pushdown 2×10–12 (60). **Lower**: Barbell Squat 4×6–8 (180), Romanian Deadlift 3×8–10 (150), Leg Press 3×10–12 (120), Lying Leg Curls 3×10–12 (90), Standing Calf Raises 3×12–15 (60) |
| **Push / Pull / Legs** | Push, Pull, Legs | **Push**: Barbell Bench Press – Medium Grip 4×6–8 (150), Standing Military Press 3×8–10 (120), Incline Dumbbell Press 3×8–12 (90), Side Lateral Raise 3×12–15 (60), Triceps Pushdown 3×10–12 (60). **Pull**: Barbell Deadlift 3×5 (180), Pullups 3×6–10 (120), Seated Cable Rows 3×8–12 (90), Face Pull 3×12–15 (60), Hammer Curls 3×10–12 (60). **Legs**: Barbell Squat 4×6–8 (180), Leg Press 3×10–12 (120), Lying Leg Curls 3×10–12 (90), Leg Extensions 3×12–15 (60), Seated Calf Raise 4×12–15 (60) |
| **Bodyweight at home** | Full body | Pushups 3×8–15 (60), Bodyweight Squat 3×15–20 (60), Inverted Row 3×6–12 (60), Bodyweight Walking Lunge 3×10–12 (60), Butt Lift (Bridge) 3×12–15 (45), Plank 3×45 s (45), Crunches 2×15–20 (45) |

All names verified present in the vendored catalogue (`free-exercise-db.json` v1). A time target
uses `durationSeconds`; ranges apply to reps only.
