# Data model: Training (spec 020)

Units throughout: weight and assistance in whole **grams**, distance in whole **metres**,
durations in whole **seconds**. Optional numeric fields have **no default** (CLAUDE.md: never
`default: 0` on an optional field). Every collection uses `baseSchemaOptions` (`id` out,
timestamps). Calendar days are `YYYY-MM-DD` strings; instants are `Date`.

## Shared constants (`libs/shared/types/src/lib/training.ts`)

- `MUSCLES`: abdominals, abductors, adductors, biceps, calves, chest, forearms, glutes,
  hamstrings, lats, lower_back, middle_back, neck, quadriceps, shoulders, traps, triceps
  (the dataset's 17).
- `EQUIPMENT_TYPES`: see research R10.
- `MEASURES`: `weight_reps`, `bodyweight_reps`, `assisted_reps`, `duration`, `distance_duration`.
- `SET_TYPES`: `warmup`, `working`, `drop`, `failure`.
- `WEIGHT_UNITS`: `kg`, `lb`.

## `exercises`

The catalogue: shared rows (no `userId`) and private rows (with `userId`).

| Field | Type | Rules |
|---|---|---|
| `userId` | ObjectId? | Absent = shared catalogue row. Present = private to that user. |
| `name` | string | 1–120, trimmed. |
| `aliases` | string[] | ≤ 10, each ≤ 120. Search matches them. |
| `primaryMuscles` | Muscle[] | ≥ 1. |
| `secondaryMuscles` | Muscle[] | |
| `equipmentType` | EquipmentType | |
| `measure` | Measure | Not editable once the exercise has been logged. |
| `mechanic` | `compound` \| `isolation`? | From the dataset where known. |
| `level` | `beginner` \| `intermediate` \| `expert`? | |
| `instructions` | string[]? | Private rows only in this phase (R1). ≤ 20 × 500. |
| `image` | `{key, width, height}`? | Private rows only, via `imageMediaId`. `key` never leaves the API. |
| `seedKey` | string? | Shared rows: `fedb:<dataset id>`. Unique (partial, where present). |
| `seedVersion` | number? | Shared rows: the catalogue version that wrote it. |
| `archived` | boolean | Default false. Deleting a logged private exercise archives it. |

Indexes: `{seedKey: 1}` unique partial (exists); `{userId: 1, archived: 1, name: 1}`;
text-free search: a normalised `searchName` (lower-case, accents folded, punctuation removed)
holding name + aliases, indexed `{searchName: 1}`, queried by prefix and contains.

Access rule (no `OwnedCrudService.scoped()` fit): **every read uses
`{$or: [{userId: {$exists: false}}, {userId}], archived: false}`** (plus `archived` for history
lookups by id). Writes only ever touch `{_id, userId}`. Shared rows are written by the seed
alone.

## `training_machines`

| Field | Type | Rules |
|---|---|---|
| `userId` | ObjectId | Required (private in this phase). |
| `name` | string | 1–120. |
| `brand` | string? | ≤ 80. |
| `equipmentType` | EquipmentType | Usually `machine`, `cable` or `smith_machine`. |
| `exerciseIds` | ObjectId[] | ≤ 20; each must be readable by the user. |
| `image` | `{key, width, height}`? | Via `imageMediaId`. |
| `archived` | boolean | Deleting a logged machine archives it. |

Index `{userId: 1, archived: 1, name: 1}`, `{userId: 1, exerciseIds: 1}`.

## `training_profiles`

One row per user, upserted on first read.

| Field | Type | Default |
|---|---|---|
| `userId` | ObjectId | unique |
| `weightUnit` | `kg` \| `lb` | `kg` |
| `defaultRestSeconds` | int 0–900 | 90 |

## `workout_sessions`

| Field | Type | Rules |
|---|---|---|
| `userId` | ObjectId | |
| `requestId` | UUID | Unique `(userId, requestId)`. |
| `day` | day string | From the browser (dayStartHour). Editable. |
| `status` | `open` \| `finished` | Partial unique `{userId}` where `open` (R5). |
| `startedAt` | Date | Set by the server at creation. |
| `endedAt` | Date? | Set on finish; ≥ `startedAt`. Required when `finished`. |
| `notes` | string? | ≤ 2000. |

Index `{userId: 1, day: -1, startedAt: -1}` for the list.

State transitions: `open` → `finished` (finish, with `endedAt` = now or the last set's
`loggedAt`); `finished` sessions stay editable. Deleting a session deletes its workout
exercises and sets. A session finished with no sets is refused with 409 and the client offers
discard (spec story 1, scenario 6).

Derived on read (never stored): `durationSeconds`, `isStale` (open and the last activity more
than 12 h ago), set and exercise counts, volume, PR flags.

## `workout_exercises`

An exercise within a session.

| Field | Type | Rules |
|---|---|---|
| `userId` | ObjectId | |
| `sessionId` | ObjectId | Must be the user's session. |
| `requestId` | UUID | Unique `(userId, requestId)`. |
| `order` | int | Position in the session. Reorder by full id array. |
| `exerciseId` | ObjectId | **Not editable.** |
| `machineId` | ObjectId? | Optional; must be the user's. |
| `snapshot` | object | **Built by the server**, never accepted from a request, never refreshed on PATCH: `{name, equipmentType, measure, primaryMuscles, machineName?, machineBrand?}`. |
| `notes` | string? | ≤ 500. |

Index `{sessionId: 1, order: 1}`, `{userId: 1, exerciseId: 1, createdAt: -1}`.

## `workout_sets`

The event row. Everything shown about progress is computed from these.

| Field | Type | Rules |
|---|---|---|
| `userId` | ObjectId | |
| `sessionId` | ObjectId | |
| `workoutExerciseId` | ObjectId | |
| `exerciseId` | ObjectId | Copied from the workout exercise at creation (an immutable reference, for history queries). |
| `requestId` | UUID | Unique `(userId, requestId)`. |
| `order` | int | Within the workout exercise. |
| `type` | SetType | Default `working`. |
| `reps` | int 1–1000? | Required for the `*_reps` measures. |
| `weightGrams` | int 0–1 000 000? | `weight_reps` (required), `bodyweight_reps` (added load), `duration` (optional). |
| `assistGrams` | int 1–500 000? | `assisted_reps` only, required. |
| `durationSeconds` | int 1–86 400? | `duration` (required), `distance_duration` (required). |
| `distanceMeters` | int 1–1 000 000? | `distance_duration`, required. |
| `rpe` | number 1–10, step 0.5? | A scale, not a quantity, so a decimal is fine. |
| `restSeconds` | int 0–3600? | |
| `loggedAt` | Date | Server time at creation. |

Which fields are allowed and required is decided by `setFieldsFor(measure)` in the domain lib,
so the DTO validation, the form and the tests share one table. Fields that do not apply are
rejected, not ignored.

Indexes: `{workoutExerciseId: 1, order: 1}`; `{userId: 1, exerciseId: 1, loggedAt: -1}`
(history, previous session, records); `{userId: 1, sessionId: 1}`.

## Derived values (pure, `libs/shared/domain/src/lib/training.ts`)

- `setFieldsFor(measure)`: allowed and required set fields.
- `effectiveLoadGrams(set, measure, bodyGrams?)`: `weight_reps` → weight;
  `bodyweight_reps` → body + added; `assisted_reps` → body − assistance (floored at 0);
  `undefined` when body weight is needed and unknown. Carries a `basis` (`recorded` or
  `weigh-in <day>`).
- `estimateOneRepMax(loadGrams, reps)`: Epley, 1–12 reps, else `undefined` (R3).
- `setVolumeGrams(set, load)`: load × reps; `undefined` without a load.
- `bodyWeightOn(weighIns, day)`: latest on or before `day`.
- `personalRecords(sets)`: given one exercise's sets in time order, returns the record-setting
  set ids per kind (heaviest load, best estimated 1RM, most reps at a load, longest duration,
  longest distance, fastest pace) and the current best of each; warm-ups excluded.
- `sessionSummary(session, sets)`: duration, set count, volume.
- `weekSummary(sessions, records, today)`: the card's three figures (R11).
- `gramsToDisplay` / `displayToGrams(value, unit)`: lb conversion, rounded once to whole grams.
- `catalogueMeasure(entry)`: the dataset category mapping (R2).
