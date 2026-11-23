# Module: nutrition (Widget 9 — Food)

Answers two questions: *what have I eaten today, and what should I have eaten?* — plus a
prioritised queue of what to eat on the next cheat day.

**Code:** `apps/api/src/nutrition/` · `apps/web/src/app/nutrition/page.tsx`
**Domain logic:** `libs/shared/domain/src/lib/nutrition.ts` (78 unit tests)
**Contracts:** `libs/shared/types/src/lib/nutrition.ts`
**Spec:** `specs/001-nutrition-tracking/`

## Units — read this first

| Quantity | Stored as | Field name |
| --- | --- | --- |
| Energy | whole kilocalories | `energyKcalPer100`, `energyKcal` |
| Protein, fat, carbs, fibre, sugar, saturated fat, sodium | whole **milligrams** | `*Mg`, `*MgPer100` |
| Body weight | whole **grams** | `weightGrams` |
| Amount eaten | whole base units — grams **or** millilitres | `amount` + `unit` |
| Body fat | decimal fraction (`0.18` = 18%) | `bodyFatPct` |

This is principle II applied to something other than money: `*Mg` is to nutrition what `*Cents`
is to cash. **Optional nutrient fields have no `default: 0`** — "unknown fibre" and "no fibre" are
different facts, and conflating them breaks every `??` downstream.

A food's facts are **per 100 base units**, always. `servingSize` is a convenience multiplier, so
editing it can never change a food's calorie density.

**`g` is never converted to `ml`.** We have no densities, and assuming 1 ml = 1 g is wrong by −8%
for oil and +40% for syrup. A food is measured in one unit and stays in it.

## Collections

| Collection | Purpose |
| --- | --- |
| `foods` | The catalogue. Facts per 100 base units, plus `servingSize`, `entryMode`, `favourite`, `archived`, and optional `image: {key, width, height}` (015). |
| `meal_entries` | **The event row.** One food, one day, one slot, an amount, and a frozen `facts` snapshot. Everything the widget shows derives from these. |
| `saved_meals` | Named groups of foods and amounts ("my oatmeal bowl"), logged in one action. Components *reference* foods. |
| `nutrition_profiles` | Intent: sex, height, birth date, activity, goal, cheat days, day-start hour, optional measured basal rate, optional manual target overrides. One row per user, upserted on first read. |
| `weigh_ins` | Dated measurements: `weightGrams` and optional `bodyFatPct`. Unique on `{userId, day}`. The latest is the current weight. `version?` (spec 030): see below. |
| `cheat_meals` | The cheat-day priority queue: a `foodId`, an `amount`, an `order`, and `eaten`. |

## The snapshot rule (the one deliberate copy in this codebase)

A `meal_entries` row stores `foodId` **and** a `facts` subdocument holding the food's name, brand,
serving size and per-100 numbers *as they were at log time*.

Without it, correcting a food's calories next month silently rewrites every day it has ever
appeared in, and the log stops being evidence of anything. With it, an event row records what was
true when it happened — exactly as a stock lot records its purchase price rather than today's quote.

Consequences to keep in mind:

- The service builds `facts` from the food. It is **never** accepted from a request.
- `PATCH /entries/:id` changes the amount, slot, day or note and **does not** refresh the
  snapshot: correcting a quantity must not re-price the meal.
- `foodId` is not editable. A different food is a different meal — delete and log again.
- Deleting a food that has been logged **archives** it instead, so the picker stays clean while
  history keeps its name.
- `repeatMeal` and `logSavedMeal` take a **fresh** snapshot: those are new meals, so they get
  today's numbers, falling back to the old snapshot only if the food is gone.

Totals are never stored. Day, week, slot, queue and banked figures are all derived on read.

