# Feature Specification: Pages

**Feature Branch**: `040-pages`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Pages: accounts that are not a person. Any user can create pages and manage them. A person chooses which identity to use (themselves or one of their pages) and, while acting as a page, gets a different experience: no personal tracking, but everything social works as an independent user: a profile, posting, commenting, liking, reposting, messaging, a For You feed, and following other pages. People and pages can follow pages (one-way Follow; friendship between people stays mutual). For normal users the Home feed tabs become 'For You' and 'Following', where Following shows posts from friends plus the pages they follow. Pages stay out of ranks, tournaments, leaderboards, badges and friend suggestions and cannot be friends. Whoever runs a page can mark it as AI-managed; on such a page, something a human did is marked as human. Never fake people: a page is always shown as a page. The app's own pages are ordinary pages run by the owner, so a newcomer never lands on an empty feed. Moderation, reports, suspension, account deletion and export and the privacy policy must cover pages. Assistant tools for acting as a page come in a later feature."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a page and act as it (Priority: P1)

A person opens the menu, chooses **Create a page**, gives it a name, a username, a photo and a short description, and has a page. From then on the menu offers a switch: themselves, or any page they manage. Choosing a page changes the whole app to that page's point of view: its profile, its feed, its posts, its messages and its notifications. Switching back returns them to their own account exactly as they left it.

**Why this priority**: Nothing else exists without a page and a way to be it. This alone lets the owner run the app's own pages.

**Independent Test**: Create a page, switch to it, post as it, switch back: the post shows the page as its author everywhere, and the person's own account, tracking and feed are untouched.

**Acceptance Scenarios**:

1. **Given** a signed-in person, **When** they create a page with a name and a free username, **Then** the page exists, they manage it, and it appears in their identity switch.
2. **Given** a person who manages a page, **When** they switch to it, **Then** every screen shows the page's own profile, feed, posts, messages and notifications, and a clear, always-visible sign of which identity is in use.
3. **Given** a person acting as a page, **When** they post, comment, like or repost, **Then** the action is the page's: it carries the page's name and photo, and nothing shows which person did it.
4. **Given** a person acting as a page, **When** they switch back, **Then** they are themselves again with no sign-in, and nothing they did as the page appears as theirs.
5. **Given** a username already used by a person or another page, **When** someone tries to take it for a page, **Then** it is refused.

---

### User Story 2 - A page is content only (Priority: P1)

While acting as a page, the personal parts of the app are gone: no food diary, no workouts, no weigh-ins, no goals, no money, no badges, levels, ranks or tournaments. What remains is everything social, plus a library: the page can keep foods, meals, exercises and workout plans so that it can publish them for others to save.

**Why this priority**: It is what makes a page a page and not a second personal account, and it keeps pages out of everything that compares people.

**Independent Test**: Act as a page and look for a way to log a meal, a workout or a weight: there is none. Publish a meal and a workout plan from the page's library: another person can save them.

**Acceptance Scenarios**:

1. **Given** a person acting as a page, **When** they look through the app, **Then** there is no way to log food, a workout or body weight, and no personal goals, money, badges, levels, ranks or tournaments.
2. **Given** a page with foods and plans in its library, **When** it posts one, **Then** other people can save it exactly as they save one from a person's post.
3. **Given** any ranking, tournament, leaderboard, badge list or friend suggestion, **When** it is shown to anyone, **Then** no page appears in it.
4. **Given** a page, **When** a person tries to send it a friend request (or the page tries to send one), **Then** it is not possible: pages have followers, not friends.

---

### User Story 3 - Follow a page, and the Following feed (Priority: P1)

A person opens a page's profile and taps **Follow**. Home now has two tabs, **For You** and **Following**. Following shows the posts of their friends and of the pages they follow, newest first. Unfollowing removes that page's posts from it.

**Why this priority**: Without it a page's posts reach nobody reliably, and it is the answer to "how do I keep seeing a page I like".

