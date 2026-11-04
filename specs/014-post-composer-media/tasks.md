---
description: "Tasks for 014 post composer and media"
---

# Tasks: One post composer, with photos and video

## Phase 1: Foundation
- [X] T001 Add `postMedia` to FEATURE_IDS / feature list / FeatureOverridesDto (internal + developer on)
- [X] T002 [P] Media types and limits in libs/shared/types/src/lib/posts.ts; publication fields optional on FoodPost
- [X] T003 [P] Domain `post-media.ts`: `postHasContent`, `mediaLimitError`, `clampAspect` + tests
- [X] T004 `aws4fetch` dependency; storage config in apps/api/src/config/configuration.ts; StorageModule/Service

## Phase 2: API (US1–US3)
- [X] T005 `post_media` schema; `food_posts.publication` optional + `media`
- [X] T006 DTOs: media upload request; CreatePostDto with optional source/previewHash and mediaIds
- [X] T007 PostMediaService: config, ticket (rate limit), attach (HEAD checks), sign for reads, delete, hourly cleanup
- [X] T008 PostsService: create without source, media in dto(), delete/moderate remove media, import without foods → 400
- [X] T009 Routes `GET /posts/media/config`, `POST /posts/media`; message post card and notification titles fall back for untitled posts
- [X] T010 Service specs for media attach checks, text-only posts and retry

## Phase 3: Web (US1–US4)
- [X] T011 Header: + left (opens composer), LifePortal centred, name removed
- [X] T012 lib/media.ts: prepareImage, videoPoster, upload with progress
- [X] T013 Composer rewrite: full screen, text, attachments, toolbar (Add food, Photos, Camera, audience), uploads, Share
- [X] T014 Food picker (Today/day, Foods, Saved meals, whole database)
- [X] T015 Camera: tap photo, hold video with 30 s ring, flip, fallback input
- [X] T016 Post display: media carousel, video autoplay muted; text-only posts without the food card

## Phase 4: Polish
- [X] T017 Docs: posts.md, new storage notes, DECISIONS, CHANGELOG, CLAUDE.md, .env.example
- [X] T018 `npm run check`, build both apps
- [ ] T019 Quickstart against local API + R2 (needs bucket name and CORS) → verification.md
