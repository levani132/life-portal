# Implementation Plan: Spending waterfall

**Branch**: `002-spending-waterfall` | **Date**: 2026-08-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-spending-waterfall/spec.md`

## Summary

Capture card payments from bank SMS through a token-authenticated endpoint, **propose** what each
was spent on by cascading it down a ladder of the budgeted expenses that already exist, and let the
owner confirm that proposal or replace it with what it really was. Report what was really spent,
what was saved or overspent per period and cumulatively by allowance, and — once there is enough
history — propose budgets that match how money is actually spent.

The technical shape follows from one line in the spec: **a payment records what happened, never what
it was for.** Everything else — the decomposition, the ladder, the savings, the gaps, the proposals
— is derived on read, which is principle III applied harder than anywhere else in this codebase.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node 22

**Primary Dependencies**: NestJS 11, Mongoose 9, Next.js 16 App Router, SWR, Tailwind. **No new
runtime dependency.** `bcryptjs` (already present, already hashes refresh tokens) covers token
hashing; rate limiting is a small in-memory counter rather than `@nestjs/throttler` — see
[research §5](research.md).

**Storage**: MongoDB Atlas. Two new collections (`spend_payments`, `ingest_tokens`), two fields added
to `expenses`, two to `user_settings`.

**Testing**: Jest. Domain logic carries the weight — parsers are fixture-driven on the owner's real
messages, and the waterfall's tests are named for the invariants in
[contracts/domain.md](contracts/domain.md).

**Target Platform**: Private PWA, one owner, iPhone-first. Ingest is called by an iOS Shortcuts
"Message" automation, which cannot handle an error response — so an unrecognised message must still
answer `201`.

**Project Type**: Nx monorepo, web + API + two shared libraries.

**Performance Goals**: A payment visible within a minute of the tap (SC-001), which is bounded by the
phone, not by us. Ladder reads span a month of payments — a few hundred rows.

**Constraints**: Free-tier deployable, no always-on worker. Every scheduled thing has a manual
trigger. The service worker must never cache `/api`.

**Scale/Scope**: One user, two banks, three currencies, ~10 budgeted line items, a few hundred
payments a month.

## Constitution Check

*GATE: passed before Phase 0, re-checked after Phase 1 design.*

| Principle | Assessment |
| --- | --- |
| **I — Widget = bounded module** | PASS. One `spending` Nest module, one collection family, one `/spending` route, one dashboard card with **one** quick action (add a payment by hand). The module reads expenses through `CashflowService` and never touches that collection, exactly as `LoansService` already does for `linkedExpenseAmounts`. |
| **II — Money is integer cents** | PASS. Every monetary field is `*Cents`. `notReallySpentCents`, `cashbackCents` and `suggestionDismissedCents` are optional and use `centsField` — **no `default: 0`**, which has caused two silent zeroing bugs here before. |
| **III — Derived never persisted** | PASS, and it is the point of the feature. Decompositions, ladder, savings, gaps and proposals are all computed on read. Two deliberate exceptions are recorded below. |
| **IV — Cross-widget links single-sourced** | PASS. The ladder *is* the cash-flow expenses; no second copy of a budget exists. `settlement` and the budget live on the expense row, which cashflow owns. The loan repayment stays owned by its expense and its `linkedExpenseId`. |
| **V — Projections are pure functions** | PASS. `spend-waterfall.ts`, `sms-parsers.ts`, `completeness.ts`, `spend-suggestions.ts` are all in `libs/shared/domain` with `today` and every window boundary as explicit arguments. |
| **VI — Estimates are labelled** | PASS. Every allocation carries `projected: boolean`; every figure drawn from captured payments carries a basis saying it is a lower bound; converted figures carry the FX basis; every budget proposal is an `Estimate<Cents>` naming its median and window. |

### Deliberate exceptions, both needing a DECISIONS.md entry

**1. `day` is written on a payment, not derived.** Everywhere else the day is computed. Here the
server must apply `dayStartHour` — a setting the owner can change — and recomputing historic days
when they change it would silently move payments between days, altering what past periods spent.
Writing it at ingest freezes the answer that was true when the payment happened.

**2. The server applies `dayStartHour`, unlike meals where the browser does.** A Shortcut cannot
read the profile; it can only report the moment. `localDay` is reused, so the 4am rule still has one
implementation — only the caller differs. Without the entry, a future session would "fix" the
inconsistency.

Neither adds a new abstraction or a new dependency, so the complexity budget is untouched.

### Constitution amendment proposed separately

The owner's *"any point in time should be calculatable"* sharpens principles III and V and is the
sentence that explains this whole design. It belongs in the constitution via
`/speckit-constitution`, not buried in a feature spec.

## Project Structure

### Documentation (this feature)

```text
specs/002-spending-waterfall/
├── spec.md
├── plan.md               # this file
├── research.md           # Phase 0 — 14 decisions with rationale
├── data-model.md         # Phase 1
├── quickstart.md         # Phase 1 — how to prove it actually works
├── contracts/
│   ├── api.md            # HTTP surface
│   └── domain.md         # the pure functions and their invariants
└── tasks.md              # /speckit-tasks — not created here
```

### Source code

```text
libs/shared/types/src/lib/
└── spending.ts                     # SpendPayment, SpendDecision, LadderTier, PeriodSaving, …

