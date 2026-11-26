# Pages: accounts that are not a person

Spec 040 (`specs/040-pages`). `apps/api/src/pages`, `apps/api/src/auth/acting.ts`, pure rules in
`libs/shared/domain/src/lib/pages.ts`, web `lib/identity.ts` and
`components/identity-switcher.tsx`. Behind the `pages` feature.

**Built: slices 1 to 3**, except the "by a person" mark on a post (T032b), a page's library
screens (T040) and per-identity offline stores (T041). Open concerns are listed at the end of
`specs/040-pages/tasks.md`.

## What a page is

A row in `users` with `kind: 'page'`, plus a social profile like a person's. So every module
finds a page's name, features and suspension the way it finds a person's.

| Field on `users` | Meaning |
|---|---|
| `kind: 'page'` | Absent for a person |
| `managers: string[]` | The people who may act as it (spec 045: up to 10, by invitation) |
| `createdBy` | Who created it; what that person's limit counts, even after a handover |
| `ownerId` | Spec 045: the owner after a handover. Absent: the creator. `pageOwner()` answers who owns it |
| `official`, `aiManaged` | The app's own page; run with AI (shown from slices 2 and 3) |
| `pageLimit` (on a person) | How many pages they may create. Absent: 3. `-1`: no limit |

A page has no password and no sign-in identity. `users.email` is required and unique, so a page
carries `<id>@pages.lifeportal.invalid`, which cannot receive mail; sign-in refuses any account
of kind `page`. `social_profiles.kind: 'page'` is a copy, so naming an author needs no join, and
a page's profile is discoverable from the start.

## Acting as a page

The person stays signed in as themselves. A request made as a page carries
`x-lp-act-as: <pageId>`. `ActingGuard` runs after authentication and before the feature check:

| Route marker (`auth/acting.ts`) | With the header |
|---|---|
| `@AsPerson()` | Ignored: the route runs as the person. Sign-in, the account, `/pages`, admin screens, devices and preferences |
| `@ForPages()` | Runs as the page, once `PagesService.actingAs()` agrees the person manages it, has the feature, and the page is not suspended. `userId` becomes the page; `actorId` stays the person |
| none, or `@NotForPages()` | 403 `NOT_FOR_PAGES` |

**The default is refusal.** A new route is closed to pages until someone opens it, so a route
that logs something personal cannot be forgotten. Open to pages today: posts, media, social
(not friend requests), the portal state, a page's Activity, and in Food and Training only the
library (`foods`, `meals`, brands, `exercises`, `plans`). A test reads the two controllers and
fails if `@ForPages()` lands on anything else there.

Token-authenticated and public routes have no session user and are untouched.

## What a page can use

`pageAccess()` is fixed: social, posts, media, For You, notifications, and Food and Training for
the library. `AccessService.forUser()` answers it for any account of kind `page`, whatever the
owner's switches say, and answers nothing-on for a suspended page. `GET /portal` answers a page
with no modules, no widgets and setup complete, and stores nothing. A page's posts are public or
unshared: the `friends` audience is refused (`PAGE_AUDIENCE`). A page cannot be anyone's friend
(`NOT_A_PERSON`).

## Routes

| Route | Runs as | What |
|---|---|---|
| `GET /pages` | person | Pages I manage, and how many more I may create (`null`: no limit) |
| `POST /pages` | person | `{name, username, bio?}`. 403 `PAGE_LIMIT`, 409 `USERNAME_TAKEN`, 403 `PAGES_OFF` |
| `PATCH /pages/:id` | person (manager) | Name, username, bio, `aiManaged` |
| `DELETE /pages/:id` | person (manager) | Erases the page with `AccountService.erase()` |
| `GET /identity` | either | `{kind: 'person'}` or `{kind: 'page', page, personId}` |

`NOT_A_MANAGER` is the one answer for "not yours" and "does not exist".

## Following

`apps/api/src/follows` (a `@Global` module, so posts and social can read it without a cycle).

