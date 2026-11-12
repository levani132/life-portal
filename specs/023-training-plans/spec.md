# Feature Specification: Training — workout plans

**Feature Branch**: `023-training-plans`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Training phase 2: workout plans (routines). Ready-made plans
everyone can use, own plans anyone can create, edit, copy and delete, starting a workout from a
plan with its exercises and target sets as suggestions (log, skip, swap, add or remove on the go),
starting an empty workout exactly as now, pre-fill from last time's performance, plan progress with
the next workout suggested. Logged sessions never change when a plan changes. UI overhaul is the
next phase; ranks, sharing, paid programs, auto-progression and calendar scheduling are later.
Same `training` flag, same units, Food unchanged."

## Context

Phase 1 (spec 020) lets a person log any workout from scratch and look back at it. What it lacks is
the thing most people bring to the gym: a plan. Phase 2 adds plans without taking anything away:
an empty workout still starts in one tap and still grows as you go.

A **plan** is a named set of **workouts** (for example "Push", "Pull", "Legs"). A **workout** in a
plan is an ordered list of exercises, each with **target sets**: how many sets, and what each set
aims for (reps or a rep range, an optional weight, or a time or distance, depending on how the
exercise is measured), plus a rest time.

There are two kinds of plan:

| Ready-made plans | Own plans |
|---|---|
| Written by us, the same for everyone | Private to the person who made them |
| Read-only; can be copied to customise | Created from scratch or copied from any plan |
| Use shared catalogue exercises only | Use shared or the person's own exercises |

