# Tasks: Eating and training together

## Slice 1: one post, both halves
- [x] T001 API: `PostsService.create` accepts `source` and `training` together.
- [x] T002 Web: the composer keeps both; attach an existing training plan.
- [x] T003 Assistant: `create_page_post` takes one food or recipe and one plan or exercise.
- [x] T004 Integration test: a person and a page each post both; a reader saves and copies each.
- [x] T005 Docs: posts.md, mcp.md, playbook, changelog.

## Slice 1b: recipes
- [x] T006 Recipes: steps, written ingredients, foods optional; create a food from inside; publish with or without numbers; assistant tool.

## Slice 2: meal plans
- [x] T010 Types and domain: meal plan shape, `mealPlanTotals()` (per meal, per day, daily average), tests.
- [x] T011 `meal_plans` collection and CRUD in Nutrition, open to pages for the library; in ACCOUNT_PLAN.
- [x] T012 Log a plan's day or lines into the diary (people only). Online only: device ids for offline logging are not done.
- [x] T013 Web: meal plans in Food (people) and Library (pages): list, editor, day view, log.
- [x] T014 Publication kind `mealPlan`: snapshot with days and slots; import gives the reader the foods and their own plan.
- [x] T015 Composer and post card: attach and show a meal plan by day.
- [x] T016 Assistant tools: list, create, delete meal plans; attach to a post.
- [x] T017 Integration tests; nutrition.md, posts.md, changelog.

## Slice 2b: the plan in use
- [x] T018 One plan in use per person (`activeSince`), today's plan day from the order or a choice (`activePlanDayIndex`), logged lines derived from the diary (`planEntryId`).
- [x] T019 Web: "Planned today" in Food with a Log button per line; Use / Stop using; "Use this plan" on a post.

- [x] T019a Planned lines inside each meal of the Food day; the diary matched to the plan on read (`matchPlanDay`), any day, with a seven-day comparison; lines at several meals (`slots`); a picked day re-anchors the order.

## Slice 3: programmes
- [x] T020 A programme: a meal plan and a training plan under one name (`programmes`, ids only).
- [x] T021 Posted as one post with both plans. The reader uses the meal plan and copies the training plan, each on its own.
- [x] T022 Web for people and pages, with both plans creatable from inside the editor; `docs/modules/programmes.md`.
- [x] T023 A reader's two copies paired into a programme of their own (spec 043, slice 5).
- [x] T024 Assistant tools for programmes (spec 043, slice 5).

## Open after slice 2

- Logging a plan's day needs a connection (it is not queued offline like other food logging).
- "Log this day today" logs into today; choosing another diary day is not offered yet.
- The composer attaches a meal plan from the plan's own Post button, not from "Add from Food".
- A recipe inside a published plan arrives as its foods: the reader's copy has no recipe objects.
