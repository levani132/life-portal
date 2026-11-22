# Implementation Plan: Pages

**Feature**: `specs/040-pages/spec.md` · **Date**: 2026-11-22

## Summary

A page is an account of kind `page`: it has a row in `users` and a social profile like a person,
and no way to sign in. A person who manages it **acts as** it: their own session stays, and each
request carries the page's id in a header. A guard checks that the person manages the page and
then hands every controller the page's id as the current user. So posts, comments, likes,
messages, feeds, media, the food and training libraries and offline all work for a page with the
code that exists, and what a page must not do is switched off in two places: feature access, and
a marker on the routes that log something.

Following is a new one-way link to a page. The second Home feed, until now friends' posts,
becomes Following: friends' posts plus followed pages' public posts.

## Constitution check

| Principle | How this feature keeps it |
|---|---|
| I. Bounded module | Two new modules: `pages` (create, manage, switch, limits, People) and `follows` (the link and its lists). Posts, messages and notifications ask them through exported reads; they do not read their collections. |
| II. Integer units | Nothing measured. A page limit is a whole number or "none". |
| III. Derived never persisted | Follower counts and page counts are counted on read. Only the follow link is stored. |
| IV. Single-sourced links | Who manages a page lives only on the page (`managers`). Who follows it lives only in `follows`. |
| V. Pure functions | What a page may do, whether a page may write to someone first, and whether a person may create another page are pure rules in `libs/shared/domain/src/lib/pages.ts`, unit tested. |
| VI. Estimates labelled | Nothing estimated. |

## Decisions (research)

**R1. A page is a `users` row, not a new kind of thing.** Every module finds an author, a
feature set or a suspension by user id. A separate `pages` collection would mean teaching each
of them a second lookup. A page row has `kind: 'page'`, `managers: [personId]`, `createdBy`,
and no password or Google identity, so nothing can sign in as it. `users.email` is required and
unique, so a page carries a reserved address that can never receive mail
(`<id>@pages.lifeportal.invalid`); sign-in, password reset and email verification refuse any
account whose kind is `page`. *Rejected:* making `email` optional (changes a unique index on the
live collection for no gain).

**R2. Acting as a page is a header on the person's own session, not a second sign-in.**
`X-LP-Act-As: <pageId>`. A global guard, after authentication, checks the person manages that
page and that neither is suspended, then sets `userId` to the page and keeps the person as
`actorId`. *Rejected:* issuing a session for the page: the web app holds one refresh cookie, so
switching back would need a second sign-in, and sessions would have to be revoked in pairs.

**R3. Two route markers.** `@AsPerson()`: the route always runs as the signed-in person and
ignores the header (auth, account, pages management, People, admin screens). `@NotForPages()`:
the route answers 403 `NOT_FOR_PAGES` while acting as a page (logging food, workouts and weight,
goals, health, tournaments, badges, dashboard, friend requests). A test lists every controller
and fails when a logging route carries neither, the way `ACCOUNT_PLAN` guards collections.

**R4. A page's features are fixed, not switched.** `AccessService.forUser()` answers, for a
page: social, posts, media, messages, For You, notifications, and nutrition and training (for
the library). Money, work and the rest are off. The owner's per-person switches do not apply to
pages.

**R5. Notifications for a page go to its managers' devices.** The sender still calls
`notify({recipientId: pageId})`. Delivery looks up devices by the page's managers and prefixes
the title with the page's name; the link carries `?as=<pageId>` so opening it switches identity.
Activity is stored against the page and read while acting as it.

**R6. Offline.** The acting identity is part of the device's account key: caches and the outbox
are kept per identity, and a queued write stores the identity it was made with and is sent with
that header (`mayReplayAs` already refuses a write for another account).

**R7. The page limit is a number on the person.** `users.pageLimit`: absent means the default
(3), `0` and up is a set limit, `-1` means none. The developer has none. Pages are counted by
`createdBy`.

## Data model

**`users`** (existing), added fields:

| Field | Meaning |
|---|---|
| `kind?: 'page'` | Absent for a person |
| `managers?: string[]` | A page's managers; one entry for now |
| `createdBy?: string` | The person who created the page |
| `official?: boolean` | The app's own page; set by the owner |
| `aiManaged?: boolean` | Run with AI; set by a manager |
| `pageLimit?: number` | On a person: see R7 |

**`social_profiles`** (existing): a page has one, like a person. Added `kind?: 'page'`,
`official?`, `aiManaged?`, copied from the account so author lookups need no join. A page's
profile is always discoverable.

