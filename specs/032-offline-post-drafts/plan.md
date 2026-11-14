# Plan: Spec 032

- **API:** `MEDIA_GONE` code on `MediaService.reserve`'s "can no longer be used". Test in
  `media.service.spec.ts`.
- **Outbox:** `send(item, save)`; `save` persists a new body under the same id, and a failure
  after it keeps what was saved. Test in `outbox.spec.ts`.
- **Web:**
  - `offline/post-drafts.ts` (pure: `publishDraft`, `draftProblem`, `mealWritesBefore`; tested);
  - `offline/post-draft-send.ts` (the runtime's sender for `social.post`, plus publishing
    progress);
  - `lib/post-drafts.ts` (`keepPostDraft`, the "posted" note);
  - `components/post-drafts.tsx`;
  - the composer's "Post later".
- **Runtime test:** stop the API, write a post with a photo and "Post later", check the draft row,
  restart the API, then check that the post exists once with its photo and that the row says
  "Posted".
