# Plan: Spec 031

- API: `AddPostCommentDto.id`, `assertFreeId`/`withId` in `PostEngagementService.add`, idempotent
  `remove`, `postGone()` in `PostsService`. Tests in `post-engagement.service.spec.ts`.
- Web: `offline/social-overlay.ts` (pure, tested), `lib/social-offline.ts` (writes, settling,
  quiet drop of `POST_GONE` toggles), `components/post-engagement.tsx`, sync sheet shows a refused
  comment's text. `NetworkError.notSent`, `OutboxItem.maybeSent`, `outboxSyncing()`.
- Runtime: like, unlike, comment and delete with the API stopped, reload, restart, check the
  database; a comment on a post deleted meanwhile shows its text in the sync sheet.