| Collection `follows` | |
|---|---|
| `followerId` | A person or a page |
| `pageId` | The account followed: a page, or a person when the follower is a page (the field's name is older than that). A person never follows a person |
| `createdAt` | |

Unique on the pair. Nothing else is stored: a follower count is counted on read, and there is no
list of followers anywhere in the API.

| Route (as person or page) | What |
|---|---|
| `PUT /follows/:pageId` | Follow. No approval. Anyone follows a page; **a page may also follow a person** (owner's decision, 2026-11-23) and then sees that person's public posts in its Following feed. 404 for a person following a person, a missing, suspended or switched-off account, or a block either way; 409 for following itself. Repeating it changes nothing. The person is not told and their follower count is shown to nobody |
| `DELETE /follows/:pageId` | Stop following. Always succeeds |
| `GET /follows/suggested` | Up to 8 pages to follow: official first, then most followed; never one already followed, managed by the viewer, suspended or blocked. Empty once someone follows 5. `?all=1` (Search, spec 045): up to 30, with no cut-off |
| `PUT /pages/:id/official` (person) | `{official}`. The developer only, for any page. Written to `users.official` and copied to `social_profiles.official` |

- **The Following feed** is the wall (`GET /posts` with no author): `followingAuthors()` in
  `libs/shared/domain` joins yourself, your friends and the pages you follow. Each post still
  passes `readable()`, so of a page's posts only the public ones show. A page acting follows as
  itself: its follows are not its manager's.
- A page's profile (`GET /social/profiles/:id`) carries `followerCount`, and `following` for
  anyone but the page itself. Authors carry `official` beside `isPage`.
- A block between two accounts deletes any follow between them (`FollowsService.endBetween`).
  A person can block a page; a page blocking a person is slice 3.
- Account deletion removes every row naming the account as follower or page (`ACCOUNT_PLAN`:
  custom). The export holds the pages the person follows.

Web: `components/follow.tsx` (`PageFollow` on a page's profile, `SuggestedPages`,
`OfficialMark`). Home's second tab is **Following**; pages to follow sit above it until five are
followed. The owner sees an "Official" switch on any page's profile.

## Messages, notifications, blocking, the AI mark

- **Messages.** The messages routes are open to pages and `messages` is in `pageAccess()`.
  `canMessage()` decides: anyone may write to a page; a page may write to a person only if they
  follow it or have written to it (`page-first` otherwise); a block either way stops both.
  Friendship plays no part when a page is on either side. The conversation belongs to the page:
  its manager, as themselves, is not a member and cannot open it.
- **Notifications.** A page has no devices. `PagesService` registers a resolver with
  `NotificationsService`; a notification for a page is sent to its managers' devices (not to the
  manager who caused it), titled "<page> (page)" with the actor in the body
  (`pageNotification()`), and its link carries `?as=<pageId>`. The web app (`useActAsLink` in
  `identity-switcher.tsx`) switches identity on such a link under the menu's rules. The badge
  count on the device stays the device owner's own. Each manager chooses per page: always, or
  only while using the app as it (spec 045, see notifications.md).
- **Blocking.** `PUT /social/connections/:id` is open to a page for `block` and `unblock` only
  (409 `NOT_A_PERSON` otherwise); `GET /social/connections` answers a page only for
  `kind=blocked`. Menu → Blocked accounts.
- **Run with AI.** `PATCH /pages/:id {aiManaged}` writes `users.aiManaged` and copies it to
  `social_profiles.aiManaged`, so authors, chat headers and profiles carry `aiManaged` and the
  mark reads "Page · AI". The manager sets it on the page's own profile.
- **Export.** A person's export holds their pages under `pages.*` (profile, posts, media,
  comments, follows, sent messages).

## Library (spec 041, slice 1)

