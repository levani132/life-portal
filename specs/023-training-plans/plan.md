# Implementation Plan: Training — workout plans

**Branch**: `023-training-plans` (work lands on `main`) | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/023-training-plans/spec.md`

## Summary

Phase 2 of training, inside the existing `training` module and flag. A new `training_plans`
collection holds ready-made plans (shared rows seeded at boot from a vendored `plans.json`,
checked against the exercise catalogue) and each person's own plans, one document per plan with
workouts, exercises and target sets embedded. Starting a plan's workout creates the usual session
plus one workout exercise per planned exercise, each carrying a frozen copy of its targets
(`planned`), the same way a logged exercise freezes its snapshot. Which suggestions are still open,
what they pre-fill with, when each workout was last done and which is next are all derived on read
by pure functions. Starting an empty workout is unchanged.

## Technical Context

**Language/Version**: TypeScript (strict), Node per repo.

**Primary Dependencies**: NestJS 11, Mongoose 9, class-validator; Next.js 16 App Router, SWR,
Tailwind. No new dependency.

**Storage**: MongoDB. New collection `training_plans`; additive optional fields on
`workout_sessions` (`plan`) and `workout_exercises` (`planned`, `skipped`)
([data-model.md](data-model.md)). Ready-made plans vendored as
`apps/api/src/training/catalogue/plans.json`.

**Testing**: Jest. Domain tests in `libs/shared/domain/src/lib/training-plans.spec.ts`; seeder and
service specs beside the services.

**Target Platform**: The installed PWA on a phone in the gym, plus desktop.

**Project Type**: Web application (Nx monorepo: `apps/api`, `apps/web`, `libs/shared/*`).

**Performance Goals**: Starting a plan's workout is one request that writes at most 31 rows
(session + ≤ 30 exercises) and answers in well under a second on Tier 0. Logging a suggested set
is the existing set endpoint (1 tap, optimistic).

**Constraints**: Tier 0 (Atlas M0). Four shared plans are a few KB; 100 own plans per account at
worst a few MB. Seeding at boot, idempotent, one count query on a normal boot. Integers in grams,
metres and seconds. No `/api` caching in the service worker.

**Scale/Scope**: ~10 new or changed endpoints, one new tab (Plans) with list, detail and editor,
suggestion rows in the existing session view. Home card, Food, Portal untouched.

No NEEDS CLARIFICATION remain; the spec's open points are decided in [research.md](research.md).

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1 design (below).*

| Principle | How the design follows it |
|---|---|
| I. Widget = bounded module | Everything lives in `TrainingModule` (`/api/training/plans`, the `/training` route). One new collection in its family. The Home card is unchanged (three figures, one action). |
| II. Integer units | Targets are whole grams, metres, seconds and reps, the same fields as a set; lb stays display-only. |
| III. Derived never persisted | Open suggestions (`targets.slice(logged)`), pre-fill, last done, next workout and recently used plans are computed on read. `plan` on a session and `planned` on a workout exercise are frozen copies (see Complexity Tracking), not derived figures. |
| IV. Single-sourced links | A plan references exercises by id; names, measures and equipment come from the catalogue on read. Progress comes from sessions; nothing is counted twice. |
| V. Pure projections | `openTargets`, `prefillFor`, `planProgress`, `recentPlanIds`, `describeTarget`, `validatePlan` in `libs/shared/domain/src/lib/training-plans.ts`, `today` explicit. |
| VI. Estimates labelled | No new estimate. Suggestions are labelled as targets ("Plan: 3 × 6–8") and pre-fill says where it came from ("last time" or "plan"). |
| Auth and scoping | Global guard plus `@RequireModule('training')`. Own plans filtered by `userId`; shared plans readable by all, writable by the seeder only; writes to a shared or foreign plan answer 404. Plans are not shareable in this phase. |
| Docs | `docs/modules/training.md` (schema, endpoints, formulas), DECISIONS, CHANGELOG and ROADMAP in the same change. |

**Result: PASS**, with three justified items in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/023-training-plans/
├── spec.md
├── plan.md            # this file
├── research.md        # decisions R1–R11
├── data-model.md
├── quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md           # /speckit-tasks
```

### Source Code

```text
libs/shared/types/src/lib/training.ts            # + PlanTarget, PlanListItem, PlanDetail, PlanInput; SessionDetail/SessionExercise/SessionListItem gain plan fields
libs/shared/domain/src/lib/training-plans.ts     # new, pure: openTargets, prefillFor, planProgress, recentPlanIds, describeTarget, validatePlan(Target)
libs/shared/domain/src/lib/training-plans.spec.ts
libs/shared/domain/src/index.ts                  # export it

apps/api/src/training/
├── training.schemas.ts                          # + TrainingPlan schema and indexes; WorkoutSession.plan; WorkoutExercise.planned/skipped
├── training.dto.ts                              # + plan DTOs; StartSessionDto planId/planWorkoutId; skipped; SwapExerciseDto
├── training.module.ts                           # + /plans routes, /swap route, PlanSeeder, PlansService
├── plans.service.ts                             # new: list, detail with progress, create/replace/copy/delete, suggested
├── plan.seeder.ts                               # new: onModuleInit after the catalogue seeder; upsert by seedKey/seedVersion; archive dropped plans
├── catalogue/plans.json                         # new: the four ready-made plans (research R11)
├── sessions.service.ts                          # start from a plan, openTargets in detail, skip, swap, finish drops unlogged planned rows
├── catalogue.service.ts                         # remove(): archive when an own plan references the exercise
└── *.spec.ts

apps/web/src/app/training/page.tsx               # tabs: Workout · Plans · History · Exercises
apps/web/src/components/training/
├── plans-list.tsx                               # new: shared and own plans, last done, next
├── plan-detail.tsx                              # new: workouts with targets, Start, Copy, Edit, Delete
├── plan-editor.tsx                              # new: name, workouts, exercises (picker), targets per measure, reorder
├── workout-session.tsx                          # plan label, suggestion rows, skip, swap, rest from planned
├── suggestion-row.tsx                           # new: pre-filled, one-tap log, tap to edit
└── workout-start.tsx (or in workout-session)    # recently used plans with "Start next" beside Start empty workout
apps/web/src/lib/training.ts                     # plan SWR keys, describeTarget re-export

docs/modules/training.md                         # plans section
```

**Structure Decision**: the existing Nx layout and the existing `training` module; plans get their
own service and seeder beside the catalogue's, mirroring how Food keeps foods and meals apart.

## Phase 0: Research

Done: [research.md](research.md). Highlights:

- **R1** One embedded document per plan; whole-plan writes, last write wins.
- **R2** Stable workout and exercise ids inside a plan so progress survives edits and re-seeds.
- **R3** Ready-made plans seeded at boot from `plans.json`, verified against the catalogue by a
  test and by the seeder itself.
- **R4/R5** Targets copied onto the session at start (`planned`); open suggestions are the targets
  not yet consumed by logged sets, by position.
- **R6** Pre-fill from last time's set at the same position (else its last set), else the target.
- **R7** Skip is a flag; swap replaces an unlogged row; finish drops unlogged planned rows.
- **R8** Last done, next workout and recently used plans derived from sessions.
- **R11** The four ready-made plans, all exercises present in the vendored catalogue.

## Phase 1: Design

- [data-model.md](data-model.md): `training_plans`, the two session additions, indexes, limits,
  the pure functions.
- [contracts/api.md](contracts/api.md): `/plans` routes, changed and new session routes.
- [quickstart.md](quickstart.md): twelve manual scenarios plus the automated coverage.

### Implementation notes worth knowing before tasks

- **Seeder order.** `PlanSeeder` must run after `CatalogueSeeder` has upserted exercises, since it
  resolves `fedb:` seed keys to exercise ids. Call it from the catalogue seeder's `onModuleInit`
  (or await a shared promise) rather than relying on provider order.
- **Shared plans and `OwnedCrudService`.** As with the catalogue, reads need `$or` with rows
  without `userId`, so `PlansService` writes its filters explicitly; writes always add
  `userId` to the filter.
- **Snapshot rule, third instance.** `planned` is server-built from the plan; no DTO has a field
  for it, and `PATCH` only accepts `skipped`. Add it to the CLAUDE.md "trip you up" line about
  workout exercises.
- **Start is one request.** Creating the session and its planned exercises must not leave a
  half-started workout on a retry: exercise rows get `requestId`s derived from the session's
  (`<requestId>:<planExerciseId>`), so a retried start finds the rows instead of duplicating them.
- **Open session.** `POST /sessions` with a plan while another is open returns the open one with
  `resumed: true`; the web shows "Push is in progress" and opens it.
- **Pre-fill on the client.** The session view calls `prefillFor` with `previous` from the
  existing detail response; nothing new is fetched per row.
- **Mobile.** Suggestion rows reuse the set row's `Input` fields (comma decimals, 16px). The editor's
  reorder uses up/down buttons, not drag, to keep tab swiping intact.

### Constitution re-check (post-design)

Still **PASS**. No new dependency, one new collection in the training family, no change outside
`training` except the docs. The copies (`plan`, `planned`) are justified below and follow the
existing snapshot rule.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| `workout_exercises.planned` copies the plan's targets | FR-011/SC-004: a started workout must not change when its plan is edited or deleted; same reason as `snapshot` and `meal_entries.facts` | Reading the plan live lets an edit rewrite a workout in progress and loses the suggestions when a plan is deleted |
| `workout_sessions.plan` stores plan and workout names | History must still say "Push · Push / Pull / Legs" after the plan is renamed or deleted | Resolving names from the plan on read shows nothing for deleted plans and the new name for renamed ones |
| Shared plan rows without `userId` | One library for everyone, seeded and fixed centrally, like the catalogue | Copying four plans into every account makes fixing a plan impossible and every account a migration |
