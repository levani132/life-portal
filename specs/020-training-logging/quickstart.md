# Quickstart: verifying spec 020

`npm run check` is necessary, not sufficient (CLAUDE.md). Run the app and look at the numbers.

## Setup

```bash
docker run -d --name lp-mongo -p 27019:27017 mongo:7
MONGODB_URI=mongodb://127.0.0.1:27019/lp-dev JWT_SECRET=$(openssl rand -hex 32) \
  npm run seed && npm run dev
```

Log in as the seeded owner (internal cohort, so `training` is on). Add the Training widget from
Home's widget controls if it is not selected (a module released after the first Portal read is
not auto-selected).

## Scenarios

1. **Catalogue seeded.** Training → Exercises lists ≥ 500 exercises; searching "bench" finds
   barbell and dumbbell variants within 2 s; no seeded exercise shows an image or instructions;
   the dataset credit is shown. Restarting the API does not duplicate rows (count unchanged).
2. **Log a workout (story 1).** Start workout from the Home card. Add Barbell bench press; log
   60 kg × 10 as warm-up and 3 × 80 kg × 8. Reload the page mid-session: everything is still
   there, and the card says Resume workout. Tapping Start workout again resumes, never a second
   session.
3. **Snapshot rule.** Create a private exercise "Test press", log a set, rename the exercise to
   "Renamed press": the session still shows "Test press".
4. **Records (story 3).** Log a second session with 85 kg × 6: the set is marked as a record
   (heaviest load and est. 1RM). Its est. 1RM reads ≈ 102 kg with "Epley, from 85 kg × 6". Delete
   that set: the record falls back to the first session's 80 kg × 8 (≈ 101 kg).
5. **Units (story 5).** Set weight unit to lb; log 225 lb. Switch back to kg: it shows 102.1 kg.
   The stored value is 102 058 g (check with `mongosh`: `db.workout_sets.find({}, {weightGrams: 1})`).
6. **Bodyweight.** With no weigh-in, log 10 pull-ups: no load, volume or est. 1RM is shown.
   Add a weigh-in of 80 kg in Food for an earlier day: the same set now shows a load of 80 kg
   labelled "from weigh-in <day>".
7. **Food untouched (SC-006).** Note Food's targets and activity adjustment, log a workout, reload
   Food: identical.
8. **Flag off (SC-007).** In Developer → access, set `training` off for the account: the card and
   page disappear and `GET /api/training/summary` answers 403.
9. **Two devices.** Open the same session in two browsers and log a set in each: both sets are
   kept.
10. **Retries.** In devtools, set the network offline, log two sets, go back online: both arrive
    once (no duplicates).

## Automated

- `libs/shared/domain`: `training.spec.ts` covers every function in data-model.md, including
  Epley bounds, warm-up exclusion, record fallback after deletion, bodyweight/assisted loads with
  and without a weigh-in, lb rounding and the catalogue measure mapping.
- `apps/api`: service specs for the one-open-session race, `requestId` retries, snapshot
  immutability, measure/field validation, shared-row write protection, archive-on-delete, and the
  training module being excluded from shared widgets.
