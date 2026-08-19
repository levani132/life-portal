# Feature Specification: Food & Nutrition Tracking

**Feature Branch**: `001-nutrition-tracking`

**Created**: 2026-08-19

**Status**: Draft

**Input**: User description: a new widget for food tracking — calories absorbed and left to absorb today, quick-add from the dashboard card, meal slots (breakfast / lunch / dinner / snack / uncategorized), a personal food database, calorie and macro targets derived from body metrics and a chosen goal, and a prioritised cheat-day meal queue with a countdown.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Log what I ate and see where today stands (Priority: P1)

The owner glances at the dashboard, sees how many calories they have eaten today and how many
are left, and taps a single "+" to record something they just ate. The modal opens with the
meal slot already chosen from the time of day, offers the foods they use most, and shows the
calories and macros the entry will add *before* it is saved. Inside the widget's own page the
same "+" appears on each meal slot, and every logged entry can be corrected or removed.

**Why this priority**: This is the loop that runs three to six times a day. If logging is not
fast, nothing else in the widget matters, and the numbers stop being true within a week.

**Independent Test**: With a handful of foods present and no profile filled in, a meal can be
logged from both the dashboard and the widget page, appears under the right slot, and today's
totals change by exactly the expected amount.

**Acceptance Scenarios**:

1. **Given** the dashboard is open at 08:40, **When** the owner taps "+" on the food card,
   **Then** the log modal opens with "breakfast" pre-selected and today's date.
2. **Given** the log modal is open with a food chosen, **When** the owner types 1.5 servings,
   **Then** the amount in grams (or millilitres) updates to match and the preview shows the
   resulting calories, protein, carbs and fat.
3. **Given** the owner instead types an amount of 45 g, **When** the field loses focus,
   **Then** the servings figure updates to match and the preview recalculates.
4. **Given** a meal has been recorded, **When** the owner returns to the dashboard,
   **Then** "eaten today" has increased and "left today" has decreased by the same amount.
5. **Given** an entry was logged with the wrong amount, **When** the owner edits the amount or
   deletes the entry, **Then** the slot list, today's totals and the dashboard card all agree
   with the correction.
6. **Given** it is 01:20 and the day-start hour is 04:00, **When** the owner logs a snack,
   **Then** the entry is recorded against the previous calendar day.

---

### User Story 2 - Know what I should be eating (Priority: P2)

The owner fills in their body metrics and picks a goal, and the widget answers "how much
should I eat" — calories, protein, carbs and fat per day — showing how each figure was
derived and warning when the goal has been clipped by a safety floor. Weight is recorded as
a dated weigh-in, so the targets follow the owner's actual weight over time.

**Why this priority**: Without targets, "left to absorb" has no meaning. It is second only
because logging is still useful on its own, and the targets need the log to be worth reading.

**Independent Test**: Enter sex, height, date of birth, activity level, a weigh-in and a
goal; the four target figures appear with their basis, and changing the goal changes them in
the documented direction.

**Acceptance Scenarios**:

1. **Given** an empty profile, **When** the owner opens the widget, **Then** targets are shown
   as unavailable with a prompt naming exactly which inputs are missing.
2. **Given** sex, height, date of birth, activity level, current weight and a goal are known,
   **When** the owner saves the profile, **Then** daily calorie, protein, fat and carbohydrate
   targets are shown, each labelled with the method and inputs used to derive it.
3. **Given** the owner records a body-fat percentage, **When** the targets are recalculated,
   **Then** the basis states that lean mass was used, and the protein target rises accordingly.
4. **Given** the owner supplies their own measured basal metabolic rate, **When** the targets
   are recalculated, **Then** that value is used unchanged and is *not* labelled as an estimate.
5. **Given** a goal whose deficit would take the calorie target below the safety floor,
   **When** the targets are shown, **Then** the target is raised to the floor and a visible
   warning explains that the requested deficit was reduced.
6. **Given** a new weigh-in is recorded, **When** the owner returns to the widget,
   **Then** the targets reflect the new weight and the weight trend includes the new point.

---

### User Story 3 - Grow my own food database (Priority: P3)

The owner adds the foods they actually eat: name, brand, serving size and unit, and the
energy and macros — entered either per serving as printed on the packet, or per 100 g/ml.
Foods can also be found by name or barcode in a public food database and imported with one
tap, with manual entry always available when that lookup is unavailable. Frequently eaten
combinations can be saved as a single item, and any earlier meal can be repeated in one tap.

