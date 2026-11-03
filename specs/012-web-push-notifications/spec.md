# Feature Specification: Push notifications for the installed app

**Feature Branch**: `012-web-push-notifications`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "Web Push notifications for the installed PWA (iOS 16.4+ Home Screen app, Android, desktop). Users opt in from a tap inside the installed app, at a meaningful moment such as after a first friend request or comment. Notifications for: incoming friend request, accepted friend request, a like on my post, a comment on my post (and later chat messages, challenge events). Tapping a notification opens/focuses the app on the relevant screen, never Safari. Every push must display a visible notification. App icon badge shows unread count. Per-type preferences and a global off switch; multiple devices per account; dead subscriptions removed, and on sign-out. Respect blocks/mutes and the post audience; notification text must not leak private content. Collapse bursts. Behind a `push` feature flag. Service worker must still never cache /api. Keys via env. Users not installed see a prompt explaining they need to add to Home Screen."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know when a friend wants to connect (Priority: P1)

Someone using the app from their Home Screen turns on notifications. Later another member sends
them a friend request. Their phone shows a notification naming that person; tapping it opens the
installed app on their incoming requests, where they can accept. When the request is accepted, the
sender gets a notification too, and tapping it opens the new friend's profile.

**Why this priority**: Friend requests are the moment social features start or stall. A request
nobody sees for a week is a lost connection. It is also the smallest complete slice: opting in,
one device, delivery and opening the right screen.

**Independent Test**: With two accounts on two devices, turn notifications on for one, send it a
friend request from the other, and confirm the notification appears and opens the requests screen
inside the installed app.

**Acceptance Scenarios**:

1. **Given** a member using the installed app with notifications on, **When** another member sends them a friend request, **Then** a notification naming the sender appears within 10 seconds, and tapping it opens the installed app on the incoming requests screen.
2. **Given** a member whose friend request is pending, **When** the recipient accepts it, **Then** the sender receives a notification naming the new friend, and tapping it opens that friend's profile.
3. **Given** the installed app is already open in the background on another screen, **When** the member taps a notification, **Then** the existing app window comes forward and navigates to the target screen; no second window or browser tab opens.
4. **Given** a member has blocked another member, or been blocked by them, **When** either one acts in a way that would notify, **Then** no notification is sent.

---

### User Story 2 - Turning notifications on at the right moment (Priority: P1)

The app never asks for notification permission when it loads. It offers notifications after an
action that makes them useful: after the member sends a friend request, publishes their first
post, or writes a comment ("Get notified when they reply"). Settings also has a Notifications
section with a main switch.

In the installed app, accepting the offer brings up the system permission prompt. In a plain
browser tab on iPhone, where notifications are impossible, the offer instead explains how to add
the app to the Home Screen and that notifications work from there.

**Why this priority**: Without permission nothing else works, and both iOS and members punish
premature prompts. A member who refuses the system prompt usually cannot be asked again.

**Independent Test**: Load the app fresh in the installed app and in an iPhone browser tab. Confirm
no prompt appears on load, the offer appears after sending a friend request, and each context shows
the right next step.

**Acceptance Scenarios**:

1. **Given** a member opens the app, **When** any screen loads, **Then** the system notification prompt is never shown without a tap on an explicit "Turn on notifications" control.
2. **Given** a member in the installed app who has not decided, **When** they send their first friend request, publish their first post or write their first comment, **Then** a dismissible in-app offer explains what they will be notified about, and accepting it shows the system prompt.
3. **Given** a member dismisses the offer, **When** they keep using the app, **Then** the offer does not reappear for at least 14 days, and notifications stay available from Settings.
4. **Given** a member on iPhone using a normal browser tab, **When** they open the offer or Settings › Notifications, **Then** they see how to add the app to the Home Screen instead of a switch that cannot work.
5. **Given** a member previously refused the system prompt, **When** they open Settings › Notifications, **Then** it says notifications are blocked on this device and how to allow them in the device's settings.
6. **Given** a browser that cannot receive notifications at all, **When** the member opens Settings › Notifications, **Then** it says this browser does not support them, and no offer appears elsewhere.

---

### User Story 3 - Likes and comments on my posts (Priority: P2)

