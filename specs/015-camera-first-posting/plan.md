# Plan: 015 camera-first posting

## Constitution check
- Widget = module: food photos live in Nutrition (`foods.image`); uploads stay one shared
  ledger, now its own `MediaModule` used by Posts and Nutrition (no circular import).
- Derived never persisted: macro shares are computed on render (`macroShares` in the domain lib).
- Pure functions: `macroShares`, `newFoodActions` in `libs/shared/domain` with tests.
- Free tier: R2 `CopyObject` for food photos (no second upload, no egress).

## API
- `MediaModule` (`apps/api/src/media`): the `post_media` ledger and `MediaService` move here.
  Routes move from `/posts/media*` to `/media*` (`RequireModule('postMedia')`), so food photos do
  not need the posts flags. New `MediaService.copyForFood()` checks the upload (owner, file
  present), copies the image (or a video's still) to `foods/{userId}/{foodId}-{n}.jpg` and returns
  `{key, width, height}`. The ledger row stays pending, so the same upload can still go on a post.
- `StorageService.copy(from, to)` (S3 CopyObject).
- `foods.image?: {key, width, height}`. `POST/PATCH /nutrition/foods` accept `imageMediaId`;
  PATCH accepts `removeImage: true`. Replaced, removed and hard-deleted foods delete their file.
  Food responses carry `image?: {url, width, height}` (signed) from list/create/update; every other
  path strips the field so a key never leaves the API.

## Web
- Tab bar: Home, Messages, centre + (link to `/new`), Search, Menu (Friends request badge).
  `/friends` becomes an ordinary page, linked from Menu.
- `/new` page: `NewPostScreen` with snap states `half | full | hidden`, pointer-drag on the
  camera panel and handle; `CameraView` (extracted from the overlay camera) with lazy microphone.
  Share buttons in Food navigate to `/new?kind=…` with the selection.
- `NewFoodCard`: form + `MacroRings`, merged with the first attachment; checkboxes and the
  button matrix from `newFoodActions`. Orchestration: upload → create food (with `imageMediaId`)
  → log entry → preview → create post; ids kept in state so a retry continues.
- `PostCard`: carousel + food card joined; `MacroRings` in the food card.
- Food form: photo picker (prepare → upload → `imageMediaId`), remove; thumbnails in lists.