**Why this priority**: The initial list of foods covers the first weeks; after that the widget
is only as useful as the owner's ability to add what is missing in under a minute.

**Independent Test**: Add a food by hand from a packet label, log it, then import a second
food from the public database and log that too; both appear in the food list ordered by
recent use.

**Acceptance Scenarios**:

1. **Given** the add-food form, **When** the owner enters per-serving values and a serving size,
   **Then** the food is stored such that logging exactly one serving reproduces those values.
2. **Given** the add-food form in per-100 mode, **When** the owner enters per-100 values,
   **Then** logging one serving yields serving-size-scaled values.
3. **Given** the food picker, **When** it opens, **Then** foods are ordered most-recently-used
   first, then most-recently-added, and a search box narrows the list by name or brand.
4. **Given** the public food lookup is unavailable or rate-limited, **When** the owner searches,
   **Then** a plain message says so and manual entry remains fully usable.
5. **Given** a saved multi-food meal, **When** the owner logs it, **Then** one action records
   every component with its saved amount under the chosen slot.
6. **Given** an earlier meal, **When** the owner chooses "repeat", **Then** the same foods and
   amounts are logged against today under the chosen slot.
7. **Given** a food's calorie value was wrong and is corrected today, **When** the owner looks
   at a day it was logged on last week, **Then** that day's totals are unchanged.

---

### User Story 4 - Cheat day queue and countdown (Priority: P4)

The owner keeps a prioritised list of the things they want to eat on their next cheat day,
picked from the food database and shown with their calories and macros, reorderable by
dragging. The widget names the next cheat day and counts down to it, and on the day itself
each queued item can be logged with one tap.

**Why this priority**: It is what makes the diet sustainable rather than a chore, but the
tracker works without it.

**Independent Test**: Configure Saturday as a cheat day, queue three items, reorder them,
and confirm the countdown and totals; on a Saturday, log the top item in one tap.

**Acceptance Scenarios**:

1. **Given** cheat days include Saturday and today is Wednesday, **When** the widget is opened,
   **Then** the cheat section names Saturday and shows 3 days remaining.
2. **Given** several cheat days are configured, **When** the countdown is shown, **Then** it
   counts to the nearest one, and today counts as zero days if today is a cheat day.
3. **Given** no cheat days are configured, **When** the widget is opened, **Then** the section
   invites the owner to set one instead of showing an empty countdown.
4. **Given** a queue of items, **When** the owner drags one to the top, **Then** the new order
   survives a reload.
5. **Given** it is a cheat day, **When** the owner taps "log this" on a queued item,
   **Then** the item is recorded as a real meal entry for today and marked as eaten.
6. **Given** a queued item, **When** the queue is shown, **Then** its calories and macros are
   read from the referenced food, and the queue's running total is displayed.

---

### User Story 5 - The week, not just the day (Priority: P5)

The owner sees the week's calorie balance alongside today's, so a heavy day read in context
rather than as a failure, and the cheat day can be funded by calories banked from the rest of
the week. The weight trend is shown next to it.

**Why this priority**: Weekly consistency is what actually moves body weight, but it is a
refinement of a working daily tracker.

**Independent Test**: Log several days under target, then confirm the week view shows the
accumulated surplus and the cheat-day allowance it funds.

**Acceptance Scenarios**:

1. **Given** logged days this week, **When** the week view is shown, **Then** it shows the
   week's eaten total, the week's target total and the difference.
2. **Given** the owner has eaten under target so far this week, **When** the cheat section is
   shown, **Then** the banked calories available for the cheat day are stated, labelled as an
   allowance rather than a rule.
3. **Given** a run of weigh-ins, **When** the trend is shown, **Then** it plots weight against
   date and states the average weekly change.

---

### Edge Cases

- **Late-night eating**: an entry made before the day-start hour belongs to the previous day.
  The day and the default slot are decided by the owner's own clock, not the server's.
- **Travel across timezones**: the day sent with the entry is whatever the owner's device
  believes; no attempt is made to reconcile a day that was 26 hours long.
- **Incomplete profile**: any missing input needed for the calorie target leaves targets
  unavailable and names the missing fields; logging still works and still shows "eaten today".
- **Impossible goals**: a deficit that would take calories below the floor is clipped, with a
  warning. A macro split that would leave negative carbohydrates reduces fat first, then
  protein, and says so.