**Independent Test**: Follow a page, see its next post in Following; unfollow, and its posts are gone from Following while still findable in For You and on its profile.

**Acceptance Scenarios**:

1. **Given** a person viewing a page, **When** they tap Follow, **Then** they follow it at once, with no approval, and the page's follower count rises by one.
2. **Given** a person who follows pages and has friends, **When** they open Following, **Then** they see the posts those friends shared with them and the public posts of those pages, mixed, newest first.
3. **Given** a person who follows a page, **When** they unfollow, **Then** its posts no longer appear in Following.
4. **Given** a person who has blocked a page, or a page that has blocked a person, **When** either looks, **Then** neither sees the other's posts anywhere and the person cannot follow the page.
5. **Given** a person acting as a page, **When** they open Home, **Then** For You and Following are there too, and Following holds the pages that page follows.
6. **Given** a person, **When** they look for a Follow button on another person's profile, **Then** there is none: people are friends, mutually, as before.

---

### User Story 4 - A newcomer never lands on an empty app (Priority: P1)

The owner runs a few pages of the app's own (kitchen, training, challenges) that post regularly. A person who has just signed up and has no friends opens Home and finds real posts in For You, and is offered those pages to follow.

**Why this priority**: Registration is open. An empty first screen is the reason people do not come back.

**Independent Test**: Create a new account with no friends: For You shows posts from the app's pages, and a short list of pages to follow is offered once.

**Acceptance Scenarios**:

1. **Given** a brand-new account, **When** it opens Home, **Then** For You contains posts from pages without the person having done anything.
2. **Given** a brand-new account that follows nobody, **When** it opens Following, **Then** it is offered pages to follow instead of an empty screen.
3. **Given** a page the owner marked as the app's own, **When** anyone sees it, **Then** it carries a mark saying it is official.

---

### User Story 5 - A page is never mistaken for a person (Priority: P1)

Wherever a page's name appears (a post, a comment, a message, a search result, a notification), a small mark shows it is a page. A page's profile says who it is for, and, if its manager set it so, that it is run with AI. On a page run with AI, anything a human did by hand is marked as done by a person.

**Why this priority**: The app's promise is that people show how they really eat and train. A page pretending to be one of them breaks that, and in some countries is unlawful.

**Independent Test**: Look at a page's post, comment and message next to a person's: the page is recognisable as a page in each, without opening its profile.

**Acceptance Scenarios**:

1. **Given** any place a page's name is shown, **When** someone looks at it, **Then** a page mark is visible beside the name.
2. **Given** a page whose manager marked it as run with AI, **When** someone opens its profile, **Then** the profile says so plainly.
3. **Given** a page marked as run with AI, **When** a manager posts or comments by hand and says so, **Then** that post or comment carries a "by a person" mark.
4. **Given** a page, **When** it posts food or training content, **Then** it is presented as something published to be saved, never as something the page ate or did today.

---

### User Story 6 - Talking to a page (Priority: P2)

A person can send a message to a page, and whoever is acting as the page can answer. A page cannot write first to someone who neither follows it nor has written to it.

**Why this priority**: Pages need to hear from people; people need not to be written to by strangers' pages.

**Independent Test**: Message a page from a personal account; switch to the page and reply; confirm the page cannot open a conversation with a person who has nothing to do with it.

**Acceptance Scenarios**:

1. **Given** a person, **When** they message a page, **Then** the conversation appears in the page's messages, not in its manager's own.
2. **Given** a person acting as a page, **When** they reply, **Then** the reply comes from the page.
3. **Given** a page and a person who neither follows it nor has messaged it, **When** the page tries to start a conversation, **Then** it cannot.
4. **Given** a person, **When** they block a page, **Then** it can no longer message them.

---

### User Story 7 - Managing a page over time (Priority: P2)