libs/shared/domain/src/lib/
├── sms-parsers.ts   + .spec.ts     # BOG + TBC, fixtures are the owner's real messages
├── spend-waterfall.ts + .spec.ts   # the cascade; one test per invariant
├── spend-suggestions.ts + .spec.ts # median-based budget proposals
└── completeness.ts  + .spec.ts     # the Nashti chain

apps/api/src/spending/
├── spending.module.ts              # controller + module wiring
├── spending.service.ts             # loads data, calls the domain, never computes
├── spending.schemas.ts             # spend_payments, ingest_tokens
├── spending.dto.ts
├── ingest-token.guard.ts           # header auth + in-memory rate limit
└── ingest-token.service.ts         # mint, verify, revoke, last-used

apps/api/src/cashflow/              # + settlement on the expense schema and DTOs
apps/api/src/settings/              # + weekStartsOn, spendOrder

apps/web/src/app/spending/
├── page.tsx                        # ladder, today's figures, payment list
└── tokens/page.tsx                 # mint, list, revoke
apps/web/src/components/
├── spend-ladder.tsx                # filling bars, names as markers — never tick-boxes
└── payment-sheet.tsx               # decomposition, confirm, custom purpose, promote

docs/modules/spending.md            # required in the same change
```

**Structure Decision**: the standard shape for this repo — one bounded Nest module, contracts in
`libs/shared/types`, all logic in `libs/shared/domain`, one Next route plus a dashboard card. The
only structural novelty is the second authentication path, which is confined to
`ingest-token.guard.ts` and applies to exactly one route.

## Delivery order

Following the spec's priorities, each slice independently testable:

1. **P1 — capture.** Types, parsers with their fixtures, `spend_payments`, tokens + guard, ingest,
   manual entry, the unparsed queue. Delivers "today's spending appears without me typing it" with
   no budgeting behaviour at all.
2. **P2 — decisions.** The waterfall, decompositions on payments, confirm / custom / promote,
   partial "not really spent". Confirmation is a **list** of allocations, may cover only part of a
   payment, and each part may name a day or a span of days whose allowance it consumes — which is
   what makes "this is for tomorrow" and "this milk covers four breakfasts" the same feature. The
   heart of the feature, and the largest slice.
3. **P3 — the ladder.** `settlement`, `spendOrder`, the tier view, the dashboard card.
4. **P4 — savings.** Per period, cumulative by allowance, the month's three figures, and feeding
   real spending into the cash projection for past days.
5. **P5 — proposals.** Median-based budget suggestions, accept and dismiss.
6. **P6 — shaping.** Drag-to-reorder, marking a rung manual.

The completeness check rides along with P1, since it is derived from data P1 already stores.

## Risks

| Risk | Mitigation |
| --- | --- |
| **A content hash silently drops a real payment.** BOG messages carry no time, so two identical coffees on one day are byte-identical. | Duplicate = same text **and** within 120 s. Tested both ways. [research §3](research.md) |
| **It all passes `npm run check` and captures nothing.** Exactly how the FX work shipped a live bug. | [quickstart.md](quickstart.md) §3–4 replays a real day against a running API and is part of done. |
| **A bank changes its wording.** | Every unrecognised message is kept verbatim and queued, so nothing is lost while the parser catches up. Fixtures make the change a failing test. |
| **The waterfall disagrees with itself between modes.** | One function computes both; the invariant that total saving does not depend on how payments were decided is asserted directly. |
| **The two days get conflated.** Real spending follows the money; allowances follow `forDay`. Mixing them makes a figure quietly wrong rather than visibly broken. | Every payload field states which it uses; tests fix both; [research §12](research.md). |
| **A spread loses or invents a minor unit.** | `splitCentsEvenly` in `money.ts`, tested on amounts that do not divide. |
| **A leaked ingest token.** | Expiry required, bcrypt at rest, one-time display, revocable, rate-limited, and `lastUsedAt` surfaced so unexpected use is visible. |
| **Drag-to-reorder dies on touch.** | Reuse `sortable-grid.tsx` as-is. Both of its non-obvious load-bearing details — the non-passive `touchmove` registered at mount, and the node not being replaced mid-gesture — are documented in `docs/DECISIONS.md` and were missed by `npm run check` once already. |

## Complexity Tracking

No violations to justify. No new runtime dependency, no new abstraction layer, and the two
collections added are the minimum for a feature that stores payments and credentials. The two
deviations from principle III are listed under the Constitution Check with their reasoning and
both owe a DECISIONS.md entry in the same change.