A member who published a food post gets notified when someone comments on it or likes it. A burst
of activity is collapsed so their phone does not buzz twenty times: likes on one post become one
notification that updates ("Ana and 4 others liked Tuesday's lunch"). Tapping opens the post.

**Why this priority**: This brings people back to the Wall, but it only matters once friends exist
and posts are being made.

**Independent Test**: Like and comment on one account's post from several other accounts in quick
succession; confirm the owner gets comment notifications, at most two like notifications for the
burst, and every tap opens the post.

**Acceptance Scenarios**:

1. **Given** a member with notifications on, **When** someone who can see their post comments on it, **Then** they get a notification with the commenter's name and the post's title, and tapping opens that post with its comments.
2. **Given** 20 likes on one post within 5 minutes, **When** they arrive, **Then** the owner's device shows at most 2 like notifications for that post, the latest naming the most recent liker and how many others.
3. **Given** a member likes or comments on their own post, **When** they do, **Then** they are not notified about it.
4. **Given** the owner has muted someone, **When** that person likes or comments, **Then** no notification is sent, but the like or comment appears normally on the post.
5. **Given** a comment was deleted or a like withdrawn before the owner taps the notification, **When** they tap it, **Then** the post opens showing its current state, without an error.

---

### User Story 4 - Choose what I'm notified about, and on which devices (Priority: P2)

