# Home feed tabs: For You and Friends

Issue #1, answers approved by the owner on 2026-11-12. Builds on 018 (the For You API).

With the `forYou` flag, Home's feed below the widgets becomes two tabs. With it off, Home is
exactly as before ("From your friends" and the Wall list).

- **For You** (default): `GET /posts/for-you`. Empty: a card explaining what will appear,
  with a button to Friends.
- **Friends**: today's Wall (`GET /posts`), unchanged. Named Friends, not Following, because
  friendship is mutual; "Following" waits for a real one-way follow model.
- Each tab keeps its own loaded page and Older/Newer history (both stay mounted once opened)
  and its own loading/empty/error state. Friends is not requested until first opened.
- When the feed has been scrolled into, switching restores the other tab's scroll position
  (never above the strip); above that, nothing moves.
- The last tab is remembered for the browser session only (`sessionStorage`).
- The strip is `role="tablist"` with arrow/Home/End keys, tap only (no swipe,
  `data-no-tab-swipe`). It is **not sticky** (changed 2026-11-12 after testing on an iPhone:
  with the header hidden, a pinned strip sat in the status-bar band, which showed through
  hollow). It scrolls away with the feed.

Out of scope: infinite scroll, one-way follows, ranking (#3), reels-style UI.
