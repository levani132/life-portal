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
- [ ] T010 Types and domain: meal plan shape, `mealPlanTotals()` (per meal, per day, daily average), tests.
- [ ] T011 `meal_plans` collection and CRUD in Nutrition, open to pages for the library; in ACCOUNT_PLAN.
- [ ] T012 Log a plan's day or meal into the diary (people only), with device ids for offline.
- [ ] T013 Web: meal plans in Food (people) and Library (pages): list, editor, day view, log.
- [ ] T014 Publication kind `mealPlan`: snapshot with days and slots; import gives the reader the foods and their own plan.
- [ ] T015 Composer and post card: attach and show a meal plan by day.
- [ ] T016 Assistant tools: list, create, delete meal plans; attach to a post.
- [ ] T017 Integration tests; nutrition.md, posts.md, changelog.

## Slice 3: programmes
- [ ] T020 A programme: a meal plan and a training plan under one name.
- [ ] T021 Publish and copy as one; the reader's copies are linked.
- [ ] T022 Web and assistant; docs.