The manager can edit the page's name, username, photo and description, see its followers, and delete it. Deleting a page removes its posts, comments, messages and followers. Deleting a personal account deletes the pages only that person managed. The manager is notified, on their own devices, about what happens on their pages, labelled with the page's name.

**Why this priority**: A page that cannot be changed or removed is a liability, and deletion must stay complete.

**Independent Test**: Delete a page and confirm nothing of it remains for anyone; delete a personal account that managed a page and confirm the page went with it.

**Acceptance Scenarios**:

1. **Given** a manager, **When** they delete a page after confirming, **Then** its profile, posts, photos, comments, likes, messages and follow links are gone for everyone, at once.
2. **Given** a person who is the only manager of a page, **When** they delete their personal account, **Then** the page is deleted with it.
3. **Given** a person who downloads their data, **When** the file is made, **Then** it includes the pages they manage and what those pages hold.
4. **Given** a manager not currently acting as the page, **When** someone comments on the page's post or messages the page, **Then** they get a notification that names the page, and opening it switches them to the page.

---

### User Story 8 - Pages follow the same rules (Priority: P2)

A page's photos are checked like anyone's. Its posts can be reported, held, kept or removed. The reviewer can suspend a page on its own, without touching its manager's personal account, and can suspend a person, which also stops them acting as their pages.

**Why this priority**: Pages will be the easiest way to reach many strangers, so they must not be a way around moderation.

**Independent Test**: Report a page's post until it is hidden; remove it; suspend the page: its manager keeps their own account and loses the page.

**Acceptance Scenarios**:

1. **Given** a page's post with a photo, **When** it is published, **Then** the photo is checked before anyone else sees it, exactly as for a person.
2. **Given** a reported page post, **When** the reviewer opens the queue, **Then** it is shown as a page's post and can be kept or removed.
3. **Given** the reviewer suspends a page, **When** anyone looks, **Then** nothing the page posted is shown, nobody can act as it, and its manager's own account works as before.
4. **Given** the reviewer suspends a person, **When** that person had pages, **Then** they cannot act as them either.

---

### User Story 9 - The owner manages people (Priority: P2)

The owner opens **People** in the menu: a searchable list of accounts and pages. For a person it shows when they joined, whether they are suspended, how many pages they have and their page limit, and lets the owner change that limit (a number, or no limit), suspend or restore them, and open the feature switches that already exist per person. For a page it shows who manages it and lets the owner suspend or restore it and mark it as the app's own.

**Why this priority**: The page limit is only useful if it can be lifted for the people who need more, and suspension and feature switches are scattered today.

**Independent Test**: Find a person by name or email, raise their limit from 3 to 20, and confirm they can create a fourth page; set it back and confirm they cannot create another.

**Acceptance Scenarios**:

1. **Given** the owner on People, **When** they search by name, username or email, **Then** matching people and pages are listed.
2. **Given** a person at their limit, **When** the owner raises or lifts it, **Then** that person can create more pages at once.
3. **Given** any account other than the owner's, **When** it opens People, **Then** it is refused.
4. **Given** a page in the list, **When** the owner marks it as the app's own or suspends it, **Then** the change shows to everyone at once.

---

### Edge Cases

- A person tries to create more pages than their limit: refused with the limit stated and how to ask for more (write to support).
- The owner lowers a person's limit below the number of pages they already have: the existing pages stay; the person cannot create another until they are under the limit.
- A page's manager is acting as the page on one device and as themselves on another: each device keeps its own choice.
- A notification for a page arrives while the person is acting as themselves: it names the page, and opening it switches identity first.
- A person follows a page, then the page is deleted or suspended: the follow disappears with it and Following shows nothing from it.
- A page reposts a person's post: it is shown as the page's repost, under the original's audience rules as today.
- A person who managed a page and is its only manager is suspended: the page is not shown while they are suspended.
- Offline: actions taken as a page while offline are sent as that page when the connection returns, never as the person or another page.
- A person likes their own page's post while acting as themselves: allowed, and counted as one like from a person.
- A page tries to follow a person: not possible; pages follow pages only.
- The same name as an existing page: allowed (names are not unique); usernames are.

