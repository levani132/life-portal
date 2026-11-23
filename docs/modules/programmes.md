# Programmes (spec 042)

A programme is a meal plan and a training plan under one name. `apps/api/src/programmes/`,
rule in `libs/shared/domain/src/lib/programmes.ts`, web `components/programmes.tsx`. For people
and pages.

## Schema

| Collection `programmes` | |
|---|---|
| `userId`, `name`, `description?` | |
| `mealPlanId?` | A `meal_plans` row of the owner's |
| `trainingPlanId?` | A training plan the owner can read (their own, or a ready-made one) |

At least one of the two. **The row holds the two ids and nothing else about the plans**
(principle 4). Each plan lives in its own module, is created through that module's own routes
and stays there when the programme is deleted. Names, day counts and "in use" are read through
`MealPlansService.list()` and `PlansService.list()` on every read, so editing a plan changes
every programme that pairs it. A plan that was deleted is reported in `gone`, never hidden.

## Routes

| Route | Who | What |
|---|---|---|
| `GET /programmes` | person, page | The owner's programmes, with both halves resolved |
| `POST /programmes`, `PUT /programmes/:id` | person, page | `{name, description?, mealPlanId?, trainingPlanId?}`. `programmeProblem()` is the validity rule; a plan the owner cannot read is a 400 |
| `DELETE /programmes/:id` | person, page | Removes the pairing only |

There is no "start" route. Starting a programme is using its meal plan
(`PUT /nutrition/meal-plans/:id/follow`, person only, with the same conflict check); its workouts are started from Training as
always. There is no programme publication either: a programme is posted as one post that carries
the meal plan (`source: {kind: 'mealPlan'}`) and the training plan (`training: {kind: 'plan'}`),
which posts already support. A reader uses the meal plan and copies the training plan from that
post, each on its own.

## Web

Food → Programmes (people) and Library → Programmes (pages). The editor picks each half from
what exists or opens that plan's own editor (`MealPlanEditor`, `PlanEditor`); a plan made there
is saved to its library first and the programme then points at it. "Start this programme" is
offered to a person only. Post opens the new post page with both halves attached. A ready-made
training plan can be paired but not posted.

## Not done

- A reader's two copies from a programme post are not paired into a programme of their own.
- The assistant has no programme tools; it can already post a meal plan and a training plan together.
