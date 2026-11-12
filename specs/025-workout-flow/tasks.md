# Tasks: 025 workout flow

- [x] T001 Types: `superset` on plan exercises and session exercises, `restSeconds` on session exercises, `planExerciseId` on `PlannedExercise`, `PLAN_LIMITS.superset`
- [x] T002 Domain: `training-workout.ts` (`supersetRuns`, `linkWithNext`, `unlinkFromNext`, `workoutFocus`, `restAfter`, `isSupersetKey`) with tests; `validatePlan` checks the key
- [x] T003 API: schemas, DTOs, plans create/replace/copy/detail and seeder carry `superset`; sessions copy it at start, PATCH `restSeconds`/`superset`, swap keeps both; tests
- [x] T004 Web US1: Duplicate in `plan-editor.tsx`
- [x] T005 Web US2: `rest-editor.tsx`, rest on each card, timer −15s/+15s/Skip (`useRestControls`)
- [x] T006 Web US3: done/current states and collapsing in `workout-session.tsx`
- [x] T007 Web US4: `workout-bar.tsx` in the header; Training page publishes whether the Workout tab shows
- [x] T008 Web US5: superset links in the editor, plan view and workout; superset badges
- [x] T010 US6: `restOver` personal reminders (`remind()`, `shouldRemind`), `RestAlarmService` + `PUT /sessions/:id/rest-alarm`, `RestAlarmSync` in the web, settings toggle; tests
- [x] T009 Docs: training module doc, CHANGELOG, DECISIONS, ROADMAP
