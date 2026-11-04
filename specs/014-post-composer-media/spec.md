# Feature Specification: One post composer, with photos and video

**Feature Branch**: `014-post-composer-media`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "One new post button that opens the share composer. Inside it, an Add (+) button lets the member pick something from their Food module, the same choices as sharing from Food; once chosen it is added to the composer and everything continues as before. This also allows text-only posts. The + goes in the header on the left, LifePortal is centred, and the member's name is removed (Menu is already a tab). Add photo uploads from the library and a camera that captures a photo or a video, with a circular progress ring on the capture button up to 30 seconds. Instagram-like posting. Store media in Cloudflare R2."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write a post from anywhere (Priority: P1)

A member taps **+** in the header on any main screen. The composer opens full screen. They type
something and tap **Share**. A text-only post appears in their friends' feed, with the audience
they chose.

**Independent Test**: Tap +, write "Back from the gym", choose Friends, Share. A friend sees it in
their feed; a stranger does not.

**Acceptance Scenarios**:

1. **Given** posts are available to the member, **When** they look at the header, **Then** it shows + on the left, LifePortal in the centre and Activity on the right, and no name.
2. **Given** the composer is open with nothing in it, **Then** Share is disabled. Typing text, adding media or adding food enables it.
3. **Given** a published text post, **Then** likes, comments, Send, Share, edit, delete, report and the audience switch all work exactly as for food posts.

### User Story 2 - Add food from inside the composer (Priority: P1)

In the composer the member taps the Add (+) icon and chooses what to share: a logged entry, a
meal, a whole day, a food, a saved meal or the whole food database. The choice appears in the
composer as the same preview card sharing from Food shows. They can remove it and choose another.
Publishing continues exactly as it does from Food (same snapshot, same preview check).

**Independent Test**: Open the composer from the header, add today's breakfast, Share. The post
is identical to sharing that meal from the Food page.

**Acceptance Scenarios**:

1. **Given** the picker, **Then** it offers Today (with days before it), Foods and Saved meals, plus the whole database, using the member's own data only.
2. **Given** a chosen item, **When** it changes before publishing (a food edited), **Then** publishing asks to refresh the preview, as today.
3. **Given** the Food page's existing share buttons, **Then** they open the same composer with that item already added.

### User Story 3 - Add photos from the library (Priority: P1)

The member taps the image icon, picks up to 10 photos, and sees them as thumbnails that upload
in the background with a progress ring. Share waits until uploads finish. The post shows the
photos as a swipeable carousel.

**Acceptance Scenarios**:

1. **Given** a photo with location data, **When** it is uploaded, **Then** the stored photo has no location or camera metadata.
2. **Given** a friends-only post with photos, **When** someone outside the audience has a photo's link, **Then** it no longer opens after a short time, and they can never get a new link.
3. **Given** an upload that fails, **Then** its thumbnail says so and offers retry; the other photos are unaffected.
4. **Given** a deleted post, **Then** its photos are deleted from storage.

### User Story 4 - Capture a photo or video in the app (Priority: P2)

The member taps the camera icon. A full-screen camera opens. A tap on the shutter takes a photo;
holding it records video, with a ring around the button filling up over 30 seconds. Releasing, or
reaching 30 seconds, stops. The capture is added to the composer.

**Acceptance Scenarios**:

1. **Given** a hold, **Then** recording starts at once and the ring fills; at 30 seconds it stops on its own.
2. **Given** a front and rear camera, **Then** a button switches between them.
3. **Given** camera access is refused or unavailable, **Then** the composer explains it and offers the system camera instead.
4. **Given** a video in a feed, **Then** it plays muted and looping while on screen, shows a still before it loads, and tapping it turns sound on.

### Edge Cases

- Leaving the composer with content asks for confirmation; a half-finished upload is discarded.
- Uploads never attached to a post are deleted after a day.
- A retried Share (same request) never makes two posts.
- Photo and video storage is not configured: the image and camera icons are hidden; text and food posts still work.
- A video from the photo library is not accepted in this version (only photos), because library videos can carry location data that cannot be removed in the browser.

## Requirements *(mandatory)*

- **FR-001**: The header MUST show a new post button on the left when posts are available, the LifePortal name centred, and MUST NOT show the member's name.
- **FR-002**: A post MUST contain at least one of: text, media, a food attachment.
- **FR-003**: The composer MUST offer every food share kind that exists today and publish it through the existing snapshot and preview check.
- **FR-004**: A post MUST hold at most 10 media items. A video MUST be at most 30 seconds.
- **FR-005**: Photos MUST be re-encoded on the device before upload, which removes metadata.
- **FR-006**: Media MUST be stored privately and read only through short-lived signed links issued after the post's read check.
- **FR-007**: Media bytes MUST go from the device to storage directly, never through the API.
- **FR-008**: The server MUST confirm each uploaded object exists, belongs to the author and matches its declared type and size before attaching it.
- **FR-009**: Deleting or removing a post MUST delete its media; unattached uploads MUST be deleted after 24 hours.
- **FR-010**: Media MUST sit behind a `postMedia` feature flag (on for internal and developer accounts) and storage configuration.

## Success Criteria *(mandatory)*

- **SC-001**: A text post can be published in under 10 seconds from any main screen.
- **SC-002**: A post with 3 photos shows in a friend's feed within 5 seconds of Share on a normal connection.
- **SC-003**: No stored photo contains GPS data.
- **SC-004**: A signed media link stops working within 2 hours.

## Assumptions

- Instagram-style choices where the description is open: up to 10 items, carousel display clamped between 4:5 and 1.91:1, hold-to-record, upload starts as soon as an item is added.
- No server-side transcoding (Tier 0). Videos are stored as the browser recorded them (MP4 on iPhone).
- Public posts may carry media; reports and developer removal apply. Automated image moderation comes before Explore.
- The existing `foodPosts` flag still gates posting; the name stays for compatibility.
