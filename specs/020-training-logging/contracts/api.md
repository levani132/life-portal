# API contract: `/api/training` (spec 020)

Every route: authenticated, `@RequireModule('training')`, scoped to the caller,
`Cache-Control: private, no-store`. Write bodies are `class-validator` DTOs; unknown fields are
rejected. Ids that are malformed or not the caller's answer 404. Types live in
`libs/shared/types/src/lib/training.ts`. Weights in requests and responses are always grams;
the unit preference is applied by the web client.

## Summary and profile

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/summary` | `?today=` | `TrainingSummary {workoutsThisWeek, secondsThisWeek, latestRecord?: {exerciseName, kind, value, day}, daysSinceLast?, openSessionId?}`. Used by `DashboardService`. |
| `GET` | `/profile` | | `TrainingProfile {weightUnit, defaultRestSeconds}` (upserted). |
| `PUT` | `/profile` | `{weightUnit?, defaultRestSeconds?}` | `TrainingProfile` |

## Catalogue

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/exercises` | `?q=&muscle=&equipment=&limit=30&skip=` | `ExerciseListItem[]`: shared + own, not archived. With `q`, prefix matches first, then contains; within each, exercises the caller used in the last 90 days first. |
| `GET` | `/exercises/:id` | | `Exercise` incl. `isOwn`, `attribution?`, `image.url?` (signed). Archived own rows are readable (history). |
| `POST` | `/exercises` | `{name, aliases?, primaryMuscles, secondaryMuscles?, equipmentType, measure, instructions?, imageMediaId?}` | `Exercise` (private). |
| `PATCH` | `/exercises/:id` | same fields, optional; `removeImage?` | `Exercise`. Own rows only (shared → 404). `measure` change on a logged exercise → 409. |
| `DELETE` | `/exercises/:id` | | `{id, deleted: true}` or `{id, archived: true}` when logged. |
| `GET` | `/exercises/:id/history` | `?before=<loggedAt cursor>` | `ExerciseHistory {exercise, sessions: [{sessionId, day, sets, bestSetId?, volumeGrams?, oneRepMax?: Estimate}], records: RecordSet, nextCursor?}`; 20 sessions a page. Records are computed over all of the caller's sets of this exercise. |
| `GET` | `/machines` | `?exerciseId=` | `Machine[]` (own, not archived). |
| `POST` / `PATCH` / `DELETE` | `/machines`, `/machines/:id` | `{name, brand?, equipmentType, exerciseIds?, imageMediaId?, removeImage?}` | `Machine` / archive-or-delete like exercises. |

`Estimate` is always `{valueGrams, basis: {formula: 'epley', fromSetId, weightGrams, reps, bodyWeightDay?}}`.

## Sessions

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `POST` | `/sessions` | `{requestId, day}` | `SessionDetail`. If an open session exists, it is returned with `resumed: true` (200), not a second one. |
| `GET` | `/sessions/current` | | `SessionDetail` or `204` when none is open. |
| `GET` | `/sessions` | `?cursor=` | `{sessions: SessionListItem[], nextCursor?}`, 20 a page, newest day first. |
| `GET` | `/sessions/:id` | | `SessionDetail`: session, `exercises[]` in order, each with its `sets[]`, `previous?` (the caller's sets of that exercise from their most recent earlier session), per-set `records: RecordKind[]`, `oneRepMax?`, derived `durationSeconds`, `isStale`. |
| `PATCH` | `/sessions/:id` | `{day?, notes?}` | `SessionDetail` |
| `POST` | `/sessions/:id/finish` | `{at?: 'now' \| 'lastSet'}` | `SessionDetail`. 409 `{code: 'EMPTY_SESSION'}` when it has no sets. |
| `DELETE` | `/sessions/:id` | | Deletes the session with its exercises and sets. |

### Exercises and sets in a session

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/sessions/:id/exercises` | `{requestId, exerciseId, machineId?}` | `SessionExercise` (snapshot built by the server). |
| `PATCH` | `/sessions/:id/exercises/:weId` | `{notes?, machineId?}` | `SessionExercise`. A machine change updates the snapshot's machine name only. `exerciseId` is not accepted. |
| `POST` | `/sessions/:id/exercises/order` | `{ids: string[]}` | full array, as `boards`/`cheat` do. |
| `DELETE` | `/sessions/:id/exercises/:weId` | | Deletes it and its sets. |
| `POST` | `/sessions/:id/exercises/:weId/sets` | `{requestId, type?, reps?, weightGrams?, assistGrams?, durationSeconds?, distanceMeters?, rpe?, restSeconds?}` | `{set, records: RecordKind[]}`. Fields checked against `setFieldsFor(measure)`; a retried `requestId` returns the original. |
| `PATCH` | `/sets/:setId` | same fields except `requestId` | `{set, records}` |
| `DELETE` | `/sets/:setId` | | `{id, deleted: true}` |

Validation errors are 400 with a message naming the field and the limit (spec edge cases).

## Cross-module

- `NutritionService.weighInsUpTo(userId, day)` (new, exported by `NutritionModule`): weigh-ins
  on or before `day`, ascending, `{day, weightGrams}` only.
- `DashboardService` calls `TrainingService.summary(userId, today)` when the account has
  `training` and the module is selected.
- `SharedWidgetsService`: `training` is **never shareable** in this phase (filtered like `epam`).
- `MediaModule`: `imageMediaId` claims a finished upload of the caller's, exactly as foods do.
