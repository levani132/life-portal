# Wall and food posts

Status: Complete locally. Implements the approved food publishing milestone. See [verification](verification.md); not deployed.

Acceptance:
- Wall is chronological, with own/friends posts; mute excludes a friend's posts from Wall.
- Profiles have Posts and About; readers see only current permitted posts.
- Share one logged entry, a meal slot, day, catalogue food, combination/saved meal, or whole database.
- Server builds an allowlisted food snapshot from owned records; preview before publishing.
- Publishing defaults to Only me and requires explicit audience; live widget privacy is independent.
- Snapshot preview fingerprints detect changed sources; idempotent publishing avoids duplicates.
- Friends/public visibility, blocks, feature access and deletion apply to list/detail/import reads.
- Authors can edit captions/audience and delete; reporting hides a post for the reporter and enters a developer queue.
- Imports preview selected foods and duplicate matches, preserve attribution, create private independent copies,
  and never log meals. Meal/combination posts can become an owned saved meal explicitly.
- Database posts are frozen versioned collections, not access to a live database. Later edits do not change posts.
- All data remains private by default; ordinary/developer accounts have no privacy bypass.

No comments, reactions, automatic activity posting, financial posts or anonymous web publishing.