A plan is a **template**. Starting one copies its targets into the workout as suggestions, the
same way a logged set freezes its exercise (spec 020's snapshot rule). After that, the workout and
the plan are independent: editing or deleting the plan never changes a workout already started or
logged.

Phases from here: 3 **training UI overhaul** (agreed as next), then strength ranks and levels,
workout posts and friend leaderboards, then programs (paid last).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Train from a ready-made plan (Priority: P1)

A person who does not know what to do in the gym opens Training, browses the ready-made plans,
picks "Push / Pull / Legs", opens its "Push" workout and taps Start. The workout opens with bench
press, overhead press, incline dumbbell press, lateral raises and triceps pushdowns already listed,
each with its planned sets shown as suggestions ("3 × 8–12, rest 2:00"). Logging a suggested set
is one tap when they did what it says, or a quick edit when they did not. They skip lateral raises,
swap the incline press for a machine they prefer, add a set of dips at the end, and finish. History
shows what they actually did, under the name "Push · Push / Pull / Legs".

**Why this priority**: This is the core value of the phase: a person can train with a plan without
building one. It is a usable product on its own, even before anyone can write their own plans.

**Independent Test**: With only the built-in plans present, start a plan workout, log some of its
suggested sets, skip one exercise, swap one, add one, and finish. The logged session contains
exactly what was done, and nothing that was skipped.

**Acceptance Scenarios**:

1. **Given** no workout is open, **When** the person opens a ready-made plan's workout and taps
   Start, **Then** a workout opens listing that workout's exercises in order, each with its planned
   sets shown as unlogged suggestions with their targets and rest time.
2. **Given** a suggestion "8–12 reps" for an exercise they did last week at 60 kg × 10, **When** the
   workout opens, **Then** the suggestion is pre-filled with 60 kg and 10 reps, and one tap logs it.
3. **Given** an exercise they have never done, **When** the workout opens, **Then** the suggestion
   is pre-filled from the plan's target (the low end of a rep range, the planned weight if any) and
   the weight is left empty when the plan has none.
4. **Given** a planned exercise, **When** they skip it (or simply never log its sets) and finish,
   **Then** the logged session has no row for it and no record or volume counts it.
5. **Given** a planned exercise, **When** they swap it for another exercise, **Then** the new
   exercise takes its place with the same planned sets, and the swap does not change the plan.
6. **Given** a plan workout in progress, **When** they add an exercise or a set the plan does not
   have, **Then** it is logged like any other set.
7. **Given** a workout is already open, **When** they tap Start on a plan workout, **Then** they are
   taken to the open workout instead of a second one being created (one open workout per person),
   and told so.
8. **Given** a plan workout was started on one device, **When** the person reloads or opens the
   workout on another device, **Then** the same suggestions are shown with the same targets.

---

### User Story 2 - Make and edit my own plans (Priority: P2)

A person who already has a routine creates "My 4-day split" with four workouts, adds exercises to
each from the catalogue or their own exercises, sets 4 × 6–8 with 2:30 rest for the main lifts and
3 × 12 for accessories, and reorders things until it reads right. Another person copies the
ready-made "Upper / Lower" plan, renames it, replaces two exercises and adds a fifth set to squats.
Either can start their own plan exactly like a ready-made one.

**Why this priority**: People with a routine need it in the app, and copying a ready-made plan is
the quickest way to a personal one. It depends on nothing from US1 except starting a plan, which
US1 provides.

**Independent Test**: Create a plan with two workouts and several exercises, edit targets, reorder
exercises and workouts, copy a ready-made plan and change it, delete a plan; then start one of the
own plans and see its targets as suggestions.

**Acceptance Scenarios**:

1. **Given** the plans list, **When** the person creates a plan, names it and adds workouts and
   exercises with target sets, **Then** it appears under their plans and nobody else can see it.
2. **Given** any plan (ready-made or own), **When** they copy it, **Then** an own plan with the same
   workouts, exercises and targets is created, named "<name> (copy)", and changing the copy never
   changes the original.
3. **Given** an own plan, **When** they reorder workouts or exercises, change a set's target, add or
   remove sets, or rename anything, **Then** the change is saved and the next start uses it.
4. **Given** an own plan with a logged session started from it, **When** they edit or delete the
   plan, **Then** the logged session is unchanged and still shows the plan and workout names it
   was started with.
5. **Given** a ready-made plan, **When** they try to change or delete it, **Then** they cannot; the
   only change offered is to copy it.
6. **Given** a target for an exercise measured by time or distance, **When** they set it, **Then**
   the target is a time or a distance (not reps or weight), following how the exercise is measured.
7. **Given** an own exercise used in one of their plans, **When** they delete that exercise, **Then**
   the plan keeps it (it is archived, not removed) and it can still be started.

---

### User Story 3 - Know which workout is next (Priority: P3)

A person following "Push / Pull / Legs" opens the plan. Each workout shows when it was last done
("Push · 3 days ago", "Pull · yesterday", "Legs · not yet"), and "Legs" is marked as next. On the
Workout tab, next to "Start empty workout", the plans they used recently offer their next workout,
so starting today's session is one tap.

**Why this priority**: It turns a plan into a routine, but the plan is already useful without it.

**Independent Test**: Log workouts from a plan out of order, then check each workout's "last done"
and which one is marked next; check the Workout tab offers that next workout.

**Acceptance Scenarios**:

1. **Given** a plan whose workouts were done on known days, **When** the plan is opened, **Then**
   each workout shows its last done day relative to today, or "not yet".
2. **Given** the most recent workout done from a plan was its workout N, **When** the plan is
   shown, **Then** workout N + 1 is marked next, wrapping to the first after the last; with none
   done, the first is next.
3. **Given** the person used plans in the last 28 days, **When** they open the Workout tab with no
   workout open, **Then** it offers "Start empty workout" and, for up to three of those plans
   (most recently used first), a start for each plan's next workout.
4. **Given** a session started from a plan and then deleted, **When** progress is shown, **Then**
   the deleted session no longer counts.

---

### Edge Cases

- **Plan edited while its workout is open.** The open workout keeps the targets it started with;
  the edit applies to the next start.
- **Plan deleted while its workout is open.** The workout carries on and finishes normally; its
  plan and workout names stay as they were at start.
- **Ready-made plan updated by us** (new catalogue version). People's copies and their logged
  sessions are unaffected; progress for the ready-made plan carries on if the workout still exists,
  and a workout we removed simply no longer appears.
- **An exercise in a ready-made plan is missing from the catalogue** (renamed or removed in a
  catalogue update). The plan update that ships with it must not reference it; the seed refuses a
  plan that names an exercise it cannot find, rather than shipping a broken plan.
- **Swapping to an exercise measured differently** (bench press → plank). The planned sets cannot
  carry over meaningfully, so the swapped exercise starts with the same number of empty sets for
  its own measure.
- **A plan with no workouts, or a workout with no exercises.** It can be saved while being built,
  but it cannot be started; Start explains why.
- **Pre-fill when last time had fewer sets than planned.** Extra planned sets repeat the last set
  of last time; when last time had more, the extra are not suggested.
- **Bodyweight and assisted exercises in a plan.** The target is reps (plus optional added weight
  or assistance), and pre-fill follows the same rules; effective load still needs a weigh-in
  (spec 020).
- **Same exercise twice in one workout** (for example a heavy and a light block). Allowed; each
  appears separately with its own targets.
- **Starting a plan workout late at night.** The workout's day follows the existing day-start rule
  (spec 020), not the plan.
- **Flag off.** Plans, like everything in Training, are hidden and refused for accounts without
  the `training` feature.

## Requirements *(mandatory)*

### Functional Requirements

**Ready-made plans**

- **FR-001**: The system MUST provide at least four ready-made plans: a full-body plan, an upper /
  lower plan, a push / pull / legs plan and a bodyweight plan needing no equipment, each with a
  short description, its workouts, and for each workout its exercises, target sets and rest.
- **FR-002**: Ready-made plans MUST be our own content, built only from shared catalogue exercises,
  and MUST NOT reproduce any published program by name or structure.
- **FR-003**: Ready-made plans MUST be the same for every person, read-only, and updatable by us
  in a new version without affecting copies or logged sessions.

**Own plans**

- **FR-004**: Every person with Training MUST be able to create, rename, describe, edit and delete
  their own plans, and to add, remove, rename and reorder a plan's workouts and each workout's
  exercises.
- **FR-005**: Own plans MUST be visible only to the person who made them.
- **FR-006**: People MUST be able to copy any plan they can see (ready-made or own) into a new own
  plan, which is then fully independent of the original.
- **FR-007**: An own plan MUST be able to use shared exercises and the person's own exercises.
  Deleting an own exercise that a plan uses MUST archive it, as deleting a logged one does.
- **FR-008**: A planned exercise MUST have 1–20 target sets and a rest time; each target set MUST
  fit the exercise's measure: reps as an exact number or a range (min ≤ max) with an optional
  weight for weight × reps; reps with optional added weight for bodyweight; reps with optional
  assistance for assisted; a time (optional weight) for timed; a distance and/or time for distance
  exercises. Target sets MAY be marked as warm-ups.
- **FR-009**: Limits: a plan name and a workout name up to 80 characters, a description up to 1000,
  at most 14 workouts per plan, 30 exercises per workout, 100 own plans per person.

**Starting and logging**

- **FR-010**: Starting a plan's workout MUST open a workout containing the plan workout's exercises,
  in order, each with its target sets as **suggestions**: shown in the workout, not yet logged, and
  not counted in any history, volume or record until logged.
- **FR-011**: The suggestions MUST be fixed at start: later changes to the plan, or its deletion,
  MUST NOT change an open or logged workout. They MUST survive a reload and appear on another
  device.
- **FR-012**: Each suggestion MUST be pre-filled from the person's own last performance of that
  exercise where one exists (the set in the same position, else the last set of that time), and
  from the plan's target otherwise (low end of a range; the planned weight, time or distance if
  given; empty if not).
