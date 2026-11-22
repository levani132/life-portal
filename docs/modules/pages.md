# Pages: accounts that are not a person

Spec 040 (`specs/040-pages`). `apps/api/src/pages`, `apps/api/src/auth/acting.ts`, pure rules in
`libs/shared/domain/src/lib/pages.ts`, web `lib/identity.ts` and
`components/identity-switcher.tsx`. Behind the `pages` feature.

**Built so far: slices 1 and 2** (create a page, act as it, post as it, the page mark; follow a
page, the Following feed, pages to follow, the official mark). Messages, notifications to
managers, the AI mark, a page blocking someone, the People screen and the page limit's admin
side are slice 3.

## What a page is

A row in `users` with `kind: 'page'`, plus a social profile like a person's. So every module
finds a page's name, features and suspension the way it finds a person's.

| Field on `users` | Meaning |
|---|---|
| `kind: 'page'` | Absent for a person |
| `managers: string[]` | The people who may act as it. One for now |
| `createdBy` | Who created it; what that person's limit counts |
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
| `pageId` | Always a page: nobody follows a person |
| `createdAt` | |

Unique on the pair. Nothing else is stored: a follower count is counted on read, and there is no
list of followers anywhere in the API.

| Route (as person or page) | What |
|---|---|
| `PUT /follows/:pageId` | Follow. No approval. 404 for a person, a missing or suspended page, or a block either way; 409 for a page following itself. Repeating it changes nothing |
| `DELETE /follows/:pageId` | Stop following. Always succeeds |
| `GET /follows/suggested` | Up to 8 pages to follow: official first, then most followed; never one already followed, managed by the viewer, suspended or blocked. Empty once someone follows 5 |
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
- Menu: the switcher and **Create a page**. A bar under the header names the page and offers the
  way back. Acting as a page, Home is the feeds, the menu is the switcher and the page's
  profile, and the composer offers text, photos and video to everyone or to nobody.
- `PageMark` sits beside a page's name in posts and on its profile.

## Tests

`pages.module.spec.ts` (create, limits, usernames, managers, the guard, what Food and Training
open), `libs/shared/domain/src/lib/pages.spec.ts`, `access.module.spec.ts`,
`account.service.spec.ts` (pages go with their manager), and `integration/pages.integration.ts`
and `integration/follows.integration.ts` against a real database.
