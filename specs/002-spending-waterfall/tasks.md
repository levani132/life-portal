---
description: "Task list for the spending waterfall"
---

# Tasks: Spending waterfall

**Input**: Design documents from `/specs/002-spending-waterfall/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Included, and not optional here. The constitution requires a unit test for every new
domain branch, and [contracts/domain.md](contracts/domain.md) names ten invariants that each get a
test named for them. UI-only tasks carry no test.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: The user story the task serves (US1–US6)

## Path conventions

Nx monorepo: `libs/shared/types`, `libs/shared/domain`, `apps/api/src/<module>`, `apps/web/src`.
Web and API both import the shared libraries; neither imports the other.

---

## Phase 1: Setup (shared contracts and schema extensions)

**Purpose**: The types and stored fields every later phase refers to.

- [ ] T001 [P] Create the shared contracts — `SpendPayment`, `SpendDecision`, `ConfirmedAllocation`, `SpendAllocation`, `LadderRung`, `LadderTier`, `SpendLadder`, `PeriodSaving`, `SavingsBreakdown`, `CompletenessGap`, `BudgetProposal`, `IngestTokenSummary` — in `libs/shared/types/src/lib/spending.ts`, and export it from `libs/shared/types/src/index.ts`
- [ ] T002 [P] Add `weekStartsOn` (0–6, default 1), `monthStartsOn` (1–28, default 1) and `spendOrder` (`string[]`) to `UserSettings` in `apps/api/src/settings/settings.module.ts` and to `libs/shared/types/src/lib/auth.ts`, with `weekStartsOn` and `monthStartsOn` accepted by `UpdateSettingsDto`
- [ ] T003 [P] Add `settlement: 'auto' | 'manual'` (default `auto`), `suggestionDismissedAt` and `suggestionDismissedCents` (`centsField`, **no `default: 0`**) to the `Expense` schema in `apps/api/src/cashflow/cashflow.schemas.ts`, to `Expense` in `libs/shared/types/src/lib/cashflow.ts`, and to `UpsertExpenseDto`/`UpdateExpenseDto` in `apps/api/src/cashflow/cashflow.dto.ts`
- [ ] T004 Scaffold the module — `apps/api/src/spending/spending.module.ts` with an empty controller and service — and register it in `apps/api/src/app/app.module.ts`

**Checkpoint**: `npm run check` passes and the API boots with an empty `/api/spending` route.

---

## Phase 2: Foundational (blocking prerequisites)

**⚠️ No user story work can begin until this phase is complete.**

- [ ] T005 Create `apps/api/src/spending/spending.schemas.ts` — `spend_payments` (indexes `{userId, day}` and `{userId, cardLast4, at}`; `notReallySpentCents`/`cashbackCents`/`reportedBalanceCents` use `centsField`; embedded `Decision` and `ConfirmedAllocation` sub-schemas) and `ingest_tokens`, per [data-model.md](data-model.md)
- [ ] T006 Create `apps/api/src/spending/spending.dto.ts` with `class-validator` DTOs for ingest, manual entry, patch, decision and token creation — including the rule that `decision.allocations` sum to **at most** the spendable amount and that `throughDay >= forDay`
- [ ] T007 Create `SpendingService` in `apps/api/src/spending/spending.service.ts` with scoped reads only, injecting `CashflowService`, `SettingsService` and `FxService`; import `CashflowModule`, `SettingsModule` and `FxModule` in the module

**Checkpoint**: schemas registered, API boots, every read scoped to `userId`.

---

## Phase 3: User Story 1 — Payments appear without me typing them (P1) 🎯 MVP

**Goal**: A bank message becomes a recorded payment with no interaction, and nothing is ever lost.

**Independent Test**: Mint a token, POST the text of a real bank message, and see the payment listed
with the right amount, currency, merchant, card and day — with no budgeting behaviour built at all.

### Tests for User Story 1

- [ ] T008 [P] [US1] Write `libs/shared/domain/src/lib/sms-parsers.spec.ts` with the owner's real messages as fixtures: BOG `გადახდა`/`ჩარიცხვა`, TBC with `Nashti`/`dagibrunda`/`Ertgul kulabashi`, and the loyalty-line trap (`სულ: 1,939.70 PLUS` must never read as money)
- [ ] T009 [P] [US1] Write `libs/shared/domain/src/lib/completeness.spec.ts` asserting the owner's verified chain (1472.30 → 1285.82 → 1278.87 → 1264.42 → 1242.23) reports no gap, and that withholding one message reports a gap of exactly its amount

### Implementation for User Story 1

- [ ] T010 [P] [US1] Implement `parseBogMessage`, `parseTbcMessage` and `parseBankMessage` in `libs/shared/domain/src/lib/sms-parsers.ts` — keyword-anchored, returning `null` rather than a half-filled object
- [ ] T011 [P] [US1] Implement `detectMissedMessages` in `libs/shared/domain/src/lib/completeness.ts`, chaining `reportedBalanceCents` per `cardLast4` in `at` order
- [ ] T012 [US1] Export both from `libs/shared/domain/src/index.ts`
- [ ] T013 [P] [US1] Implement `IngestTokenService` in `apps/api/src/spending/ingest-token.service.ts` — mint `lp_<tokenId>_<secret>` from `crypto.randomBytes(32)`, hash the secret with `bcryptjs`, verify with exactly one comparison by looking the row up by id, and stamp `lastUsedAt`
- [ ] T014 [US1] Implement `IngestTokenGuard` in `apps/api/src/spending/ingest-token.guard.ts` — reads `X-Ingest-Token`, rejects missing/expired/revoked with `401`, and applies an in-memory fixed-window limit of 60 accepted submissions per token per hour returning `429`
- [ ] T015 [US1] Implement `POST /api/spending/ingest` in the controller — guarded by `IngestTokenGuard` and **never** `@Public()`; stores `raw` for every submission; applies `localDay(at, dayStartHour)` server-side to derive and persist `day`
- [ ] T016 [US1] Implement duplicate detection in `SpendingService`: a submission matching an existing payment's `raw` **within 120 seconds** is ignored and answered `duplicate: true`; outside that window it records a second payment
- [ ] T017 [US1] Make an unrecognised message answer **`201` with `status: 'unparsed'`**, never a 4xx — a Shortcut cannot handle an error, so any non-2xx loses the message permanently
- [ ] T018 [P] [US1] Implement `POST`, `PATCH` and `DELETE /api/spending/payments` for manual entry and for completing an `unparsed` row (supplying an amount flips it to `recorded`)
- [ ] T019 [P] [US1] Implement `GET /api/spending/payments` with a day range and status filter
- [ ] T020 [P] [US1] Implement the token endpoints — `GET`/`POST /api/spending/tokens` and `DELETE /api/spending/tokens/:id` — returning the plain token **exactly once** on create and never again
- [ ] T021 [P] [US1] Build the token page at `apps/web/src/app/spending/tokens/page.tsx` — create with label and expiry, one-time reveal with a copy button, list with last-used and revoke
- [ ] T022 [US1] Build the payments list at `apps/web/src/app/spending/page.tsx` with the unparsed queue surfaced and a manual-entry form using `MoneyInput` with its currency picker
- [ ] T023 [US1] Surface completeness gaps beside the unparsed queue, worded as a possible missed message and **never** as a balance

**Checkpoint**: capture works end to end. [quickstart.md](quickstart.md) §2–§3 pass.

---

## Phase 4: User Story 2 — See what a payment was probably for, and fix it (P2)

**Goal**: Every payment carries a proposed decomposition the owner can leave, confirm in whole or
in part, or replace — including for other days.

**Independent Test**: Enter payments by hand, confirm one and give another a custom purpose, and
verify the first consumes its allowances while the second consumes none.

### Tests for User Story 2

- [ ] T024 [P] [US2] Add `splitCentsEvenly` tests to `libs/shared/domain/src/lib/money.spec.ts` — 1001 over 3 is `[334, 334, 333]`, and parts always sum to the total for any amount and count
- [ ] T025 [P] [US2] Write `libs/shared/domain/src/lib/spend-waterfall.spec.ts` covering: allocations sum to the spendable amount; a payment splitting across two rungs; a confirmation placed before projections regardless of clock order; **confirming payment A re-proposes payment B in both directions**; a partly confirmed payment's remainder cascading; a confirmed rung closed to the cascade but open to a second confirmation; un-confirming reopening it; a spread across four days; a span crossing a week and a month boundary; a `manual` rung and a planned one-off never receiving a cascade allocation
- [ ] T026 [P] [US2] Add the invariant test named for it: **the total saved for a window is identical however its payments were decided** — the 40.00-against-30.00 case both ways, and the 35.00 case with 20.00 confirmed

### Implementation for User Story 2

- [ ] T027 [P] [US2] Implement `splitCentsEvenly(total, parts)` in `libs/shared/domain/src/lib/money.ts`, giving the indivisible remainder to the earliest parts
- [ ] T028 [US2] Implement `spendWaterfall` in `libs/shared/domain/src/lib/spend-waterfall.ts` following the eight ordered steps in [contracts/domain.md](contracts/domain.md): resolve → place confirmed → **close touched rungs** → expand spans → route custom to extra → cascade the rest → split → surface orphans
- [ ] T029 [US2] Export it from `libs/shared/domain/src/index.ts` and have `SpendingService` load a window of payments, build the tiers from `CashflowService`, and call it
- [ ] T030 [US2] Implement `PUT /api/spending/payments/:id/decision` accepting `confirmed` with an allocation list (optionally partial, optionally with `forDay`/`throughDay`), `custom` with a purpose, and `none`
- [ ] T031 [US2] Implement `notReallySpentCents` on `PATCH /api/spending/payments/:id`, reducing both real spending and what is decomposed
- [ ] T032 [US2] Implement `POST /api/spending/payments/:id/promote`, creating an expense **through `CashflowService`** — this module never writes that collection directly
- [ ] T033 [US2] Return derived allocations on every payment from `GET /api/spending/payments`, each carrying `projected` and the day it consumes
- [ ] T034 [US2] Build the payment sheet at `apps/web/src/components/payment-sheet.tsx` — decomposition shown as a projection until confirmed, confirm/partial-confirm across several rungs, custom purpose, promote, mark part not really spent, and choose a day or span
- [ ] T035 [US2] Handle the orphaned allocation case in the UI: a confirmed allocation whose expense no longer exists shows as needing a decision and counts as extra

**Checkpoint**: [quickstart.md](quickstart.md) §4 "confirming one payment moves another" and the split/spread checks pass.

---

## Phase 5: User Story 3 — See how much is left today (P3)

**Goal**: The ladder, in order, with the cascade and the extra bucket visible.

**Independent Test**: Enter several payments against a known ladder and confirm each is proposed
where the waterfall says, with the parts summing to the whole.

- [ ] T036 [P] [US3] Implement `spendOrder` handling — sort rungs within a tier by index in the preference list, tolerating ids never seen and ids that no longer exist, exactly as `arrangeWidgets` does
- [ ] T037 [P] [US3] Exclude inactive expenses from the ladder, and treat `kind: 'one_off'` as a confirmable target the cascade always skips
- [ ] T038 [US3] Implement `GET /api/spending?today=` returning the ladder, today's figures, the unparsed count, gaps and a `basis` naming both the lower bound and the FX rate
- [ ] T039 [US3] Build the ladder component at `apps/web/src/components/spend-ladder.tsx` — **filling bars with names as markers, never tick-boxes**; a *confirmed* rung may read as settled and shows its remainder as saved rather than available
- [ ] T040 [US3] Add the dashboard card in `apps/api/src/dashboard/dashboard.service.ts` and the widget registry — three numbers and **one** quick action (add a payment by hand)
- [ ] T041 [US3] Add `/spending` to the nav in `apps/web/src/components/app-shell.tsx`

**Checkpoint**: the ladder answers "can I still spend today?" at a glance.

---

## Phase 6: User Story 4 — Know what I saved (P4)

**Goal**: Saved, spent outside the allowances, and the net — per period and cumulatively by tier.

**Independent Test**: Run known payments across a known ladder and confirm each period's saving is
budget minus real spending, and that the cumulative parts sum to the whole.

- [ ] T042 [P] [US4] Add savings tests to `spend-waterfall.spec.ts`: a day saving 11.78 from 30.00 less 18.22; a day reporting three figures (saved, extra, net); a projected tier never negative while a confirmed rung may be; `cumulative.daily + weekly + monthly === totalCents`
- [ ] T043 [US4] Implement per-period and cumulative savings in `spend-waterfall.ts`, honouring `weekStartsOn` and `monthStartsOn`
- [ ] T044 [US4] Implement `GET /api/spending/savings?from=&to=` returning periods, the cumulative breakdown, and the month's projected saving, actual saving and extra together
- [ ] T045 [US4] Feed real spending into the cash projection for **past** days while future days keep budgeted allowances, switching at `today` — extending `projectCash` in `libs/shared/domain/src/lib/cash-projection.ts` and its spec
- [ ] T046 [US4] Build the savings view in `apps/web/src/app/spending/page.tsx`

**Checkpoint**: savings are trustworthy and the projection starts from what really happened.

---

## Phase 7: User Story 5 — The app tells me when my budget is wrong (P5)

**Goal**: Budget proposals drawn from observed spending, labelled with their evidence.

**Independent Test**: Feed history where one line is consistently underspent and confirm a proposal
appears naming the observed figure and window; accepting changes the budget, dismissing changes
nothing.

- [ ] T047 [P] [US5] Write `libs/shared/domain/src/lib/spend-suggestions.spec.ts`: a consistently underspent line proposes lower; an overspent one proposes higher; too little history proposes nothing; a dismissal suppresses the same figure; the median resists one holiday where a mean would not
- [ ] T048 [US5] Implement `suggestBudgets` in `libs/shared/domain/src/lib/spend-suggestions.ts` — median of complete periods, minimum 28 days / 8 weeks / 4 months, thresholds of 15% **and** ~₾5, returning `Estimate<Cents>` with the median and window in `basis` and `assumptions`
- [ ] T049 [US5] Propose adding a budget line for a custom purpose that has recurred often enough to look like a habit
- [ ] T050 [US5] Implement `GET /api/spending/suggestions` and the accept/dismiss endpoints, writing accepted changes **through `CashflowService`** and recording dismissals on the expense row
- [ ] T051 [US5] Build the proposals UI showing the working behind each figure

**Checkpoint**: the budget learns from reality without ever changing itself.

---

## Phase 8: User Story 6 — Shape the ladder (P6)

**Goal**: The owner controls the order and which rungs are settled by hand.

**Independent Test**: Reorder two rungs and confirm unconfirmed payments re-propose while confirmed
ones do not move.

- [ ] T052 [US6] Implement `PUT /api/spending/order` writing `spendOrder`, with exactly one writer so a reorder cannot arrive bundled with another settings change
- [ ] T053 [US6] Add drag-to-reorder to the ladder, **reusing `apps/web/src/components/sortable-grid.tsx` unchanged** — both of its load-bearing details (the non-passive `touchmove` registered at mount, and the node not being replaced mid-gesture) are documented in `docs/DECISIONS.md` and were missed by `npm run check` once already
- [ ] T054 [P] [US6] Add a settlement toggle to the expense edit form in `apps/web/src/app/cashflow/page.tsx`, explaining that a manual rung is never charged by the cascade

**Checkpoint**: all six stories work independently.

---

## Phase 9: Polish and cross-cutting

- [ ] T055 [P] Write `docs/modules/spending.md` — purpose, schema, endpoints, derived formulas, cross-links, open questions. **Required by the constitution in the same change as the schema.**
- [ ] T056 [P] Append the two DECISIONS entries this feature owes to `docs/DECISIONS.md`: **`day` is written, not derived** (recomputing it when `dayStartHour` changes would silently move payments between days) and **the server applies `dayStartHour`, unlike meals where the browser does** (a Shortcut cannot read the profile)
- [ ] T057 [P] Append a user-facing entry to `docs/CHANGELOG.md`
- [ ] T058 [P] Add the spending gotchas to `CLAUDE.md`: duplicate detection needs the time window because BOG messages carry no time; ingest must answer 2xx on an unparsed message; a payment has two days
- [ ] T059 Add ingest setup instructions to the token page — the exact Shortcut steps, copy buttons for URL and token, and a "waiting for first message / received" state driven by `lastUsedAt`
- [ ] T060 Run [quickstart.md](quickstart.md) §3–§4 against a running API on the local Mongo, **never** `.env`, which points at the owner's live Atlas cluster
- [ ] T061 Confirm `npm run check` passes and both `nx build api` and `nx build web` succeed

---

## Dependencies and execution order

### Phase dependencies

- **Setup (Phase 1)** — no dependencies
- **Foundational (Phase 2)** — needs Setup; **blocks every user story**
- **US1 (Phase 3)** — needs Foundational. Delivers value alone.
- **US2 (Phase 4)** — needs Foundational. Testable on hand-entered payments, so it does not need US1.
- **US3 (Phase 5)** — needs US2's waterfall for its figures
- **US4 (Phase 6)** — needs US2's waterfall
- **US5 (Phase 7)** — needs US4's period history
- **US6 (Phase 8)** — needs US3's ladder view
- **Polish (Phase 9)** — after the stories being shipped

### Within a story

Tests → domain → service → endpoints → UI. Domain before anything that calls it.

### Parallel opportunities

- T001–T003 are three different files and can run together
- T008–T011: parsers and completeness are independent of each other
- T024–T027: the money helper and the waterfall spec touch different files
- T013 and T018–T021 are separate endpoint groups
- T055–T058 are four separate documents

---

## Implementation strategy

**MVP is Phase 1 + 2 + 3 (US1).** That alone replaces the daily chore of remembering what was
spent, and it is worth shipping before any budgeting behaviour exists — it starts collecting the
history every later phase needs.

**Then US2**, which is the heart of the feature and the largest slice. US3 follows quickly because
the hard work is already done.

**US5 cannot be exercised until there is history**, so it is last for a reason, not just by
priority: a proposal drawn from 28 days of data needs 28 days of data.

**Do not skip T060.** `npm run check` passed while the FX work shipped a live bug that made
conversion do nothing at all, and it passed again in this session while DI was broken at boot.
Running the thing is the only step that catches that class of failure.
