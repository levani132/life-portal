# Quickstart: verifying Food & Nutrition Tracking

`npm run check` is necessary but not sufficient — it has passed before while the app could not
boot and while two silent zeroing bugs were live (`CLAUDE.md`, "Verifying a change"). The
procedure below is the one that catches those.

## 1. Static gate

```bash
npm run check          # typecheck + lint + test across the workspace
```

Expect the domain suite to have grown by the nutrition tests (was 97 before this feature). A
failing `nutrition.spec.ts` branch is a blocker, not a warning.

## 2. Boot it for real

```bash
docker run -d --name lp-mongo -p 27019:27017 mongo:7          # if not already running
MONGODB_URI=mongodb://127.0.0.1:27019/lp-dev JWT_SECRET=$(openssl rand -hex 32) \
  npm run seed && npm run dev
```

`npm run seed` must be safe to run twice: re-running it may not duplicate the initial foods
(keyed on name + brand).

## 3. Walk the widget

Sign in, then check each of these. Every one of them is a figure that was zero or missing in a
previous silent-failure bug, so read the numbers rather than glancing at the layout.

| Step | What to check |
|---|---|
| Dashboard | The food card is present, shows calories eaten today (0 before logging) and — before the profile is filled in — an invitation to complete it rather than a blank or a zero target. |
| Quick-add | The `+` on the card opens the modal with the slot matching the time of day and today's date. It is the **only** interactive control on the card. |
| Log a food | Pick a seeded food, type `1.5` servings; the base-unit amount follows. Type an amount instead; the servings figure follows. The preview shows non-zero calories **and** non-zero protein, fat and carbs. |
| Record it | The entry lands in the right slot. Today's totals and the dashboard card both move by exactly the preview's figures. |
| Profile | Fill in sex, height, birth date, activity, goal, and record a weigh-in. Targets appear. `bmr`, `tdee` and all four macro targets are non-zero, and each shows its basis on hover. |
| Basal-rate switch | Add a body-fat percentage to the weigh-in. The basis string changes from Mifflin–St Jeor to Katch–McArdle and the protein target rises. Remove it: the displayed body-fat estimate returns, marked low-confidence, and the basis returns to Mifflin–St Jeor. |
| Own BMR | Enter a measured basal rate. It is used verbatim and rendered **without** the `est` mark. |
| Goal sweep | Cycle all five goals. Calorie target moves −25%, −15%, 0, +10%, +20% against maintenance, and `max_gain` shows the +20%-cap note. |
| Floor | Set a small stature and `pure_weight_loss` until the deficit hits the floor. The target is raised and the warning names the floor. |
| Macro squeeze | Set protein and fat overrides high enough to exceed the calorie target. Carbohydrate stays ≥ 0 and the adjustment is reported. |
| Day boundary | With `dayStartHour: 4`, log at 01:00 local (or fake the clock) — the entry belongs to the previous day. At 05:00 it belongs to today. |
| Week view | After two or three logged days, the week shows eaten, target and difference, and banked calories reflect only the days that were actually logged. |
| Cheat day | Set Saturday. The countdown names Saturday with the right number of days. Queue three foods, drag one to the top and reload — the order holds. Use ↑/↓ too. On a cheat day, "log this" writes a real entry and marks the row eaten. |
| History integrity | Edit a food's calories by +50%. Yesterday's totals do **not** change; a newly logged entry uses the new value. |
| Delete a used food | It is archived, past entries keep their name and numbers, and it leaves the default picker. |
| Offline lookup | Block network access to `openfoodfacts.org` (or set an unreachable base URL). Search reports it is unavailable, and manual food entry and logging still work end to end. |
| Weight trend | Two or more weigh-ins render a trend and an average weekly change. |

## 4. What "done" means

- `npm run check` green, including a test per branch of the target model.
- Every row in the table above verified by reading the number, not the layout.
- `docs/modules/nutrition.md` matches what was built; `docs/DECISIONS.md`, `docs/CHANGELOG.md`,
  `.specify/memory/constitution.md` (1.1.0) and `CLAUDE.md` updated in the same change.
