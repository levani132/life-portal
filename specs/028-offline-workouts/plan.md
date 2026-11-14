# Plan: Offline workouts (spec 028)

## API (`apps/api/src/training/`)

- `sessions.service.ts`: `id` on start / add / swap / set; `assertFreeId` (any user, 409
  `ID_TAKEN`); `sessionConflict`; `clientTime()` clamps (`MAX_CLIENT_BACKDATE_MS` = 48 h);
  `finish(…, endedAt?)`. `planned-row-id.ts` derives plan-start row ids.
- `catalogue.service.ts`: `offlineList()` for `GET exercises/offline` (declared before
  `exercises/:id`).
- DTOs: `id` (`IsMongoId`), `startedAt` / `loggedAt` / `endedAt` (`IsISO8601`).

## Web

- `lib/offline/training-overlay.ts` (pure): the workout as shown = the cached server copy with the
  outbox's training writes applied in order. Every case is idempotent, which is what lets an
  acknowledged write stay applied until the refetch lands.
- `lib/offline/reads.ts`: `getWithOfflineCopy()` for the reads a workout needs (profile, plans, a
  plan, current, history, a session, the offline exercise list, Food's profile). `useApi` uses it.
- `lib/offline/planned-row-id.ts`: the same id derivation with `crypto.subtle`; `newObjectId()`.
- `lib/training-offline.ts`: `trainingWrites.*` (each a meta + request into the outbox, with
  `dependsOn` on the writes that create the ids it references), read hooks
  (`useCurrentSession`, `useSessionDetail`, `useHistoryPage`), `useTrainingSync`, conflict
  resolution (`finishOtherAndRetry`), the auto-drop of a colliding online start, and the
  settling list. `lib/training-queue.ts` is gone.
- Screens: `workout-session.tsx`, `set-table.tsx`, `workout-bar.tsx`, `plans.tsx`,
  `plan-suggestions.tsx`, `rest-editor.tsx` (the plan half stays online), `exercise-picker.tsx`,
  `plan-day-update.tsx`, `sync-status.tsx`, `app/training/page.tsx`.

## Verification

Unit: `sessions.service.spec.ts` ("work done offline"), `catalogue.service.spec.ts`
(`offlineList`), `training-overlay.spec.ts` (overlay, idempotence, reload, finish, history, the
shared id test vector), `start-workout.spec.tsx`. Runtime: a throwaway Mongo and the browser with
the network cut: start a plan workout, log, reload, finish, reconnect, check one copy of each set
on the server.
