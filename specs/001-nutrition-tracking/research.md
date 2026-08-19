# Phase 0 Research: Food & Nutrition Tracking

Every decision below is settled; nothing is left as `NEEDS CLARIFICATION`. The one outstanding
input is the owner's initial food list, which blocks the seed task only.

---

## R1 — How nutrition facts are stored

**Decision**: canonically **per 100 base units**, as integers: `energyKcalPer100` in whole
kilocalories, and `proteinMgPer100` / `fatMgPer100` / `carbMgPer100` (plus optional
`fibreMgPer100`, `sugarMgPer100`, `satFatMgPer100`, `sodiumMgPer100`) in whole **milligrams**.
The food row also keeps `servingSize` (integer base units) and `entryMode`
(`per_serving` | `per_100`) so the add-food form reopens the way it was filled in.

**Rationale**: amounts are logged in base units, so per-100 makes every derivation a single
multiply with no serving-size dependency — and it means editing a food's serving size cannot
silently change its calorie density. Milligrams give three decimal places of a gram, far more
than any label carries, while keeping principle II's "no floats" rule intact; `*Mg` mirrors the
existing `*Cents` naming so the convention reads the same way.

**Alternatives considered**: storing exactly what the label says (per serving) — faithful, but
every calculation then depends on a mutable serving size, and two foods with the same food but
different serving sizes become incomparable. Storing grams as floats — rejected by principle II
and by the two real zeroing bugs that the no-float, no-`default: 0` rules exist to prevent.

---

## R2 — Meal entries freeze their facts

**Decision**: a `meal_entries` row stores `foodId`, `amount`, `unit` **and** a `facts`
subdocument holding the food's four per-100 integers plus its `name` and `brand` as they were
at log time. Day and week totals are still derived on read, always.

**Rationale**: the entry is the event row, and an event row records what was true when it
happened — exactly as a stock lot records its purchase price rather than today's quote.
Without the snapshot, fixing a typo in a food's calories next month silently rewrites every day
it has ever appeared in, and the log stops being evidence of anything. Keeping `foodId` as well
preserves grouping, recency and "log this again".

**Alternatives considered**: pure reference (simplest, but retroactively mutates history);
immutable foods (forbids ever correcting a typo); versioned foods, one row per edit (correct,
but fills the picker — the one surface that has to stay clean — with near-duplicates).

**Principle III note**: this is not a cached derivation and must not become one. Totals are
never stored; only the inputs are.

---

## R3 — Amounts stay in the food's own base unit

**Decision**: `unit` is `g` or `ml`, facts are per 100 g **or** per 100 ml accordingly, and the
logged `amount` is an integer in that same unit. No conversion to grams.

**Rationale**: converting ml to g needs a density we do not have. Assuming 1 ml = 1 g is wrong
by −8% for oil, +3% for milk and +40% for syrup — an error that would quietly corrupt every
total involving a liquid. The owner's requested UX ("enter servings or ml, whichever I prefer")
is unaffected: the modal converts between servings and base units, which needs only
`servingSize`.

**Alternatives considered**: grams-only with a per-food density field — honest, but adds a
field to every liquid food for no gain, since nothing in the app compares a volume to a mass.

---

## R4 — Which day an entry belongs to

**Decision**: the browser computes the day using a configurable `dayStartHour` (default 4) and
sends it explicitly — `?today=YYYY-MM-DD` for reads, `day` in the body for writes. The API
validates it with the existing `@Today()` decorator / `resolveToday()`. The default meal slot
is likewise computed from the browser's local hour.

**Rationale**: the server may be in a different timezone from the eater, and principle V
already insists "today" enters the system as an explicit argument. A 01:20 snack belongs to the
day that is ending, not the one that just started, which is what `dayStartHour` expresses:
`localDay = hour < dayStartHour ? yesterday : today`.

**Slot defaults**: breakfast up to 10:30, lunch to 15:30, dinner 17:00–21:30, snack otherwise.
Always editable in the modal; the boundaries are a convenience, not a rule.

**Alternatives considered**: deriving the day server-side (breaks for any travel, and for any
deploy region change); storing a full timestamp and bucketing at read time (more faithful, but
every query then needs the timezone and the day-start rule, and the existing codebase is
day-string throughout).

