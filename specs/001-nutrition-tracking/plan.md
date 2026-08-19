# Implementation Plan: Food & Nutrition Tracking

**Branch**: `001-nutrition-tracking` | **Date**: 2026-08-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-nutrition-tracking/spec.md`

## Summary

A ninth widget: log food per day against calorie and macro targets derived from the owner's
body metrics and goal, with a prioritised cheat-day queue. One Nest module owning six
collections, one pure-domain file holding every formula, one Next.js route plus a log-food
modal shared with the dashboard card, and one new dashboard card carrying the widget's single
quick-add action.

The shape follows the existing widgets exactly: a single-file module in the style of
`apps/api/src/items/items.module.ts`, contracts in `libs/shared/types`, every formula in
`libs/shared/domain` with `today` passed in explicitly, and an external provider that
degrades to manual entry the way `FinnhubProvider` does.

Three decisions carry the design and are recorded in [research.md](./research.md): nutrition
facts are canonically **per 100 base units** as integers, a meal entry **freezes the facts it
was logged with**, and amounts stay in the food's **own base unit** (g or ml) rather than
being forced to grams.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20

**Primary Dependencies**: NestJS 11, Mongoose 9, Next.js 16 (App Router), SWR, Tailwind,
Recharts (already present, used for the weight trend). **No new runtime dependency** — the
cheat-queue reordering uses native HTML5 drag events plus keyboard-accessible move buttons
rather than a drag library.

**Storage**: MongoDB Atlas / local Mongo. Six new collections, all owned by this module:
`foods`, `meal_entries`, `saved_meals`, `nutrition_profiles`, `weigh_ins`, `cheat_meals`.

**Testing**: Jest. New unit tests in `libs/shared/domain/src/lib/nutrition.spec.ts` covering
every branch of the target model (constitution: domain logic changes require a test per
branch).

**Target Platform**: Browser (desktop and phone-width) + Node API, free-tier hosted (Vercel +
Render + Atlas).

**Project Type**: Nx integrated monorepo, web + API + two shared libs.

**Performance Goals**: The detail page loads in one round trip (`GET /api/nutrition`), as the
other widgets do. The dashboard card adds no extra request — its numbers come from the
existing `/api/dashboard` payload.

**Constraints**: Every route JWT-guarded and user-scoped; calendar dates as `YYYY-MM-DD`
strings; no floats for nutrition values (integer kcal, integer mg); no `default: 0` on
optional numeric fields; Open Food Facts unavailability must never break the page; no
always-on worker.

**Scale/Scope**: One user, ~6 entries/day (≈2k rows/year), a food database in the low
hundreds. Well inside a single-document-per-entry design with no aggregation concerns beyond
the food-recency pipeline.

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1.*

| Principle | Verdict | Notes |
|---|---|---|
| **I. Widget = bounded module** | ⚠️ Amendment required | The dashboard quick-add breaks "no interaction beyond navigation". Principle I is amended in this change to permit **at most one primary quick action per card**; version bump to 1.1.0 and reasoning in `docs/DECISIONS.md`. Everything else complies: one module, one API namespace, one route, one registry entry, no other widget's internals touched. |
| **II. Integer minor units** | ✅ Pass (extended) | No money in this widget. The same rule is applied to nutrition: energy as integer kcal, macros as integer **milligrams** (`*Mg` suffix, mirroring `*Cents`). No float reaches Mongo. |
| **III. Derived never persisted** | ✅ Pass, one documented exception | Day/week totals, targets, BMR, TDEE, countdowns and banked calories are all computed on read. The exception is the `facts` snapshot on a meal entry, which is *not* a cached derivation but the record of what was true when the meal was eaten — the same reasoning as a stock lot storing its purchase price. Justified in Complexity Tracking. |
| **IV. Cross-widget links single-sourced** | ✅ Pass | Cheat-queue rows reference `foodId`; saved meals reference `foodId`; the profile owns body metrics; weigh-ins own weight. No value is mirrored between collections. Nothing links outside the module — food is not money and does not touch cash flow. |
| **V. Projections are pure functions** | ✅ Pass | All formulas in `libs/shared/domain/src/lib/nutrition.ts`, plain data in and out, `today` and the local hour always explicit arguments. The web imports the same functions for the modal's live preview, so the preview and the stored result cannot disagree. |
| **VI. Estimates are labelled** | ✅ Pass | BMR, TDEE, every target figure, the Deurenberg body-fat estimate and the projected weekly change are returned as `Estimate<T>` with `basis` and `assumptions`, and rendered with `EstimateMark`. A user-supplied BMR is *not* labelled. |
| **Tech constraints** | ✅ Pass | No new dependency; DTOs on every write; global JWT guard, every query scoped; Open Food Facts needs no key and no paid tier; no worker — the OFF calls are on demand only. |
| **Workflow** | ✅ Planned | `docs/modules/nutrition.md` written in the same change, decisions appended, changelog appended, `CLAUDE.md` module list updated. |

**Post-Phase-1 re-check**: no new violations. The design added the OFF search cache (in-memory,
bounded, explicitly not a stored cache of user data) and the food-recency aggregation, both of
which keep principle III intact by deriving on read.

## Project Structure

### Documentation (this feature)

```text
specs/001-nutrition-tracking/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: decisions, formulas and their sources, OFF API findings
├── data-model.md        # Phase 1: the six collections, field by field
├── quickstart.md        # Phase 1: how to run and verify the widget end to end
├── contracts/
│   └── nutrition-api.md # Phase 1: every endpoint, request and response shape
└── checklists/
    └── requirements.md  # Spec quality checklist (passing)