Settings › Notifications has a main switch, one switch per type (friend requests, accepted
requests, comments, likes), and a list of devices receiving notifications (for example "iPhone ·
added 3 Nov"), each removable. Turning a type off stops it on every device.

**Why this priority**: Members who cannot quiet the app turn notifications off at the system level,
and then they are gone for good.

**Independent Test**: Turn off Likes, have someone like a post and confirm nothing arrives, while a
comment still does. Remove a device and confirm it stops receiving notifications.

**Acceptance Scenarios**:

1. **Given** notifications are on, **When** the member turns a type off, **Then** no notification of that type reaches any of their devices.
2. **Given** the member turns the main switch off, **When** anything happens, **Then** no notifications are sent to any device, and their type choices are kept for when they turn it back on.
3. **Given** a member has notifications on a phone and a laptop, **When** a notification is due, **Then** both devices receive it.
4. **Given** a member removes a device from the list, or signs out on that device, **When** later notifications are sent, **Then** that device receives none.

---

### User Story 5 - Unread count on the app icon (Priority: P3)

The app's Home Screen icon shows how many notification-worthy things the member has not seen yet.
A simple Activity list (opened from the app header) shows those items newest first. Opening the
list clears the count.

**Why this priority**: The badge is a strong, quiet reason to reopen the app, but notifications
are useful without it.

**Independent Test**: Receive three notifications without opening the app and confirm the icon shows
3. Open Activity and confirm the badge clears.

**Acceptance Scenarios**:

1. **Given** three unseen items, **When** the member looks at the Home Screen, **Then** the app icon shows 3 on devices that support icon badges.
2. **Given** an unseen count, **When** the member opens Activity, **Then** the count on every device clears the next time each device shows a notification or opens the app.
3. **Given** an item stops being valid (a like withdrawn, a comment deleted, a request cancelled, the other person blocked), **When** the member opens Activity, **Then** that item no longer appears and does not count.
4. **Given** a device without icon badge support, **When** items arrive, **Then** everything else works and no error appears.

---

### Edge Cases

- **Expired device registration**: when the delivery service reports a device registration as gone, it is removed after that single failure and is not retried.
- **Delivery failure never fails the action**: if sending a notification fails or is slow, the friend request, like or comment that caused it still succeeds normally.
- **Lock-screen privacy**: notification text contains only member names, what happened, and the recipient's own post title. It never contains food items, calories, weight, money or other tracking data, and comment text is not shown unless the member turned on "Show comment previews" (off by default).
- **Shared devices**: signing out removes this device's registration first, so the next person to sign in on it does not receive the previous member's notifications.
- **Push not configured**: in an environment with no notification keys, the feature is hidden and everything else works normally (graceful degradation, as with Finnhub).
- **Feature flag off**: a member outside the `push` cohort sees no offer and no Settings section, and no device can register for them. Registrations they already have stop receiving notifications.
- **Unfriend or block after the fact**: once members are no longer friends, or one has blocked the other, the target screen opens with its current permissions (for example "Post not available"). Notification text sent earlier cannot be recalled.
- **Lost access to a post**: a member is never told about a post they cannot open. Likes and comments come only from people who can already see the post, so this mainly covers posts deleted between the action and the tap.
- **Offline**: tapping a notification while offline opens the installed app's normal "no connection" state. Private data is never served from a cache to fill the screen.
- **Account deletion**: all of the member's device registrations and notification preferences are removed with the account.
- **Many devices**: a member can register up to 10 devices. Adding an 11th replaces the one least recently used.

## Requirements *(mandatory)*

### Functional Requirements

**Opting in**

- **FR-001**: The system MUST NOT show the device's notification permission prompt except in direct response to the member tapping an explicit "Turn on notifications" control.
- **FR-002**: The system MUST offer notifications in-app after a member's first friend request, first published post or first comment, and from Settings › Notifications at any time. A dismissed offer MUST stay hidden for at least 14 days.
- **FR-003**: The system MUST detect whether it is running as the installed app, in a browser that can receive notifications, or in a browser that cannot. An iPhone browser tab MUST see instructions to add the app to the Home Screen. An unsupported browser MUST see a plain "not supported" message.
- **FR-004**: The system MUST show when permission is blocked at the device level and explain how to allow it there.

**Devices**

- **FR-005**: A member MUST be able to receive notifications on several devices (up to 10). Each is listed with a device description and the date it was added, and can be removed.
- **FR-006**: Signing out on a device MUST remove that device's registration before the session ends.
- **FR-007**: The system MUST delete a registration the first time the delivery service reports it expired or gone.
- **FR-008**: A device registration MUST belong to exactly one member. Registering the same device for another member MUST move it to that member.

**What notifies**

- **FR-009**: The system MUST send a notification to the recipient for: a friend request received, a friend request accepted, a comment on their post, and a like on their post.
- **FR-010**: The system MUST NOT notify a member about their own actions, about anyone blocked in either direction, or about someone they have muted.
- **FR-011**: The system MUST check, when sending, that the recipient has the main switch on, the type switched on, the `push` and `social` features enabled, and (for posts) the `foodPosts` feature enabled.
- **FR-012**: Likes on the same post MUST be collapsed: after a like notification, further likes on that post send no new notification for 15 minutes. The next one names the latest liker and the number of others since the previous notification. On the device, a newer notification for the same post and type MUST replace the older one rather than stack.
- **FR-013**: Comments MUST each notify, except that comments on the same post within 2 minutes of the previous comment notification replace it on the device rather than adding another.
- **FR-014**: Collapsing MUST be decided when a notification is sent. It MUST NOT require a background process that runs continuously or on a timer (constitution: free-tier deployable).
- **FR-015**: Every notification sent MUST be visible on the device. The system MUST NOT send invisible or data-only notifications.

**Content and privacy**

- **FR-016**: Notification title and body MUST contain only: the acting member's display name, what happened, the recipient's own post title (for likes and comments), and a count for collapsed likes. With "Show comment previews" on, the first 80 characters of the comment MAY be added. It MUST be off by default.
- **FR-017**: Notification content MUST NOT include food items, nutrition facts, weight, activity, money, or any data from the member's tracking widgets.
- **FR-018**: Sending a notification MUST NOT expose another member's private data, the recipient's email address, or internal IDs in readable text.

**Opening**

- **FR-019**: Tapping a notification MUST open the installed app (never a browser tab when the app is installed) on the target screen: incoming requests for a friend request, the friend's profile for an accepted request, the post for likes and comments. If the app is already open, the existing window MUST come forward and navigate.
- **FR-020**: The target screen MUST apply its normal sign-in and access checks. A notification never grants access by itself.
- **FR-021**: The app's offline cache MUST continue to exclude all `/api` responses. Notification handling MUST NOT add any cached copy of private data.

**Preferences**

- **FR-022**: Settings › Notifications MUST provide a main switch, a switch per notification type, "Show comment previews", and the device list. Preferences apply to all of the member's devices.
- **FR-023**: When a member first turns notifications on, all types MUST default to on and comment previews to off.

**Activity and badge**

- **FR-024**: The app MUST provide an Activity list of the member's notification-worthy items, newest first, showing only items that are still valid (not withdrawn, deleted, cancelled or from someone now blocked).
- **FR-025**: The unread count MUST be the number of valid Activity items newer than the last time the member opened Activity. It MUST be shown on the app icon where the device supports it, and MUST clear when Activity is opened.
- **FR-026**: The unread count and Activity list MUST be worked out from the current likes, comments and friend requests whenever they are read, never stored as a running total (constitution principle III).

**Rollout and configuration**

- **FR-027**: The feature MUST sit behind a new `push` feature flag managed with the existing developer cohort controls. It defaults on for internal and developer accounts and off in production.
- **FR-028**: Notification signing keys MUST come only from environment configuration and be documented in `.env.example`. Without them, the API MUST boot and the feature MUST be hidden.
- **FR-029**: Notifications MUST be one shared system that any module can send through, so chat messages and challenge events can be added later as new types without changing existing types, preferences, devices, delivery or opening. Each type declares only:
  - who receives it and the access check that must still pass when sending;
  - its text, under the same privacy rules as FR-016–FR-018;
  - the screen it opens;
  - what it collapses on (a post for likes; later, a conversation for messages);
  - whether it counts toward the unread badge.
- **FR-030**: The shared system MUST support two behaviours that messaging will need, even though no current type uses them:
  - skip a notification when the recipient is already looking at the screen it would open (for example, the open conversation);
  - let a module supply its own unread count to the badge (for example, unread messages), added to the Activity count.

### Key Entities

- **Device registration**: one device able to receive notifications for one member. It holds the delivery address and keys the browser issued, a readable device description, when it was added and when it last received a notification successfully. It is removed when it expires, on sign-out, or by the member.
- **Notification preferences**: per member. Main switch, one switch per type, "Show comment previews", and when the member last opened Activity.
- **Delivery record**: per recipient, type and post (or person), when the last notification was sent and how many actions it covered. It is used only to decide collapsing, and it can be deleted after a day without changing anything a member sees.
- **Activity item** (not stored): worked out on read from existing likes, comments and friend requests addressed to the member.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On iPhone (Home Screen app), Android and desktop, tapping a notification opens the installed app on the correct screen in 100% of test runs, and never opens a browser tab when the app is installed.
- **SC-002**: A notification appears within 10 seconds of the action that caused it in at least 95% of attempts on a connected device.
- **SC-003**: In testing, no notification is ever sent about a blocked or muted member, about a member's own action, or of a type the member turned off.
- **SC-004**: A burst of 20 likes on one post within 5 minutes produces at most 2 visible like notifications on each of the owner's devices.
- **SC-005**: No notification text in testing contains food, nutrition, weight, activity or money data. Comment text appears only when previews are on.
- **SC-006**: The permission prompt never appears without a tap on an explicit control, across fresh loads on all supported platforms.
- **SC-007**: A friend request, like or comment succeeds and responds as fast as before when notification delivery is failing or unconfigured.
- **SC-008**: After sign-out on a device, that device receives no further notifications for the member who signed out.

## Assumptions

- Members already use the app as an installed Home Screen app on iPhone (iOS 16.4 or later) or on Android or desktop. iPhone browser tabs cannot receive notifications, and that is outside our control.
- Notifications go through each platform's standard browser push service. No native app is involved in this feature.
- "Recipient's own post title" is safe on a lock screen because the recipient wrote it. Comment text is not, because someone else wrote it and it may be personal, so it is opt-in.
- The 15-minute like window and 2-minute comment window are starting values and can be tuned without changing the spec's intent.
- Mute already means "less of this person in my Wall", so it reasonably also means "no notifications from this person".
- Notifications are sent while the request that caused them is handled, with a short time limit, so no separate worker service is needed (constitution: free-tier deployable).
- Chat and challenge notifications are out of scope until those features exist. FR-029 and FR-030 require that adding them is only a matter of registering new types.
- Quiet hours, email notifications and notification sounds are out of scope for this version.