---

## R5 — The basal-rate and target model

**Decision**, in evaluation order, all in `libs/shared/domain/src/lib/nutrition.ts`:

1. **Basal metabolic rate (kcal/day)**
   - `profile.basalRateKcal` if the owner supplied one → used unchanged, **not** labelled an
     estimate.
   - else if a **recorded** body-fat percentage exists → **Katch–McArdle**:
     `370 + 21.6 × leanKg`, where `leanKg = weightKg × (1 − bodyFat)`.
   - else → **Mifflin–St Jeor**: `10 × weightKg + 6.25 × heightCm − 5 × age + (male ? 5 : −161)`.
2. **Body fat, when not recorded** → **Deurenberg**:
   `1.20 × BMI + 0.23 × age − 10.8 × (male ? 1 : 0) − 5.4`, clamped to 3–60%, returned as an
   `Estimate` with `confidence: 'low'` **for display only**. It never feeds step 1, because
   Katch–McArdle on an estimated lean mass is Mifflin–St Jeor with extra error.
3. **Maintenance energy (TDEE)** = `BMR × activityFactor`:
   `sedentary 1.2`, `light 1.375`, `moderate 1.55`, `very 1.725`, `athlete 1.9`.
4. **Goal energy** = `TDEE × goalFactor`: pure weight loss `0.75`, fat loss `0.85`,
   maintain `1.0`, lean gain `1.10`, max gain `1.20`.
5. **Energy floor** = `max(BMR, male ? 1500 : 1200)`. When the floor bites, the target is
   raised to it and `floorApplied` is set so the UI can say the deficit was reduced.
6. **Reference mass** for protein and fat: `leanKg` when body fat is **recorded**, otherwise
   `weightKg`, with the per-kg figures from the spec's FR-030 table (the lean-mass column is
   the higher one).
7. **Protein cap**: protein energy is capped at 40% of the target energy. This is the guard
   that keeps a per-kg figure sane at a high BMI when no body-fat percentage is available.
8. **Fat floor**: at least `0.5 g/kg` and at least 15% of target energy.
9. **Carbohydrate** = `(energy − protein × 4 − fat × 9) / 4`. If negative: reduce fat toward
   its floor first, then protein (never below `1.2 g/kg`), and report the adjustment in the
   `basis` string.
10. **Fibre suggestion** = `14 g per 1000 kcal`.
11. **Projected weekly change** = `(energy − TDEE) × 7 ÷ 7700` kg. Recommended rates are
    0.5–1.0% of body weight per week for loss and 0.25–0.5% for gain, but the *verdict*
    thresholds are deliberately wider: `fast` above 1.0% (loss) or 0.5% (gain), `slow` below
    0.25% either way, `sane` in between. A narrower rule made the app's own `fat_loss`
    recommendation (about 0.45% a week at 80 kg) report itself as too slow, which is the kind
    of self-contradiction that teaches the owner to ignore the warnings.
12. **Max gain is capped at +20%** deliberately, with the interface stating that a larger
    surplus mostly adds fat.

**Rationale**: Mifflin–St Jeor is the best-validated predictive equation for the general
population and is the default in clinical practice; Katch–McArdle is more accurate for lean or
muscular people because it scales with lean mass, which is why it is used only when lean mass
is actually known. The goal deltas are the conventional evidence-informed ranges (roughly
−0.5 to −1.0% body weight per week for loss, +0.25 to +0.5% for gain), and the protein figures
sit inside the ISSN's 1.4–2.0 g/kg range for trainees, at its top during a deficit where
protein protects lean mass, and at Helms' 2.3–3.1 g/kg **lean mass** band when lean mass is
known. The 7700 kcal/kg conversion is the standard rule of thumb and is stated as one: it
overestimates long-run loss because maintenance falls as body mass falls.

**Sources** (also used verbatim as the `basis` strings, per principle VI):
- Mifflin MD, St Jeor ST, et al. *A new predictive equation for resting energy expenditure in
  healthy individuals.* Am J Clin Nutr, 1990.
