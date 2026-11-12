# Research: Training — exercise catalogue and workout logging

Decisions taken while planning spec 020. Each one is a choice the spec left open.

## R1. Seed dataset and its licence

**Decision**: Seed the shared catalogue from **free-exercise-db** (yuhonas/free-exercise-db),
importing **facts only**: name, primary and secondary muscles, equipment, category, force,
mechanic, level. **No images and no instruction text** are imported.

**Rationale**:
- The JSON is released under the Unlicense (public domain), confirmed from the repository's
  LICENSE.md on 2026-11-12. It has ~870 exercises, which meets SC-002 (≥ 500).
- Its **images are not safe to reuse.** The README states no licence for them, the upstream
  (wrkout/exercises.json) names no source, and issue #13 ("images has copyright?") is open, with
  a 2026 claim that some come from ExRx.net. The maintainer has suggested replacing them with
  placeholders. The upstream also sells a separate "commercial" dataset, which suggests the free
  images are not offered for commercial use.
- **Instruction text has the same unknown provenance** as the images. Facts (an exercise's name,
  which muscles it works, what equipment it uses) are not creative expression; prose instructions
  are. Leaving them out removes the risk at little cost, since most people logging a set already
  know the movement.
- Attribution is not required by the Unlicense, but the module credits the dataset anyway, on the
  Exercises screen, because it costs nothing and helps if the provenance is ever questioned.

**Alternatives considered**:
- *wger*: data is CC-BY-SA (3.0 for the initial data, per-entry licences after that), and some
  images come from Wikipedia with their own licences. Usable with per-row attribution, but
  share-alike on a seeded closed-source catalogue is a legal question, and every row needs its
  own licence check. Kept as a later source for **images only**, each shown unmodified with its
  author and licence, if the owner wants pictures.
- *ExerciseDB / paid APIs*: good GIFs, but a paid licence and terms that usually forbid storing
  the media. Not for Tier 0.
- *Write the catalogue by hand*: too slow for ≥ 500 exercises.

**Follow-up (not in this phase)**: exercise pictures and instructions, either licensed images
from wger with attribution, our own illustrations, or text written for us.

## R2. Measurement kinds

**Decision**: Every exercise has exactly one `measure`:

| Measure | Fields a set uses | Example |
|---|---|---|
| `weight_reps` | weight, reps | Bench press |
| `bodyweight_reps` | reps, optional added weight | Pull-up, dip |
| `assisted_reps` | reps, assistance | Assisted pull-up machine |
| `duration` | seconds, optional weight | Plank, farmer's carry for time |
| `distance_duration` | metres, seconds | Rowing, running |

The dataset's categories map as: `strength`, `powerlifting`, `olympic weightlifting`,
`strongman` → `weight_reps` (or `bodyweight_reps` when equipment is `body only`); `cardio` →
`distance_duration`; `stretching` and `plyometrics` → `duration` and `bodyweight_reps`. The
mapping is a pure, tested function, and the owner can correct individual rows by bumping the
seed version.

**Rationale**: fields are known per exercise, so the set form shows only what applies, and
records and estimates know what "better" means (FR-019).

## R3. Estimated 1-rep max

**Decision**: **Epley**, `1RM = w × (1 + r / 30)`, with `r = 1` giving `w` itself. Only from
non-warm-up sets of 1–12 reps with a load. The result is in whole grams, rounded once. The
label carries `{formula: 'epley', fromSetId, weightGrams, reps}`.

**Rationale**: the most widely used formula; accuracy falls off sharply above ~10–12 reps, so
higher-rep sets produce no estimate rather than a misleading one. The formula is part of the
label (principle 6), so changing it later misleads nobody.

**Alternatives**: Brzycki (diverges badly above 10 reps), an average of several (harder to
explain in one line).

## R4. Body weight for bodyweight and assisted sets

