# Feature Specification: Training — exercise catalogue and workout logging

**Feature Branch**: `020-training-logging`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Training module, phase 1: exercise & equipment catalogue and workout
logging. A new bounded module for strength/gym training, mirroring Food's shape. Catalogue of
exercises and equipment/machines seeded from an open dataset plus private user additions; logging
sessions with sets (reps, weight, rest, RPE, set type, bodyweight/assisted, timed, distance) whose
exercise details are frozen at log time; history and personal records computed on read with
labelled 1-rep-max estimates; a Home card and a detail page. Routines, ranks/levels, leaderboards,
sharing, programs and GPS are later phases. No burned-calorie figure reaches Food. Behind a
`training` flag, off in production."

## Context

Training is roadmap item 5 and the first half of the later **programs** feature (diet, training
or both). This phase is deliberately the foundation only: a catalogue to pick from, a fast way to
log what was done in the gym, and an honest history. Everything that motivates (ranks, levels,
streaks, leaderboards) and everything social comes in later phases and must be computable from
what this phase records.

The module has Food's shape on purpose:

| Food | Training |
|---|---|
| Food catalogue (plus Open Food Facts) | Exercise and equipment catalogue (plus an open dataset) |
| Logged meal with frozen facts | Logged set with frozen exercise details |
| Totals computed on read | Volume, best sets, estimated 1-rep max and records computed on read |

Later phases, for orientation only (not specified here): 2 routines (saved workouts), 3 strength
ranks and levels, 4 workout posts, shared routines and friend leaderboards, then programs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log a workout in the gym (Priority: P1)

A person walks into the gym, taps **Start workout** on the Home card, picks "Barbell bench press"
from the catalogue, and records each set as they finish it: 60 kg × 10 as a warm-up, then three
working sets of 80 kg × 8. The app shows what they did last time for this exercise beside the new
set, and starts a rest timer after each set. They add pull-ups (bodyweight) and a 10-minute row
(distance and time), then finish the workout. If the phone locks or the tab is closed mid-workout,
reopening the app returns them to the same unfinished session.

**Why this priority**: Logging is the module. Without it nothing else in training has data, and it
is already useful alone as a gym notebook.

**Independent Test**: With only this story built, a person can start, fill and finish a session,
and see it in their list of past workouts with every set as entered.

**Acceptance Scenarios**:

1. **Given** no workout in progress, **When** the person taps Start workout, **Then** an empty
   session opens with its start time and the day it belongs to.
2. **Given** a session in progress, **When** they add an exercise and log a set, **Then** the set
   is saved immediately (survives closing the app) and their previous result for that exercise is
   shown alongside.
3. **Given** a session in progress, **When** they open Home, **Then** the card's action reads
   **Resume workout** and returns to that session.
4. **Given** a logged set, **When** they correct its reps or weight, **Then** the set changes but
   the exercise details it was logged with do not.
5. **Given** a finished session, **When** they reopen it, **Then** they can still correct, add or
   delete sets and edit the notes.
6. **Given** a session with no sets, **When** they finish it, **Then** they are asked whether to
   discard it instead of saving an empty workout.

---

### User Story 2 - Find or add the right exercise or machine (Priority: P1)

The person searches "chest press" and sees the movement plus the machines it can be done on.
Their gym has a specific plate-loaded machine that is not in the catalogue, so they add it as a
private machine (name, brand, the movement it is used for, optional photo) and pick it. Next time
it appears in their results.

**Why this priority**: Logging is only fast if the exercise is found in seconds. A gym-specific
machine missing from the catalogue would otherwise block logging.

**Independent Test**: Search finds seeded exercises by name, alias, muscle group and equipment;
a newly created private exercise or machine is findable and loggable by its creator only.

**Acceptance Scenarios**:

1. **Given** the seeded catalogue, **When** the person searches by name, a common alternative
   name, a muscle group or an equipment type, **Then** matching exercises are listed, recently
   used ones first.
