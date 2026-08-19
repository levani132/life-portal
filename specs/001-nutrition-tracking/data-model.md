# Phase 1 Data Model: Food & Nutrition Tracking

Six collections, all owned by `apps/api/src/nutrition/nutrition.module.ts`. Conventions carried
from the existing modules: `baseSchemaOptions` (timestamps, `_id → id`, no `__v`), calendar days
as `YYYY-MM-DD` strings via `dayField` / `requiredDayField`, `userId` indexed on every row, and
**no `default: 0` on any optional numeric field**.

Nutrition numbers follow principle II by analogy with money: **energy as integer kilocalories**,
**macronutrients as integer milligrams** (`*Mg`), **weight as integer grams**. Percentages are
decimals (`0.18` = 18%), matching `capitalGainsTaxRate`.

---

## 1. `foods`

The catalogue. Facts are per 100 base units (see research R1).

| Field | Type | Rules |
|---|---|---|
| `userId` | string | required, indexed |
| `name` | string | required, trimmed, ≤ 160 |
| `brand` | string? | ≤ 120 |
| `unit` | `'g' \| 'ml'` | required, default `'g'` |
| `servingSize` | int | required, ≥ 1, ≤ 5000 — base units in one serving |
| `servingLabel` | string? | ≤ 60, e.g. "1 slice", "1 can" — display only |
| `energyKcalPer100` | int | required, ≥ 0, ≤ 900 (pure fat is 900 kcal/100 g) |
| `proteinMgPer100` | int | required, ≥ 0, ≤ 100 000 |
| `fatMgPer100` | int | required, ≥ 0, ≤ 100 000 |
| `carbMgPer100` | int | required, ≥ 0, ≤ 100 000 |
| `fibreMgPer100` | int? | ≥ 0 — optional, **no default** |
| `sugarMgPer100` | int? | ≥ 0 |
| `satFatMgPer100` | int? | ≥ 0 |
| `sodiumMgPer100` | int? | ≥ 0 |
| `entryMode` | `'per_serving' \| 'per_100'` | required, default `'per_serving'` — how the owner typed it, so the form reopens the same way |
| `favourite` | boolean | default `false` |
| `barcode` | string? | ≤ 32, sparse index |
| `source` | `'manual' \| 'openfoodfacts'` | required, default `'manual'` |
| `sourceRef` | string? | Open Food Facts product code, for the attribution link |
| `archived` | boolean | default `false` — deleting a food that has been logged archives it instead, so the picker stays clean without touching history |
| `notes` | string? | ≤ 500 |

**Indexes**: `{ userId: 1, name: 1 }`, `{ userId: 1, favourite: -1 }`, sparse
`{ userId: 1, barcode: 1 }`.

**Sanity check at the schema boundary**: `protein × 4 + carb × 4 + fat × 9` must not exceed the
stated energy by more than 30% — catches a per-serving figure typed into a per-100 field, which
is the single most likely data-entry error. Warn, do not reject (real labels disagree with their
own macros; alcohol and polyols make the check inexact).

**Derived, never stored**: `lastUsedDay`, `useCount` (research R7); `perServing` values, which
the API returns for display as `round(servingSize × per100 / 100)`.

---

## 2. `meal_entries`

The event row. Everything the widget shows about a day is derived from these.

| Field | Type | Rules |
|---|---|---|
| `userId` | string | required, indexed |
| `day` | day string | required — supplied by the client per research R4 |
| `slot` | `'breakfast' \| 'lunch' \| 'dinner' \| 'snack' \| 'uncategorized'` | required |
| `foodId` | string | required, indexed — kept for grouping, recency and "log again" |
| `amount` | int | required, ≥ 1, ≤ 20 000 base units; > 3000 is accepted but flagged in the UI |
| `unit` | `'g' \| 'ml'` | required — copied from the food, so history stays readable |
| `facts` | subdocument, `_id: false` | required — the frozen snapshot (research R2) |
| `facts.name` | string | required |
| `facts.brand` | string? | |
| `facts.servingSize` | int | required — the food's serving size at log time, so "1.5 servings" keeps its meaning |
| `facts.energyKcalPer100` | int | required, ≥ 0 |
| `facts.proteinMgPer100` | int | required, ≥ 0 |
| `facts.fatMgPer100` | int | required, ≥ 0 |
| `facts.carbMgPer100` | int | required, ≥ 0 |
| `facts.fibreMgPer100` | int? | |
| `savedMealId` | string? | set when the entry came from a saved meal, so the group can be undone together |
| `cheatMealId` | string? | set when the entry came from the cheat queue |
| `note` | string? | ≤ 300 |

**Indexes**: `{ userId: 1, day: -1 }` (the day and week reads), `{ userId: 1, foodId: 1 }` (the
recency aggregation), `{ userId: 1, day: 1, slot: 1 }`.

**Write rule**: the service resolves the food, builds `facts` from it and ignores any
client-supplied facts. The client may not dictate the snapshot.

**Delete rule**: hard delete. The entry is the record; an entry that did not happen should
leave nothing behind.

---

## 3. `saved_meals`

A named group of foods and amounts — "my oatmeal bowl" — logged in one action.