**Decision**: Training asks Nutrition for the person's body weight **on or before** a day
through a new exported method, `NutritionService.weighInsUpTo(userId, day)` (latest weigh-in
on or before each needed day; one query per request, ascending). Training never queries
`weigh_ins` itself and never stores a body weight on a set.

**Rationale**: principle 4: the weigh-in has one owner. The effective load is computed on read,
so a corrected weigh-in corrects every bodyweight figure (FR-020).

## R5. One open session per person

**Decision**: `workout_sessions.status` is `open` or `finished`, with a **partial unique index**
on `{userId}` where `status: 'open'`. `POST /sessions` returns the existing open session instead
of creating a second one.

**Rationale**: the database enforces FR-009 even under a double tap from two devices; a
duplicate-key race is caught and answered with the existing session. `endedAt`'s absence would
say the same thing, but Mongo cannot build a partial index on a field being absent (the same
limit noted in the posts doc). See Complexity Tracking in the plan.

## R6. Sets as their own rows

**Decision**: three collections: `workout_sessions`, `workout_exercises` (an exercise within
a session, holding the snapshot) and `workout_sets` (one row per set). Not one document with
embedded arrays.

**Rationale**:
- Two devices logging into one session must not overwrite each other (spec edge case). One row
  per set makes every write independent.
- Per-exercise history and records query sets by `(userId, exerciseId)` across sessions, which
  an index on rows serves directly.
- Mirrors `meal_entries`.

## R7. Retry safety

**Decision**: every create (session, workout exercise, set) carries a client `requestId` UUID,
unique per `(userId, requestId)`. A retry returns the original row. The web client keeps a
queue of unsent writes in memory and retries them when the connection returns (SC-003).

**Rationale**: the gym has bad signal. This is the same pattern posts and comments use. Full
offline logging (IndexedDB, conflict merging) is out of scope.

## R8. Timestamps vs calendar days

**Decision**: a session's `day` is a `YYYY-MM-DD` string chosen by the browser (local clock and
`dayStartHour`), exactly like meals. `startedAt`, `endedAt` and a set's `loggedAt` are real
`Date` instants, because durations and rest times need them.

**Rationale**: the "dates are strings" rule is about calendar days. A start time is an instant,
and "time trained this week" needs one.

## R9. Weight unit preference

**Decision**: a `training_profiles` row per user with `weightUnit: 'kg' | 'lb'` (default `kg`)
and `defaultRestSeconds` (default 90). Upserted on first read, seeding only the fields the
caller did not send (the `$set`/`$setOnInsert` trap in CLAUDE.md). Conversion uses
1 lb = 453.59237 g, only at the render edge, and lb input is converted to whole grams once.

**Rationale**: like `displayCurrency`, a rendering preference. Kept in the training module so
Food's profile does not grow a field it does not use.

## R10. Machines

**Decision**: generic equipment types are a fixed list in shared types (`barbell`, `dumbbell`,
`kettlebell`, `cable`, `machine`, `smith_machine`, `band`, `bodyweight`, `ez_bar`, `trap_bar`,
`plate`, `medicine_ball`, `exercise_ball`, `foam_roll`, `other`). Specific machines are rows in
`training_machines`, **private to their creator in this phase**, with name, optional brand,
equipment type, optional photo (through `MediaModule`, like a food photo) and the exercise ids
they serve. A workout exercise may name the machine used; the snapshot keeps its name.

**Rationale**: the dataset knows only generic equipment. Shared, brand-specific machines need
contribution and moderation, which the spec puts out of scope.

## R11. Dashboard summary and the Health boundary

**Decision**: the card shows **workouts this week**, **time trained this week** and either the
**latest personal record** (within 14 days) or **days since the last workout**. The week is
Monday-based in the person's days. No energy figure anywhere (FR-025).

**Rationale**: three numbers that change after every workout and need no estimate. Burned energy
stays with Apple Health's Active Energy until a later phase decides who owns it when Health is
not connected.
