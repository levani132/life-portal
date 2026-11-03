# Implementation Plan: Direct messages between friends

**Branch**: `013-direct-messages` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

## Summary

A new `MessagesModule` owns `conversations` and `messages`. A conversation is one per pair of
friends, with per-member read, viewing and mute state. Messages are text or a shared-post
reference, sent idempotently with a client ID.

The inbox, unread counts and "Seen" are all derived on read. Live updates use a 3-second
`sync` poll while the conversation is visible; the poll also marks it read and doubles as the
presence signal for notifications. Shared posts are checked through `PostsService.detail()`
each time they are shown.

Notifications go through the shared system as a new `message` type, with a server-side
`suppress` hook (muted, or viewing) and a badge source. Everything is behind a new `messages`
flag.

## Technical Context

- **Language/stack**: TypeScript strict; NestJS 11, Mongoose 9, Next.js 16, SWR. No new
  dependencies.
- **Storage**: MongoDB, two new collections (data-model.md).
- **Testing**: Jest. Domain functions and an API service spec; manual end-to-end checks per
  quickstart.md.
- **Performance**: a message shows within 5 seconds while open (SC-001). No requests while the
  app is in the background (SC-007).
- **Constraints**: free tier with no worker, so no sockets yet (research R1). No caching of
  message responses.
- **Scale**: current cohort. Inbox capped at 50 conversations; pages of 30.

## Constitution Check

| Principle | How it is met |
|---|---|
| I. Bounded module | `MessagesModule` owns its two collections. Post access goes through `PostsService.detail()`, names through `SocialService.displayNames()`, the friendship through `SocialGraphService`. It reads no other module's collections. Platform module, no Home card |
| II. Money | Not applicable |
| III. Derived never persisted | Inbox order, last message, unread counts and Seen are derived. Stored: messages (events), and per-member read, viewing and mute facts |
| IV. Single-sourced links | A shared post is a `postId` reference rendered at read with current access (research R4) |
| V. Pure functions | `canMessage`, `messagePreview`, `isViewing`, `seenLabel`, `timeSeparators` in the domain lib, with "now" passed explicitly, all tested |
| VI. Estimates labelled | Not applicable. Calories on a post card are the post's recorded total |
| Free tier | Polling, rate limit kept in the database, notifications not awaited |
| Auth | `@RequireModule('messages')` on every route; membership in every query; a stranger's conversation answers 404; DTOs on all writes |
| Complexity | Two collections (justified in the module doc), no new dependencies |

**Result**: passes, with no violations, before and after design.

## Project Structure

```text
libs/shared/types/src/lib/messages.ts           NEW
libs/shared/types/src/lib/{portal,notifications}.ts   + 'messages' flag, 'message' type, preview pref
libs/shared/domain/src/lib/messages.ts (+spec)  NEW
libs/shared/domain/src/lib/notifications.ts     message text case (+spec)
apps/api/src/messages/                          NEW: schemas, dto, service, module (+spec)
apps/api/src/posts/posts.module.ts              export PostsService
apps/api/src/notifications/*                    showMessagePreviews preference
apps/api/src/access/access.module.ts            messages override
apps/api/src/app/app.module.ts                  register MessagesModule
apps/web/public/sw.js                           renotify for message tags
apps/web/src/app/messages/page.tsx              NEW: inbox
apps/web/src/app/messages/[id]/page.tsx         NEW: conversation
apps/web/src/components/messages.tsx            NEW: inbox, chat, send-post picker, header icon
apps/web/src/components/app-shell.tsx           messages icon; chat layout without tabs
apps/web/src/components/social.tsx              Message button on friends
apps/web/src/components/post-engagement.tsx     Send button
apps/web/src/components/notifications.tsx       Messages switch + message previews
docs/modules/messages.md                        NEW; notifications/posts/social docs, DECISIONS, CHANGELOG
```

## Risks

- **Polling load grows with open conversations.** Documented; the upgrade path is in research
  R1.
- **The inbox runs one count per conversation** (up to 50). That is fine now, and the read
  model at Tier 1 replaces it.
- **iOS Home Screen apps freeze timers in the background.** The visibility handler pauses
  polling and syncs immediately on return.
