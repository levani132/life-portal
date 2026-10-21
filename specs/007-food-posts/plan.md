# Plan

1. Shared source/post/import contracts, pure snapshot fingerprint and audience policies.
2. Nutrition-owned snapshot building and idempotent independent import with provenance.
3. FoodPosts service and collections, current audience checks, stable cursor feeds, reporting.
4. Composer and share entry points, Wall, profile Posts, detail and import preview.
5. Privacy/source/duplicate/race tests, isolated multi-user HTTP and browser verification, docs.

food_posts stores explicit publication snapshots as immutable events, not cached live summaries.
post_reports stores each reporter's own moderation report/hide state. Nutrition owns imported
foods/recipes. Unique request/import keys make retries safe without requiring transactions.
