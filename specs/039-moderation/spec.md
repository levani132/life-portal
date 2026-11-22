# Feature Specification: Photos strangers can see are checked, and reports reach someone

**Feature Branch**: `039-moderation`

**Created**: 2026-11-22

**Status**: Built; the automatic check is off until its key is set on the API host

**Input**: Owner: "Please go ahead and take care of … moderation of photos … we still want to remove the invite code." Once anyone can register, strangers post photos. Reporting existed (007) but hid the post only from its reporter, the reviewer could not see what was reported, and nothing looked at a photo before it was shown.

## User Scenarios & Testing

### User Story 1 - A photo is checked before anyone else sees it (Priority: P1)

A person posts a photo or a clip to friends, to everyone, or as a link. Until the automatic check has looked at it, only they see the post, with a note that it is being checked. A few seconds later it appears for everyone, or stays hidden and goes to the reviewer.

**Acceptance Scenarios**:

1. **Given** a checker is configured, **When** a post with a photo is published to anyone but its author, **Then** nobody else can read it, in any feed, link, repost or preview, until the check passes.
2. **Given** the check flags the photo, **Then** the post stays hidden, the reviewer is told by email, and the author sees "waiting for a review".
3. **Given** the checking service is down, **Then** the post stays hidden and is checked again within ten minutes; after thirty minutes it shows in the review queue.
4. **Given** a private post with a photo, **Then** it is not sent anywhere; it is checked when its audience is opened.
5. **Given** no checker is configured, **Then** posts publish as before and the review page says photos are not being checked.

### User Story 2 - Reports hide what several people object to (Priority: P1)

The report dialog names what is wrong: nudity, violence, a child at risk, spam, harassment, private information, misleading advice, something else. Three people reporting a post, or one saying a child is at risk, hides it from everyone but its author until the reviewer decides.

### User Story 3 - The reviewer sees the post and decides (Priority: P1)

Menu → Review queue lists held posts first, then reported ones, each with its text, photos, author, audience and why it is there. The reviewer keeps it (shown again, reports closed, never hidden by reports again), removes it (erased like an author's delete), and can suspend the author.

### User Story 4 - A suspended account is gone until restored (Priority: P2)

A suspended account is signed out everywhere, cannot sign in by password or Google, and nothing it posted is shown. Restoring it brings everything back.

### User Story 5 - A profile photo is checked too (Priority: P2)

A profile photo is shown to everyone, so it is checked while it is being saved. A flagged one is refused; if the check cannot be reached the person is asked to try again.

## Requirements

- **FR-001**: Holding is one field on the post (`heldAt`) that `canReadFoodPost()` honours; every read path follows it. Only the author learns a post is held.
- **FR-002**: The checker receives short-lived read links only: no account, no text. Only photos other people can reach are sent.
- **FR-003**: A video is judged by its still image.
- **FR-004**: Reviewer routes are developer-only. The reviewer may read a reported or held post whatever its audience.
- **FR-005**: The email to the reviewer names no post and no person.
- **FR-006**: Which categories hide a post is a pure rule (`imageHoldCategories`), as is when reports do (`reportsHoldPost`).

## Out of scope, and still open

- **Known abuse images.** The check classifies what a picture shows; it does not match pictures against the databases of known child-abuse material. That needs a hash-matching service (see docs/modules/moderation.md).
- Food photos and brand logos, comments, profile text and messages are not checked automatically. Posts, and through them their photos, can be reported; a person can be blocked.
- The frames of a video beyond its still.
- An appeal form. A person who thinks a decision is wrong writes to support.
