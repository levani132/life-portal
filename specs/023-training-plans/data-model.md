# Data model: Training — workout plans (spec 023)

One new collection and two additive changes to spec 020's session collections. Every quantity
stays a whole number of grams, metres or seconds. Calendar days are `YYYY-MM-DD` strings.

## New: `training_plans`

One document per plan. Shared (ready-made) plans have no `userId`; own plans have one.

| Field | Type | Rules |
|---|---|---|
| `userId` | string? | Absent on shared plans. Set from the session on create, never from a request. |
| `name` | string | Required, trimmed, 1–80 chars. |
| `description` | string? | ≤ 1000 chars. |
| `workouts` | `PlanWorkout[]` | 0–14 items, order is the array order. A plan may be saved empty while being built; it cannot be started until the chosen workout has an exercise. |
| `seedKey` | string? | Shared plans only, e.g. `plan:ppl`. Unique among shared rows. |
| `seedVersion` | number? | Shared plans only; the `plans.json` version that last wrote the row. |
| `copiedFrom` | `{planId, name}`? | Set by copy; informational ("Based on Push / Pull / Legs"). Never followed for data. |
| `requestId` | string? | Own plans: idempotency of create and copy. |
| `archived` | boolean | Shared plans removed from the seed file. Default `false`. Archived plans are hidden from lists but still resolve by id for history and progress. |
| `createdAt`, `updatedAt` | Date | Mongoose timestamps. |

### `PlanWorkout` (embedded)

| Field | Type | Rules |
|---|---|---|
| `id` | string | Stable. Own plans: ObjectId hex assigned by the server; shared: the seed key (`ppl:push`). Unique within the plan. |
| `name` | string | Required, 1–80 chars. |
| `exercises` | `PlanExercise[]` | 0–30 items (a workout may be empty while being built; Start on it answers 400 `EMPTY_WORKOUT`). |

### `PlanExercise` (embedded)

| Field | Type | Rules |
|---|---|---|
| `id` | string | Stable, server-assigned, unique within the plan. |
| `exerciseId` | string | A shared exercise, or one of the plan owner's own exercises. Checked on write. Archived own exercises remain valid. |
| `restSeconds` | int? | 0–900. Absent = the person's default rest. |
| `note` | string? | ≤ 200 chars ("pause at the bottom"). |
| `targets` | `PlanTarget[]` | 1–20 items. |

### `PlanTarget` (embedded)

| Field | Type | Rules |
|---|---|---|
| `type` | `'warmup' \| 'working'` | Default `working`. |
| `reps` | int? | 1–1000. Required for `weight_reps`, `bodyweight_reps`, `assisted_reps`. |
| `repsMax` | int? | Only with `reps`; `repsMax > reps` (a range). |
| `weightGrams` | int? | 0–1,000,000. `weight_reps`, `bodyweight_reps` (added load), `duration` (held load). |
| `assistGrams` | int? | 1–500,000. `assisted_reps` only. |
| `durationSeconds` | int? | 1–86,400. Required for `duration`. |
| `distanceMeters` | int? | 1–1,000,000. `distance_duration`: distance or time (or both) required. |

Which fields a target may carry follows `setFieldsFor(measure)` from spec 020, so a target and a
logged set of the same exercise always have the same shape. `validatePlanTarget(measure, target)`
and `validatePlan(plan, exercisesById)` live in `libs/shared/domain` and are used by both the API
and the editor.

### Indexes

- `{userId: 1, archived: 1, updatedAt: -1}`: an account's own plans; shared plans
  (`userId` absent) through the same index.
- `{seedKey: 1}` unique, partial on `seedKey` existing: seeder upserts.
- `{userId: 1, requestId: 1}` unique, partial on `requestId` existing: create and copy retries.
- `{userId: 1, 'workouts.exercises.exerciseId': 1}`: "is this own exercise used by a plan?" (R9).

### Limits

At most **100 own plans** per account (FR-008); the 101st create or copy answers 409
`PLAN_LIMIT`. Archived shared plans do not count.

## Changed: `workout_sessions`

| Field | Type | Rules |
|---|---|---|
| `plan` | `{planId, planWorkoutId, planName, workoutName}`? | Set only by `POST /sessions` with a plan; frozen. Absent for an empty start (spec 020 behaviour unchanged). |

New index: `{userId: 1, 'plan.planId': 1, day: -1}` (progress and recently used plans).

## Changed: `workout_exercises`

| Field | Type | Rules |
|---|---|---|
| `planned` | `{planExerciseId, restSeconds?, note?, targets: PlanTarget[]}`? | Copied from the plan at start (or carried over by a swap). Server-built, never accepted from a request, never edited. Absent on exercises added by hand. |
| `skipped` | boolean? | Set by `PATCH {skipped}`. Only meaningful with `planned`. |

`snapshot`, `exerciseId` and the set rows are unchanged.

## Derived on read (pure, `libs/shared/domain/src/lib/training-plans.ts`)

| Function | Returns |
|---|---|
| `openTargets(planned, loggedSetCount)` | `planned.targets.slice(loggedSetCount)`; empty when skipped (R5). |
| `prefillFor(measure, target, previousSets, position)` | The values a suggestion's fields start with: `previousSets[position] ?? previousSets.at(-1)` if any, else the target's (low end of a rep range); `type` from the target (R6). |
| `planProgress(plan, sessions)` | `{workouts: {[id]: {lastDoneDay?}}, nextWorkoutId}` from that plan's sessions, open ones included, wrapping (R8). |
| `recentPlanIds(sessions, today, days = 28, max = 3)` | Plan ids by most recent session within the window (FR-021). |
| `describeTarget(measure, target, unit)` | `3 × 6–8`, `45 s`, `+10 kg × 8`: for the plan view and suggestion rows. Display only. |
| `validatePlan(...)`, `validatePlanTarget(...)` | Error lists per field; shared by DTO checks and the editor. |

## State transitions

- **Own plan**: created (or copied) → edited any number of times (whole-plan replace) → deleted
  (hard delete; sessions keep their frozen `plan` names, and progress simply has nothing to point
  at).
- **Shared plan**: seeded → re-seeded on a new `plans.json` version (workout ids kept) → archived
  if dropped from the file.
- **Workout exercise from a plan**: open suggestions shrink as sets are logged and grow back when
  a set is deleted; `skipped` toggles; swap replaces the row while it has no sets; on finish, rows
  with `planned` and no sets are deleted.
