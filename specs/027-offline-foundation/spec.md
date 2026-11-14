# Feature Specification: Offline-first foundation

**Feature Branch**: `claude/issue-16`

**Created**: 2026-11-14

**Status**: Approved (owner, #16, 2026-11-14). Built. Training's set logging is the first consumer;
#17 (offline training) and #18 (offline nutrition) build on it.

**Input**: Issue #16, "Offline-first foundation", with the owner's answers to the review: local
storage only for the offline-capable modules, finance and work online-only, an obvious way to
clear it, a guarded logout, isolated accounts, 30-day expiry, persistent storage requested, no
reliance on background sync, and no new dependency unless justified.

## User Scenarios & Testing

### User Story 1 — A set logged without signal is not lost (P1)

At the gym with no connection, a member logs sets. Each appears at once as pending. They close
the app. Later, with signal, they open it again: the sets are still there and are sent, once each.

**Acceptance Scenarios**:
1. **Given** no connection, **When** a set is logged, **Then** it is shown as pending and kept on
   the device, and the header says "Offline · 1 waiting".
2. **Given** pending sets and a reload or app restart, **When** the app opens, **Then** they are
   still pending and are sent when the connection returns, in the order they were logged.
3. **Given** a set whose response was lost after the server saved it, **When** it is retried,
   **Then** the server answers with the first result and no second set exists (`Idempotency-Key`).
4. **Given** the server refuses a set (4xx), **Then** it is kept as "Not accepted" with the reason,
   later writes carry on, and the person can retry or discard it (with a confirmation).

### User Story 2 — The app opens without a connection (P1)

**Acceptance Scenarios**:
1. **Given** a signed-in device that has opened the app before, **When** it is opened offline,
   **Then** the shell draws (from the cached HTML and the last portal state of that account) for
   previously visited pages instead of an error.
2. **Given** the server answers that the session is over, **Then** the device signs out as
   before; only "no answer at all" opens as the remembered account.

### User Story 3 — Signing out never silently drops unsent changes (P1)

**Acceptance Scenarios**:
1. **Given** pending writes, **When** the person signs out, **Then** a dialog shows how many,
   with "Sync now", "Stay signed in" and "Discard pending changes and log out", the last behind a
   second explicit confirmation.
2. **Given** "Sync now" sends everything, **Then** sign-out continues by itself.
3. **Given** a sign-out, **Then** that account's offline data on the device is deleted.

### User Story 4 — Accounts on one device stay apart (P1)

**Acceptance Scenarios**:
1. **Given** account A's writes are waiting and the session expired, **When** account B signs in,
   **Then** B never sees A's data and A's writes are never sent as B (each account has its own
   store, and a 401 pauses the queue until the same account signs in).

### User Story 5 — Seeing and clearing what is on the device (P2)

**Acceptance Scenarios**:
1. **Given** Settings, **Then** "Offline data on this device" shows pending writes, saved screens,
   storage used, whether the browser keeps it, that it is not encrypted at rest, and that iOS may
   evict it.
2. **When** "Clear offline data" is pressed with writes pending, **Then** the logout-style dialog
   asks first; without pending writes a confirmation asks first.

## Requirements

- **FR-001** Offline-capable writes go to a durable per-account outbox (IndexedDB
  `lp-offline:<userId>`), removed only after a 2xx.
- **FR-002** Sent in order; transient failures back off (1 s doubling to 60 s, 50–100 % jitter)
  without later items overtaking; 4xx → `error`, 409 → `conflict`, 401 → `auth` (pause all).
- **FR-003** Every authenticated POST/PUT/PATCH/DELETE may carry `Idempotency-Key`; the API stores
  the result per user and key for 7 days and replays it.
- **FR-004** Only `training`, `nutrition` and `social` may store anything, plus the exact key
  `shell:portal`. Money, banking, investments and work never: a test asserts it.
- **FR-005** The service worker still never caches `/api`.
- **FR-006** Cached reads unused for 30 days are pruned; unsynced writes never are.
- **FR-007** `navigator.storage.persist()` is requested once, on the first stored write.
- **FR-008** Syncing happens while the app is open (enqueue, `online`, focus, visibility, a 30 s
  timer). No Background Sync API.
- **FR-009** A header pill says only what is true; nothing when nothing waits.
- **FR-010** No new dependency.

## Out of scope

Offline training reads and offline workouts (#17), offline nutrition (#18), offline social.