- **FR-013**: Logging a suggestion as it stands MUST take one action; changing its values first
  MUST be possible. A logged suggestion becomes an ordinary set (spec 020 rules: validation,
  snapshot, records).
- **FR-014**: During the workout, the person MUST be able to skip a planned exercise, swap it for
  another exercise (keeping its planned sets where the measure is the same), remove it, add
  exercises and add sets beyond the plan, without any of it changing the plan.
- **FR-015**: A workout started from a plan MUST record the plan and workout it came from, with
  their names as they were at start, and show them in the workout and in history.
- **FR-016**: Finishing MUST keep only what was logged; unlogged suggestions are discarded and a
  workout with nothing logged follows spec 020's rule (it cannot be finished; it can be discarded).
- **FR-017**: Starting an empty workout and adding exercises on the go MUST work exactly as in
  spec 020. One open workout per person still applies to plan starts.

**Progress**

- **FR-018**: A plan MUST show, for each of its workouts, the day it was last done by the person
  (from their logged, not deleted, sessions started from it), relative to today, or "not yet".
- **FR-019**: A plan MUST mark its next workout: the one after the workout most recently done from
  it, in plan order, wrapping around; the first when none has been done.
- **FR-020**: With no workout open, the Workout tab MUST offer an empty workout and the next workout
  of up to three plans the person used in the last 28 days, most recently used first.