**`follows`** (new): `{ followerId, pageId, createdAt }`, unique on the pair, indexed by
`pageId`. `followerId` is a person or a page. In `ACCOUNT_PLAN` as `custom`: rows naming the
account on either side go with it.

**`food_posts`**, **`post_comments`**: added `byPerson?: boolean` (set only on a page run with AI).

**Shared types**: `PostAuthor` and `SocialPerson` gain `isPage?`, `official?`; a page's profile
gains `aiManaged?`, `followerCount`, `following: boolean`; `FoodPost` and `PostComment` gain
`byPerson?`. New `PageSummary`, `Identity`, `PeopleRow`.

## Contracts

| Route | Who | What |
|---|---|---|
| `GET /pages` | person | The pages I manage, my limit and how many I may still create |
| `POST /pages` | person | Create: name, username, description; 403 `PAGE_LIMIT` at the limit |
| `PATCH /pages/:id` | manager | Name, username, description, `aiManaged` |
| `DELETE /pages/:id` | manager | Delete the page and everything it holds (the account deletion, run for the page) |
| `GET /identity` | either | Who I am acting as: person or page, with its features |
| `PUT /follows/:pageId`, `DELETE /follows/:pageId` | either | Follow, unfollow |
| `GET /follows/suggested` | either | Pages to follow: official first, then most followed |
| `GET /pages/:id/followers` | manager | Who follows the page |
| `GET /posts?feed=following` | either | Friends' posts and followed pages' public posts, newest first (the existing wall, widened) |
| `GET /people?query=` | developer | Accounts and pages, with page count, limit, suspension |
| `PATCH /people/:id` | developer | `pageLimit`, `official` |

All `/pages` management, `/identity` and `/people` routes are `@AsPerson()`.

Errors: `PAGE_LIMIT`, `USERNAME_TAKEN`, `NOT_A_MANAGER` (403, also when the page does not
exist), `NOT_FOR_PAGES`, `PAGE_CANNOT_WRITE_FIRST`.

## Rules (pure, `libs/shared/domain/src/lib/pages.ts`)

- `pageAccess()`: the fixed feature set of a page.
- `mayCreatePage({limit, created, developer})`.
- `canMessage` gains the page cases: a person may always write to a page; a page may write to a
  person only if that person follows it or a conversation exists; never past a block.
- `followingAuthors({friends, followedPages})`: whose posts the Following feed shows, and with
  which audiences (friends: friends and public; pages: public).

## Web

- `lib/identity.ts`: the acting identity, kept per device; the API client adds the header; a
  switch clears in-memory data and reloads the shell.
- Menu: an identity switcher at the top, **Create a page**, and for the owner **People**.
- A thin bar under the header names the page while acting as one.
- Acting as a page: Home shows the two feeds and no widgets; Food and Training show the library
  (foods, meals, exercises, plans) without the day, the workout or goals.
- Profiles: a page's profile shows the page mark, Follow, follower count, and "Run with AI".
- Home tabs: **For You** and **Following**. An empty Following offers pages to follow.
- The page mark sits beside the name in posts, comments, messages, search and notifications.

## Slices

1. **Create and act** (stories 1, 2, 5): the `kind` on accounts, the pages module, the acting
   guard and markers, fixed features, the page mark, the switcher, posting as a page.
2. **Follow and Following** (stories 3, 4): the follows module, the widened feed, suggestions,
   the official mark and People's "official" switch.
3. **The rest** (stories 6, 7, 8, 9): messages with pages, notifications to managers, the AI and
   "by a person" marks, page deletion and export, suspension, the page limit and People.

Each slice is shippable behind a feature switch `pages`, off for everyone but the owner until
its device check.

## Verification

- Unit tests for the pure rules, the acting guard, the route-marker inventory, page creation and
  limits, follows, and the widened feed.
- `app.module.spec.ts` covers the wiring.
- Integration (runs in CI against Mongo): create a page, act as it, post, follow from a second
  account, read Following, delete the page and find nothing left.
- On a phone, per slice, before its switch is turned on.

## What must change with it

`docs/modules/pages.md` (new), `social.md`, `posts.md`, `messages.md`, `notifications.md`,
`account.md` (deleting pages), `ACCOUNT_PLAN` (`follows`), `USAGE_SOURCES` (pages are not
people: sign-ups and activity exclude `kind: 'page'`), the terms, privacy policy and community
rules (who answers for a page, that a page is never a person, the AI mark) with `LEGAL_VERSION`,
`DECISIONS.md`, `CHANGELOG.md`, the roadmap, and `CLAUDE.md`.
