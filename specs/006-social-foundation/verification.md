# Verification — 2026-10-22

Automated gates: `npm run check` passes typechecking, lint, 370 domain tests and 18 API tests.
API and web production builds pass. `git diff --check` passes.

Runtime verification uses an isolated ephemeral Mongo database and local API/web ports 4333/4200.
The configured real database and deployment settings are untouched.

HTTP coverage:
- Production social API denial and normal authentication requirements.
- Private default profiles; opt-in case-insensitive literal search without email/credentials.
- Unknown/malformed profile IDs, duplicate and reserved usernames, forbidden identity fields.
- Send/retry/cancel/accept/decline/unfriend, sender/third-party forged acceptance denial.
- Accepted mutual connection required for Friends-only modules; no query-based preview elevation.
- Shared DTOs exclude source IDs, notes, alerts, owner links, summaries and unshared nutrition data.
- First two readable widgets in Home order; category-private Food does not consume a slot.
- Viewer-only mute, bilateral blocks, blocked browse/count/import, and no friendship after unblock.
- Feature changes applied to owner/viewer with existing JWTs; friend/stranger owner previews.
- Canonical-pair opposite-request race and concurrent duplicate request idempotency.
- Concurrent block/accept leaves a blocked non-friend connection.
- Stable search and friends pagination with 25 accounts across two pages.

Browser coverage: two independent signed-in Chrome contexts, mobile 390×844 and desktop
1440×1000, with Asia/Tbilisi timezone. Search → profile → request → recipient acceptance → two
shared friend widgets → mute → block/unblock → owner audience preview → profile-link copy →
profile editing and search opt-out → direct profile link → privacy revocation. A production
account still has Home/Menu only. No page errors or mobile horizontal overflow.

Wall/posts and open-internet profile access remain out of scope for this milestone.