- **Body-fat percentage of zero versus not recorded**: zero is a recorded value and is
  rejected as out of range; "not recorded" falls back to the weight-based method.
- **Both a measured basal rate and a body-fat percentage present**: the measured rate wins.
- **Estimated body fat**: when body fat is not recorded, the displayed estimate is marked
  low-confidence and is never used to derive the calorie target.
- **A food edited or deleted after being logged**: past entries keep the values they were
  logged with. A deleted food leaves its history intact.
- **A cheat-queue item or saved multi-food meal whose food was deleted**: the row is shown as
  unavailable with a prompt to replace or remove it, and cannot be logged.
- **Absurd amounts**: an amount of zero or a negative amount is rejected; an implausibly large
  amount is accepted but flagged, because 1 kg of rice is a real meal and 100 kg is a typo.
- **Fractional servings**: half and quarter servings are supported; the servings and amount
  fields stay consistent to the nearest whole base unit.
- **Two weigh-ins on the same day**: the later one replaces the earlier one.
- **A second entry of the same food in the same slot**: kept as two rows, not merged, so each
  can be corrected independently.
- **Public food lookup returns a food with missing macros**: it is imported with the fields it
  has, and the gaps are shown as unknown rather than zero.

## Requirements *(mandatory)*

### Functional Requirements

**Logging**

- **FR-001**: Users MUST be able to record a food eaten, choosing a meal slot from breakfast,
  lunch, dinner, snack or uncategorized.
- **FR-002**: System MUST offer the amount as either a number of servings or an amount in the
  food's own unit, keeping the two in sync, and MUST record the amount in that unit.
- **FR-003**: System MUST show the calories, protein, carbohydrate and fat an entry will add
  before it is recorded.
- **FR-004**: System MUST pre-select the meal slot from the time of day when the log action is
  started from the dashboard, and MUST pre-select the originating slot when started from a slot.
- **FR-005**: System MUST determine the day an entry belongs to from the user's local clock and
  a configurable day-start hour, defaulting to 04:00.
- **FR-006**: Users MUST be able to edit and delete any recorded entry, with all totals
  following the correction.
- **FR-007**: System MUST record on each entry the nutrition values that were used at the time
  of logging, so later corrections to a food never alter previously logged days.
- **FR-008**: System MUST derive all daily and weekly totals on read; no total may be stored.
- **FR-009**: Users MUST be able to repeat a previously logged meal in one action.

**Food database**

- **FR-010**: Users MUST be able to add a food with a name, an optional brand, a serving size,
  a unit of grams or millilitres, and its energy, protein, fat and carbohydrate content.
- **FR-011**: System MUST accept those values either per serving or per 100 units, converting
  between them, and MUST remember which way the food was entered.
- **FR-012**: System MUST support optional fibre, sugar, saturated fat and sodium per food.
- **FR-013**: Users MUST be able to edit and delete foods, without affecting logged history.
- **FR-014**: System MUST order the food picker most-recently-used first, then
  most-recently-added, deriving usage from the log rather than storing it on the food.
- **FR-015**: Users MUST be able to search foods by name and brand, and mark foods as
  favourites so they surface first.
- **FR-016**: Users MUST be able to search a public food database by name or barcode and import
  a result as a food, and the feature MUST remain fully usable by manual entry when that
  lookup fails, is unavailable or is rate-limited.
- **FR-017**: Users MUST be able to save a named combination of foods and amounts and log it
  in one action.
- **FR-018**: System MUST store energy as whole calories and macronutrients as whole
  milligrams; no nutritional value may be stored as a floating-point number.

**Profile and targets**

- **FR-019**: Users MUST be able to record sex, height, date of birth, activity level, goal,
  optional body-fat percentage, optional measured basal metabolic rate, cheat days and
  day-start hour.
- **FR-020**: Users MUST be able to record dated weigh-ins, optionally with a body-fat
  percentage; the most recent weigh-in is the current weight.
- **FR-021**: System MUST offer these goals: pure weight loss, fat loss, **body recomposition
  (lose fat and build muscle at once)**, no change, muscle gain without fat gain, and maximum
  growth.
- **FR-022**: System MUST derive a daily calorie target and protein, fat and carbohydrate
  targets from the profile and the goal, using the model below.
- **FR-023**: System MUST label every derived figure with the method and inputs used, and MUST
  NOT label a user-supplied value as an estimate.