- Katch FI, McArdle WD, 1973 (lean-mass basal rate; cf. Cunningham 1980).
- Deurenberg P, Weststrate JA, Seidell JC. *Body mass index as a measure of body fatness.*
  Br J Nutr, 1991.
- Jäger R, et al. *ISSN position stand: protein and exercise.* JISSN, 2017.
- Aragon AA, et al. *ISSN position stand: diets and body composition.* JISSN, 2017.
- Helms ER, Aragon AA, Fitschen PJ. *Evidence-based recommendations for natural bodybuilding
  contest preparation: nutrition and supplementation.* JISSN, 2014.
- Garthe I, et al. *Effect of two different weight-loss rates on body composition and strength
  and power-related performance in elite athletes.* Int J Sport Nutr Exerc Metab, 2011.
- Institute of Medicine, Dietary Reference Intakes, 2005 (fibre 14 g per 1000 kcal).
- Wishnofsky M, 1958 (3500 kcal/lb ≈ 7700 kcal/kg), used as a rule of thumb with its known
  long-run bias stated.

**Alternatives considered**: Harris–Benedict (older, overestimates by ~5% in modern
populations); Cunningham instead of Katch–McArdle (near-identical output, less commonly cited);
percentage-based macro splits such as 40/30/30 (they scale protein with calories rather than
with body mass, so they under-deliver protein in exactly the deficit where it matters most).

**Not medical advice**: every figure is model output, labelled as such. No clinical claim.

---

## R6 — Weight as event rows

**Decision**: a `weigh_ins` collection with one row per dated measurement
(`day`, `weightGrams`, optional `bodyFatPct`), current weight = latest row by `day`. A second
weigh-in on a day that already has one replaces it.

**Rationale**: principle III — the profile holds intent (goal, activity, height), the log holds
measurements. It also gives the weight trend and the average weekly change for free, and lets a
back-dated correction fix the past properly. Weight is stored in **grams** as an integer for the
same reason money is in cents.

**Alternatives considered**: a mutable `weightKg` field on the profile (no history, and a
back-dated correction is impossible); an array on the profile document (a growing unbounded
array inside a document that is read on every dashboard build).

---

## R7 — Food ordering and usage, without denormalising

**Decision**: `GET /api/nutrition/foods` returns each food with derived `lastUsedDay` and
`useCount`, produced by one aggregation over `meal_entries`
(`$match userId → $group by foodId → $max day, $sum 1`), merged onto the food list in the
service. Ordering: favourites first, then `lastUsedDay` descending, then `createdAt`
descending. Search filters on name and brand, case-insensitive.

**Rationale**: a stored `lastUsedAt` is a cache of a derived fact — precisely what principle III
forbids — and it drifts the moment an entry is deleted or back-dated. At this scale the
aggregation is trivial and the index `{ userId: 1, foodId: 1 }` covers it.

**Alternatives considered**: `$lookup` from foods to entries (heavier, harder to read); updating
a counter on write (drifts on delete, and needs a migration to fix when it does).

---

## R8 — Cheat day: countdown, queue and banked calories

**Decision**:
- `cheatDays` is a set of weekday numbers, **0 = Sunday**, matching `weekdayOf()` in the
  existing `dates.ts`.
- **Countdown**: the nearest configured weekday at or after today; today is 0 days. No cheat
  days configured → the section invites the owner to set one rather than showing a countdown.
- **Queue**: `cheat_meals` rows referencing `foodId` with an `amount`, an integer `order` and
  `eaten`. Reordering posts the full id array, exactly like `POST /api/boards/:key/tasks/order`.
  Calories and macros are read through the food reference, never copied onto the row
  (principle IV).
- **Banked calories** for the current week (Monday-start): the sum over days **before today**
  that have at least one entry of `(dayTarget − dayEaten)`, clamped to ≥ 0, presented as an
  *allowance*.

**Rationale**: only counting days that were actually logged is the part that matters — treating
an unlogged day as a full deficit would hand out a fictional 2000-calorie allowance every time
the owner forgets to log. Monday-start matches the `en-GB` formatting used everywhere else.

