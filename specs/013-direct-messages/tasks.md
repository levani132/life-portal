---
description: "Tasks for 013 direct messages"
---

# Tasks: Direct messages between friends

**Input**: `specs/013-direct-messages/` (plan, spec, research, data-model, contracts, quickstart)

**Tests**: unit tests for the domain functions (constitution) and a MessagesService spec for
access, idempotency, rate limit, unsend and suppression. No UI tests.

## Phase 1: Foundation

- [X] T001 Add `'messages'` to `FEATURE_IDS` and the feature list in libs/shared/types/src/lib/portal.ts. Add `messages` to `FeatureOverridesDto` in apps/api/src/access/access.module.ts. Map `messages` → `'messages'` in `moduleForPath` (libs/shared/domain/src/lib/portal.ts)
- [X] T002 [P] Create libs/shared/types/src/lib/messages.ts per data-model.md, and export it from the index
- [X] T003 [P] In libs/shared/types/src/lib/notifications.ts, add the `'message'` type, `messageText?`/`messageKind?` on `NotificationEvent`, and `showMessagePreviews` on `NotificationPreferences`
- [X] T004 Create libs/shared/domain/src/lib/messages.ts (`pairKey`, `canMessage`, `messagePreview`, `isViewing`, `seenLabel`, `timeSeparators`) and export it
- [X] T005 Add a `message` case to `notificationText` in libs/shared/domain/src/lib/notifications.ts
- [X] T006 Tests in libs/shared/domain/src/lib/messages.spec.ts, and the new notification text cases in notifications.spec.ts
- [X] T007 Store and serve `showMessagePreviews`: apps/api/src/notifications/notifications.schemas.ts, notifications.service.ts (DTO response, `updatePreferences`, previews passed to text), notifications.dto.ts

## Phase 2: US1 + US2, conversations, sending, inbox (P1)

- [X] T008 Export `PostsService` from apps/api/src/posts/posts.module.ts
- [X] T009 Create apps/api/src/messages/messages.schemas.ts (`conversations`, `messages`, with indexes)
- [X] T010 Create apps/api/src/messages/messages.dto.ts (open, send with text or postId, sync, before cursor, mute)
- [X] T011 Create apps/api/src/messages/messages.service.ts with:
  - get-or-create (with `canMessage`);
  - membership-scoped reads;
  - pages and sync (marks read and viewing);
  - idempotent send with the rate limit;
  - unsend and mute;
  - the derived inbox and unread count;
  - post cards through `PostsService.detail`.
- [X] T012 Register the `message` notification type (`suppress`: muted or viewing) and a badge source in `MessagesService.onModuleInit`. Notify without awaiting, only on a new insert
- [X] T013 Create apps/api/src/messages/messages.module.ts (no-store controller, `@RequireModule('messages')`) and register it in apps/api/src/app/app.module.ts
- [X] T014 Spec in apps/api/src/messages/messages.service.spec.ts

## Phase 3: Web (US1–US5)

- [X] T015 Create apps/web/src/components/messages.tsx with:
  - `MessagesIcon` (header, unread count);
  - `Inbox`;
  - `Conversation` (bubbles, separators, optimistic send with retry, Seen, unsend, older pages, 3-second visible-only sync, mute);
  - `SendPostDialog` (friend picker).
- [X] T016 Create apps/web/src/app/messages/page.tsx and apps/web/src/app/messages/[id]/page.tsx
- [X] T017 In apps/web/src/components/app-shell.tsx, add the messages icon in the header, and a chat layout that hides the tabs and pull-to-refresh on `/messages/:id`
- [X] T018 Add a Message button for friends in apps/web/src/components/social.tsx, and a Send button opening `SendPostDialog` in apps/web/src/components/post-engagement.tsx
- [X] T019 In apps/web/src/components/notifications.tsx, add the Messages switch and "Show message previews" (only with the `messages` feature), and Activity text for the `message` type. In apps/web/public/sw.js, add `renotify` for `message:` tags

## Phase 4: Polish

- [X] T020 [P] Create docs/modules/messages.md. Update docs/modules/notifications.md (new type), posts.md and social.md (Message and Send), DECISIONS and CHANGELOG
- [X] T021 Run `npm run check` and build both apps
- [X] T022 Run quickstart.md steps 1–8 against the built API and the dev web app. Record the results in specs/013-direct-messages/verification.md

## Dependencies

T001–T007 → T008–T014 → T015–T019 → T020–T022. Can run in parallel: T002/T003, and the docs.
