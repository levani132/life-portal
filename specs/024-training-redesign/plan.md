# Implementation Plan: Training — colourful redesign

**Branch**: `024-training-redesign` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

## Summary

Display-only redesign of `/training` (spec 024): a colour system for muscle groups and plans,
a header with the week's numbers, icon tabs, a start card, a workout-in-progress header with a
progress bar, coloured exercise cards and set chips, plan cards, History grouped by week, and
coloured muscle chips in Exercises. No API, schema or stored-data change; every request stays the
same.

## Technical Context

**Language/Version**: TypeScript, Next.js 16 App Router, React, Tailwind 3, SWR, lucide-react
**Storage**: none new
**Testing**: `npm run check`; UI-only changes need no unit tests (CLAUDE.md), so verification is
running every training scenario at 375px in light and dark themes
**Constraints**: both themes; 375px with no sideways scroll; tab swiping (`data-no-tab-swipe` on
sideways scrollers); `min-width: 0` default; inputs through `Input`/`Select`; no `animation`
shorthand where a delay utility is used; colour never the only meaning

## Constitution Check

- I Bounded module: only `apps/web` training files and global tokens. ✅
- II Integer units: unchanged; display formatting only. ✅
- III Derived never persisted: plan colours and week totals are computed for display. ✅
- IV Single-sourced links: none touched. ✅
- V Pure projections: none added (colour lookup is presentation, in `apps/web/src/lib`). ✅
- VI Estimates labelled: no estimates shown. ✅

## Design decisions

**Colour tokens.** Six training hues as CSS variables in `global.css`, in the light `:root`, the
`[data-theme='dark']` block and the `prefers-color-scheme: dark` block, exposed in
`tailwind.config.js` as `train-<hue>`:

| Group | Muscles | Hue |
|---|---|---|
| push | chest, shoulders | orange |
| pull | lats, middle_back, lower_back, traps, neck | blue |
| legs | quadriceps, hamstrings, glutes, calves, abductors, adductors | emerald |
| core | abdominals | amber |
| arms | biceps, triceps, forearms | violet |
| cardio | any `distance_duration` exercise | pink |

`train-<hue>` is for text and tints (a dark shade in the light theme, a light shade in the dark
theme, both ≥ 4.5:1 on the surface). `train-<hue>-solid` is for filled surfaces with white text,
the same 600/700 shade in both themes (≥ 4.5:1 with white). Gradients use solids only.

**Lookups** live in `apps/web/src/lib/training-colors.ts`: `muscleGroup(muscle)`,
`exerciseGroup(primaryMuscles, measure)` (first primary muscle wins; cardio by measure; neutral
otherwise), and `GROUP_STYLES` with literal Tailwind class strings (JIT needs literals). Plan
colour: ready-made plans by their position in the seed-ordered list (so the four are distinct and
stable on every device), own plans by a hash of their id; `usePlanStyle(id)` reads the cached
plan list so the plan page agrees with the card.

**Header** (`training-hero.tsx`): gradient card from `/training/summary?today=<workout day>`
(the same endpoint as the Home card): workouts this week, time this week, then the newest record
or days since the last workout, or an in-progress badge.

**Progress** in an open plan workout: sets logged on non-skipped planned exercises over their
planned sets (`planned.targets.length`), capped at 100%; hidden with no planned exercise.

**History weeks**: Monday-start week of each `session.day`, labelled This week / Last week /
`Week of 3 Nov`; totals summed from the loaded rows, so a week split across pages merges on
"Older workouts".

## Project Structure

```
apps/web/src/app/global.css                         train-* tokens (3 places)
apps/web/tailwind.config.js                         train-* colours
apps/web/src/lib/training-colors.ts                 groups, styles, plan style
apps/web/src/components/training/training-hero.tsx  header with the week
apps/web/src/app/training/page.tsx                  icon tabs, History by week
apps/web/src/components/training/workout-session.tsx start card, live header, exercise cards
apps/web/src/components/training/set-row.tsx         coloured set-type chips
apps/web/src/components/training/plan-suggestions.tsx next-workout cards
apps/web/src/components/training/plans.tsx           plan cards, plan header, lettered workouts
apps/web/src/components/training/exercise-library.tsx / exercise-picker.tsx  chips and tiles
```

## Complexity Tracking

None.