```

### Source Code (repository root)

```text
apps/api/src/
├── nutrition/
│   ├── nutrition.module.ts        # schemas + DTOs + service + controller, items.module.ts style
│   └── openfoodfacts.provider.ts  # search/barcode lookup, degrades like finnhub.provider.ts
├── dashboard/dashboard.service.ts # + nutritionCard(), + NutritionService injection
├── app/app.module.ts              # + NutritionModule
├── config/configuration.ts        # + offUserAgent (env OFF_USER_AGENT / OFF_CONTACT_EMAIL)
└── seed/seed.ts                   # + idempotent initial food list

libs/shared/types/src/
├── lib/nutrition.ts               # contracts, enums, summary shapes
├── lib/dashboard.ts               # + 'nutrition' in WIDGET_KEYS, + summaries.nutrition
└── index.ts                       # + export

libs/shared/domain/src/
├── lib/nutrition.ts               # every formula: entry macros, totals, BMR/TDEE, targets,
│                                  # cheat countdown, banked calories, default slot
├── lib/nutrition.spec.ts          # one test per branch
└── index.ts                       # + export

apps/web/src/
├── app/nutrition/page.tsx         # detail page: today, slots, week, cheat day, settings
├── app/page.tsx                   # dashboard card gains the quick-add action
├── components/log-food-modal.tsx  # shared by the card and every slot "+"
├── components/food-picker.tsx      # search, recency, favourites, OFF import
├── components/app-shell.tsx       # + /nutrition nav link
└── lib/hooks.ts                   # + '/nutrition' in revalidateLinked roots

docs/
├── modules/nutrition.md           # new module doc
├── DECISIONS.md                   # amendment + the three design decisions
└── CHANGELOG.md                   # user-visible entry

.specify/memory/constitution.md    # principle I amended, version 1.1.0
CLAUDE.md                          # module list and "things that will trip you up"
```

**Structure Decision**: The existing Nx layout is unchanged. The API side follows the
single-file module convention (`items`, `personal`, `settings`) because this widget's schemas,
DTOs, service and controller belong to one concern and splitting them into six files would
diverge from every other widget of comparable size. The one exception is the Open Food Facts
client, which lives in its own file for the same reason `finnhub.provider.ts` does: it is an
external boundary with its own failure modes and deserves to be readable and stubbable on its
own. On the web side the modal and food picker are separate components precisely because the
dashboard card and the detail page both mount them.

## Phase 0 — Research

See [research.md](./research.md). Resolved: the nutrition-science model and its sources; the
storage-precision question (per-100 integers, mg for macros); snapshot-versus-reference for
logged entries; base units versus grams; the day-boundary and timezone rule; how food recency
is derived without denormalising; Open Food Facts endpoints, rate limits, required
`User-Agent` and ODbL attribution; how the cheat-day banking figure is defined; and the
reordering approach without a new dependency.

No `NEEDS CLARIFICATION` markers remain. One input is outstanding — the owner's initial food
list — which blocks only the seed task.

## Phase 1 — Design

- [data-model.md](./data-model.md): the six collections field by field, with the index plan,
  the validation rules and the reasoning for each stored-versus-derived call.
- [contracts/nutrition-api.md](./contracts/nutrition-api.md): every endpoint under
  `/api/nutrition`, its DTO, its response, and the dashboard payload addition.
- [quickstart.md](./quickstart.md): the boot-and-look-at-the-numbers procedure from
  `CLAUDE.md`, with the specific figures to check so a silent zero cannot pass.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Constitution principle I amended to allow one quick action on a summary card | The owner logs food three to six times a day; making every entry start with a navigation is the difference between a tracker that survives and one that is abandoned in week three | A purely navigational card was tried in the design discussion and rejected by the owner; a shell-level floating button would put a food-specific action in shared chrome, which is a worse boundary violation than one action on the widget's own card |
| A meal entry stores a `facts` snapshot of the food's per-100 values | Without it, correcting a food's calories silently rewrites every past day it appears in, and the log stops being a record of anything | Pure reference plus an immutable-food rule would forbid ever fixing a typo; food versioning (a new row per edit) means a growing catalogue of near-duplicates in the picker, which is the one place that must stay clean |
| Six collections inside one module | They are one concern — what was eaten, against what target — and Mongo has no join to make a single collection cheaper | Folding weigh-ins into the profile document would make weight history a mutable array and break principle III; folding entries into a per-day document would make correcting one item a read-modify-write of the whole day |
| A short-lived in-memory cache of Open Food Facts search results | The documented search limit is 10 requests per minute per IP; typing "chicken" would otherwise spend several of them | No cache means either a slow debounce that feels broken, or IP bans. The cache holds public catalogue data only, never user data, and is bounded and process-local, so it is not a stored cache under principle III |