Acting as a page, the tab bar has **Library** in place of Search (Search is an icon in the header, so the bar stays at four tabs and the + button): (`/library`, `components/page-library.tsx`):
Foods (`GET/POST/PATCH/DELETE /nutrition/foods`, brands), Recipes (saved meals, built from the
page's foods with `POST/PATCH /nutrition/meals`; this builder exists only here), Training plans
and Exercises (the people's components, with Start, progress and history hidden). The reads a
page may not make (`/training/profile`, `/nutrition/profile`, the current session) are skipped
in their hooks when acting, so a page sees defaults instead of errors.

Posting from the library: "Post" on a food, recipe, plan or exercise opens the composer with it
attached; the composer's **Add from the library** opens the food picker on the page's foods and
recipes (no Diary tab). The snapshot, hash, saving and copying are the same services people use.
**Create in the composer** (`components/post-create.tsx`, for people and pages): the composer's
"Create" button makes a recipe, a training plan or an exercise (and, for a page, a food) with
the same forms as elsewhere; it is saved to the library and comes back attached to the post.
People keep the composer's own "New food" card, which can also log the food.

A page's library is its own: its manager's foods and plans are separate rows under another id.
Tested in `integration/page-library.integration.ts`.

## The assistant for pages (spec 041)

See [mcp](mcp.md#pages-spec-041): the consent switch, the tools, the daily caps, the log and
the same-manager rule. In the app: the switch is in Menu → AI assistant connections; a page's
own profile lists what the assistant did; Menu → People edits the caps (defaults and per person).

## People (the owner's screen)

Menu → People, developer only (`/settings/people`).

| Route (person, developer only) | What |
|---|---|
| `GET /people-admin?kind=people\|pages&q=&skip=` | 30 accounts, newest first, by name or username prefix. A person: `pageLimit` (absent: default), `pagesCreated`. A page: `official`, `aiManaged`, `followerCount`, its managers' names. No email, nothing an account keeps |
| `PUT /people-admin/:id/page-limit` | `{limit}`: 0 to 1000, `-1` for none, `null` for the default. Lowering it deletes nothing: existing pages stay, no more can be made |

Suspend and restore use the existing `POST /auth/accounts/:id/suspend|unsuspend`, which work on
a page as on a person: a suspended page cannot be acted as (`PAGE_SUSPENDED`), its features are
all off so its posts are hidden, and its managers (not the page's unreachable address) get the
email. The manager's own account is untouched. Suspending a person does not suspend their pages,
unless none of a page's managers can act any more (spec 045, below).

Open concerns for this feature are listed at the end of `specs/040-pages/tasks.md`.

## Switching a page off (spec 041)

`users.disabledAt` on a page, set by a manager with `PUT /pages/:id/disabled {disabled}` (Menu →
Manage pages) or by an assistant with `disable_page`. `AccessService.forUser()` then answers
nothing-on, exactly as for a suspended account, so the profile, the posts and the page's place
in feeds and suggestions disappear for everyone else; follows refuse it; acting as it and the
assistant answer `PAGE_DISABLED`. Nothing is deleted. Only a manager, in the app, switches it on
again: an assistant can switch off and has no tool to switch on or delete. Menu → Manage pages
is also where a page is deleted (the username is typed to confirm).

## Limits and deletion

`mayCreatePage()`: three pages per person by default, counted by `createdBy`; `pageLimit` on the
person changes it; the developer has none. Deleting a page runs the account deletion for it.
Deleting a person deletes every page only they manage, and removes them from pages others also
manage.

## Web

- `lib/identity.ts` keeps the acting page id per device; the API client adds the header to every
  signed-in request. An answer of `NOT_A_MANAGER` or `PAGE_SUSPENDED` while acting ends it.
- **Switching reloads the app**, waits until the outbox is empty, and clears what the device kept
  for offline use, so one identity's data is never shown or sent as the other's. Per-identity
  offline stores are later work.
- Menu: the switcher and **Create a page**. Acting as a page, Home is the feeds, the menu is the
  switcher and the page's profile, and the composer offers text, photos and video to everyone or
  to nobody.
- **Which identity is in use is the photo on the profile tab** (the last tab shows the acting
  identity's profile photo, not an icon). There is no banner: the owner removed it (2026-11-23).
  **A double tap on that tab switches** to the other identity: from a page back to yourself, from
  yourself to the page used last on this device (`lp.acting.last`, else the first usable page).
  It follows the menu's rules (nothing unsent, reload) and says why when it cannot.
- `PageMark` sits beside a page's name in posts and on its profile.

## Tests

`pages.module.spec.ts` (create, limits, usernames, managers, the guard, what Food and Training
open), `libs/shared/domain/src/lib/pages.spec.ts`, `access.module.spec.ts`,
`account.service.spec.ts` (pages go with their manager), and `integration/pages.integration.ts`
and `integration/follows.integration.ts` against a real database.

## By a person (spec 045, slice 1)

On a page run with AI, a post, comment or message a person writes through the app is stored with
`byPerson: true` and shows **By a person** (`ByPersonMark`). It is decided at creation: the
request was made acting as the page (`actorId !== userId`) and the page is `aiManaged` then. The
assistant calls the services directly, so what it writes is never marked. Likes, reposts and
follows carry no mark. Tested in `integration/by-person.integration.ts`.

## Pinned post (spec 045, slice 5)

`food_posts.pinnedAt` on one of a page's own original posts. `PUT /posts/:id/pin` and `DELETE`
(acting as the page; 403 `PAGES_ONLY` for a person, 404 for a post not its own) set it; pinning
another clears the old one. `GET /posts?authorId=<page>` (first page, no cursor) puts the pinned
post first and does not repeat it; every post answer carries `pinned`. The web says "Pinned" on a
profile only; "Pin to profile" is in a page's own post menu. The assistant has `pin_page_post`
and `unpin_page_post`. Tested in `integration/pinned-post.integration.ts`.

## Co-managers (spec 045, slice 6)

`page_invites {pageId, personId, invitedBy, createdAt, expiresAt}` (unique per page and person,
gone after 30 days). All routes are person routes (`@AsPerson()`):

| Route | Who | What |
|---|---|---|
| `GET /pages/:id/managers` | a manager | Managers (`owner`, `you`, `mayRemove`) and pending invitations |
| `POST /pages/:id/managers {username}` | a manager | Invites a person by exact username. 404 `NO_SUCH_PERSON` for no such person, a page, a suspended account or a block either way with the page or the inviter (one answer, so nothing leaks); 400 `ALREADY_MANAGER`, `TOO_MANY_MANAGERS` (10). Repeating changes nothing; a new invitation sends `pageInvite` |
| `DELETE /pages/:id/invites/:inviteId` | a manager | Cancels an invitation |
| `GET /pages/invites/mine` | anyone | Invitations waiting for me (pages not suspended) |
| `PUT /pages/invites/:id {accept}` | the invited person | Accept (joins `managers`) or decline; either way it goes. 404 `INVITE_GONE` |
| `DELETE /pages/:id/managers/:personId` | a manager | `mayRemoveManager()`: a manager leaves; the owner removes anyone else but cannot leave (403 `OWNER_MUST_HAND_OVER`); with no owner left, any manager removes others. Never the last manager (403 `LAST_MANAGER`); guarded on the count, so two leaving at once cannot empty it |
| `PUT /pages/:id/owner {personId}` | the owner | Makes another current manager the owner (`ownerId`); the old owner stays a manager. 403 `OWNER_ONLY`, 400 `NOT_A_MANAGER_YET`. Guarded on the current owner |

**Two roles** (owner's decision, 2026-11-26): the **owner** removes managers, deletes the page
(`DELETE /pages/:id`, 403 `OWNER_ONLY` for anyone else) and hands ownership over; resigning in
favour of someone is the same handover. **Managers** post, answer, invite, see insights, switch
the page off and get its notifications. More roles may come with money. The page limit still
counts `createdBy` only, so receiving a page never takes someone over their limit. When an owner
deletes their account, a page others also manage goes to the longest-serving other manager
(`nextOwner()`). A removed manager's next request as
the page is refused (`NOT_A_MANAGER`), which ends acting on that device.

**Suspension.** Suspending a person suspends a page they manage only when every manager of it is
then suspended (`pageHasNoActiveManager()`): the page gets `suspendedForManagers`. Restoring any
of its managers restores such a page. A page suspended for itself stays suspended. Deleting a
person still deletes the pages only they manage (what account deletion promises).

Web: Menu → Manage pages → the page, "Managers" (invite by username, remove, leave); invitations
show at the top of Menu with Accept and Decline. No assistant tools: managing who runs a page is
a person's act, not the page's. Tested in `integration/co-managers.integration.ts`.