## Requirements *(mandatory)*

### Functional Requirements

**Pages and identity**

- **FR-001**: A signed-in person MUST be able to create a page with a name, a unique username, an optional photo and an optional description.
- **FR-002**: A person MUST be able to create up to 3 pages by default. The owner MUST be able to raise, lower or lift that limit for a specific person, and the owner's own account has no limit. The limit counts pages a person created; it does not limit how many pages a person may help manage once co-managers exist.
- **FR-003**: A person who manages pages MUST be able to switch, without signing in again, between acting as themselves and acting as any one of their pages, and the app MUST show at all times which identity is in use.
- **FR-004**: Everything done while acting as a page MUST belong to the page and MUST NOT reveal which person did it to anyone but the page's managers and the reviewer.
- **FR-005**: A page MUST have no password or sign-in of its own; it is reached only through a manager's account.
- **FR-006**: A manager MUST be able to edit and delete their page. Deleting is immediate and complete.
- **FR-007**: The design MUST allow more than one manager per page later; this feature ships with the creator as the only manager.

**What a page can and cannot do**

- **FR-008**: While acting as a page, a person MUST NOT be able to log food, workouts or body weight, set personal goals, or use money, badges, levels, ranks or tournaments.
- **FR-009**: A page MUST be able to keep a library of foods, meals, exercises and workout plans, and publish them in posts that others can save.
- **FR-010**: A page MUST be able to post text, photos and video, comment, like, repost, and send and receive messages, as a person can.
- **FR-011**: A page's posts MUST be either public or not shared (only its managers, or people sent its link); a page has no friends-only audience.
- **FR-012**: A page MUST NOT appear in any rank, tournament, leaderboard, badge list or friend suggestion, and MUST NOT be able to be anyone's friend.
- **FR-013**: A page MUST NOT be able to start a conversation with a person who neither follows it nor has messaged it.

**Following and feeds**

- **FR-014**: A person or a page MUST be able to follow and unfollow a page with one tap and no approval. Nobody can follow a person.
- **FR-015**: A page's profile MUST show its follower count, and its managers MUST be able to see who follows it.
- **FR-016**: Home MUST offer two feeds to people: For You and Following. Following MUST show the posts friends shared with the viewer and the public posts of followed pages, together, newest first.
- **FR-017**: While acting as a page, Home MUST offer For You and Following, where Following holds the pages that page follows.
- **FR-018**: Public posts from pages MUST be eligible for everyone's For You without the page having to opt in to being found.
- **FR-019**: Blocking MUST work between people and pages in both directions and MUST end and prevent following.
- **FR-020**: A person who follows nobody and has no friends MUST be offered pages to follow instead of an empty Following feed.

**Honesty**

- **FR-021**: A page mark MUST be visible beside a page's name wherever the name is shown.
- **FR-022**: A page's manager MUST be able to mark the page as run with AI, and the page's profile MUST then say so.
- **FR-023**: On a page marked as run with AI, a manager MUST be able to mark a post or comment as made by a person, and that mark MUST be shown on it.
- **FR-024**: Food and training content published by a page MUST be presented as content to save, never as something the page ate or did.
- **FR-025**: The owner MUST be able to mark a page as the app's own, and that mark MUST be visible to everyone.

**Safety, deletion and privacy**

