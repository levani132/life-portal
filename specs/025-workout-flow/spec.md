# Feature Specification: Training — workout flow (duplicate days, focus, rest, supersets)

**Feature Branch**: `025-workout-flow` (built on main)

**Created**: 2026-11-12

**Status**: Built

**Input**: User request: duplicate a workout inside a plan (PPL → PPPPL); a pinned bar showing the
open workout everywhere; make done vs current exercises obvious (collapse finished ones, green,
expandable to add sets); change the rest per exercise, and replace the timer's Hide; supersets.

## User stories

### US1 — Duplicate a workout in a plan (P1)

In the plan editor each workout has a Duplicate button that inserts a copy right after it, named
`<name> (2)` (or the next free number), with every exercise, target, rest, note and superset. The
copy has no ids, so the server gives it new ones; past sessions keep pointing at the original.

*Test*: edit an own PPL plan, duplicate Push and Pull, save: the plan has five workouts and Start
works on each copy.

### US2 — Rest per exercise, and better timer controls (P1)

Every exercise card in an open workout shows `Rest m:ss` (this workout's choice, else the plan's,
else the profile default). Tapping it offers presets and a typed value, "Also save to <plan>"
when the workout came from one of the person's own plans, and "Go back to the plan's / your
default". The rest timer offers −15s, +15s and Skip (Hide is gone: what it meant was "I'm ready").

*Test*: change Bench's rest to 2:00, log a set: the timer counts from 2:00. +15s makes 2:15.
Skip removes it. With "Also save to plan", the plan shows the new rest.

### US3 — Done and current exercises (P1)

In an open workout:
- **Done** exercises (all planned sets logged; or, with no plan, logged and moved on from) turn
  green with a check and collapse to one line summarising their sets. Tapping expands one to look
  or add sets; it stays open until collapsed.
- The **current** exercise has a ring and a "Now" label: the next member of a superset round,
  else the exercise of the last set while it is not done, else the first that is neither done nor
  skipped.

### US4 — A pinned workout bar (P2)

While a workout is open, a slim bar sits under the app header on every page: the current exercise,
the plan workout's name, time since start, and the rest countdown while resting. It hides on the
Training page's Workout tab. Tapping it opens the workout (switching tabs if on Training).

### US5 — Supersets (P2)

Exercises next to each other can be linked into a superset (A1, A2, …) in the plan editor and
during a workout ("Superset with next" / "Unlink" between cards). Sets are still logged per
exercise, so history, records and 1RM are unchanged. After a set in a superset, "Now" moves to the
next member without a rest; after the last member, the rest is the last member's, and it goes
round again until the superset is done.

## Requirements

- FR-001 Superset membership is a key on plan exercises and workout exercises; only neighbours
  with the same key form a superset. Keys are `[A-Za-z0-9_-]{1,40}`, opaque.
- FR-002 Starting from a plan copies the superset key onto the workout exercise; it may then be
  changed by PATCH (`superset: string | null`). A swap keeps it.
- FR-003 `workout_exercises.restSeconds` (0–900) is this workout's choice, set by PATCH
  (`null` clears). `planned` stays frozen. A swap keeps it.
- FR-004 Done, current and rest-after-set are derived in `libs/shared/domain` (`workoutFocus`,
  `restAfter`), never stored.
- FR-005 The timer's ±15 s and Skip apply to the current rest only and live in memory.
- FR-006 The bar reads `GET /training/sessions/current`; no new endpoint.

## Out of scope

- A notification when rest ends, and a live/ongoing notification (not possible for a PWA; a rest
  notification through web push is a possible follow-up).
