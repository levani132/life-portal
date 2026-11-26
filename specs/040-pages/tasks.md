# Tasks: Pages

Plan: `plan.md`. Each slice ends with `npm run check`, a green integration run, docs, and a
device check before the `pages` switch is turned on for anyone but the owner.

## Slice 1: create and act

- [x] T001 Shared types: `Identity`, `PageSummary`, page fields on `PostAuthor` and `SocialPerson`; feature id `pages`.
- [x] T002 Domain `pages.ts`: `pageAccess()`, `mayCreatePage()`, with tests.
- [x] T003 `users`: `kind`, `managers`, `createdBy`, `official`, `aiManaged`, `pageLimit`. Sign-in, reset and verification refuse `kind: 'page'`.
- [x] T004 `AccessService.forUser()`: fixed features for a page; test.
- [x] T005 Acting guard: `X-LP-Act-As`, `@AsPerson()`, `@NotForPages()`, `actorId` on the request user; tests for a manager, a stranger, a suspended page, a missing page.
- [x] T006 Mark the routes: `@AsPerson()` on auth, account, access, people, pages management, admin screens; `@NotForPages()` on logging routes. Inventory test over all controllers.
- [x] T007 `pages` module: list, create (limit, username shared with people), edit, with the page's social profile created alongside. Tests.
- [x] T008 `GET /identity`.
- [x] T009 Author lookups carry `isPage` (posts, comments, search, profiles).
- [x] T010 Web: `lib/identity.ts` and the header in the API client. A switch reloads, waits for the outbox and clears the offline store; per-identity stores are deferred.
- [x] T011 Web: switcher and "Create a page" in Menu; the acting bar; a page's Home, Food and Training.
- [x] T012 Web: the page mark beside names.
- [x] T013 Integration test: create, act, post, read as another account.
- [x] T014 Docs: `pages.md`, `social.md`, `DECISIONS.md`, `CHANGELOG.md`, `CLAUDE.md`.

## Slice 2: follow and Following

- [x] T020 Domain: `followingAuthors()`, with tests.
- [x] T021 `follows` module and collection; in `ACCOUNT_PLAN`; block ends a follow.
- [x] T022 The wall becomes Following: friends plus followed pages' public posts; tests.
- [x] T023 Page posts are public or not shared; pages are always discoverable for For You. (Done with slice 1.)
- [x] T024 `GET /follows/suggested`; follower count and `following` on a page's profile.
- [x] T025 Web: Follow on a page's profile; Home tabs For You and Following; pages to follow when Following is empty.
- [x] T026 `official` mark: field, owner's switch, shown beside the name.
- [x] T027 Integration test: follow, see the post in Following, unfollow.
- [x] T028 Docs: `posts.md`, `pages.md`, changelog.

## Slice 3: the rest

- [x] T029 A page can block a person (and see its blocked list); today only a person can block a page.
- [x] T030 Domain: `canMessage` page cases, with tests. Messages service uses them.
- [x] T031 Notifications for a page reach its managers' devices, named and linking with `?as=`.
- [x] T032a `aiManaged` on the profile and beside the name everywhere.
- [ ] T032b `byPerson` on posts and comments of a page run with AI (touches the composer, drafts and the outbox).
- [x] T033 Export includes a person's pages. (Deleting a page, and pages going with their only manager, were done with slice 1.)
- [x] T034 Suspending a page alone; a suspended person cannot act.
- [x] T035 `pageLimit` per person; People screen (search, limit, suspend, official).
- [x] T036 Numbers excludes pages from people.
- [x] T037 Terms, privacy policy and rules mention pages; `LEGAL_VERSION`.
- [x] T038 Integration test: delete a page and find nothing; limit raised and lowered.
- [ ] T039 Docs, roadmap, changelog; device check; turn the switch on.

## Deferred from slice 1

- [x] T040 (spec 041 slice 1) A page's library screens in Food and Training (the routes are open; the screens are not built), and attaching food or a plan to a page's post.
- [ ] T041 Offline stores kept per identity, so switching need not clear them.

## Open concerns

Logged 2026-11-22, after slice 2. Each is closed by the task named, or by a decision from the owner.

| Concern | State |
|---|---|
| A page cannot block a person; only a person can block a page. A harassed page has no defence of its own. | Closed 2026-11-22 (T029): a page can block and unblock; Menu → Blocked accounts |
| Pages to follow disappear once someone follows five (`SUGGEST_UNTIL_FOLLOWING`). The number was picked without the owner; after that there is no place to browse pages except search and For You. | Closed 2026-11-26 (spec 045 slice 2): Home's card keeps the cut-off; Search lists pages for good |
| The privacy policy, terms and rules do not mention pages or follows (who you follow is stored). | Closed 2026-11-22 (T037) in English. **Open:** the Georgian review copy does not have these paragraphs yet |
| The People screen searches by name and username, not email (spec asks for email too). Left out so the screen shows no address. | Open: owner to say whether email search is wanted |
| A suspended person's pages stay visible: only the person is hidden. Suspend each page too if it should go. | Open: decide whether suspending a person should hide the pages only they manage |
| Per-identity offline stores (T041): switching identity clears what the device kept for offline use. | Deferred |
| A page's library screens in Food and Training are not built (T040), so a page cannot yet attach a food or a plan to a post. | Closed 2026-11-23 (spec 041 slice 1) |
| The "by a person" mark on a post or comment of an AI-run page is not built (T032b). The page-level "run with AI" mark is. | Closed 2026-11-26 (spec 045 slice 1): posts, comments and messages |
| A personal notification tapped while acting as a page opens in the page's context (only a page's notification switches identity, with `?as=`). | Open: decide whether personal links should switch back |
| A notification link for a page does not switch identity while unsent changes wait on the device; it opens as the current identity. | Accepted: same rule as the menu switch |
| A page's notifications use the default preferences (no message or comment previews, every type on); a manager cannot mute one page's notifications. | Open |
| A page can open a conversation with a follower through the API, but there is no screen listing followers to pick from (by design: follower lists are not shown). A page answers people who wrote first. | Accepted for now |