**Offline (spec 029, issue #18).** The rule holds offline: a meal logged with no connection is
shown with the food's facts *as this device has them*, marked "Not saved yet", and sent with its
client `id` but never its facts. The server snapshots the food when the meal arrives; if that
differs from what was shown (the food was corrected meanwhile), the meal says "Updated after
sync". See Offline below.

## Endpoints

All under `/api/nutrition`, all JWT-guarded and user-scoped.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/` | Everything the page renders, `suggestions` included. `?today=` from the browser's clock; `?day=` the day being viewed. |
| `GET` | `/summary` | The dashboard card's figures. Consumed by `DashboardService`. |
| `GET`/`POST` | `/foods` | List (picker order) / create. Create accepts `imageMediaId`: a finished upload of the caller's from `POST /api/media`. |
| `PATCH`/`DELETE` | `/foods/:id` | Update / delete-or-archive. Update accepts `imageMediaId` (replace) or `removeImage: true`. |
| `GET` | `/foods/lookup?q=` | Open Food Facts search. Declared before `/foods/:id` so the literal path wins. |
| `GET` | `/foods/lookup/barcode/:code` | Barcode lookup. |
| `POST` | `/foods/import` | `{ code }` → an owned food row. |
| `GET` | `/foods/public?q=&limit=&skip=` | List public foods from other users available to import. |
| `POST` | `/foods/import-public/:id` | Import a public food from another user into own database. |
| `GET`/`POST` | `/entries` | List by `?day=` or `?from=&to=` / log a meal. Create accepts `id` (spec 029: chosen on the device; 409 `ID_TAKEN` if any user has it). A missing food is 404 `FOOD_GONE`. |
| `PATCH`/`DELETE` | `/entries/:id` | Correct / remove. |
| `POST` | `/entries/repeat` | Repeat a day or a slot onto another day. |
| `GET`/`POST` | `/meals` | Saved meals with current totals / create. |
| `POST` | `/meals/from-day` | Save what was logged in one slot as a meal. |
| `PATCH`/`DELETE` | `/meals/:id` | |
| `POST` | `/meals/:id/log` | One snapshotted entry per component. Optional `ids` (spec 029), one per component in order; a different count is 409 `MEAL_CHANGED`. |
| `GET`/`PUT` | `/profile` | Returns `{ profile, targets }` — the write ships the new targets too. |
| `GET`/`PUT` | `/weigh-ins` | List ascending / upsert keyed on day. |
| `DELETE` | `/weigh-ins/:id` | |
| `GET` | `/cheat` | Queue, countdown and banked allowance. |
| `POST`/`PATCH`/`DELETE` | `/cheat`, `/cheat/:id` | Queue rows. |
| `POST` | `/cheat/order` | Full id array, as `boards` does. |
| `POST` | `/cheat/:id/log` | Queue row → real entry, row marked eaten. |

An amount is given as either `amount` (base units) or `servings` — never both, never neither.
Servings are converted with the serving size and stored as base units.

## Derived formulas

All in `libs/shared/domain/src/lib/nutrition.ts`, pure, with `today` always an explicit argument.

**Entry maths.** `entryTotals(amount, facts)` scales per-100 facts by `amount / 100` and rounds
**once per entry**, so a row's number and the total's number are the same arithmetic.

**Basal metabolic rate**, in this order:

1. `profile.basalRateKcal` if the owner supplied one — returned as `Recorded`, never labelled an
   estimate.
2. Body fat recorded on the latest weigh-in → **Katch–McArdle**: `370 + 21.6 × leanKg`.
3. Otherwise → **Mifflin–St Jeor**: `10 × kg + 6.25 × cm − 5 × age + (male ? 5 : −161)`.

**Body fat, when not recorded** → **Deurenberg**: `1.20 × BMI + 0.23 × age − 10.8 × male − 5.4`,
clamped to 3–60%, `confidence: 'low'`, **display only**. It must never feed the basal rate:
Katch–McArdle on an estimated lean mass is Mifflin–St Jeor with extra error.

**Maintenance** = basal rate × activity factor (1.2 / 1.375 / 1.55 / 1.725 / 1.9).

**Goals** (`GOAL_PLAN`), protein and fat per kg of body weight, or per kg of **lean mass** at the
bracketed figure when body fat was measured:

| Goal | Energy | Protein | Fat |
| --- | --- | --- | --- |
| `pure_weight_loss` | ×0.75 | 2.2 (2.6 lean) | 0.6 |
| `fat_loss` | ×0.85 | 2.0 (2.3 lean) | 0.8 |
| `recomp` | ×0.90 | 2.4 (2.8 lean) | 0.8 |
| `maintain` | ×1.00 | 1.6 (1.9 lean) | 0.9 |
| `lean_gain` | ×1.10 | 1.8 (2.1 lean) | 0.9 |
| `max_gain` | ×1.20 | 1.8 (2.1 lean) | 1.0 |

**Guardrails, in order:**

1. Energy floored at `max(BMR, male ? 1500 : 1200)`; `floorApplied` explains the clip.
2. Protein capped at 40% of the energy target — the guard that keeps a per-kg figure sane at a
   high BMI when no body fat is known. A goal may raise its own ceiling via `proteinEnergyCap`;
   `recomp` uses 50%, because the intake its evidence rests on would otherwise be clipped.
3. Fat floored at `0.5 g/kg` body weight and 15% of energy.
4. Carbohydrate = the remainder. If negative: fat gives way first (down to `0.5 g/kg`), then
   protein (never below `1.2 g/kg`), and `macroAdjustment` reports it.
5. Fibre suggestion = 14 g per 1000 kcal.
6. Projected weekly change = `(energy − maintenance) × 7 ÷ 7700` kg. Verdict thresholds are wider
   than the recommended bands: `fast` above 1.0% of body weight a week (loss) or 0.5% (gain),
   `slow` below 0.25% either way. A narrower rule flagged the app's own `fat_loss` recommendation
   as too slow, which teaches the owner to ignore warnings.
7. `max_gain` is capped at +20% deliberately, and `goalNote` says why.

Manual overrides (`energyOverrideKcal`, `proteinOverrideG`, `fatOverrideG`, `carbOverrideG`) are
returned as `Recorded` and skip the floor: they are the owner disagreeing with the model on
purpose, and the model does not get to pretend it agreed.

**Targets are unavailable** without `sex` and a weigh-in, plus `heightCm` and `birthDate` when
there is no measured basal rate. `missingInputs[]` names what is absent so the UI can too.

**Which day a meal belongs to.** `localDay(now, dayStartHour)` — a meal before `dayStartHour`
(default 4) belongs to the day that is ending. Computed in the **browser** and sent explicitly;
the server's day may not be the eater's. `defaultSlot(hour, minute)`: breakfast to 10:30, lunch to
15:30, snack to 17:00, dinner to 21:30, snack after.

**Cheat day.** `nextCheatDay(today, cheatDays)` finds the nearest configured weekday (`0` =
Sunday) at or after today; today is zero days away. **Banked calories** are the sum of
`target − eaten` over days *before today* that have at least one entry, clamped at zero. Counting
unlogged days would hand out a fictional allowance every time logging is forgotten.

**Per-slot suggestions.** `mealSuggestions({ entries, foods, day })` — what each slot offers for
one tap, from the **fourteen days** of log before `day`. A candidate is a `(slot, food)` pair,
scored by **recency-weighted frequency**: each distinct day it appeared adds `1 / (1 + age)`, age
being whole days back from `day`. Yesterday is worth 0.5, a week ago 0.125, so five mornings of
porridge outrank yesterday's one-off and yesterday's one-off outranks a fortnight-old meal. Ties
break on the most recent day, then the name — never on input order. Four per slot, returned in menu
order then rank.

The amount offered is **that food's total in that slot on the most recent day it appeared** (two
helpings at one breakfast are one breakfast's portion), and the totals are computed from the food's
**current** facts, because logging one goes through the ordinary `POST /entries` and takes a fresh
snapshot — see `docs/DECISIONS.md`. Left out: whatever is already logged in that slot on `day`,
`day` itself and anything after it, and foods that have been deleted or archived. Nothing is
stored, and there is no separate endpoint: the overview's fourteen-day window is the same query
that serves the day being viewed.

**Food picker order.** Favourites, then `lastUsedDay` descending, then `createdAt` descending.
`lastUsedDay` and `useCount` come from one aggregation over `meal_entries` — never stored, because
a counter drifts the moment an entry is deleted or back-dated.

## Privacy and Sharing

Users can share their food database with others:

- **`defaultFoodVisibility`** on the profile controls whether new foods are `public` or `private`
  by default.
- Each food has its own **`visibility`** field that can override the default.
- When changing `defaultFoodVisibility`, the API accepts `updateExistingFoodsVisibility: true` to
  bulk-update all foods that had the old default visibility.
- **`shareMeals`**, **`shareWeight`**, **`shareTargets`** control whether other users can see
  daily meals, weight/body metrics, and nutrition targets respectively (future use).

Public foods can be imported by other users via `POST /foods/import-public/:id`. The imported
food becomes the user's own copy with `source: 'imported'` and `sourceRef` pointing to the
original food's ID.

## Badge facts (022)

`badgeInputs(userId, today)` is the only nutrition read [badges](badges.md) uses. It returns:
- **`eatenKcal`:** whole kcal eaten per logged day up to `today`.
- **`targetKcal`:** that day's **starting** calorie target. It is the `nutritionTargets` value
  with the weigh-in in effect that day and the age on that day. There is no Health activity
  adjustment, because that cannot be reproduced for past days.
- **`cheatDays`:** the configured cheat weekdays.

The target is computed once per (weigh-in, age) pair, not per day. When nothing is logged, the
method returns early and reads no profile.

## Cross-links

- **Dashboard.** `nutrition` is in `WIDGET_KEYS`; `DashboardService.nutritionCard()` renders
  calories eaten, calories left and protein left, and carries `quickAction: { kind: 'log-food' }`
  — the one interactive control a card may have under constitution 1.1.0. `netPositionCents` is
  untouched: food is not money.
- **Training reads weigh-ins.** `NutritionService.weighInsUpTo(userId, day)` returns weigh-ins on
  or before `day`, ascending, as `{day, weightGrams}` only, in one query. Training uses it for
  bodyweight and assisted loads and never reads `weigh_ins` itself. Nothing else flows either way:
  training adds no burned energy to Food.
- **Training writes weigh-ins too (issue #25).** The finish sheet records body weight through
  `/training/weigh-in`, for accounts with Training whether or not Food is on. It is the same
  `weigh_ins` row and the same `upsertWeighIn`, with `weightOnly`:
  - it sets `weightGrams` alone, so body fat and note are kept;
  - it requires `baseVersion`;
  - the same weight again is not a write.
  
  `GET /training/weigh-ins/recent` lists the latest two. See `training.md`, "Finishing a workout".
- **Nothing else.** Apart from that read, this widget links to no other module. It does not touch cash flow, and a
  grocery expense is a cash-flow concern that deliberately knows nothing about calories.

## Open Food Facts

`OpenFoodFactsProvider`, modelled on `FinnhubProvider`: returns empty results and a human-readable
`reason` rather than throwing, so manual entry always works (constitution: external APIs degrade
gracefully).

- No API key. A **custom `User-Agent` is required** — `OFF_USER_AGENT`, or `OFF_CONTACT_EMAIL`
  folded into a default. No address is hard-coded.
- Full-text search does **not** exist in API v2/v3: it uses Search-a-licious
  (`search.openfoodfacts.org`), falling back to the legacy `cgi/search.pl`.
- Rate limits are tight — about 10 searches and 15 product reads a minute per IP, enforced by IP
  ban. Hence the 400 ms debounce, the three-character minimum, and a bounded 10-minute in-process
  result cache (public catalogue data only, so principle III is untouched).
- Data is ODbL; the attribution string travels with every result and is rendered on import.
- A missing nutriment is imported as **absent**, never as zero, and a product with no calorie
  figure is refused with an explanation rather than stored as 0 kcal.

## Open questions

- The owner's 11 starting foods live in `apps/api/src/seed/foods.ts`, keyed on name + brand.
  `npm run seed:foods` writes only the `foods` collection and is safe to re-run against a live
  database; `npm run seed` calls the same function as its last step. Two transcription decisions are
  recorded in that file: **an egg is taken as 50 g** (the source measured in "1 egg" with no
  weight), and **where the source showed 0 for every one of trans fat, saturated fat and fibre,
  those fields are stored as absent rather than zero** — that pattern is an unfilled form, not a
  claim about the food. Trans fat has no field in this module; every reading was 0 bar one at 0.1 g.
- **Adaptive maintenance** — inferring true maintenance from 14 days of intake against the weight
  trend — is deliberately deferred. It is the best available fit for principle VI once there is
  enough history to run it.
- Recipes with per-component units (a spoon, a slice) are out of scope; `servingLabel` is display
  text only.

## 2026-10-22: private sharing baseline

Food and nutrition-profile records now have `privacyVersion: 1`. New records get the marker.
`ensurePrivateSharing(userId)` resets unversioned foods to private and unversioned profile
sharing switches/defaults to private, then marks them in the same per-row atomic updates.
It is safe to retry and does not erase a choice made after migration. Portal/profile reads and
food edits initialize it. Public browse/import queries require the marker, so unvisited legacy
accounts cannot continue leaking their old public foods. Migration changes no meal facts,
quantities, nutrition goals or weight records. Module audiences are separately stored in settings;
future social views must intersect them with the existing fine-grained food switches.

## Shared nutrition summaries and blocks

`sharedStats(userId, today)` is the only Food projection used in social widgets. It includes
meal totals, daily targets and/or latest recorded weight only when their individual switches
are enabled; it never returns full profiles, meal notes, food IDs or body measurements outside
the enabled categories. Social additionally checks module audiences and both accounts' flags.
Public food browse, availability counts and import check either-direction blocks through the
graph service. Previously imported independent copies are not revoked by later blocking.

## Explicit food publications and imports (007)

`NutritionPublicationService` owns the boundary for [food posts](posts.md). It projects only reviewed nutrition facts from owned entries, active foods or saved meals, retaining historical entry facts. Live `shareMeals`/weight/target preferences are not changed by explicit publishing. Imported foods always start private, retain attribution and use a partial unique `(userId, postImportKey)` index for retry/concurrency safety. Saved meals have an analogous optional key. Imports never add meal entries and never overwrite a previous copy. `Food.attribution` is an optional label/URL; `Food.postImportKey` and `SavedMeal.postImportKey` are optional server-owned markers; existing rows need no migration.

## Separate activity model and Health uploads (010)

Profiles add `everydayMovement`, `exerciseSessionsPerWeek` (0.5 represents less than weekly),
`exerciseMinutes`, `exerciseType`, `nutritionPreferences`, and IANA `timeZone`. The original
`activityLevel` remains for numeric compatibility until new inputs are answered. See
[model, assumptions, receiver and device handoff](../APPLE_HEALTH_SETUP.md) for the new
maintenance equation, interval replacement, source overlap policy, and remaining iPhone work.

Two collections are necessary: `nutrition_health` holds scoped connection/ticket metadata;
`nutrition_health_days` holds raw daily sample snapshots, preventing a rolling upload from
losing historical activity. Unique `{userId, connectionId, day}` scopes raw data to a pairing.
Neither targets nor adjustments are persisted. Revocation deletes connection and samples.

JWT-scoped `/api/nutrition/health`: GET status and installation URL, POST `/pair`, POST
`/launch` (15-minute single-use ticket and `limitPerKind: 50`), DELETE revoke. The app
passes exactly `{token, uploadUrl, limitPerKind}` to Shortcuts. POST `/upload` uses its
own `@TokenAuth` guard with `x-health-ticket`, not an account JWT. Its body contains only
`samples`, at most 50 each for Steps and Active Energy. No date-window protocol is used.
Absolute sample dates, source/ID, finite values and explicit energy units are validated.
Samples may be older than the former rolling window. kcal/kJ normalize to kcal.

Storage merges source/type/ID records per UTC start-date bucket without deleting earlier
imports. The ticket is consumed after successful writes; failed storage leaves it retryable.
An account/connection lease prevents concurrent uploads. Revocation cleans up racing writes.
`lastUploadAt`/`lastReceivedCount` describe any accepted upload; `lastSync` describes the last
nonempty data receipt. Empty results do not erase data or establish inactivity. Launches are
manual only, reminders are six-hourly, and no browser return callback is used.

Food retains calories/protein/carbs/fat and adds a distinct Activity adjustment without a ring.
Main calorie denominator is already adjusted. Macro targets remain the starting model's goals.

Weekly/cheat banking uses the starting target; today's Health adjustment is never copied to
all historic days in the week. The Food day view and Home calorie ring use the adjusted target.

Shortcut compatibility: `HealthUploadDto.samples` accepts native arrays, JSON-text arrays,
JSON dictionaries, bounded double encoding and newline-separated JSON dictionaries.
Empty text means an empty snapshot. Malformed content and invalid nested fields are rejected.
The combined maximum is 100; each type is independently limited to 50.

## Recent Health samples

The Shortcut retrieves the newest `limitPerKind` samples of each type with no date filters,
then uploads the combined list once. This does not establish complete historical coverage:
more than 50 new records of a type between runs can leave gaps. Existing imported history
remains available. Earlier batch routes, window planning and generated batch artifacts are
retired. See [the iPhone setup guide](../integrations/apple-health-shortcut-manual.md).

## Health info and Shortcut publishing

The Activity info panel shows the per-device confirmed Shortcut state (installed, update
available, or not confirmed), recorded hourly activity, and compact totals. Hourly bars
use the same source-overlap priority and timezone/food-day boundary as activity targets;
unimported periods stay missing rather than becoming measured zero.

The configured developer alone can GET/PUT `/settings/health-shortcut`. Its validated
iCloud URL lives in the singleton `health_shortcut_settings` document; the old environment
variable is ignored. Publishing a different URL triggers existing per-device update prompts.

## Food photos (015)

A food may have one photo. It is a **copy** of an upload: `MediaService.copyForFood()` copies the
upload's JPEG (a video's still, for a video) inside the bucket to `foods/{userId}/{foodId}-{oid}.jpg`
and the food stores `image: {key, width, height}`. Copying, not referencing, keeps the upload free
for a post and lets either be deleted without the other. The upload stays in the ledger and is
cleaned up after a day if no post claims it.

Responses never carry `key`: `image` is returned as `{url, width, height}` with a signed read link
(same hour-aligned signing as posts). A replaced or removed photo's file is deleted after the
update; a hard delete of the food deletes it too. If copying fails while creating, the food is
deleted and the error returned, so a food never half-exists. Publications and imports do not copy
food photos yet.

`NutritionPublicationService` publishes a single food (`kind: 'food'`) even when it is archived,
because the new post page creates an archived food for a post that is not saved to the list. The
database kind still publishes only live foods.

## Web: the look of the Today view

The Food page shares Training's visual language (owner request, 2026-11-17). Display only; nothing
here is stored or changes a figure.

- **Tab strip** (`app/nutrition/page.tsx`): Today, Foods and You with icons, in the same glass
  strip as Training's tabs (`.glass-tabs`, selected tab `.glass-tab-on`, in `global.css`), followed by two trailing cells: the AI assistant link and **Log food**
  (the accent cell, on screen in every view).
- **`FoodHero`** (`components/food-day.tsx`) opens Today: the day on a gradient with the day
  arrows, "Today" and Share, and **the current week as seven days to tap** (`overview.week`). A
  day's bar is what was eaten against the daily target (full at the target); without a target, a
  logged day is a full bar. It deliberately carries no calories or macros: a first version did,
  and it repeated the rings directly below (owner feedback).
- **A meal's colour and icon come from its slot** (`SLOT_STYLES`): breakfast, lunch, dinner,
  snacks, anything else. The hues are Training's `train-*` tokens, the theme-aware set. Each meal
  is a card with that colour on its left edge and icon; its header carries the kcal and
  `MacroLine` (P, C, F in the one macro palette, `lib/macro-colors.ts`); each entry is a row with
  icon buttons for share, edit and remove. Suggestions take the meal's tint.
- **A logged food's actions are behind its row on touch screens** (`components/swipe-row.tsx`):
  swipe left for Share, Edit and Remove; a swipe past 60% of the row removes it. The actions are
  round buttons with a word underneath, as in Telegram: each pops in as the row uncovers its
  place, and on a long swipe Remove stretches into a pill while the others dim. It is touch only;
  with a fine pointer the same three buttons stay visible (`.pointer-fine-flex`), so no action is
  reachable by swiping alone. The row is `data-no-tab-swipe`, its `touchmove` listener is
  non-passive and attached at mount, and a mostly vertical move is left to scrolling.
- **Macro tiles** are four across on every width, as on Home's Food card: glass tiles (`.glass`,
  the surface Home's widget cards use), each lit from above in its own macro colour.

## Offline (spec 029, issue #18)

Built on `docs/modules/offline.md`. `lib/nutrition-offline.ts` turns logging, correcting and
removing a meal, logging a saved meal and weighing in into outbox writes (`nutrition.*` kinds) with
ids chosen on the device; `lib/offline/nutrition-overlay.ts` applies them to the kept Food day with
`decorateEntry` and `dayTotals`, so the totals and the week move at once and match after sync. The
device keeps the Food day for days within 14 days of today (and the latest copy, used for a day
never opened, with nothing eaten), with at most 2,000 foods. Public foods, product search,
barcode and imports are never kept and say they need a connection; so do foods, saved meals, the
cheat queue, repeating a day and the profile.

Spec 030 (issue #19): `meal_entries` and `weigh_ins` carry `version?` (missing = 0), bumped by
every edit. `PATCH /entries/:id` and `PUT /weigh-ins` accept `baseVersion`; a stale one is 409
`STALE_EDIT` with `current`, so a meal corrected or a weigh-in recorded on another device is never
overwritten without a choice. For a weigh-in `baseVersion: 0` means "none for that day"; a new
one starts at version 1. An edit of a deleted row is 409 `ROW_DELETED`; deleting a meal or a
weigh-in already gone succeeds. Without `baseVersion` (MCP tools, Shortcuts) nothing is checked.
The snapshot rule is unchanged: a correction never refreshes `facts`.

A refused meal (`FOOD_GONE`, `MEAL_CHANGED`) stays on
the day with its reason and Discard. Banked calories, the cheat countdown and suggestions stay the
server's until it answers.

## Meal plans (spec 042)

`apps/api/src/nutrition/meal-plans.ts`, pure rules in `libs/shared/domain/src/lib/meal-plans.ts`,
web `components/meal-plans.tsx`. For people and pages.

| Collection `meal_plans` | |
|---|---|
| `userId`, `name`, `description?` | |
| `days[]` | 1 to 14, each `{id, name, entries[]}`; names are free ("Training day", "Day 1") |
| `days[].entries[]` | Up to 20, each `{id, slot, savedMealId}` (a recipe) or `{id, slot, foodId, amount}` (one food, amount in its own unit) |
| `days[].entries[].slots?` | Every meal the line may be eaten at, when more than one ("lunch or dinner"); `slot` is the first. `planLineSlots()` reads a line's meals, with `uncategorized` meaning any time |
| `postImportKey?` | A copy saved from a post: one per reader and post |
| `activeSince?` | The calendar day the person started using this plan. At most one plan per person has it. A choice, not a derived value |
| `dayChoices?` | `[{day, dayId}]`: plan days the person picked for calendar days, the latest 60 |

`meal_entries.planEntryId?` is the plan line a meal was logged from. The server sets it in
`logDay`; `CreateEntryDto` has no such field, so a request cannot.

**Nothing derived is stored.** `mealPlanView()` works out each line's name and totals, each day's
totals, the average day (over days that hold anything) and `complete` from the foods and recipes
as they are now. A line whose food or recipe is gone, or whose recipe has no foods, is `missing`
and counts for nothing. `mealPlanProblem()` is the one validity rule, shared by API and editor.

| Route | Who | What |
|---|---|---|
| `GET /nutrition/meal-plans` | person, page | The owner's plans, resolved |
| `POST /nutrition/meal-plans`, `PUT /:id` | person, page | Create, replace. Only the owner's own foods and recipes |
| `DELETE /nutrition/meal-plans/:id` | person, page | |
| `POST /nutrition/meal-plans/:id/days/:dayId/log` | **person only** | `{day, entryIds?, slot?}`: logs the day, or those lines, into `slot` (which each line must allow; else each line's first meal), into the diary day the device chose, through `createEntry`, so facts are frozen then. A line the diary already has that day (by `matchPlanDay`) is skipped, so nothing is eaten twice. 400 `PLAN_INCOMPLETE` when a line has no numbers. A page gets 403 `NOT_FOR_PAGES` |
| `GET /nutrition/meal-plans/active?today=&day=` | **person only** | `{active}`: the plan in use as it applies to calendar day `day` (default `today`): that plan day with each line's `logged`, and `recent`, how closely each of the seven days up to `today` followed its plan day; `null` when none |
| `PUT /nutrition/meal-plans/active` | **person only** | `{planId \| null, today}`: start using a plan from today (stopping any other), or stop. Using the plan already in use keeps its start day |
| `PUT /nutrition/meal-plans/active/day` | **person only** | `{day, dayId}`: that calendar day is this plan day, and the days after follow on from it (`today` is read as `day` for the first version of the route) |

**The plan in use.** `activePlanDayIndex()` (pure, tested) decides which plan day a calendar day
is: the plan's days in order, one per day from `activeSince`, round and round, and backwards
before it so earlier days can be compared. A picked day re-anchors the order: that calendar day is
the plan day picked and later days follow on from it; earlier days keep theirs.

**What was eaten is matched, never marked.** `matchPlanDay()` (pure, tested) decides which of a
day's diary meals stand for which plan lines: first meals logged from the plan (`planEntryId`),
then a recipe line takes that recipe's meals (`savedMealId`), then a food line takes one meal of
that food, and failing that one meal of a food with the same name (case and spacing ignored): a
plan saved from a post holds the reader's copies of its foods, while they keep logging their own. A meal at one of the line's meals is preferred, but one at another meal still counts.
Each meal stands for one line. So a meal logged by hand, from a suggestion or before the plan was
in use counts, deleting it makes the line open again, and `planDayAdherence()` can compare any day
with its plan day. The web runs the same function on the day it shows, including meals still
waiting to be sent.

**Sharing.** `{kind: 'mealPlan', mealPlanId}` publishes the plan as its foods, in order, each
with `dayIndex`, `slot`, `amount` and, when it came from a recipe, `group` (the recipe's name);
`publication.days` holds the day names. Recipes are flattened: only foods, amounts, meals and day
names leave. A plan with a line that has no numbers cannot be shared (`PLAN_INCOMPLETE`).
`POST /posts/:id/import` with `savePlan: true` (every food selected) saves the foods and builds
the reader's own plan from them. With policy `skip`, a food the reader already has (same name,
brand and unit, not archived) stands in for the post's in the plan, so nothing is copied for it;
with `copy` every food is copied (`MealPlansService.saveImported`), once per
post. Nothing is logged.

Web: on any day in Food, the plan's lines not eaten yet sit inside each meal they may be eaten at,
dashed, with a Log button that logs into that meal (`PlannedLines`); a meal that counts for the
plan says "In your plan". Above the meals, `PlanStrip` has the plan day (a picker), how much of
it is eaten, the last seven days and Stop. Putting another plan in use (Use, Start this programme, Use this plan)
first asks when one is in use already (`okToReplacePlan`). Food → Meal
plans has Use / Stop using; a meal plan post has **Use this plan** (`UsePlanFromPost`: saves the
foods and the plan, then starts it). A page's Library → Meal plans has no logging and no use.
Also: Food → Meal plans (with "Log this day today"); a page's Library → Meal plans (no logging).
The post card heads each day, shows numbers per day rather than summed, and the save dialog
offers "Also save it as my own meal plan".

## Recipes (spec 042)

A saved meal is also a recipe. `saved_meals` gained `ingredients: string[]` (written by hand, up
to 40 lines of 200 characters) and `steps: string[]` (the method, up to 30 of 600). `components`
may now be empty: a recipe needs foods, ingredients or steps, and one with no foods has no
numbers, cannot be logged (`loggable: false`) and says so wherever it is shown. `POST` and `PATCH
/nutrition/meals` take both fields; a `PATCH` changes only what it is sent.

Published (`{kind: 'combination', savedMealId}`), the recipe's words travel as
`publication.recipe {ingredients, steps}`; a recipe with words and no foods may be published with
zero items, the one food publication allowed to be empty. Saving a post's foods as a meal copies
the words into the reader's recipe. A recipe with no foods offers nothing to save.

Web: `RecipeEditor` (`components/page-library.tsx`) is used in Food (Saved meals and recipes),
in a page's Library and in the composer's Create. A food can be created from inside it.

## Brands

A brand is a name and an optional logo, in `food_brands`:

| Field | Meaning |
| --- | --- |
| `userId` | absent for a **public** brand (everyone sees it); the owner's id for their **own** |
| `name` | as shown, at most 60 characters |
| `key` | `brandKey(name)`: lower case, accents removed, letters and digits only. Unique per `userId` |
| `logo` | `{ key, width, height }` in storage under `brands/`; responses carry a signed `logoUrl`, never the key |

Public rows have no `userId`, so this service cannot use `OwnedCrudService` (the same reason as
Training's catalogue): every query says whether it means public, own, or both.

**A food is joined to its brand by name, not by an id.** `foods.brand` stays text and holds the
brand's exact name; the join is `brandKey(food.brand) === brand.key`. So foods saved before
brands existed, foods looked up by barcode and foods copied from someone else find their brand
(and its logo) with no migration. A meal's `facts.brand` is still the frozen text it always was.

Saving a food runs its brand text through `BrandsService.resolve()`:

| What was typed | What is stored |
| --- | --- |
| any spelling of an existing brand, own first, then public | that brand's own name |
| a new name | the cleaned name, and a new own brand with it |
| nothing with a letter or digit | no brand |

That is the whole rule that stops one brand being entered twice; the food form applies the same
rule while typing. At 300 own brands, new names are stored as text without a brand row.

| Route | Who | What |
| --- | --- | --- |
| `GET /nutrition/brands` | anyone with Food | public brands and their own (their own wins a shared name), `no-store` |
| `POST /nutrition/brands` | anyone; `public: true` developer only | 409 `BRAND_EXISTS` with `existing` if the name exists in any spelling |
| `PATCH /nutrition/brands/:id` | owner; developer for a public brand | name, `imageMediaId`, `removeImage`. A rename renames the brand on foods: the owner's, or everyone's for a public brand |
| `DELETE /nutrition/brands/:id` | owner; developer for a public brand | foods keep the name as text |
| `POST /nutrition/brands/:id/publish` | developer | one of the developer's own brands becomes public |

The public list starts with `STARTER_BRANDS` (names only), inserted once per process with
`$setOnInsert`, never overwriting. Their logos are the brands' own artwork: the admin uploads
them, they are not in the code.

**Most used brands** (`topBrandKeys`, pure): by how often the person's foods of that brand were
eaten, then by how many foods, then by name; archived and unbranded foods do not count. The top
five are the brand chips in the Foods tab and in the food chooser. Computed on the device from
the foods already loaded.

**Log from the food list:** each food card has a Log button that opens the log sheet with that
food chosen at one serving, for the meal the clock suggests.

**Logos are normalised on the device** (`prepareLogo` in `apps/web/src/lib/media.ts`): margins
that are transparent or near-white are trimmed, and the artwork is centred on a white 512 px
square with 12% padding, then saved as JPEG. So every logo has the same size and margin whatever
file it came from. The Brands manager can take many files at once; each is matched to a brand by
`brandKey` of its file name, and a name with no brand becomes a new one.
