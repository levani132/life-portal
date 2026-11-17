# Tasks: Training sharing

Order follows the plan's phases. `[P]` can run in parallel with its neighbours.

## Phase 1: Foundation

- [x] T001 Add `trainingPosts` to `FEATURE_IDS` / `FEATURES` (`libs/shared/types/src/lib/portal.ts`) and `FeatureOverridesDto` (`apps/api/src/access/access.module.ts`)
- [x] T002 [P] Contracts in `libs/shared/types/src/lib/training-posts.ts`; extend `FoodPost`
- [x] T003 [P] Domain in `libs/shared/domain/src/lib/training-posts.ts` with unit tests: `validTrainingSelection`, `canonicalTrainingPublication`, `planWorkoutFromPublished`, `trainingPublicationLabel`
- [ ] T004 Schema fields: `food_posts.training/trainingHash/allowCopy` (done); `training_plans.postImportKey/attribution`; `exercises.postImportKey/attribution`; indexes

## Phase 2: Share (US1, US2, US4)

- [x] T005 `TrainingPublicationService.snapshot()` for workout, plan (with chosen workouts) and exercise; unit tests incl. "no weights without includeSets", "records only with showRecords", own-exercise details
- [x] T006 `PostsService.preview/create/dto/sameRequest` carry the training attachment; DTOs; unit tests
- [x] T007 Exercise photos: copy at publish, sign on read, delete with the post

## Phase 3: Copy (US3, US4)

- [ ] T008 `TrainingPublicationService.copyPreview()` and `copy()`: plan → new plan; single workout → existing plan or new; exercise → own exercise; own exercises once per viewer and source; all-or-nothing; unit tests
- [ ] T009 `GET/POST /posts/:id/training-copy` with read check, `allowCopy`, feature checks; unit tests
- [ ] T010 Attribution on `PlanDetail`, `PlanListItem` and `Exercise`

## Phase 4: After publishing (US5)

- [x] T011 `PATCH /posts/:id` accepts `allowCopy`; delete and moderation remove the attachment and its photos

## Phase 5: Web

- [ ] T012 `newPostHref` + composer: `PickedTrainingCard`, switches, publish
- [ ] T013 `TrainingAttachmentView` in `PostCard`; Copy action and `CopyTrainingSheet`
- [ ] T014 Share entry points: recap, History workout, plan header, plan workout, own exercise
- [ ] T015 Attribution lines on a copied plan and exercise

## Phase 6: Offline, docs, verification

- [ ] T016 Offline draft carries the training selection and previewed hash; held when it differs
- [ ] T017 Docs: `docs/modules/posts.md`, `training.md`, `offline.md`, `DECISIONS.md`, `CHANGELOG.md`, `ROADMAP.md`; CLAUDE.md trap note for the new snapshot
- [ ] T018 Integration test: publish, read as friend and stranger, copy, repeat copy, copy off
