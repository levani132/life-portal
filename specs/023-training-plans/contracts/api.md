# API contract: `/api/training` additions (spec 023)

Same rules as spec 020's contract: authenticated, `@RequireModule('training')`, scoped to the
caller, `Cache-Control: private, no-store`, `class-validator` DTOs with unknown fields rejected,
malformed or foreign ids answer 404, weights always grams. New types live in
`libs/shared/types/src/lib/training.ts`.

## Plans

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/plans` | | `{shared: PlanListItem[], own: PlanListItem[]}`. Shared in seed order, own newest-edited first; archived shared plans left out. `PlanListItem {id, name, description?, isOwn, workoutCount, exerciseCount, lastDoneDay?, nextWorkout?: {id, name}}`. |
| `GET` | `/plans/suggested` | `?today=` | `PlanListItem[]`: up to 3 plans the caller started a session from in the 28 days up to `today`, most recent first. Empty when none. |
| `GET` | `/plans/:id` | | `PlanDetail {id, name, description?, isOwn, copiedFrom?, workouts: [{id, name, lastDoneDay?, isNext, exercises: [{id, exerciseId, exercise: {name, measure, equipmentType, archived}, restSeconds?, note?, targets: PlanTarget[]}]}]}`. Shared plans, own plans, and archived shared plans (so history links work). |
| `POST` | `/plans` | `{requestId, name, description?, workouts: [{name, exercises: [{exerciseId, restSeconds?, note?, targets}]}]}` | `PlanDetail`, 201. Ids are assigned by the server. A retried `requestId` returns the original. 409 `{code: 'PLAN_LIMIT'}` at 100 own plans. |
| `PUT` | `/plans/:id` | Same as `POST` minus `requestId`; workouts and exercises may carry the `id` they were given | `PlanDetail`. Replaces the whole plan. A sent `id` must already exist in that plan (else 400); items without one get new ids; items left out are removed. Shared plans → 404. |
| `POST` | `/plans/:id/copy` | `{requestId}` | `PlanDetail` of the new own plan, named `<name> (copy)` (trimmed to 80), new ids, `copiedFrom` set. Works on shared and own plans. 409 `PLAN_LIMIT`. |
| `DELETE` | `/plans/:id` | | `{id, deleted: true}`. Own plans only (shared → 404). Sessions are untouched. |

Validation (400, message names the field and limit) uses `validatePlan`: name 1–80, description
≤ 1000, 0–14 workouts, ≤ 30 exercises a workout, 1–20 targets an exercise, rest 0–900 s, targets
shaped by the exercise's measure (`reps` required for rep measures, `repsMax > reps`, `durationSeconds`
for `duration`, distance or time for `distance_duration`). `exerciseId` must be a shared exercise or
one of the caller's own (archived allowed).

## Sessions: changed

| Method | Path | Change |
|---|---|---|
| `POST` | `/sessions` | Body gains optional `{planId, planWorkoutId}` (both or neither). With them: the session gets `plan {planId, planWorkoutId, planName, workoutName}` and one workout exercise per planned exercise, in order, each with its server-built `snapshot` and `planned` copy. If a session is already open, it is returned with `resumed: true` and nothing is added; the client tells the person which workout is open. Unknown plan or workout id → 404. A planned workout with no exercises answers 400 `{code: 'EMPTY_WORKOUT'}` (spec edge case: it can be saved, not started). |
| `GET` | `/sessions/:id`, `/sessions/current` | `SessionDetail` gains `plan?`. Each `SessionExercise` gains `planned?: {restSeconds?, note?, targets: PlanTarget[]}`, `openTargets: PlanTarget[]` (derived, R5; `[]` when skipped or not from a plan) and `skipped: boolean`. `previous` is unchanged and is what the client pre-fills from. |
| `GET` | `/sessions` | `SessionListItem` gains `plan?: {planName, workoutName}`. |
| `PATCH` | `/sessions/:id/exercises/:weId` | Body gains `skipped?: boolean`. 400 when the exercise has no `planned` block. |
| `POST` | `/sessions/:id/finish` | Also deletes workout exercises with `planned` and no sets. Still 409 `EMPTY_SESSION` when no set was logged at all. |

## Sessions: new

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/sessions/:id/exercises/:weId/swap` | `{requestId, exerciseId, machineId?}` | `SessionExercise`: a new row at the same `order`, new snapshot, `planned` carried over when the measures match, else the same number of empty working targets for the new measure. The old row is deleted. 409 `{code: 'HAS_SETS'}` when the old row has logged sets; 409 on a finished session as for other writes. A retried `requestId` returns the new row. |

## Cross-module

- `CatalogueService.remove(userId, exerciseId)` also archives (rather than deletes) an own
  exercise referenced by any of the caller's own plans.
- No change to the dashboard summary, the Home card, Nutrition or Portal.
