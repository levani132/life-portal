# Quickstart: verifying spec 023

`npm run check` is necessary, not sufficient (CLAUDE.md). Run the app and look at the numbers.

## Setup

```bash
docker run -d --name lp-mongo -p 27019:27017 mongo:7
MONGODB_URI=mongodb://127.0.0.1:27019/lp-dev JWT_SECRET=$(openssl rand -hex 32) \
  npm run seed && npm run dev
```

Log in as the seeded owner (internal cohort, so `training` is on) and open Training.

## Scenarios

1. **Plans seeded.** Training → Plans lists the four ready-made plans (Full body, Upper / Lower,
   Push / Pull / Legs, Bodyweight at home) with their workout counts. Restarting the API does not
   duplicate them (`db.training_plans.countDocuments({userId: {$exists: false}})` stays 4). The API
   log names no skipped plan.
2. **Start from a plan (story 1, SC-001).** Open Push / Pull / Legs → Push → Start. The session
   shows "Push · Push / Pull / Legs" and five exercises with their suggested sets (e.g. bench press
   4 × 6–8, rest 2:30). With no history, the first suggestion is pre-filled with 6 reps and an empty
   weight.
3. **One-tap log (SC-002).** Fill 60 kg on the first bench suggestion and log it. The second
   suggestion now starts from 60 kg × 6 only if bench was done before; otherwise from the target.
   Finish this workout, start Push again: every bench suggestion is pre-filled from last time's
   sets at the same position and logs with one tap.
4. **Suggestions are not data (SC-005).** With Push started and only one set logged, the Home card
   and History count one set's volume; nothing from the unlogged suggestions. Finish: the session
   keeps only the exercise with a logged set.
5. **Skip, swap, add, remove.** Skip Side Lateral Raise (collapses, no suggestions; un-skip brings
   them back). Swap Incline Dumbbell Press for Cable Crossover before logging: same position, the
   three targets carried over. Try to swap bench after logging: refused ("already has sets"). Add
   Plank by hand: it has no suggestions and behaves as in spec 020.
6. **One open session.** With Push open, start Legs from the plan: the app says Push is open and
   resumes it; no second session exists.
7. **Snapshot rule (SC-004).** Copy Push / Pull / Legs, start the copy's Push, log a set, then edit
   the copy (rename it, change bench to 5 × 5, remove an exercise) and delete it. The open session
   still shows the original names and suggestions; the finished one in History is unchanged.
8. **Own plan (story 2, SC-003).** Create "My split" with three workouts of five exercises,
   including one own exercise; reorder exercises and workouts; save; reload: all there. Set a time
   target on Plank and a 10–12 range on curls; a range of 12–10 is refused with a message.
   Delete the own exercise: it is archived (still shown in the plan), not deleted.
9. **Progress (story 3).** After finishing Push, the plan shows Push "last done today" and Pull as
   next; after Legs, next wraps to Push. The Workout tab offers Push / Pull / Legs under recently
   used plans with Start next. Delete the Legs session: next goes back to Legs.
10. **Empty start unchanged (SC-006).** Workout tab → Start empty workout: a session with no
    exercises and no plan label; adding exercises works as before.
11. **Food untouched (SC-007).** Note Food's targets and activity adjustment, train from a plan,
    reload Food: identical.
12. **Flag off.** With `training` off for the account, `GET /api/training/plans` answers 403.

## Automated coverage

- Domain (`libs/shared/domain/src/lib/training-plans.spec.ts`): `openTargets`, `prefillFor`
  (same position, fewer sets last time, no history, ranges, time targets), `planProgress`
  (none done, wrap, open session counts, deleted session), `recentPlanIds` (28-day edge, max 3),
  `validatePlan` (every limit, every measure).
- Seed (`apps/api/src/training/plan.seeder.spec.ts`): every `seedKey` in `plans.json` exists in
  `free-exercise-db.json` and every target validates against that exercise's measure; a re-run
  at the same version writes nothing; a missing exercise skips the plan.
- API (`plans.service.spec.ts`, `sessions.service.spec.ts`): ownership (shared → 404 on write,
  someone else's plan → 404), id preservation on `PUT`, `PLAN_LIMIT`, copy, start with plan
  (planned copied, open session resumed), swap with and without sets, finish drops unlogged
  planned rows, archive-on-delete for exercises used by plans.