2. **Given** an exercise, **When** they open it, **Then** they see its primary and secondary
   muscles, equipment, instructions, images and the dataset's attribution where one is required.
3. **Given** a missing exercise or machine, **When** they create one, **Then** it is private to
   them, immediately usable in a workout, and marked as their own.
4. **Given** a private exercise that has been logged, **When** they delete it, **Then** it is
   archived: hidden from search, while past workouts keep its name.
5. **Given** another person's private exercise, **When** anyone else searches, **Then** it never
   appears.

---

### User Story 3 - See progress and personal records (Priority: P2)

On the training page, the person opens "Barbell squat" and sees every session they did it, the
best set each time, total volume, and an estimated 1-rep max labelled with how it was worked out
("est. 1RM 112 kg — from 5 × 100 kg, Epley formula"). When they beat a record during a workout,
the set is marked as a new personal record.

**Why this priority**: Progress is why people keep logging, and it is the base the later ranks
and levels are computed from. It needs logging (P1) first.

**Independent Test**: After logging a few sessions, history, best sets and records match a manual
calculation from the logged sets, and correcting or deleting an old set updates them.

**Acceptance Scenarios**:

1. **Given** logged sessions, **When** the person opens an exercise's history, **Then** they see
   each session's sets, the best set and the volume, newest first.
2. **Given** working sets with weight and reps, **When** history is shown, **Then** an estimated
   1-rep max is shown, labelled as an estimate with its formula and the set it came from.
3. **Given** a set that beats their previous best (heaviest weight, most reps at a weight,
   best estimated 1-rep max, longest distance or time, as fits the exercise), **When** it is
   logged, **Then** it is marked as a personal record in the session.
4. **Given** a record-setting set, **When** it is later corrected downward or deleted, **Then** the
   record falls back to the true best remaining set; nothing stale remains.
5. **Given** warm-up sets, **When** records and volume are calculated, **Then** warm-ups are
   excluded.

---

### User Story 4 - Training at a glance on Home (Priority: P2)

Home shows a Training card with at most three figures (workouts this week, time trained this week,
and the most recent personal record or days since the last workout) and one action: **Start
workout**, or **Resume workout** while one is open. Tapping the card opens the training page.

**Why this priority**: It is how the module fits the dashboard, but it is a view on data from
stories 1 and 3.

**Independent Test**: With the flag on, the card appears and its figures match the training page;
with it off, the card, page and all training routes are unavailable.

**Acceptance Scenarios**:

1. **Given** the `training` flag is on, **When** Home loads, **Then** the Training card can be
   added like other widgets and shows at most three figures and one action.
2. **Given** the flag is off for an account, **When** they try the page or any training route,
   **Then** it is unavailable, the same way other flagged modules behave.
3. **Given** a session in progress, **When** Home loads, **Then** the action is Resume workout.

---

### User Story 5 - Units and weights the way the person thinks (Priority: P3)

A person who trains in pounds sets their weight unit to lb. Every weight is shown and entered in
lb; switching back to kg shows the same lifts converted, without any stored number changing.
Bodyweight exercises use their latest weigh-in from Food where one exists, and assisted exercises
(assisted pull-up machine) record the assistance, so the effective load is the body weight minus it.

**Why this priority**: Correctness matters, but the default (kg) serves the current users.

**Acceptance Scenarios**:

1. **Given** weight unit lb, **When** they log 225 lb, **Then** it is stored once in grams and
   displays as 225 lb (and as about 102 kg if they switch).
2. **Given** a bodyweight exercise and a weigh-in on or before that day, **When** volume or an
   estimate needs a load, **Then** the body weight on that day is used and the figure says so.
3. **Given** no weigh-in, **When** a bodyweight set is shown, **Then** reps are shown and no
   load-based figure is invented.
4. **Given** an assisted set of 30 kg assistance and a 80 kg body weight, **Then** the effective
   load is 50 kg, labelled as derived from the weigh-in.

### Edge Cases

- Two devices open the same session: each set is its own row, so both devices' sets are kept;
  editing the same set twice keeps the last write.