- **FR-024**: System MUST warn visibly when a calorie target has been raised to the safety
  floor, and when a macro split has been adjusted to keep carbohydrates non-negative.
- **FR-025**: System MUST state targets as unavailable, naming the missing inputs, when the
  profile lacks what the calculation needs.
- **FR-026**: System MUST show the projected weekly weight change implied by the target and
  whether it falls inside a sane rate.

**Nutrition target model** *(the derivation FR-022 refers to)*

- **FR-030a**: Recomposition MUST carry a note stating the conditions it depends on — resistance
  training, the protein target, sleep, and starting body fat — because unlike the other goals its
  outcome is conditional on behaviour the app cannot see. Its protein ceiling is 50% of the energy
  target rather than the default 40%.
- **FR-027**: Basal metabolic rate is the user's own value when supplied; otherwise, when a
  body-fat percentage is recorded, `370 + 21.6 × lean kg` (Katch–McArdle); otherwise
  `10 × kg + 6.25 × cm − 5 × age`, `+5` for male and `−161` for female (Mifflin–St Jeor).
- **FR-028**: When body fat is not recorded, the displayed estimate is
  `1.20 × BMI + 0.23 × age − 10.8 × (1 if male else 0) − 5.4` (Deurenberg), marked
  low-confidence, and MUST NOT feed the basal rate.
- **FR-029**: Maintenance energy is the basal rate multiplied by an activity factor:
  sedentary 1.2, lightly active 1.375, moderately active 1.55, very active 1.725,
  athlete 1.9.
- **FR-030**: Goal targets, where protein and fat are per kilogram of body weight, or per
  kilogram of lean mass at the bracketed figure when body fat is recorded, and carbohydrate is
  the remaining energy:

  | Goal | Energy | Protein | Fat |
  |---|---|---|---|
  | Pure weight loss | maintenance − 25% | 2.2 g/kg (2.6 g/kg lean) | 0.6 g/kg |
  | Fat loss | maintenance − 15% | 2.0 g/kg (2.3 g/kg lean) | 0.8 g/kg |
  | Recomposition | maintenance − 10% | 2.4 g/kg (2.8 g/kg lean) | 0.8 g/kg |
  | No change | maintenance | 1.6 g/kg | 0.9 g/kg |
  | Muscle without fat | maintenance + 10% | 1.8 g/kg | 0.9 g/kg |
  | Maximum growth | maintenance + 20% | 1.8 g/kg | 1.0 g/kg |

- **FR-031**: The calorie target is floored at the greater of the basal rate and 1500 calories
  for men or 1200 for women.
- **FR-032**: Carbohydrate target is `(energy − protein × 4 − fat × 9) / 4`; if negative, fat
  is reduced first, then protein, and the adjustment is reported.
- **FR-033**: A fibre suggestion of 14 g per 1000 calories is shown alongside the macros.
- **FR-034**: Projected weekly weight change is `(target − maintenance) × 7 ÷ 7700` kilograms,
  compared against the recommended 0.5–1.0% of body weight per week for loss and 0.25–0.5% for
  gain. The verdict thresholds are wider than the recommended bands: a rate is called *fast*
  above 1.0% (loss) or 0.5% (gain), *slow* below 0.25% either way, and *sane* in between — so a
  gentle deficit inside the recommended band is never reported as a problem.
- **FR-035**: Maximum growth is capped at maintenance + 20%, and the interface MUST state that
  a larger surplus mostly adds fat.

**Cheat day**

- **FR-036**: Users MUST be able to configure one or more weekdays as cheat days.
- **FR-037**: Users MUST be able to queue foods with an amount as cheat-day meals, reorder them
  by dragging, and remove them.
- **FR-038**: System MUST show each queued item's calories and macros and the queue's total,
  read from the referenced food rather than copied onto the queue row.
- **FR-039**: System MUST name the next cheat day and the number of days until it, treating
  today as zero when today is a cheat day.
- **FR-040**: Users MUST be able to log a queued item as a real meal entry in one action, after
  which it is marked as eaten.

**Dashboard and week view**

- **FR-041**: The dashboard card MUST show calories eaten today, calories left today and
  protein left today, and MUST carry a single quick-add action.
- **FR-042**: The dashboard card MUST remain readable when targets are unavailable, showing
  what was eaten and inviting the profile to be completed.
