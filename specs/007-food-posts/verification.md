# Verification — 2026-10-22

All application checks use local source and an isolated in-memory MongoDB. No production database or deployment was changed.

- `npm run check`: typecheck, all lint targets and 418 tests (387 domain, 31 API) pass. Lint retains non-null-assertion warnings; no errors.
- `npm run build`: API and web production builds pass. The browser run uses an uncached web build with its API pointed explicitly at the isolated server.
- Existing social foundation HTTP smoke checks pass against the expanded application.
- 131 HTTP actions/assertions exercise six source kinds, historical entry facts, allowlisted snapshots/no tracking IDs or notes, preview fingerprint conflicts, publishing retries, current audience/friendship/block/feature checks, mute, independent private imports, duplicate previews/skips/copies, saved meals, five concurrent imports, four concurrent reports, no automatic meal logs, owner/developer boundaries, deletion tombstones, moderation and opaque cursor pagination.
- Two separate browser accounts at mobile 390×844 and desktop 1440×1000 complete: Food meal share → review with private default → friends publication → Wall → import private food copies and save a meal → view imported foods → profile Posts/About → owner changes audience to private → the other account loses access → mobile single-food private publication and deletion. No browser exceptions or horizontal overflow. Screenshot review covers the desktop composer and mobile Wall/import dialog.

- A further mobile browser pass previews all six composer kinds, then logs 123g and uses the optional share prompt to verify that exact entry is selected and the audience remains private.

Manual follow-up after deployment: enable social + foodPosts for the inner circle deliberately, keep production Food-only, and try real personal food databases. Public sharing here requires a signed-in enabled account. Existing imports are intentionally independent and cannot be recalled.
