# Plan: Offline food (spec 029)

## API (`apps/api/src/nutrition/`)

- `nutrition.dto.ts`: `CreateEntryDto.id`, `LogSavedMealDto.ids` (`IsMongoId`).
- `nutrition.service.ts`: `createEntry` and `logSavedMeal` use `assertFreeId` / `withId`, now in
  `common/client-id.ts` (shared with training); `findFood(…, 'log')` answers `FOOD_GONE`.

## Web

- `lib/offline/nutrition-overlay.ts` (pure): ops `entry.add`, `meal.log`, `entry.patch`,
  `entry.remove`, `weighin.put`, `weighin.remove`; `overlayOverview`, `emptyDayFrom`, `capFoods`.
- `lib/offline/settling.ts`: one module's writes to apply (live minus refused, plus settling);
  used by training and nutrition.
- `lib/offline/reads.ts`: the Food day kept per day (14-day window, `latest`, food cap).
- `lib/nutrition-offline.ts`: `foodWrites.*`, `useNutritionDay`, `useRefusedFood`,
  `useFoodOffline`, `useUpdatedAfterSync`.
- Screens: `app/nutrition/page.tsx` (day, suggestions, saved meals, removal, `FoodSyncNotes`),
  `log-food-modal.tsx`, `weigh-in-panel.tsx`, `home-dashboard.tsx`; `food-form.tsx` and
  `public-foods-panel.tsx` say "needs a connection"; `useAction` does the same for every other
  online-only action.

## Verification

Unit: `nutrition-offline.spec.ts` (API: client id, snapshot from the food not the request,
`ID_TAKEN`, `FOOD_GONE`, saved meal ids) and `nutrition-overlay.spec.ts` (totals, week,
idempotence, corrections, saved meal, weigh-ins, empty day, food cap). Runtime: throwaway Mongo,
API stopped, log and reload, restart, one row each on the server.
