# Phase 1 Contracts: `/api/nutrition`

Every route is JWT-guarded by the global guard and scoped to `userId`; none is `@Public()`.
Writes take a `class-validator` DTO. Days are `YYYY-MM-DD` strings supplied by the client
(research R4); reads accept `?today=` and pass it through the existing `@Today()` decorator.

Shared contracts live in `libs/shared/types/src/lib/nutrition.ts`. Field names below are the
wire names.

---

## Overview — one round trip for the detail page

### `GET /api/nutrition?today=YYYY-MM-DD&day=YYYY-MM-DD`

`day` defaults to `today`. Returns everything `/nutrition` renders:

```ts
interface NutritionOverview {
  today: IsoDate;
  day: IsoDate;                    // the day being viewed
  profile: NutritionProfile;
  targets: NutritionTargets;       // Estimate-wrapped figures + missingInputs[]
  dayTotals: DayTotals;            // per-slot breakdown, entries included
  week: WeekBalance;
  cheat: CheatDayInfo;
  weighIns: WeighIn[];             // ascending by day, for the trend
  foods: FoodWithUsage[];          // catalogue + derived lastUsedDay/useCount, picker order
  savedMeals: SavedMeal[];
  recentMeals: RecentMeal[];       // last 10 logged (day, slot, entries) for one-tap repeat
  foodLookup: { available: boolean; reason?: string };  // Open Food Facts status
}
```

### `GET /api/nutrition/summary?today=YYYY-MM-DD`

Returns `NutritionSummary` — the dashboard card's three numbers plus the cheat-day countdown.
Consumed by `DashboardService`, not fetched separately by the browser.

---

## Foods

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/foods` | `?q=&favourite=&includeArchived=` | `FoodWithUsage[]`, picker order |
| `POST` | `/foods` | `CreateFoodDto` | `Food` |
| `PATCH` | `/foods/:id` | `UpdateFoodDto` | `Food` |
| `DELETE` | `/foods/:id` | — | `{ id, deleted: true }` if unused, otherwise `{ id, archived: true }` |

```ts
class CreateFoodDto {
  name: string;                 // ≤ 160
  brand?: string;               // ≤ 120
  unit?: 'g' | 'ml';            // default 'g'
  servingSize: number;          // int ≥ 1
  servingLabel?: string;
  entryMode?: 'per_serving' | 'per_100';   // default 'per_serving'
  // Facts, in the mode indicated by entryMode. The service normalises to per-100 on write.
  energyKcal: number;           // int ≥ 0
  proteinMg: number;            // int ≥ 0
  fatMg: number;                // int ≥ 0
  carbMg: number;               // int ≥ 0
  fibreMg?: number; sugarMg?: number; satFatMg?: number; sodiumMg?: number;
  favourite?: boolean;
  barcode?: string;
  notes?: string;
}
```

`UpdateFoodDto` is `CreateFoodDto` with every field optional. A food that appears in any
`meal_entries` row is **archived** rather than deleted, so history keeps its name in the picker's
"archived" filter without cluttering the default list.

The response includes both the stored per-100 figures and a `perServing` block, so the UI never
does the arithmetic twice.

### Open Food Facts

| Method | Path | Query / body | Returns |
|---|---|---|---|
| `GET` | `/foods/lookup?q=` | ≥ 3 chars | `{ available, reason?, results: FoodLookupResult[] }` |
| `GET` | `/foods/lookup/barcode/:code` | — | `{ available, reason?, result?: FoodLookupResult }` |
| `POST` | `/foods/import` | `{ code: string }` | `Food` — fetched server-side and stored |

```ts
interface FoodLookupResult {
  code: string;                 // OFF product code, used by /foods/import
  name: string;
  brand?: string;
  unit: 'g' | 'ml';
  servingSize?: number;
  energyKcalPer100?: number;    // absent, never 0, when the source has no value
  proteinMgPer100?: number; fatMgPer100?: number; carbMgPer100?: number;
  fibreMgPer100?: number; sugarMgPer100?: number; satFatMgPer100?: number; sodiumMgPer100?: number;
  imageUrl?: string;
  attribution: string;          // ODbL notice + source URL, rendered on the import screen
}
```

Never throws on provider failure: `available: false` with a `reason`, empty results, and manual
entry stays open (FR-016). Import copies the values into an owned `foods` row with
`source: 'openfoodfacts'` and `sourceRef: code`; from then on it is the owner's row and editable.

---

## Entries

| Method | Path | Body / query | Returns |
|---|---|---|---|
| `GET` | `/entries` | `?day=` or `?from=&to=` | `MealEntry[]` |
| `POST` | `/entries` | `CreateEntryDto` | `MealEntry` |
| `PATCH` | `/entries/:id` | `UpdateEntryDto` | `MealEntry` |
| `DELETE` | `/entries/:id` | — | `{ id, deleted: true }` |
| `POST` | `/entries/repeat` | `RepeatMealDto` | `MealEntry[]` |

```ts
class CreateEntryDto {
  day: string;                  // YYYY-MM-DD, from the client's clock + dayStartHour
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'uncategorized';
  foodId: string;               // MongoId
  // Exactly one of the two. `servings` is converted with the food's servingSize and rounded
  // to a whole base unit; the stored row always carries `amount`.
  amount?: number;              // int ≥ 1 base units
  servings?: number;            // > 0, up to 2 decimal places
  note?: string;
}

