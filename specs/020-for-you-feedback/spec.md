# For You: Not interested and hide an author

Issue #3, task A only (owner, 2026-11-12). #3 stays open as the umbrella; B (computed post
topics) may follow; C/D/E (ranking, onboarding interests, impression tracking) are on hold.

- A For You card's menu offers **Not interested** (that post) and **Hide {name} from For You**
  (that author). Neither appears on Friends, profiles or a post's own page.
- Either collapses the card in place into a one-line note with **Undo**. Hiding an author also
  removes that author's other cards from the page; Undo brings them back. A failed request
  leaves the card as it was and shows the error.
- Stored in `feed_feedback`: one row per (viewer, kind, target), kind `post` or `author`.
  Only for another member's post the viewer can read now. Repeats are no-ops; undo deletes.
- For You leaves out hidden authors in the query and Not-interested posts in the scan. Nothing
  else changes: Friends, profiles, links, likes and comments are unaffected.
- "Hide author" is an exclusion, not a down-weight: with no ranking yet (#3 C), there is nothing
  to weigh. When ranking exists it can become "show fewer".
- Needs the `forYou` flag, like For You itself.

Out of scope: a page to review hidden authors (Undo is the only way back for now), topics,
ranking.
