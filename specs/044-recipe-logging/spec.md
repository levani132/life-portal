# Feature Specification: Logging a recipe

**Feature**: `044-recipe-logging` · **Created**: 2026-11-23 · **Status**: Built
**Builds on**: spec 042 (recipes), spec 029 (food offline)

## Why

A recipe with several foods was logged as loose rows with no sign they belonged together, always
as the whole recipe. A pot of soup is four servings; a bowl is eaten one and a half times.

## Decisions (owner, 2026-11-23)

1. **Stored as separate meals, shown as one.** Each food stays its own meal with its own frozen
   numbers, because plan matching, rules on each food and the macro bars work food by food. The
   meals logged together share `mealLogId`, and the day shows them as one recipe row that opens
   to its foods. Remove and Share act on the recipe; Edit acts on one food.
2. **Servings.** A recipe says how many servings it makes (`servings`, 1–50, absent = 1). Logging
   takes a number of servings in quarters up to 20; every food is scaled by servings ÷ makes and
   rounded to a whole gram or millilitre, never below one (`recipePortion`, used by the server
   and by the device logging offline, so both agree).
3. **Changing one food after logging** is an ordinary edit of that meal; it stays in the group.

## Data

- `saved_meals.servings?`, `meal_entries.mealLogId?` (device-chosen, else the server's) and
  `meal_entries.mealServings?`. A recipe logged from a meal plan is grouped the same way.
- Recipes logged before this share no id; the day groups them by recipe and the minute logged.
- A shared recipe carries `servings` in `publication.recipe`, and a reader's copy keeps it.
