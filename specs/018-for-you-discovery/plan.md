# Plan

1. `forYou` in `FEATURE_IDS` / `FEATURES` and the overrides DTO; cohort defaults follow
   `resolveFeatureAccess` (internal/developer on, production off).
2. `SocialGraphService.hiddenAuthorIds()` (blocked either way, or muted by the viewer) and
   `SocialService.discoverableIds()` (one query per scanned batch).
3. `PostsService.forYou()` reusing the Wall's scan loop, cursor encryption (keyed per feed),
   `readable()` and `dto()`. Route `GET /posts/for-you` declared before `GET /posts/:id`.
4. Index `{audience, deleted, createdAt desc, _id desc}` on `food_posts`.
5. Tests: query shape, flag, discoverable, live read checks, author cap, paging without repeats,
   cross-feed cursor refusal, graph helper. Docs: posts, social, roadmap gate, decisions,
   changelog.