**Alternatives considered**: a fixed cheat-day calorie multiplier (arbitrary, and unrelated to
what the week actually looked like); rolling seven-day window (harder to reason about — "this
week" is a thing people plan around, a rolling window is not).

---

## R9 — Reordering without a new dependency

**Decision**: native HTML5 drag events (`draggable`, `onDragStart`, `onDragOver`, `onDrop`) plus
always-present ↑/↓ buttons, posting the resulting id array to the reorder endpoint.

**Rationale**: the constitution requires a written justification for any new dependency, and a
drag-and-drop library cannot be justified for one list of a handful of rows. The ↑/↓ buttons
also make the list usable by keyboard and on a phone, where HTML5 drag is unreliable.

---

## R10 — Open Food Facts integration

**Findings** (verified against the current API documentation):
- **Barcode**: `GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json`.
- **Full-text search** is *not* available in API v2/v3; the documented route is Search-a-licious:
  `GET https://search.openfoodfacts.org/search?q=…`. The legacy
  `world.openfoodfacts.org/cgi/search.pl?search_terms=…&json=1` remains as a fallback.
- **No API key** is needed for reads. A **custom `User-Agent` is required**, in the form
  `AppName/Version (contact)`; generic agents risk being treated as a bot.
- **Documented rate limits**: 10 requests/minute/IP for search, 15 requests/minute/IP for
  product reads. Exceeding them risks an IP ban.
- **Licence**: database under ODbL 1.0 (contents under the Database Contents Licence, images
  CC-BY-SA). **Attribution is required** where imported data is shown.

**Decision**: an `OpenFoodFactsProvider` in the nutrition module, modelled on
`finnhub.provider.ts` — returns `null` or an empty list instead of throwing, exposes an
`unavailableReason` string for the UI, and has an 8-second timeout. The `User-Agent` comes from
config (`OFF_USER_AGENT`, defaulting to `LifePortal/1.0 (+https://github.com/…)`; an optional
`OFF_CONTACT_EMAIL` is appended when set, and no address is hard-coded). Search results are
cached in-process for 10 minutes, keyed by the normalised query, bounded to 100 entries. The web
side debounces input by 400 ms and requires three characters. Imported fields map as:
`product_name → name`, `brands → brand`, `nutriments['energy-kcal_100g'] → energyKcalPer100`,
`proteins_100g / fat_100g / carbohydrates_100g → *Mg` (× 1000), `fiber_100g`, `sugars_100g`,
`saturated-fat_100g`, `sodium_100g` likewise, `serving_quantity → servingSize`, and the unit
from `serving_quantity_unit` / `product_quantity_unit`, defaulting to `g`. A missing nutriment
is imported as **absent**, never as zero. The import screen carries the ODbL attribution and a
link to the source product.

**Rationale**: it satisfies "external APIs degrade gracefully" and "free-tier deployable", and
the search cap is the whole reason for the debounce and the cache. Rate-limit and outage
handling is one code path: no result, a reason string, manual entry still available.

---

## R11 — Rounding, so totals cannot drift

**Decision**: per entry, `energyKcal = round(amount × energyKcalPer100 / 100)` and
`macroMg = round(amount × macroMgPer100 / 100)`. Day totals sum the rounded per-entry values;
week totals sum the day totals. Rendering shows whole calories and whole grams
(`Math.round(mg / 1000)`), never a decimal gram.

**Rationale**: rounding once per entry keeps the number in a table identical to the number in
the total — the alternative, rounding only at the end, produces rows that visibly fail to add
up. Sub-calorie error per entry is irrelevant against label accuracy of ±10%.

---

## R12 — The dashboard quick-add and the constitution

**Decision**: amend principle I to allow **at most one primary quick action per summary card**,
bump the constitution to 1.1.0, and record the amendment and its reasoning in
`docs/DECISIONS.md` in the same change. The nutrition card's stats stay within the
three-numbers rule: eaten today, left today, protein left.

**Rationale**: the constitution's own governance clause requires either following a principle or
amending it in the same change — never silently diverging. The owner's use case (three to six
logs a day) is a real justification, and confining the exception to *one* action per card keeps
the "cards are not dashboards" intent intact.

**Alternatives considered**: a floating quick-add in the app shell (puts a food-specific action
in shared chrome, a worse boundary violation); navigation-only (rejected by the owner, and the
friction is what kills food logging).