- Starting a workout while one is already in progress resumes the open one instead of creating a
  second.
- A session left open for more than 12 hours is shown as "still open" with a choice to finish it
  at its last logged set's time or to discard it; it is never finished silently.
- A workout that starts at 23:30 and ends at 01:10 belongs to the day it started on, using the
  same day-start rule as meals (a 02:00 session before the day-start hour belongs to the previous
  day).
- Corrections to a catalogue exercise's name or equipment do not rename past sets (snapshot rule).
- An exercise measured by time or distance never shows weight or 1-rep max fields.
- Implausible input (negative numbers, 0 reps on a rep-based set, a single set over 1,000 kg or
  over 24 hours) is rejected with a clear message.
- The seeded catalogue is updated later: existing logged sets are unaffected; personal additions
  are never overwritten.
- Account deletion removes sessions, sets, private exercises and private machines with their photos.

## Requirements *(mandatory)*

### Functional Requirements

**Catalogue**

- **FR-001**: The system MUST provide a shared exercise catalogue, seeded from an open dataset,
  where each exercise has a name, alternative names, primary and secondary muscle groups, an
  equipment type, a measurement kind (weight × reps, bodyweight reps, assisted reps, time,
  distance, distance and time), instructions and optional images.
- **FR-002**: The system MUST provide equipment as its own entity: generic equipment types
  (barbell, dumbbell, cable, machine, kettlebell, band, bodyweight…) and specific machines (with
  optional brand and photo) linked to the exercises they are used for.
- **FR-003**: The seeded catalogue MUST only be imported from a dataset whose licence permits
  it, and MUST show the attribution the licence requires on every exercise taken from it.
- **FR-004**: Users MUST be able to create, edit and delete private exercises and private
  machines; these are visible to and usable by their creator only.
- **FR-005**: Deleting a private exercise or machine that has been logged MUST archive it
  (hidden from search, kept for history) instead of removing it.
- **FR-006**: Users MUST be able to search the catalogue by name, alternative name, muscle group
  and equipment, with their recently used exercises ranked first.
- **FR-007**: Shared catalogue entries MUST NOT be editable by ordinary users in this phase.

**Logging**

- **FR-008**: Users MUST be able to start a workout session, which records its start time and the
  day it belongs to; the day is decided on the person's device from the local clock and the Food
  profile's day-start hour, as for meals.
- **FR-009**: A person MUST have at most one session in progress; starting another resumes it.
- **FR-010**: Within a session users MUST be able to add exercises in order, reorder them, and log
  sets with the fields the exercise's measurement kind needs: reps, weight, assistance, duration,
  distance; plus optional RPE (1–10, halves allowed), set type (warm-up, working, drop, failure)
  and rest time.
- **FR-011**: Every set MUST be saved as soon as it is logged, so closing or reloading the app
  loses nothing.
- **FR-012**: Each logged exercise MUST freeze a snapshot of the exercise's name, equipment and
  measurement kind at the time it was added; later catalogue changes MUST NOT alter it, the
  snapshot MUST be built by the system (never accepted from the client), and the exercise
  reference of a logged exercise MUST NOT be editable.
- **FR-013**: Correcting a set MUST change only its own values (reps, weight, time, distance, RPE,
  type, rest), never its snapshot.
- **FR-014**: Users MUST be able to finish a session (recording its end time), add notes, and
  later edit, add to or delete sets and sessions.
- **FR-015**: The session MUST show, for each exercise, the person's sets from their previous
  session of that exercise, and offer a rest timer after a set is logged.
- **FR-016**: Stored quantities MUST be whole numbers in fixed units: weight and assistance in
  grams, distance in metres, duration in seconds. The kg/lb choice MUST be a display preference
  only; no converted value is ever stored.

**History and records**

- **FR-017**: Volume, best set, estimated 1-rep max, totals and personal records MUST be
  computed from logged sets when read, never stored, so corrections and deletions are reflected
  everywhere at once.
