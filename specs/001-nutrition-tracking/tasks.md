---
description: "Task list for Food & Nutrition Tracking"
---

# Tasks: Food & Nutrition Tracking

**Input**: Design documents from `/specs/001-nutrition-tracking/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/nutrition-api.md](./contracts/nutrition-api.md),
[quickstart.md](./quickstart.md)

**Tests**: Unit tests for the domain library are **not optional here** — the constitution
requires a test covering every new branch of `libs/shared/domain`. UI-only tasks carry no tests,
per the same rule.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: `US1`–`US5`, mapping to the user stories in [spec.md](./spec.md)

## Path Conventions

Nx integrated monorepo: `apps/api/src/…`, `apps/web/src/…`, `libs/shared/types/src/…`,
`libs/shared/domain/src/…`. All paths below are repository-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: make the rule the code will follow true first, and get config in place.

- [X] T001 Amend constitution principle I in `.specify/memory/constitution.md` to permit at most one primary quick action per summary card, bump **Version** to 1.1.0 with today's date as **Last Amended**, and state what changed
- [X] T002 [P] Append the amendment rationale to `docs/DECISIONS.md` (why one quick action per card is justified, why a shell-level floating button was rejected)
- [X] T003 [P] Add `offUserAgent` to `AppConfig` in `apps/api/src/config/configuration.ts`, built from `OFF_USER_AGENT` with an `OFF_CONTACT_EMAIL` suffix when set and a safe default that hard-codes no personal address
- [X] T004 [P] Document `OFF_USER_AGENT` and `OFF_CONTACT_EMAIL` in `.env.example` as optional, noting that Open Food Facts needs no key but does require a custom User-Agent

**Checkpoint**: the constitution now permits the card action, and the provider has its config.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

### Contracts

- [X] T005 Create `libs/shared/types/src/lib/nutrition.ts` with every contract from [contracts/nutrition-api.md](./contracts/nutrition-api.md): `MEAL_SLOTS`, `NUTRITION_GOALS`, `ACTIVITY_LEVELS`, `FOOD_UNITS`, `ENTRY_MODES`, `Food`, `FoodWithUsage`, `MealEntry` (with the `facts` snapshot), `SavedMeal`, `NutritionProfile`, `WeighIn`, `CheatMeal`, `EntryTotals`, `DayTotals`, `SlotTotals`, `WeekBalance`, `CheatDayInfo`, `NutritionTargets`, `Recorded<T>`, `NutritionSummary`, `NutritionOverview`, `FoodLookupResult` — zero runtime dependencies
- [X] T006 Export `./lib/nutrition` from `libs/shared/types/src/index.ts`
- [X] T007 In `libs/shared/types/src/lib/dashboard.ts`, add `'nutrition'` to `WIDGET_KEYS`, add `nutrition: NutritionSummary` to `DashboardResponse.summaries`, and add the optional `quickAction?: { kind: 'log-food'; label: string }` field to `WidgetCard`

### Pure domain logic (constitution principle V)

- [X] T008 Create `libs/shared/domain/src/lib/nutrition.ts` part 1 — unit maths: `entryTotals(amount, facts)` with the per-entry rounding rule from research R11, `servingsToAmount` / `amountToServings`, `perServingFacts(food)`, `per100FromPerServing` / `perServingFromPer100` for the two entry modes, and `mgToG` / `gToMg` helpers
- [X] T009 Extend `libs/shared/domain/src/lib/nutrition.ts` — aggregation: `slotTotals`, `dayTotals`, `weekStart(day)` (Monday), `weekBalance(entries, targetKcal, today)` counting only days with at least one entry, and `bankedKcal` clamped at zero
- [X] T010 Extend `libs/shared/domain/src/lib/nutrition.ts` — body model: `ageOn(birthDate, today)`, `currentWeighIn(weighIns, today)`, `leanMassGrams`, `bmr(profile, weighIn, today)` implementing user-supplied → Katch–McArdle → Mifflin–St Jeor in that order, and `estimateBodyFat` (Deurenberg, `confidence: 'low'`, display only) — each returning an `Estimate` with its `basis` string naming the equation and inputs
- [X] T011 Extend `libs/shared/domain/src/lib/nutrition.ts` — targets: `tdee` (activity factors), `nutritionTargets(profile, weighIns, today)` applying the goal factor, the energy floor with `floorApplied`, the reference-mass choice, the 40% protein cap, the fat floor, the carbohydrate remainder with the documented reduction order, the fibre suggestion, `projectedWeeklyChangeKg`, `rateVerdict`, the `max_gain` cap note, the four manual overrides as `Recorded<T>`, and `missingInputs[]`
- [X] T012 Extend `libs/shared/domain/src/lib/nutrition.ts` — time and cheat helpers: `localDay(nowIso, dayStartHour)`, `defaultSlot(localHour, localMinute)` with the R4 boundaries, `nextCheatDay(today, cheatDays)` (0 = Sunday, today counts as 0 days), and `summariseNutrition(...)` producing `NutritionSummary` for the dashboard
- [X] T013 Export `./lib/nutrition` from `libs/shared/domain/src/index.ts`
- [X] T014 Create `libs/shared/domain/src/lib/nutrition.spec.ts` covering T008/T009: entry rounding, servings↔amount round-trips, both entry-mode conversions, slot and day totals, Monday week start, week balance ignoring unlogged days, banked calories clamped at zero
- [X] T015 [P] Extend `libs/shared/domain/src/lib/nutrition.spec.ts` covering T010/T011 — one test per branch: each of the three BMR paths, Deurenberg never feeding BMR, all five activity factors, all five goals' energy, body-weight versus lean-mass reference, the energy floor for each sex, the protein cap, the fat floor, the negative-carbohydrate reduction order, fibre, projected change and each `rateVerdict`, every override, and each `missingInputs` combination
- [X] T016 [P] Extend `libs/shared/domain/src/lib/nutrition.spec.ts` covering T012: `localDay` either side of the day-start hour, every slot boundary, `nextCheatDay` for today / later this week / next week / multiple days / none configured, and `summariseNutrition` with and without targets

### API module

- [X] T017 Create `apps/api/src/nutrition/nutrition.module.ts` with the six Mongoose schemas from [data-model.md](./data-model.md) — `Food`, `MealEntry` (with the `_id: false` `facts` subschema), `SavedMeal`, `NutritionProfile`, `WeighIn`, `CheatMeal` — using `baseSchemaOptions`, `dayField`/`requiredDayField`, integer validators on every `*Mg` / `*Kcal` / `*Grams` field, no `default: 0` on any optional numeric field, and the indexes listed in the data model
- [X] T018 Add the food macro-versus-energy sanity check (flag, never reject). **Implemented in the service and the form, not as a schema hook**: a `pre('validate')` hook has nowhere to put a warning, so `NutritionService.warnOnImplausibleFacts` logs it and the food form shows it inline before saving, using the same `macroEnergyMismatch` domain function
- [X] T019 Add every DTO to `apps/api/src/nutrition/nutrition.module.ts` — `CreateFoodDto`, `UpdateFoodDto`, `CreateEntryDto`, `UpdateEntryDto`, `RepeatMealDto`, `SavedMealDto`, `LogSavedMealDto`, `UpdateProfileDto`, `UpsertWeighInDto`, `CreateCheatMealDto`, `UpdateCheatMealDto`, `ReorderCheatDto`, `ImportFoodDto` — `class-validator` on every field with the ranges from the data model, and an `amount`-xor-`servings` check
- [X] T020 Implement `NutritionService` in `apps/api/src/nutrition/nutrition.module.ts` extending `OwnedCrudService` for foods, with per-100 normalisation from `entryMode` on write, and `listFoods(userId, { q, favourite, includeArchived })` merged with the recency aggregation from research R7 (`$match` → `$group` by `foodId` → `$max day`, `$sum 1`) and the documented picker order
- [X] T021 Implement profile and weigh-in methods on `NutritionService`: upsert-on-read defaults (mirroring `SettingsService.get`), `updateProfile`, `listWeighIns`, `upsertWeighIn` keyed on `{ userId, day }`, `removeWeighIn`, and `targets(userId, today)` delegating to the domain lib
- [X] T022 Implement entry methods on `NutritionService`: `createEntry` resolving the food and building the `facts` snapshot server-side (never from the client), `updateEntry` that changes amount/slot/day/note **without** refreshing the snapshot, `removeEntry`, `listEntries` by day or range, and `repeatMeal`
- [X] T023 Implement `NutritionService.overview(userId, today, day)` assembling the single-round-trip `NutritionOverview` from the contract, and `NutritionService.summary(userId, today)` returning `NutritionSummary`
- [X] T024 Add `NutritionController` to `apps/api/src/nutrition/nutrition.module.ts` with the overview, summary, foods, entries, profile and weigh-in routes from the contract, using `@CurrentUser('userId')` and `@Today()`; declare the module with `MongooseModule.forFeature` for all six schemas and export the service
- [X] T025 Register `NutritionModule` in `apps/api/src/app/app.module.ts` and inject `NutritionService` into `apps/api/src/dashboard/dashboard.module.ts`

### Web shell

- [X] T026 [P] Add the `/nutrition` link to `CORE_LINKS` in `apps/web/src/components/app-shell.tsx` and `'/nutrition'` to the roots in `revalidateLinked()` in `apps/web/src/lib/hooks.ts`
- [X] T027 Create `apps/web/src/app/nutrition/page.tsx` as an `AppShell` + `PageHeader` shell fetching `useApi<NutritionOverview>('/nutrition?today=…')` with `Spinner` / `ErrorNote` states and empty section placeholders
- [X] T028 [P] Create `apps/web/src/lib/local-day.ts` wrapping the domain `localDay` / `defaultSlot` against the browser clock, so no component reads `new Date()` directly

**Checkpoint**: contracts, formulas (tested), collections, endpoints and an empty page all exist.

---

## Phase 3: User Story 1 — Log what I ate and see where today stands (Priority: P1) 🎯 MVP

**Goal**: log a food in three interactions from the dashboard or the widget, and see today's
numbers move by exactly the previewed amount.

**Independent Test**: with a few foods seeded and no profile filled in, log from both the
dashboard and each slot; entries land in the right slot on the right day, and editing or
deleting one moves every total consistently.

- [X] T029 [P] [US1] Create `apps/web/src/components/food-picker.tsx` — searchable list over `overview.foods` in picker order (favourites, then last used, then newest), showing brand and per-serving energy per row
- [X] T030 [US1] Create `apps/web/src/components/log-food-modal.tsx` — slot selector pre-filled from the caller, the food picker, a servings field and a base-unit amount field kept in sync through the domain helpers, and a live preview of energy, protein, carbohydrate and fat computed with `entryTotals` (the same function the API uses), submitting `POST /nutrition/entries` through `useAction`
- [X] T031 [US1] Add the "Today" section to `apps/web/src/app/nutrition/page.tsx`: four metric tiles (energy, protein, carbohydrate, fat) showing eaten, target and remaining with a `ProgressBar`, degrading to eaten-only when `targets.available` is false
- [X] T032 [US1] Add the five slot sections to `apps/web/src/app/nutrition/page.tsx`, each with its own `+` opening `LogFoodModal` with that slot pre-chosen, listing entries with amount, energy and macros, and per-row edit and delete
- [X] T033 [US1] Add the day navigator to `apps/web/src/app/nutrition/page.tsx` (previous / next / today) driving the `day` query parameter, so a missed day can be filled in
- [X] T034 [US1] Implement `nutritionCard()` in `apps/api/src/dashboard/dashboard.service.ts` — energy eaten, energy left, protein left, tone by remaining, `progress`, the `alert` inviting profile completion when targets are unavailable, `accent: 'lime'`, `order` after `personal`, and `quickAction: { kind: 'log-food' }`; add `nutrition` to the `Promise.all` and to `summaries`
- [X] T035 [US1] Add the `lime` entries to `ACCENT_RING` and `ACCENT_DOT` in `apps/web/src/app/page.tsx` (written out, never interpolated, because Tailwind scans source text)
- [X] T036 [US1] Render the card's quick action in `apps/web/src/app/page.tsx` — a `+` button inside `SummaryCard` that stops link navigation and opens `LogFoodModal` with the slot from `defaultSlot()`, the one interactive control the amended principle I allows

**Checkpoint**: US1 is a working food tracker on its own.

---

## Phase 4: User Story 2 — Know what I should be eating (Priority: P2)

**Goal**: body metrics and a goal produce calorie and macro targets, each traceable to its
method, with the guardrails visible.

**Independent Test**: enter sex, height, birth date, activity and a weigh-in, then cycle the
five goals and confirm each target moves by the documented proportion and shows its basis.

- [X] T037 [P] [US2] Create `apps/web/src/components/nutrition-settings.tsx` — the profile form (sex, height, birth date, activity, goal, own basal rate, cheat days, day-start hour, the four overrides), saving through `PUT /nutrition/profile`
- [X] T038 [P] [US2] Create `apps/web/src/components/weigh-in-panel.tsx` — record a dated weigh-in with optional body-fat percentage, list recent weigh-ins, delete one
- [X] T039 [US2] Add the targets panel to `apps/web/src/app/nutrition/page.tsx`: basal rate, maintenance energy and the four targets, each with `EstimateMark` carrying its `basis`, overrides rendered as recorded rather than estimated, and the estimated body-fat figure marked low-confidence
- [X] T040 [US2] Render the guardrail notices in `apps/web/src/app/nutrition/page.tsx`: the energy floor (`floorApplied`), the macro adjustment (`macroAdjustment`), the `max_gain` cap note, and the projected weekly change against its sane-rate band
- [X] T041 [US2] Render the `missingInputs` prompt in `apps/web/src/app/nutrition/page.tsx`, naming each missing input as a link into the settings panel

**Checkpoint**: US1 + US2 — logging against real targets.

---

## Phase 5: User Story 3 — Grow my own food database (Priority: P3)

**Goal**: add foods by hand or import them, keep the picker ordered by what is actually eaten,
and log repeat meals in one action.

**Independent Test**: add a food from a label, import a second from Open Food Facts, save a
two-food meal, log it, then repeat yesterday's breakfast — with the lookup blocked, everything
except the import still works.

- [X] T042 [P] [US3] Create `apps/api/src/nutrition/openfoodfacts.provider.ts` modelled on `finnhub.provider.ts`: Search-a-licious full-text search with the legacy `cgi/search.pl` fallback, `api/v2/product/{barcode}.json` for barcodes, the configured `User-Agent`, an 8-second timeout, a bounded 10-minute in-process result cache, `isConfigured`/`unavailableReason`, `null` or empty on every failure, and field mapping that treats a missing nutriment as absent rather than zero
- [X] T043 [US3] Add the lookup routes to `NutritionController` in `apps/api/src/nutrition/nutrition.module.ts` — `GET /foods/lookup`, `GET /foods/lookup/barcode/:code`, `POST /foods/import` — plus `foodLookup: { available, reason? }` in the overview payload, and register the provider in the module
- [X] T044 [P] [US3] Create `apps/web/src/components/food-form.tsx` — add and edit a food with the per-serving / per-100 toggle, unit selector, optional fibre, sugar, saturated fat and sodium, and the favourite flag
- [X] T045 [US3] Add the Open Food Facts search tab to `apps/web/src/components/food-form.tsx`: debounced 400 ms, minimum three characters, barcode field, one-tap import through `POST /nutrition/foods/import`, the ODbL attribution and a link to the source product, and a plain unavailable message that leaves manual entry usable
- [X] T046 [US3] Add the foods panel to `apps/web/src/app/nutrition/page.tsx`: list, search, favourite toggle, edit, and delete-or-archive with the archived filter
- [X] T047 [US3] Implement saved-meal methods on `NutritionService` and their routes in `apps/api/src/nutrition/nutrition.module.ts` — list with current totals, create, `from-day`, update, delete, and `log` writing one snapshotted entry per component with `savedMealId`, refusing to log when a component's food is archived or missing
- [X] T048 [US3] Add the saved-meals UI to `apps/web/src/app/nutrition/page.tsx` and a "save this slot as a meal" action on each slot section, plus one-tap logging with a slot choice
- [X] T049 [US3] Add "repeat" actions to `apps/web/src/app/nutrition/page.tsx` driven by `overview.recentMeals` and `POST /nutrition/entries/repeat`, for a whole day or a single slot

**Checkpoint**: the food database is self-sufficient and logging is low-friction.

---

## Phase 6: User Story 4 — Cheat day queue and countdown (Priority: P4)

**Goal**: a prioritised, reorderable queue with a countdown to the next cheat day and one-tap
logging on the day.

**Independent Test**: set Saturday, queue three items, reorder by drag and by ↑/↓, reload and
confirm the order; on a cheat day, log the top item in one tap.

- [X] T050 [US4] Implement cheat-queue methods on `NutritionService` in `apps/api/src/nutrition/nutrition.module.ts` — list with per-row totals read through the food reference, create, update, delete, `reorder(order[])` rewriting `order: index` as `BoardsService.reorderTasks` does, and `logCheatMeal` writing a snapshotted entry with `cheatMealId` then marking the row eaten with `eatenDay`
- [X] T051 [US4] Add `cheatDayInfo(userId, today)` to `NutritionService` combining `nextCheatDay`, the queue with totals, the queue total and `bankedKcal`, and expose `GET /cheat`, `POST /cheat`, `PATCH /cheat/:id`, `DELETE /cheat/:id`, `POST /cheat/order`, `POST /cheat/:id/log`
- [X] T052 [P] [US4] Create `apps/web/src/components/cheat-queue.tsx` — ordered rows with energy and macros, native HTML5 drag handlers plus keyboard-accessible ↑/↓ buttons, both posting the full id array to `POST /nutrition/cheat/order`
- [X] T053 [US4] Add the cheat-day section to `apps/web/src/app/nutrition/page.tsx`: the countdown (or the invitation to configure a cheat day), the queue, the queue total, the add-from-food-database control, and the one-tap "log this" enabled on a cheat day
- [X] T054 [US4] Surface the next cheat day on the dashboard card in `apps/api/src/dashboard/dashboard.service.ts` as the card `subtitle` when one is configured

**Checkpoint**: US1–US4 complete.

---

## Phase 7: User Story 5 — The week, not just the day (Priority: P5)

**Goal**: the week's balance beside today's, the banked cheat-day allowance, and the weight trend.

**Independent Test**: log several days, then confirm the week totals, that unlogged days are
excluded from the bank, and that two weigh-ins render a trend with an average weekly change.

- [X] T055 [P] [US5] Create `apps/web/src/components/week-balance.tsx` — eaten, target and difference for the week, a per-day bar with today marked, days logged, and the banked allowance labelled as an allowance rather than a rule
- [X] T056 [P] [US5] Create `apps/web/src/components/weight-trend.tsx` — a Recharts line over the weigh-ins with the average weekly change and the target rate band
- [X] T057 [US5] Mount both panels in `apps/web/src/app/nutrition/page.tsx` and show the banked figure inside the cheat-day section

**Checkpoint**: all five stories independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T058 Write `docs/modules/nutrition.md` — purpose, the six collections, every endpoint, the target formulas with their sources, the snapshot rule, the cheat-banking definition, cross-links and open questions
- [X] T059 [P] Append the three design decisions to `docs/DECISIONS.md` — per-100 integer facts with milligram macros, the meal-entry snapshot, base units instead of grams — each with the alternatives rejected
- [X] T060 [P] Append a user-visible entry to `docs/CHANGELOG.md` for the food widget
- [X] T061 [P] Update `CLAUDE.md`: the module list, the nutrition widget in the layout section, and a "things that will trip you up" note on the snapshot rule, milligram macros and the client-supplied day
- [X] T062 Seeded the owner's 11 starting foods idempotently, keyed on name + brand. The list lives in `apps/api/src/seed/foods.ts` with its transcription decisions recorded (per-serving source values, an egg taken as 50 g, and all-zero "other macros" treated as unrecorded rather than zero); `npm run seed:foods` writes only the `foods` collection, so it is safe to re-run against a live database, and `npm run seed` calls the same function
- [X] T063 [P] Mobile-width and keyboard pass over `apps/web/src/app/nutrition/page.tsx` and the modal: the quick-add reachable one-handed, the picker usable without a mouse, the queue reorderable by keyboard
- [X] T064 Run `npm run check` and fix everything it reports
- [X] T065 Ran a 57-check scripted walk of [quickstart.md](./quickstart.md) against a real local Mongo boot (throwaway container, `lp-dev`): every target figure, all five goals, both basal-rate equations, the floor and macro-squeeze guardrails, the snapshot rule, the picker's derived recency, the week and bank, the cheat countdown and one-tap log, a live Open Food Facts search and a real barcode import, and the dashboard card. **Two real bugs found and fixed**: the `$set`/`$setOnInsert` conflict (a 500 on saving the profile, and the same latent bug in the pre-existing settings module) and Open Food Facts returning `brands` as an array from its newer endpoint. Not covered: a hand-driven pass through the UI at phone width

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies. T001 must land before T036 renders a card action.
- **Phase 2 (Foundational)**: depends on Phase 1. **Blocks every user story.**
- **Phase 3–7 (Stories)**: each depends only on Phase 2, and can be delivered in priority order
  or in parallel by different people.
- **Phase 8 (Polish)**: T058–T061 depend on the stories they document; T064–T065 come last.

### Within Phase 2

- T005 → T006, T007 (types before their consumers)
- T008 → T009 → T010 → T011 → T012 (one file, sequential) → T013
- T014 after T009; T015 after T011; T016 after T012 — same spec file, so run them in that order
- T017 → T018, T019 → T020, T021, T022 → T023 → T024 → T025
- T026, T028 are independent of the API tasks; T027 needs T024 to have something to fetch

### Story Dependencies

- **US1 (P1)**: Phase 2 only. Independently shippable — logging works with no profile.
- **US2 (P2)**: Phase 2 only. Independently testable; US1's tiles gain their target column.
- **US3 (P3)**: Phase 2 only. Independently testable; T042 has no dependants outside US3.
- **US4 (P4)**: Phase 2 only; reads foods, but the picker exists from Phase 2's endpoints.
- **US5 (P5)**: Phase 2, and reads targets — the week's target column needs US2 to be meaningful.

### Parallel Opportunities

- Phase 1: T002, T003, T004 together (T001 first, since T002 documents it).
- Phase 2: the types chain (T005–T007), the domain chain (T008–T013) and the API chain
  (T017–T025) are three separate lanes and can run concurrently; T026 and T028 alongside all of
  them. T015 and T016 are marked `[P]` against the API and web lanes, not against each other.
- Phase 3: T029 and T034/T035 (web picker versus dashboard service) are separate files.
- Phase 5: T042 (provider), T044 (food form) run concurrently.
- Phase 7: T055 and T056 are independent components.
- Phase 8: T059, T060, T061, T063 are all separate files.

---

## Parallel Example: Phase 2

```bash
# Three lanes at once, no shared files:
Lane A: T005 → T006 → T007            # libs/shared/types
Lane B: T008 → T009 → T010 → T011 → T012 → T013 (+ T014, T015, T016)   # libs/shared/domain
Lane C: T017 → T018 → T019 → T020 → T021 → T022 → T023 → T024          # apps/api/src/nutrition
Lane D: T026, T028                    # apps/web plumbing
# T025 joins A and C; T027 needs C.
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 (T001–T004)
2. Phase 2 (T005–T028) — the whole foundation, including the tested formulas
3. Phase 3 (T029–T036)
4. **Stop and validate**: log from the dashboard and from every slot, edit, delete, cross the
   day boundary, and confirm the totals agree everywhere. That alone is a usable tracker.

### Incremental delivery

US2 makes "left to eat" mean something. US3 makes the database self-sufficient. US4 adds the
cheat day. US5 adds the weekly view. Each is a checkpoint that can be verified and left alone.

### Notes

- T062 is the only task blocked on outside input, and nothing depends on it.
- `npm run check` (T064) is a gate, not proof: T065 exists because that gate has passed before
  while the app could not boot.
