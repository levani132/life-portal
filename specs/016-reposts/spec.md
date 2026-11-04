# Feature Specification: Reposts

**Feature**: 016-reposts · **Created**: 2026-11-05 · **Status**: Implemented

Reposting puts someone else's post on your own wall, from the post's Share sheet, with one tap.

## User Scenarios & Testing

### US1: Repost from the Share sheet (P1)

A member sees a friend's post and taps Share → Repost. The post appears on their wall and in
their friends' Home feeds with "↻ <name> reposted" above it. Tapping Repost again (now
"Reposted") takes it back.

1. **Given** a friend's public or friends-only post, **When** I tap Repost, **Then** my wall and
   my friends' feeds show the original post under a "<me> reposted" line.
2. **Given** I already reposted it, **When** I tap Reposted, **Then** the repost disappears.
3. **Given** my own post, or a private one, **Then** the sheet offers no Repost.
4. **Given** a repost, **When** someone likes or comments on it, **Then** it goes to the original.
5. **Given** I repost twice (double tap, retry), **Then** there is still one repost.

### US2: The original's audience always wins (P1)

1. **Given** a friends-only post reposted by Ben, **When** Cat (Ben's friend, not the author's)
   reads Home, **Then** she does not see it.
2. **Given** the author makes the post private, blocks the viewer, or deletes it, **Then** every
   repost of it disappears for those who can no longer read the original.
3. **Given** a repost, **Then** viewers also need to be in the repost's own audience (the
   reposter's friends for a friends-only post).

### US3: The author is told (P2)

1. **Given** Ben reposts Ana's post, **Then** Ana gets a "reposted your post" notification and
   Activity row, with its own Reposts toggle in notification settings.
2. **Given** a repost is undone and redone, **Then** it notifies once.

### Edge cases

- Reposting a repost reposts the original (the card always carries the original's id).
- The same post may appear in a feed page both as itself and as a repost; within a page, only
  the first is shown.
- A repost has no text, media or food of its own and is never addressable by its own id.

## Requirements

- **FR-001** One repost per member per post, idempotent; undo removes it.
- **FR-002** Only another member's post that the reposter can read and whose audience is not
  private can be reposted.
- **FR-003** A repost's audience is the original's audience at repost time; a viewer must pass
  the audience check of both the repost and the original, on every read.
- **FR-004** Feeds and walls render a repost as the original post plus who reposted and when.
- **FR-005** Engagement reports `reposted` and `repostCount` for the viewer.
- **FR-006** A new `postRepost` notification type and Activity row for the original's author.
- **FR-007** No content is copied: the repost stores only the original's id.

## Success Criteria

- **SC-001** A repost takes one tap from the Share sheet and shows on the reposter's wall at once.
- **SC-002** No viewer outside the original's audience can see a repost of it (tested).

## Assumptions

- No "quote repost" (text with the repost) yet; the schema leaves room for it.
- Repost counts are shown in the sheet, not on the card.
