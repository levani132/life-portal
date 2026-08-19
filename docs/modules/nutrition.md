# Module: nutrition (Widget 9 — Food)

Answers two questions: *what have I eaten today, and what should I have eaten?* — plus a
prioritised queue of what to eat on the next cheat day.

**Code:** `apps/api/src/nutrition/` · `apps/web/src/app/nutrition/page.tsx`
**Domain logic:** `libs/shared/domain/src/lib/nutrition.ts` (61 unit tests)
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
| `foods` | The catalogue. Facts per 100 base units, plus `servingSize`, `entryMode`, `favourite`, `archived`. |
| `meal_entries` | **The event row.** One food, one day, one slot, an amount, and a frozen `facts` snapshot. Everything the widget shows derives from these. |
| `saved_meals` | Named groups of foods and amounts ("my oatmeal bowl"), logged in one action. Components *reference* foods. |
| `nutrition_profiles` | Intent: sex, height, birth date, activity, goal, cheat days, day-start hour, optional measured basal rate, optional manual target overrides. One row per user, upserted on first read. |
| `weigh_ins` | Dated measurements: `weightGrams` and optional `bodyFatPct`. Unique on `{userId, day}`. The latest is the current weight. |
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

## Endpoints

All under `/api/nutrition`, all JWT-guarded and user-scoped.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/` | Everything the page renders. `?today=` from the browser's clock; `?day=` the day being viewed. |
| `GET` | `/summary` | The dashboard card's figures. Consumed by `DashboardService`. |
| `GET`/`POST` | `/foods` | List (picker order) / create. |
| `PATCH`/`DELETE` | `/foods/:id` | Update / delete-or-archive. |
| `GET` | `/foods/lookup?q=` | Open Food Facts search. Declared before `/foods/:id` so the literal path wins. |
| `GET` | `/foods/lookup/barcode/:code` | Barcode lookup. |
| `POST` | `/foods/import` | `{ code }` → an owned food row. |
| `GET`/`POST` | `/entries` | List by `?day=` or `?from=&to=` / log a meal. |
| `PATCH`/`DELETE` | `/entries/:id` | Correct / remove. |
| `POST` | `/entries/repeat` | Repeat a day or a slot onto another day. |
| `GET`/`POST` | `/meals` | Saved meals with current totals / create. |
| `POST` | `/meals/from-day` | Save what was logged in one slot as a meal. |
| `PATCH`/`DELETE` | `/meals/:id` | |
| `POST` | `/meals/:id/log` | One snapshotted entry per component. |
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

**Food picker order.** Favourites, then `lastUsedDay` descending, then `createdAt` descending.
`lastUsedDay` and `useCount` come from one aggregation over `meal_entries` — never stored, because
a counter drifts the moment an entry is deleted or back-dated.

## Cross-links

- **Dashboard.** `nutrition` is in `WIDGET_KEYS`; `DashboardService.nutritionCard()` renders
  calories eaten, calories left and protein left, and carries `quickAction: { kind: 'log-food' }`
  — the one interactive control a card may have under constitution 1.1.0. `netPositionCents` is
  untouched: food is not money.
- **Nothing else.** This widget links to no other module. It does not touch cash flow, and a
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
