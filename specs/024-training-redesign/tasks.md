# Tasks: Training — colourful redesign (spec 024)

Display-only; no tests are required for UI-only changes (CLAUDE.md). Each story is verified at
375px in both themes.

## Phase 1: Foundation

- [X] T001 Add `--train-<hue>` (themed, three places) and `--train-<hue>-solid` tokens to `apps/web/src/app/global.css` and the `train-*` colours to `apps/web/tailwind.config.js`
- [X] T002 `apps/web/src/lib/training-colors.ts`: `muscleGroup`, `exerciseGroup`, `GROUP_STYLES` (literal classes, label, lucide icon), `planStyle(index | id)` and `usePlanStyle(id)`

## Phase 2: User Story 1 — a Training page that feels alive (P1)

- [X] T003 [US1] `components/training/training-hero.tsx`: gradient header with this week's workouts and time, newest record or days since last, in-progress badge; used in `app/training/page.tsx` in place of the plain subtitle
- [X] T004 [US1] Icon tabs in `app/training/page.tsx` (Dumbbell, ClipboardList, History, Library) with a coloured selected tab
- [X] T005 [US1] Workout tab with nothing open (`workout-session.tsx`): start card with a large Start empty workout and Choose a plan; `plan-suggestions.tsx` as plan-coloured cards with the plan icon

## Phase 3: User Story 2 — a workout in progress (P1)

- [X] T006 [US2] Open-workout header in `workout-session.tsx`: plan-coloured gradient, workout · plan name, live time, sets count and the planned-sets progress bar
- [X] T007 [US2] Exercise cards: muscle-group accent, icon tile and muscle names; next suggestion highlighted in `suggestion-row.tsx`
- [X] T008 [US2] Set-type chips coloured by type in `set-row.tsx` (warm-up amber, working accent, drop violet, failure rose), labels kept

## Phase 4: User Story 3 — browsing (P2)

- [X] T009 [US3] `plans.tsx`: plan cards with colour, icon, counts and next workout; plan page gradient header; workouts lettered A, B, C with the Next badge
- [X] T010 [US3] History in `app/training/page.tsx` grouped by Monday-start week with totals; a coloured date block per workout
- [X] T011 [US3] Exercises (`exercise-library.tsx`, `exercise-picker.tsx`): muscle filter chips in group colours in a sideways scroller marked `data-no-tab-swipe`; rows with a coloured icon tile

## Phase 5: Polish

- [X] T012 Run `npm run check`; at 375px in light and dark: every tab, start from plan, log, skip, swap, finish, History week groups, plan copy/edit, exercise filter; no sideways scroll
- [X] T013 Docs: `docs/modules/training.md` (Web section: colour system), `docs/CHANGELOG.md`, `docs/ROADMAP.md` phase 3, progress here

## Progress

- 2026-11-12: all tasks done. Checked at 375px in light and dark with demo data: hero, icon tabs,
  start card and plan cards; an open plan workout (gradient header, progress bar, coloured
  exercise cards, set chips, one-tap logging); Plans list (four distinct colours) and a plan page
  (lettered workouts, Next badge); History grouped into This week / Last week with totals;
  Exercises chip filter (Chest selected in its colour). No screen scrolls sideways. Exercise rows
  moved the measure under the name, because pills beside it cut names to a few letters at 375px.
  Plan exercises have no muscles in `PlanExerciseDetail`, so they are numbered in the plan's
  colour rather than coloured by muscle; adding muscles would be an API change, out of scope.

