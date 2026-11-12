# Implementation Plan: Training — exercise catalogue and workout logging

**Branch**: `020-training-logging` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/020-training-logging/spec.md`

## Summary

A new bounded module, `training`, with Food's shape: a catalogue (shared exercises seeded from
free-exercise-db facts, plus private exercises and machines), workout sessions whose exercises
freeze a snapshot at log time, one row per set, and everything about progress (volume, best set,
Epley 1-rep max with its basis, personal records, the card's weekly figures) computed on read by
pure functions in `libs/shared/domain`. It is a new `ModuleId`, so the existing access policy
makes it on for internal and developer accounts and off for production with no new flag code.
It reads body weight from Nutrition through one exported method and never touches Food's targets.

## Technical Context

**Language/Version**: TypeScript (strict), Node per repo.

**Primary Dependencies**: NestJS 11, Mongoose 9, class-validator; Next.js 16 App Router, SWR,
Tailwind. No new dependency.

**Storage**: MongoDB. New collections: `exercises`, `training_machines`, `training_profiles`,
`workout_sessions`, `workout_exercises`, `workout_sets` ([data-model.md](data-model.md)).
Catalogue data vendored as a facts-only JSON file in the API.

**Testing**: Jest. Domain unit tests in `libs/shared/domain/src/lib/training.spec.ts`; API
service specs beside the services.

**Target Platform**: The installed PWA on a phone (one hand, in the gym), plus desktop.

**Project Type**: Web application (Nx monorepo: `apps/api`, `apps/web`, `libs/shared/*`).

**Performance Goals**: Logging a set: the row appears instantly (optimistic) and is confirmed
in well under a second on Tier 0. Catalogue search answers in < 2 s on three letters (SC-002).

**Constraints**: Tier 0 (Atlas M0 512 MB: ~870 catalogue rows are a few hundred KB). Free-tier
deployable, no worker: the catalogue seeds itself at boot, idempotently. Every quantity an
integer in grams, metres or seconds. No `/api` caching in the service worker.

**Scale/Scope**: Per user, a few thousand sets a year; history and records scan one exercise's
sets through an index. One new route (`/training`), one Home card, ~20 endpoints.

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1 design (below).*

| Principle | How the design follows it |
|---|---|
| I. Widget = bounded module | `TrainingModule` owns its six collections, `/api/training` and `/training`. Home card: three figures, one quick action (Start/Resume workout). Other modules are touched only to register it: `MODULE_IDS`, the dashboard summary, the shared-widget exclusion, and one exported Nutrition read. |
| II. Integer units | Grams, metres, seconds as integers; lb is display-only, converted once on input. RPE is a 1–10 scale, not a quantity (see Complexity Tracking). |
| III. Derived never persisted | Volume, 1RM, records, durations, weekly figures, staleness all computed on read. The per-set `exerciseId` and the snapshot are immutable facts recorded at log time, as `meal_entries` does. |
| IV. Single-sourced links | Body weight is read from Nutrition's weigh-ins, never copied. Burned energy stays owned by Apple Health; training emits none. |
| V. Pure projections | All maths in `libs/shared/domain/src/lib/training.ts`, `today` explicit. |
| VI. Estimates labelled | Every 1RM carries `{formula, fromSetId, weightGrams, reps, bodyWeightDay?}`; bodyweight loads say which weigh-in they used. |
| Auth and scoping | Global guard plus `@RequireModule('training')`; private rows filtered by `userId`; shared rows readable by all, writable by the seed only. Training is not shareable. |
| Docs | `docs/modules/training.md`, DECISIONS, CHANGELOG and the module list in CLAUDE.md, in the same change. |

**Result: PASS**, with two justified items in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/020-training-logging/
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
libs/shared/types/src/lib/training.ts         # constants (muscles, equipment, measures, set types), DTO shapes
libs/shared/types/src/lib/portal.ts           # + 'training' in MODULE_IDS and MODULES
libs/shared/domain/src/lib/training.ts        # pure: setFieldsFor, loads, Epley, records, summaries, units, catalogue mapping
libs/shared/domain/src/lib/training.spec.ts

apps/api/src/training/
├── training.module.ts                        # controller under @RequireModule('training')
├── training.schemas.ts                       # six schemas and their indexes
├── training.dto.ts
├── catalogue.service.ts                      # search, own exercises/machines, archive-on-delete
├── catalogue.seeder.ts                       # onModuleInit: upsert shared rows by seedKey when seedVersion is behind
├── catalogue/free-exercise-db.json           # vendored, facts only (no images, no instructions)
├── sessions.service.ts                       # sessions, workout exercises, sets, snapshots, retries
├── progress.service.ts                       # loads sets and weigh-ins, calls the domain lib
└── *.spec.ts
apps/api/src/access/access.module.ts          # UpdateAccessDto gains `training`
apps/api/src/nutrition/nutrition.service.ts   # + weighInsUpTo(userId, day), exported
apps/api/src/dashboard/dashboard.service.ts   # + training summary
apps/api/src/social/shared-widgets.service.ts # training never shareable
apps/api/src/app/app.module.ts                # import TrainingModule

apps/web/src/app/training/page.tsx            # tabs: Workout · History · Exercises
apps/web/src/components/training/
├── workout-session.tsx                       # current session, add exercise, set rows, rest timer
├── set-row.tsx                               # fields from setFieldsFor(measure), pre-filled from last set
├── exercise-picker.tsx                       # search, filters, recent first, create private
├── exercise-history.tsx                      # history, records, labelled 1RM
├── machine-form.tsx / exercise-form.tsx      # private additions, photo via MediaModule
└── training-card.tsx                         # Home summary card
apps/web/src/lib/training-queue.ts            # in-memory retry queue keyed by requestId

docs/modules/training.md                      # new module doc
```

**Structure Decision**: the existing Nx layout. One new API module and one new web route,
following `nutrition`'s split of a catalogue service and an event-row service.

## Phase 0: Research

Done: [research.md](research.md). Highlights:

- **R1 Seed licence.** free-exercise-db JSON is Unlicense; its images (and by the same
  reasoning its instruction prose) have unknown provenance and an open copyright issue. Seed
  **facts only**. This narrows FR-001 for **shared** rows: they have no images or instructions in
  this phase; private rows have both. The spec's Assumptions are updated to say so.
- **R3 Epley**, 1–12 reps, label carries the basis.
- **R5 One open session** enforced by a partial unique index on `status: 'open'`.
- **R6 One row per set**, so two devices never overwrite each other.
- **R7 `requestId` on every create**, plus a client retry queue, for gym signal.

## Phase 1: Design

- [data-model.md](data-model.md): six collections, field rules per measure, indexes, derived
  functions.
- [contracts/api.md](contracts/api.md): `/api/training` routes and the four cross-module touch
  points.
- [quickstart.md](quickstart.md): ten manual scenarios plus the automated coverage.

### Implementation notes worth knowing before tasks

- **The catalogue seeder runs at boot**, not in `npm run seed`, because production needs it and
  the free tier has no job runner. It bulk-upserts by `seedKey` only when the stored
  `seedVersion` is behind the file's, so a normal boot does one count query. It never touches
  rows with a `userId`.
- **The vendored JSON is stripped at vendoring time** (only id, name, force, level, mechanic,
  equipment, muscles, category), so uncertain prose and images never enter the repository.
- **New module, existing users:** the first Portal read froze each account's module selection,
  so `training` is not auto-selected for existing accounts. They add it from Home's widget
  controls. This matches every module released so far.
- **Snapshot rule, second instance:** the server builds `workout_exercises.snapshot`; DTOs have
  no field for it and no `exerciseId` on PATCH. Add a CLAUDE.md "trip you up" line beside the
  meal one.
- **Upsert-with-defaults:** `training_profiles` seeds only the fields the caller did not send
  (the `$set`/`$setOnInsert` trap).
- **Shared rows and `OwnedCrudService`:** catalogue reads need `$or` with the shared rows, so
  `CatalogueService` does not extend it and writes its filters explicitly; the doc says why.
- **Rest timer** is client-side only (a countdown from the last set's `loggedAt`); nothing about
  it is stored except an optional `restSeconds` the person enters or accepts.
- **Mobile layout:** set rows use `Input` with `inputMode="decimal"` for weight (the
  comma-decimal fix) and `numeric` for reps; nothing inside the session scrolls sideways
  without `data-no-tab-swipe`.

### Constitution re-check (post-design)

Still **PASS**. The design added no dependency. It adds six collections, each justified in
the module doc (catalogue, machines, preferences, and the three-level session/exercise/set
event structure required by concurrent devices and per-exercise history).

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| `workout_sessions.status` stored alongside `endedAt` | A partial unique index enforces one open session under races (FR-009) | Mongo cannot build a partial index on a field being absent; checking in code alone loses to a double tap from two devices |
| `rpe` as a decimal (step 0.5) | RPE is a perceived-effort scale, not a measured quantity | Storing ×2 integers would be a unit nobody reads; principle II covers quantities (money, nutrition, weight) |
| Shared catalogue rows without `userId` | One catalogue for everyone, ~870 rows | Copying the catalogue into every account multiplies storage on M0 and makes catalogue fixes impossible |