class RepeatMealDto {
  sourceDay: string;
  sourceSlot?: string;          // omit to repeat the whole day
  entryIds?: string[];          // or repeat only these
  day: string;                  // target day
  slot?: string;                // target slot, defaults to the source slot
}
```

`UpdateEntryDto` allows `amount`/`servings`, `slot`, `day` and `note`. `foodId` is not editable —
changing the food means a different meal; delete and log again. The `facts` snapshot is always
built server-side from the food (never accepted from the client) and is **not** refreshed on a
later `PATCH` of the amount: correcting the quantity of a meal must not silently re-price it.

---

## Saved meals

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/meals` | — | `SavedMeal[]` with current totals |
| `POST` | `/meals` | `{ name, defaultSlot?, components: [{ foodId, amount }] }` | `SavedMeal` |
| `POST` | `/meals/from-day` | `{ name, day, slot }` | `SavedMeal` — saves what was logged in that slot |
| `PATCH` | `/meals/:id` | partial | `SavedMeal` |
| `DELETE` | `/meals/:id` | — | `{ id, deleted: true }` |
| `POST` | `/meals/:id/log` | `{ day, slot? }` | `MealEntry[]` — one row per component |

---

## Profile and weigh-ins

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/profile?today=` | — | `{ profile, targets }` — upserted with defaults on first read |
| `PUT` | `/profile` | `UpdateProfileDto` | `{ profile, targets }` |
| `GET` | `/weigh-ins` | — | `WeighIn[]` ascending by day |
| `PUT` | `/weigh-ins` | `{ day, weightGrams, bodyFatPct?, note? }` | `WeighIn` — upsert keyed on day |
| `DELETE` | `/weigh-ins/:id` | — | `{ id, deleted: true }` |

`UpdateProfileDto` covers `sex`, `heightCm`, `birthDate`, `activityLevel`, `goal`,
`basalRateKcal`, `cheatDays`, `dayStartHour` and the four override fields. Every field optional;
validation ranges as in [data-model.md](../data-model.md).

`targets` is returned alongside the profile on every write, so the settings panel shows the new
numbers without a second request:

```ts
interface NutritionTargets {
  available: boolean;
  missingInputs: string[];                  // e.g. ['birthDate', 'weighIn']
  bmr?: Estimate<number>;                   // basis names the equation used
  tdee?: Estimate<number>;
  bodyFatPct?: Estimate<number>;            // Deurenberg, confidence 'low', display only
  energyKcal?: Estimate<number> | Recorded<number>;
  proteinG?: Estimate<number> | Recorded<number>;
  fatG?: Estimate<number> | Recorded<number>;
  carbG?: Estimate<number> | Recorded<number>;
  fibreG?: Estimate<number>;
  floorApplied?: { floorKcal: number; requestedKcal: number; reason: string };
  macroAdjustment?: { what: 'fat' | 'protein'; fromG: number; toG: number; reason: string };
  projectedWeeklyChangeKg?: number;
  rateVerdict?: 'sane' | 'fast' | 'slow';
  goalNote?: string;                        // e.g. the +20% cap explanation for max_gain
}
```

`Recorded<T>` is `{ value: T; recorded: true }` — the shape the UI uses to decide whether to
render `EstimateMark` (principle VI: a user-supplied number is never labelled an estimate).

---

## Cheat day

| Method | Path | Body | Returns |
|---|---|---|---|
| `GET` | `/cheat?today=` | — | `CheatDayInfo` |
| `POST` | `/cheat` | `{ foodId, amount?, servings?, note? }` | queue row |
| `PATCH` | `/cheat/:id` | `{ amount?, servings?, note?, eaten? }` | queue row |
| `DELETE` | `/cheat/:id` | — | `{ id, deleted: true }` |
| `POST` | `/cheat/order` | `{ order: string[] }` | queue rows in the new order |
| `POST` | `/cheat/:id/log` | `{ day, slot? }` | `MealEntry` |

`POST /cheat/order` mirrors `POST /api/boards/:key/tasks/order`: the full id array, rewritten to
`order: index`. Ids not belonging to the user are ignored, not errors.

---

## Dashboard addition

`libs/shared/types/src/lib/dashboard.ts`:

- `WIDGET_KEYS` gains `'nutrition'`.
- `DashboardResponse.summaries` gains `nutrition: NutritionSummary`.
- `WidgetCard` gains one optional field: `quickAction?: { kind: 'log-food'; label: string }`.
  The dashboard page maps `kind` to a component; the API never ships a URL or a handler.

`DashboardService.build()` gains `this.nutrition.summary(userId, today)` in its `Promise.all` and
a `nutritionCard()` builder returning three stats — calories eaten, calories left, protein left —
tone `bad` when over target, `warn` within 10% of it, `good` otherwise, plus
`quickAction: { kind: 'log-food' }`. When targets are unavailable the card shows calories eaten
and an `alert` inviting the profile to be completed (FR-042). `netPositionCents` is untouched:
food is not money.