- **FR-021**: All progress figures MUST be computed from logged sessions when shown, never stored.

**Boundaries**

- **FR-022**: Plans MUST be behind the `training` feature like the rest of Training, MUST NOT be
  shareable or shown on a profile in this phase, and MUST NOT add any burned-energy figure or change
  anything in Food.
- **FR-023**: Units follow spec 020: weights in whole grams, distance in metres, time in seconds,
  shown and typed in the person's kg/lb setting.

### Key Entities

- **Plan**: a named, optionally described collection of workouts. Either ready-made (shared,
  versioned, read-only) or own (belongs to one person). Records where a copy came from, for
  reference only.
- **Plan workout**: one workout within a plan (for example "Push"), with a name and a position.
- **Planned exercise**: an exercise (shared or own) within a plan workout, with a position, a rest
  time, an optional note, and its target sets.
- **Target set**: what one set aims for, shaped by the exercise's measure (reps or range, optional
  weight, assistance, time, distance), and whether it is a warm-up.
- **Workout started from a plan** (an existing workout session, extended): records the plan and plan
  workout it came from with their names at start, and carries its suggestions: the planned
  exercises and target sets as they were at start, until logged or discarded.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From the plans list, a person can start a ready-made plan's workout and log its first
  suggested set in at most 4 taps.
- **SC-002**: When a person repeats what a suggestion says, logging that set takes 1 tap.
- **SC-003**: A person can build a 3-workout plan with 5 exercises each in under 10 minutes, and copy
  and adjust a ready-made plan in under 3 minutes.
- **SC-004**: Editing or deleting a plan changes 0 already logged sessions, and 0 open ones
  (verified by comparing a logged session before and after).
- **SC-005**: Unlogged suggestions add 0 to volume, records, the weekly count or the Home card.
- **SC-006**: An empty workout still starts in 1 tap from the Workout tab, as in spec 020.
- **SC-007**: Food's targets and activity adjustment are identical before and after training from a
  plan, and accounts without the `training` feature see no plans and are refused plan requests.

## Assumptions

- **No "active plan" setting.** Which plan a person follows is inferred from what they recently
  started (FR-020); choosing an active plan, weekly schedules and calendar days are later work.
- **The Home card is unchanged in this phase.** Its one action stays Start / Resume workout; making
  it start the next plan workout belongs with the UI overhaul (phase 3).
- **No automatic progression.** Suggestions repeat last time's numbers or the plan's targets; they
  never increase weights on their own.
- **Ready-made plans are few and plain** (four to six), written for general fitness, and not
  medical or coaching advice. More plans, levels and goals come later with programs.
- **Rest time** in a plan feeds the existing rest timer for that exercise instead of the profile's
  default.
- **Copying records its source for reference** only; there is no syncing between a copy and its
  original, and no notice when a ready-made plan changes.
- **Phase 3 (UI overhaul) will restyle these screens**, so this phase favours clear, functional
  screens over polish, consistent with the existing Training pages.
- Depends on spec 020 (catalogue, sessions, sets, snapshot rule, one open session, day-start rule,
  units, `training` flag) and changes none of its rules.
