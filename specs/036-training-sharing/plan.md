# Implementation Plan: Training sharing

**Feature**: `specs/036-training-sharing/spec.md` · **Date**: 2026-11-17

## Summary

A post can carry a Training attachment beside (later: together with) its Food attachment. The
attachment is a snapshot built by the API from the author's own training data, hashed for the
preview-then-publish check exactly as food is. A viewer who passes the post's read check and has
Training can copy it into their own plans or exercises. The whole thing is behind a new feature
flag, `trainingPosts`.

## Technical context

- API: NestJS 11, Mongoose 9. Web: Next.js 16, SWR. Shared contracts in `libs/shared/types`,
  pure logic in `libs/shared/domain`.
- Extends: `apps/api/src/posts` (`PostsService`, `food_posts`), `apps/api/src/training`
  (`PlansService`, `CatalogueService`, `SessionsService`, `PlanDayUpdateService`),
  `apps/api/src/media` (`MediaService`, `StorageService.copy`), the web composer
  (`components/post-composer.tsx`), the post card (`components/posts.tsx`) and offline post
  drafts (`lib/offline/post-drafts.ts`).

## Constitution check

| Principle | How this feature keeps it |
|---|---|
| I. Widget = bounded module | Training builds and imports its own snapshots (`TrainingPublicationService`, in the training module). Posts stores the result and never reads training collections, as with `NutritionPublicationService`. |
| II. Integer units | Snapshots carry whole grams, metres and seconds, as training stores them. |
| III. Derived never persisted | The snapshot is the second deliberate copy rule (as `meal_entries.facts` and food publications): built by the server, never accepted from a request, never refreshed. Documented as such. |
| IV. Cross-links single-sourced | A copy records where it came from on the copy itself (`postImportKey`, `attribution`); there is no second ledger to drift. |
| V. Pure projections | Canonical form, validation, "plan from a published workout" and selection checks are pure functions in `libs/shared/domain/src/lib/training-posts.ts`, unit tested. |
| VI. Estimates labelled | Nothing estimated is introduced. |

## Design

### Contracts (`libs/shared/types/src/lib/training-posts.ts`)

- `TrainingPostSelection`, what the author asks to share:
  - `{ kind: 'workout', sessionId, includeSets?: boolean, showRecords?: boolean }`
  - `{ kind: 'plan', planId, workoutIds?: string[] }` (absent = every workout)
  - `{ kind: 'exercise', exerciseId }`
- `TrainingPublication`, the stored snapshot (self-contained, FR-030):
  - `kind`, `label`
  - `exercises: PublishedExercise[]`: one entry per exercise used, keyed `key` (ordinal). A
    catalogue exercise carries `exerciseId`; an own one carries `own: true`, its `sourceId`, and
    its details (`name`, muscles, equipment, measure, `instructions?`, `image?`).
  - `workout?`: `{ name, day, durationSeconds, exercises: [{ key, sets: number, logged?: PublishedSet[] }], records?: PublishedRecord[] }`
  - `plan?`: `{ name, description?, includedWorkouts, totalWorkouts, workouts: [{ name, exercises: [{ key, restSeconds?, note?, superset?, targets }] }] }`
  - `exercise?`: `{ key }`
- Stored form keeps each image as a storage `key`; the response form (`TrainingAttachment`)
  replaces it with a signed `url`. A key never leaves the API.
- `FoodPost` gains `training?: TrainingAttachment`, `allowCopy?: boolean` and `canCopy?: boolean`.
- `TrainingCopyInput { requestId, planId?, planName? }`, `TrainingCopyResult { kind, planId?, planWorkoutId?, exerciseId?, reused }`.

### Storage

- `food_posts`: `training?` (object), `trainingHash?`, `allowCopy?` (absent = true). `previewHash`
  and `publication` are untouched. `sameRequest` compares `trainingHash` and `allowCopy` too.
- `training_plans`: `postImportKey?` (`<postId>`), `attribution? { label, postId, authorId }`;
  unique partial index `{ userId, postImportKey }`. A workout added to an existing plan uses a
  deterministic day id derived from the post id, so `addDay` stays idempotent and the copy can be
  found again.
- `exercises`: `postImportKey?` (`<authorId>:<sourceExerciseId>`, so one copy per viewer and
  source, FR-021), `attribution?`; unique partial index `{ userId, postImportKey }`.
- Post photos of exercises live under `posts/<authorId>/training/…`, copied with
  `StorageService.copy` at publish and deleted with the post; a copy made by a viewer is copied
  again to that viewer's `training/<viewerId>/exercises/…`.

### API

- `POST /posts/preview` and `POST /posts` accept `training?: TrainingPostSelection` and, on
  create, `trainingHash?` and `allowCopy?`. For now `source` and `training` are mutually
  exclusive (400); nothing else assumes it.
- `GET /posts/:id/training-copy` (what copying would create, and the viewer's own plans for the
  single-workout choice) and `POST /posts/:id/training-copy`.
- `PATCH /posts/:id` accepts `allowCopy`.
- Access: sharing needs `training` and `trainingPosts`; copying needs `training` and
  `trainingPosts` for the viewer; viewing keeps the existing post gate. The attachment is left out
  of a response when its author no longer has `training` and `trainingPosts`.
- `TrainingModule` exports `TrainingPublicationService`; `PostsModule` imports `TrainingModule`.

### Web

- `newPostHref` gains a training selection (`/new?training=…`). The composer shows a
  `PickedTrainingCard` with the preview and the switches (weights and reps, records, which
  workouts, allow copying).
- `PostCard` renders `post.training` (`TrainingAttachmentView`: muscle figures, sets, plan
  workouts) and offers Copy when `post.canCopy` (`CopyTrainingSheet`, reusing the plan choice of
  `SaveToPlanSheet`).
- Share entry points: workout recap and History's workout; a plan's header and each plan workout;
  an own exercise's detail.
- Offline: `PostDraftBody.training` with the hash the author previewed; `publishDraft` previews
  again and refuses (held for review) when the hash differs.

## Phases

1. **Foundation**: flag, contracts, domain functions, schema fields.
2. **Share (US1, US2, US4 publish side)**: snapshot service, preview, create, read, photos.
3. **Copy (US3, US4 copy side)**: copy service and routes, attribution.
4. **After publishing (US5)**: `allowCopy` edit, delete cleans photos.
5. **Web**: composer, card, entry points, copy sheet.
6. **Offline drafts** and docs, integration test.

## Risks

- **Privacy**: the snapshot is the only thing a viewer sees. Tests assert that a workout snapshot
  without `includeSets` holds no weight or reps anywhere, and never body weight, rank or level.
- **Existing gate needs Food**: every post route today requires `nutrition`. Viewing a training
  post therefore still needs Food turned on. Kept as is; changing the gate for all posts is its
  own decision.