- **FR-043**: System MUST show the week's eaten total, target total and the difference, and the
  banked calories available for the next cheat day, labelled as an allowance.
- **FR-044**: System MUST show the weight trend and the average weekly change over the recorded
  weigh-ins.

**Scoping and data**

- **FR-045**: Every food, entry, weigh-in, saved meal, queue row and profile MUST belong to
  exactly one user and MUST never be readable by another.
- **FR-046**: The initial list of foods supplied by the owner MUST be loadable repeatedly
  without creating duplicates.

### Key Entities

- **Food**: something that can be eaten, with a name, optional brand, a serving size, a unit
  of grams or millilitres, its energy and macronutrients per 100 units, optional micro detail,
  a favourite flag, and which way its values were entered.
- **Meal entry**: one food eaten, on one day, in one slot, with an amount and a frozen copy of
  the nutrition values used. The only row written when logging; every total derives from these.
- **Saved meal**: a named list of foods and amounts that logs as a group.
- **Nutrition profile**: the owner's sex, height, date of birth, activity level, goal, optional
  body-fat percentage, optional measured basal rate, cheat days and day-start hour.
- **Weigh-in**: a dated body weight with an optional body-fat percentage. The latest is current.
- **Cheat-day queue row**: a reference to a food, an amount, a position in the priority order,
  and whether it has been eaten.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A food already in the database can be logged from the dashboard in three
  interactions and under 15 seconds, without leaving the dashboard.
- **SC-002**: Calories eaten and calories left today are visible without opening the widget's
  own page.
- **SC-003**: A new food can be added from a packet label in under 60 seconds, and imported
  from the public database in under 15 seconds.
- **SC-004**: Correcting a food's nutrition values changes no previously logged day's totals.
- **SC-005**: Editing or deleting an entry updates the day's totals, the week's totals and the
  dashboard card consistently, with no stale figure anywhere.
- **SC-006**: Every target figure on screen can be traced to its method and inputs by the user
  without leaving the page.
- **SC-007**: Changing the goal changes the calorie target in the documented direction and by
  the documented proportion, for every one of the five goals.
- **SC-008**: A weigh-in recorded today is reflected in the targets on the next view of the
  widget.
- **SC-009**: The cheat-day countdown is correct for every weekday configuration, including
  today, multiple days, and none configured.
- **SC-010**: The widget remains fully usable — logging, totals, food entry — when the public
  food lookup is unreachable.
- **SC-011**: A meal logged at 01:00 appears on the previous day, and one logged at 05:00
  appears on the current day.
- **SC-012**: Nothing in the widget shows a nutrition figure with false precision: energy to
  the calorie, macros to the gram.

## Assumptions

- **Metric units throughout**: kilograms, centimetres, grams and millilitres. Pounds, feet and
  ounces are out of scope.
- **Energy is expressed in kilocalories** and called "calories" in the interface, as on food
  packaging.
- **Single owner**: as with every other widget, one user, though every row is still scoped.
- **The initial food list is supplied by the owner** and will be loaded by the existing seed
  step; it is not derived from any external source. Its contents are still outstanding at the
  time of writing and block only the seed, not the feature.
- **The owner's device clock is authoritative** for which day an entry belongs to and for the
  default meal slot, because the server's day may differ from the eater's.
- **Default slot boundaries**: breakfast until 10:30, lunch until 15:30, dinner from 17:00
  until 21:30, snack at any other hour. These are defaults only; the slot is always editable.
- **Body-fat percentage is the only optional input that changes the method** used for the basal
  rate; every other optional input affects presentation only.
- **The public food database is Open Food Facts**, chosen because it needs no key and no paid
  tier, consistent with the free-tier constraint. Imported data is treated as the owner's own
  food row once imported, and its licence attribution is shown on the import screen.
- **This is not medical advice**: the targets are labelled as model output, following the
  existing rule that estimates state their basis. No clinical validation is claimed.
- **Constitution amendment required**: the dashboard quick-add conflicts with the rule that a
  summary card carries no interaction beyond navigation. Principle I is to be amended in the
  same change to permit at most one primary quick action per card, with the reason recorded.
- **Micronutrients beyond the four listed extras are out of scope**, as are water tracking,
  exercise logging and calorie burn from workouts. Activity is captured only as the multiplier.
- **Adaptive maintenance energy** — inferring true maintenance from intake against weight
  trend — is deliberately deferred to a later change.