- **FR-026**: Photo checks, reports, holds, the review queue and removal notices MUST apply to pages exactly as to people.
- **FR-027**: The reviewer MUST be able to suspend a page without suspending its manager, and suspending a person MUST stop them acting as their pages.
- **FR-028**: Deleting a personal account MUST delete every page that person alone manages; the data download MUST include the pages they manage.
- **FR-029**: Notifications about a page MUST go to its managers' devices, name the page, and never mix with their personal notifications without that label.
- **FR-030**: Actions queued while offline MUST be sent as the identity they were made with.
- **FR-032**: The owner MUST have a People screen listing accounts and pages with search, showing each person's page count and limit, and allowing the limit to be changed, an account or page to be suspended or restored, and a page to be marked as the app's own. Nobody else may open it.
- **FR-031**: The terms, privacy policy and community rules MUST describe pages: who is responsible for one, that a page is never a person, and the AI mark.

### Key Entities

- **Page**: An identity that is not a person: name, username, photo, description, whether it is run with AI, whether it is the app's own, whether it is suspended. Has managers, followers, posts, messages and a library.
- **Manager**: The link between a person and a page they may act as. One per page for now.
- **Follow**: A one-way link from a person or a page to a page. No approval, removable by either side blocking.
- **Acting identity**: Which identity a device is currently using: the person, or one of their pages.
- **Library**: The foods, meals, exercises and plans a page keeps in order to publish them. It has no diary, workouts or weigh-ins.
- **"By a person" mark**: A flag on a post or comment made by hand on a page run with AI.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-009**: The owner can find a person and change their page limit in under 30 seconds.
- **SC-001**: A person can create a page and publish its first post in under 2 minutes.
- **SC-002**: Switching between identities takes one or two taps and under 2 seconds, with no sign-in.
- **SC-003**: A brand-new account with no friends sees at least 5 posts in For You the first time it opens Home.
- **SC-004**: In a side-by-side look at a page's and a person's post, comment and message, 10 out of 10 testers tell which is the page without opening a profile.
- **SC-005**: While acting as a page, there are zero ways to create a diary entry, a workout or a weigh-in.
- **SC-006**: No page appears in any rank, tournament, leaderboard, badge list or friend suggestion: zero occurrences across those screens.
- **SC-007**: After a page is deleted, nothing that names it or belonged to it can be found by any account: zero remaining items.
- **SC-008**: A post from a followed page appears in the follower's Following feed within one refresh of being published (and released by the photo check).

## Assumptions

- **People follow pages; a page may also follow a person** (changed 2026-11-23). People remain mutual friends with each other: a person does not follow a person.
- **"Following" replaces "Friends" as the second Home tab** and holds both friends' posts and followed pages' posts. There is no separate friends-only feed.
- **A page's posts are public or not shared.** "Followers only" is left out to keep the first version simple; it can be added later.
- **Pages are always findable.** Unlike people, who choose whether strangers can find them, a page exists to be found.
- **A page may write first only to its followers or to people who wrote to it.** This is the anti-spam default.
- **3 pages per person by default** (owner's decision, 2026-11-22) is a guard against flooding, not a ceiling on what someone may run: the owner lifts or changes it per person from the People screen, and has no limit themselves.
- **The AI mark shows on the page's profile; the page mark shows everywhere.** This follows the owner's stated preference (2026-11-20): someone who opens the page learns it is run with AI, and the "page" mark beside the name is what stops a page being mistaken for a person in a feed.
- **"By a person" is set by the manager** when they act by hand on an AI-run page. Detecting it automatically arrives with the assistant tools in a later feature, where actions made by a tool can be told apart from actions made in the app.
- **One manager per page for now.** Inviting co-managers, roles and transferring a page are a later feature.
- **Assistant (MCP) tools for acting as a page are a later feature**, as are paid pages, promoted posts, verified business pages and page analytics.
- **A page keeps a library but never a diary.** It needs foods and plans to publish them; it has nothing to log.
- **The app's own pages are ordinary pages** that the owner creates and marks as official; their content is the owner's to write. No content ships with the feature.
- **Existing rules carry over unchanged:** photo checks, reports, holds, link-only posts, reposts, saving foods and plans from posts, and offline behaviour work for a page as they do for a person.
