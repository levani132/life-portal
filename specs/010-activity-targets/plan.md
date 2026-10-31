# Implementation plan

Extend shared contracts and pure target calculation first. Persist profile preferences and
stable setup IDs; migrate legacy completion as the original steps only. Add Health receiver
with one-use scoped tickets and raw daily sample snapshots, keeping calculations derived.
Reuse NutritionRing, settings and profile forms; keep one app-wide launch bridge with cooldown,
freshness check, callback suppression and manual fallback. Verify formulas/migration/isolation
with focused tests and production builds. Preserve unrelated changes. Commit and push.
