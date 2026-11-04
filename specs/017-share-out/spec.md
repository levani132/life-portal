# Feature Specification: Sharing outside the app

**Feature**: 017-share-out · **Created**: 2026-11-05 · **Status**: Implemented

Posts should travel to Instagram, TikTok, WhatsApp, Messenger and Facebook looking good, so
people who see them want to know where they came from. Four parts, all in the post's Share sheet.

## User Scenarios & Testing

### US1: Share image for Stories (P1)

From Share → Instagram, TikTok or Story image, the app draws a 1080×1920 card: the post's photo,
its title, the macro rings and calories, the author, and "Life Portal". On a phone it opens the
system share sheet with the image (Instagram and TikTok take it as a Story or post); elsewhere it
downloads the image.

1. **Given** my own post or a public post, **Then** the image options are offered.
2. **Given** someone else's friends-only post, **Then** no image option is offered: an image would
   carry their post past its audience.
3. **Given** the photo cannot be drawn (blocked by the browser), **Then** the card is drawn without
   it rather than failing.

### US2: Public link previews (P1)

1. **Given** a public post's link pasted into WhatsApp, Messenger, Facebook or iMessage, **Then**
   the preview shows the post's title, calories and macros, the author's name and a card image.
2. **Given** a friends-only or private post's link, **Then** the preview is a generic
   "A post on Life Portal" with no content, title or author.
3. **Given** a deleted or moderated post, or an author whose posting is switched off, **Then** the
   preview is generic too.
4. The page itself still needs sign-in; only the preview is public.

### US3: App buttons (P2)

A "Share to" row: Instagram, TikTok (image, as in US1), WhatsApp, Messenger (phones only),
Facebook and X (link). Link targets open the app or its web share page with the post's link.

### US4: Save foods (P2)

**Given** another member's post with food, **When** I tap Save foods in the sheet, **Then** the
existing import dialog opens (pick items, skip or copy duplicates, optionally save as a meal).

## Requirements

- **FR-001** `canShareImage({own, audience})`: own posts, or public ones. Pure and tested.
- **FR-002** The image is drawn in the browser from data the viewer already has; nothing new is
  uploaded or stored.
- **FR-003** A new unauthenticated preview endpoint returns only: title, author display name,
  kind label, calories and macros, and a short-lived photo link — and only for a live, public,
  non-repost post whose author still has posting switched on. Anything else is 404, and the
  response never says why.
- **FR-004** The web post route renders Open Graph / Twitter metadata and an OG image from that
  endpoint, falling back to generic metadata.
- **FR-005** Share-to links are built by one tested helper; the post link is the only payload.

## Success Criteria

- **SC-001** A public post's link shows a rich preview in WhatsApp and Facebook.
- **SC-002** No preview, image or app share exposes a non-public post of someone else (tested).

## Assumptions

- Instagram and TikTok have no web share URL; on the web the image goes through the system share
  sheet. Direct "share to Instagram Stories" with a sticker needs the native app (roadmap: Capacitor).
- Previews may be cached by the receiving app for some time after an audience change; the preview
  carries no photo link that outlives two hours.
