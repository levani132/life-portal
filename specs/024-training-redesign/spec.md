# Feature Specification: Training — colourful redesign

**Feature Branch**: `024-training-redesign`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Now start redesigning, make sure it is more colorful and has
everything in the training module much more appealing." Training phase 3 on the roadmap
("training UI overhaul"), after spec 020 (logging) and spec 023 (plans).

## Context

Training works end to end, but every screen is the same grey card with grey text: the Workout
tab is an empty box with two buttons, plans are text lists, the active workout is a column of
identical panels, History is a plain list and Exercises is a search box with a list. Nothing
tells a push day from a leg day at a glance, nothing celebrates progress, and the screens look
unlike a training app. Food, by contrast, has rings and colour.

This phase changes how Training looks and feels, not what it does. Every flow from specs 020 and
023 keeps working the same way, through the same requests.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Training page that feels alive (Priority: P1)

Opening Training shows a colourful header with this week at a glance (workouts, time, days since
the last one or the newest record), tabs with icons, and a Workout tab that invites starting:
a large start card, and the next workout of each recently used plan as colourful cards.

**Why this priority**: it is the first thing seen every time and the entry to every flow.

**Independent Test**: With a few workouts logged and a plan used, open Training at phone width
in light and dark themes: the header shows the week's numbers, tabs show icons and the selected
one is clearly coloured, and Start / Next-from-plans are one tap as before.

**Acceptance Scenarios**:

1. **Given** no workout this week, **When** Training opens, **Then** the header shows 0 workouts
   with an encouraging line, not an empty grey box.
2. **Given** a workout in progress, **When** Training opens, **Then** the header makes it obvious
   and the Workout tab shows it.
3. **Given** the light theme, **When** any training screen shows, **Then** all coloured text keeps
   readable contrast (no pale text on white).

---

### User Story 2 - A workout in progress that is easy to follow (Priority: P1)

The open workout shows a coloured header with the plan and workout name, the running time and a
progress bar of sets done against planned. Each exercise card carries the colour of its muscle
group, a coloured icon tile and its muscle names; set types (warm-up, working, drop, failure) are
coloured chips; logged sets are marked done; the next suggested set stands out.

**Why this priority**: it is where people spend their time in the app.

**Independent Test**: Start Push from a plan, log sets, skip and swap: everything works as before,
and at a glance the chest exercises are one colour, shoulders another, triceps a third.

**Acceptance Scenarios**:

1. **Given** a plan workout with planned sets, **When** sets are logged, **Then** the progress bar
   fills by sets done over sets planned (skipped exercises left out).
2. **Given** an empty workout, **When** it is open, **Then** there is no progress bar, only the
   running time and set count.
3. **Given** a finished workout opened from History, **When** it shows, **Then** it uses the same
   colours and stays editable as before.

---

### User Story 3 - Plans, History and Exercises that are pleasant to browse (Priority: P2)

Plans are colourful cards, each plan with its own colour and icon, showing workouts and the next
workout; a plan's page has a coloured header and lettered workout cards (A, B, C). History groups
workouts by week with the week's totals and a coloured date block per workout. Exercises shows
coloured muscle filter chips and rows with a coloured tile by muscle group.

**Why this priority**: browsing is less frequent than logging, but it is what makes the module
feel finished.

**Independent Test**: Browse every tab at phone width in both themes; every action from specs 020
and 023 (copy, edit, delete, start, load older workouts, filter, create an exercise) still works.

**Acceptance Scenarios**:

1. **Given** the four ready-made plans, **When** Plans shows, **Then** each has a distinct colour.
2. **Given** workouts across three weeks, **When** History shows, **Then** they are grouped under
   "This week", "Last week" and a dated week, each with workouts, sets and time.
3. **Given** a muscle chip is tapped in Exercises, **When** the list filters, **Then** the chip is
   shown selected in its muscle group's colour.

### Edge Cases

- A plan with no workouts, or a workout with no exercises: cards still render, with a muted state.
- An exercise with no primary muscle, or a muscle outside the groups: a neutral colour.
- Very long plan, workout or exercise names: truncated, never widening the page at 375px.
- Many weeks of History: grouping works across "Older workouts" pages, a week split across two
  pages stays one group.
- Reduced motion: progress and highlights do not animate.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Training MUST use a consistent colour system: each muscle group (push, pull, legs,
  core, arms) has one colour, used for exercise tiles, exercise cards and muscle chips.
- **FR-002**: Every colour MUST be defined for both light and dark themes with readable contrast
  for text; colour MUST never be the only carrier of meaning (labels stay).
- **FR-003**: The Training header MUST show this week's workouts and time and either the newest
  record or days since the last workout, from the existing summary.
- **FR-004**: The tabs MUST show an icon and a label; the selected tab MUST be clearly coloured.
- **FR-005**: The Workout tab with nothing open MUST offer Start empty workout and the plans'
  next workouts as cards; Choose a plan remains.
- **FR-006**: An open plan workout MUST show progress as sets logged over sets planned, excluding
  skipped exercises; the elapsed time stays.
- **FR-007**: Exercise cards MUST carry their muscle group colour, an icon tile and muscle names;
  set type chips MUST be coloured by type with their label.
- **FR-008**: Each plan MUST have a stable colour (the same on every visit and device) and an icon.
- **FR-009**: History MUST group workouts by Monday-start week with totals per week.
- **FR-010**: Exercises MUST offer muscle filters as coloured chips that scroll sideways without
  triggering the tab swipe.
- **FR-011**: Every existing training action MUST keep working through the same API requests; no
  API, schema or stored data changes.
- **FR-012**: Nothing may be wider than a 375px screen; tap targets stay at least 40px.

### Key Entities

None new. Colours are derived for display from existing fields: an exercise's primary muscles and
a plan's id.

## Success Criteria *(mandatory)*

- **SC-001**: At 375px, in light and dark themes, no training screen scrolls sideways.
- **SC-002**: Every scenario in `specs/020-training-logging/quickstart.md` and
  `specs/023-training-plans/quickstart.md` that has a screen still passes.
- **SC-003**: Starting a workout and logging a suggested set still takes the same number of taps.
- **SC-004**: Coloured text meets 4.5:1 contrast against its background in both themes.

## Assumptions

- No new data: colours come from muscles and plan ids; History week totals are summed from the
  sessions already loaded.
- No illustrations or photos are added; colour, gradients and lucide icons carry the look.
- The Home card and other modules are unchanged.