| Field | Type | Rules |
|---|---|---|
| `userId` | string | required, indexed |
| `name` | string | required, ≤ 120 |
| `defaultSlot` | slot? | pre-selects the slot when logging |
| `components` | array, `_id: false`, ≥ 1, ≤ 20 | |
| `components[].foodId` | string | required |
| `components[].amount` | int | required, ≥ 1 |
| `archived` | boolean | default `false` |

**Indexes**: `{ userId: 1, name: 1 }`.

Components reference foods and never copy their facts (principle IV) — the totals shown for a
saved meal are today's facts, because the meal has not been eaten yet. The snapshot happens only
when it is logged, at which point real `meal_entries` rows are written, one per component, each
carrying `savedMealId`.

A component whose food has been archived or deleted renders as unavailable and blocks logging
until it is replaced or removed.

---

## 4. `nutrition_profiles`

One row per user, created on first read with defaults, exactly like `user_settings`.

| Field | Type | Rules |
|---|---|---|
| `userId` | string | required, **unique**, indexed |
| `sex` | `'male' \| 'female'` | required for targets; no default |
| `heightCm` | int | 100–250 |
| `birthDate` | day string | required for targets (age drives Mifflin–St Jeor) |
| `activityLevel` | `'sedentary' \| 'light' \| 'moderate' \| 'very' \| 'athlete'` | default `'light'` |
| `goal` | `'pure_weight_loss' \| 'fat_loss' \| 'maintain' \| 'lean_gain' \| 'max_gain'` | default `'maintain'` |
| `basalRateKcal` | int? | 800–5000 — the owner's own measured figure; wins over every equation, **no default** |
| `cheatDays` | int[] | each 0–6, `0 = Sunday`, default `[]` |
| `dayStartHour` | int | 0–12, default `4` |
| `energyOverrideKcal` | int? | 800–8000 — a manual calorie target that overrides the model, for when a coach says otherwise |
| `proteinOverrideG` | int? | ≥ 0 |
| `fatOverrideG` | int? | ≥ 0 |
| `carbOverrideG` | int? | ≥ 0 |

Body-fat percentage deliberately does **not** live here: it is a measurement, so it belongs on a
weigh-in. `energyOverrideKcal` and the macro overrides exist so the owner can disagree with the
model without the model pretending it agreed — an override is rendered as *recorded*, not as an
estimate, and the modelled figure is still shown beside it.

**Missing-input rule**: targets require `sex`, `heightCm`, `birthDate` and at least one weigh-in.
Any missing input is returned by name in `missingInputs[]` so the UI can name it (FR-025).

---

## 5. `weigh_ins`

| Field | Type | Rules |
|---|---|---|
| `userId` | string | required, indexed |
| `day` | day string | required |
| `weightGrams` | int | required, 20 000–400 000 |
| `bodyFatPct` | number? | 0.03–0.60 as a decimal — a **recorded** measurement, and the only input that switches the basal-rate method |
| `note` | string? | ≤ 300 |

**Indexes**: unique `{ userId: 1, day: 1 }` — a second weigh-in on the same day replaces the
first, via an upsert (FR "two weigh-ins on the same day").

The current weight is the row with the greatest `day` that is not in the future. The trend and
the average weekly change are derived.

---

## 6. `cheat_meals`

The priority queue for the next cheat day.

| Field | Type | Rules |
|---|---|---|
| `userId` | string | required, indexed |
| `foodId` | string | required — referenced, never copied (principle IV) |
| `amount` | int | required, ≥ 1 — base units of that food |
| `order` | int | default `0`; the reorder endpoint rewrites the whole set, as boards do |
| `eaten` | boolean | default `false` |
| `eatenDay` | day string? | set when logged |
| `note` | string? | ≤ 300 |

**Indexes**: `{ userId: 1, order: 1 }`.

Logging a queued row writes a normal `meal_entries` row (snapshotting the food's facts at that
moment) with `cheatMealId` set, then marks the queue row `eaten` with `eatenDay`. The queue row
survives as a record of the priority list, and can be re-queued by clearing `eaten`.

---

## Derived shapes (computed on read, in `libs/shared/domain/src/lib/nutrition.ts`)

| Shape | Contents |
|---|---|
| `EntryTotals` | `energyKcal`, `proteinMg`, `fatMg`, `carbMg`, `fibreMg?` for one entry |
| `SlotTotals` | the same, per slot, plus the entry rows |
| `DayTotals` | the same for a day, plus per-slot breakdown and entry count |
| `NutritionTargets` | `energyKcal`, `proteinG`, `fatG`, `carbG`, `fibreG`, each an `Estimate` (or a recorded value when overridden), plus `bmr`, `tdee`, `floorApplied`, `macroAdjustment?`, `projectedWeeklyChangeKg`, `rateVerdict`, `missingInputs[]` |
| `WeekBalance` | `weekStart`, `eatenKcal`, `targetKcal`, `differenceKcal`, `daysLogged`, `bankedKcal` |
| `CheatDayInfo` | `nextDay?`, `daysUntil?`, `isToday`, `queue[]` with per-row totals, `queueTotals`, `bankedKcal` |
| `NutritionSummary` | what the dashboard card needs: `eatenKcal`, `targetKcal?`, `leftKcal?`, `proteinLeftG?`, `entryCount`, `targetsAvailable`, `nextCheatDay?`, `daysUntilCheat?` |

Nothing in this table is ever written to Mongo.