- **FR-018**: Every estimated 1-rep max MUST be shown as an estimate together with the formula
  and the set it was derived from. Estimates MUST only be made from sets of 1–12 reps.
- **FR-019**: Personal records MUST be determined per exercise and measurement kind (heaviest
  load, most reps at a load, best estimated 1-rep max, longest distance, longest time, fastest
  pace), excluding warm-up sets.
- **FR-020**: A load for a bodyweight or assisted set MUST come from the person's body weight on
  or before that day (from Food's weigh-ins) and be labelled as such; with no weigh-in, no
  load-based figure is shown.
- **FR-021**: Users MUST be able to see their list of past sessions and a per-exercise history.

**Dashboard, access and boundaries**

- **FR-022**: The Training widget MUST have a summary card with at most three figures and exactly
  one quick action (Start workout / Resume workout), plus a detail page.
- **FR-023**: Training MUST be behind a `training` feature flag, on by default for internal and
  developer cohorts and off for production, administered like existing flags.
- **FR-024**: All training data MUST be private to its owner; no other account, including the
  developer, can read another person's sessions, sets or private catalogue entries in this phase.
- **FR-025**: This phase MUST NOT produce any burned-energy figure, and MUST NOT change Food's
  targets or activity adjustment, which remain owned by Apple Health's Active Energy.
- **FR-026**: Training data MUST be included in what account deletion removes, and the module doc
  MUST list it.

### Key Entities

- **Exercise**: a movement in the catalogue (shared, or private to one person): names, muscles,
  equipment type, measurement kind, instructions, images, attribution, archived state.
- **Equipment**: a generic equipment type or a specific machine (shared or private), with optional
  brand and photo, linked to the exercises it serves.
- **Workout session**: one person's workout on one day: start, end (absent while in progress),
  notes.
- **Logged exercise**: an exercise within a session, in order, holding the frozen snapshot of the
  exercise's details and a reference to the catalogue entry.
- **Set**: one performed set of a logged exercise: type, reps, weight, assistance, duration,
  distance, RPE, rest, time logged. The event row everything else is computed from.
- **Training preferences**: the person's weight unit (kg/lb) and default rest time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A set can be logged in under 5 seconds after the previous one for the same exercise
  (pre-filled from the last set), one-handed on a phone.
- **SC-002**: A common exercise is found within 2 seconds of typing its first three letters, and
  the seeded catalogue covers at least 500 exercises.
- **SC-003**: No logged set is lost when the app is closed, reloaded or loses its connection
  mid-workout and reconnects.
- **SC-004**: Every personal record, volume and 1-rep max shown matches a manual calculation from
  the logged sets, including after an old set is corrected or deleted.
- **SC-005**: Every estimated figure on screen carries its basis; a test pass finds no unlabelled
  estimate.
- **SC-006**: With training in use, a person's Food targets and activity adjustment are identical
  to what they would be without it.
- **SC-007**: An account without the flag sees no training card, page or data, and its requests
  to training routes are refused.

## Assumptions

- The seed dataset is free-exercise-db, whose data is public domain (checked 2026-11-12; see
  research R1). Only its **facts** are imported (names, muscles, equipment, category, level):
  its images have unknown provenance and an open copyright dispute, and its instruction text has
  the same unknown source. So in this phase, shared catalogue exercises have **no images or
  instructions**; private exercises and machines can have both. Licensed pictures and
  instructions are a later addition.
- The estimated 1-rep max uses the Epley formula; the formula name is part of the label, so it can
  change later without misleading anyone.
- The kg/lb preference lives with the training module's preferences, not with the money display
  currency.
- Body weight comes from Food's existing weigh-ins; training reads it and never stores a copy.
- Offline support is limited to not losing what has been entered (retry with an idempotency key);
  full offline logging without a connection is out of scope.
- Suggestions of shared catalogue additions by users, and moderation of them, are out of scope.
- Routines, ranks and levels, streaks, leaderboards, sharing and posts, programs, GPS, heart rate,
  imported workouts from Apple Health and any calories-burned estimate are later phases.
