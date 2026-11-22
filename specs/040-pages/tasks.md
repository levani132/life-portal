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

- [ ] T020 Domain: `followingAuthors()`, with tests.
- [ ] T021 `follows` module and collection; in `ACCOUNT_PLAN`; block ends a follow.
- [ ] T022 The wall becomes Following: friends plus followed pages' public posts; tests.
- [x] T023 Page posts are public or not shared; pages are always discoverable for For You. (Done with slice 1.)
- [ ] T024 `GET /follows/suggested`; follower count and `following` on a page's profile.
- [ ] T025 Web: Follow on a page's profile; Home tabs For You and Following; pages to follow when Following is empty.
- [ ] T026 `official` mark: field, owner's switch, shown beside the name.
- [ ] T027 Integration test: follow, see the post in Following, unfollow.
- [ ] T028 Docs: `posts.md`, `pages.md`, changelog.

## Slice 3: the rest

- [ ] T030 Domain: `canMessage` page cases, with tests. Messages service uses them.
- [ ] T031 Notifications for a page reach its managers' devices, named and linking with `?as=`.
- [ ] T032 `aiManaged` on the profile; `byPerson` on posts and comments.
- [ ] T033 Export includes a person's pages. (Deleting a page, and pages going with their only manager, were done with slice 1.)
- [ ] T034 Suspending a page alone; a suspended person cannot act.
- [ ] T035 `pageLimit` per person; People screen (search, limit, suspend, official).
- [ ] T036 Numbers excludes pages from people.
- [ ] T037 Terms, privacy policy and rules mention pages; `LEGAL_VERSION`.
- [ ] T038 Integration test: delete a page and find nothing; limit raised and lowered.
- [ ] T039 Docs, roadmap, changelog; device check; turn the switch on.

## Deferred from slice 1

- [ ] T040 A page's library screens in Food and Training (the routes are open; the screens are not built), and attaching food or a plan to a page's post.
- [ ] T041 Offline stores kept per identity, so switching need not clear them.
