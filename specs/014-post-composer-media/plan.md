# Implementation Plan: 014 post composer and media

**Spec**: [spec.md](spec.md) · Research, data model, contract and quickstart alongside.

## Summary
One composer for every post, opened from a header +. Food becomes an optional attachment chosen
inside it; text-only posts become possible. Photos (library or camera) and short videos (camera)
upload straight to a private R2 bucket and are read through signed links after the post's read check.

## Technical context
NestJS 11 / Mongoose 9 API, Next 16 web, shared types/domain libs. New dependency `aws4fetch` (API only).
Storage config `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: all or none (none → media hidden).

## Constitution check
- I Bounded module: media ledger `post_media` belongs to PostsModule; `StorageModule` is a platform service like Notifications, with no collection. ✓
- II Integer units: bytes, pixels, milliseconds as integers. ✓
- III Derived never persisted: signed URLs are computed per read, never stored. ✓
- IV Single-sourced: a post references its uploads by id; a message still references the post. ✓
- V Pure functions: `postHasContent`, `clampAspect` and media limits in the domain lib with tests. ✓
- VI Estimates: none introduced. ✓
- Free tier: no worker; cleanup is the existing in-process cron. ✓

## Structure
- `libs/shared/types/src/lib/posts.ts`: media types and limits; optional publication fields.
- `libs/shared/domain/src/lib/post-media.ts` (+ spec).
- `apps/api/src/storage/`: `storage.service.ts`, `storage.module.ts` (@Global).
- `apps/api/src/posts/`: `post_media` schema, DTOs, `PostMediaService`, posts service changes, routes, cleanup cron.
- `apps/web/src/lib/media.ts`: image preparation, poster, upload with progress.
- `apps/web/src/components/`: `post-composer.tsx` (rewritten), `food-picker.tsx`, `camera-capture.tsx`, `post-media.tsx`, header + in `app-shell.tsx`.
