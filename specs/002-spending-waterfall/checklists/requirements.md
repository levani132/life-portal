# Specification Quality Checklist: Spending waterfall

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-25
**Updated**: 2026-08-29
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

### Validation pass 1 — 2026-08-25

Three problems fixed: collection, endpoint and file names had leaked into the requirements; one
success criterion was a latency figure rather than something the owner would notice; and "parsers
are strict" was untestable until it became "an unreadable message is queued, never partly recorded".

### Validation pass 2 — 2026-08-29, after the owner's answers

The answers changed the shape of the feature, not just the blanks. Reworked:

1. **A payment no longer carries what it was for.** It records only what happened, and the
   decomposition against the ladder is a *proposal* the owner may leave, confirm, or replace with a
   custom purpose. This replaced the previous model where the waterfall assigned and the owner
   corrected. Drove FR-011 to FR-019 and a new User Story 2, which is now the heart of the feature.
2. **Custom purposes consume no allowance**, and can be promoted into a budgeted line item — new
   behaviour with no earlier equivalent.
3. **Balance reconciliation removed; the completeness check kept.** The bank's balance line covers
   one account of several across two banks, so it is not the balance and no account is reconciled
   from it — the old User Story 4 was built on that and is gone. But the two uses are separable, and
   on the owner's follow-up the checksum stays (FR-010a to FR-010c): chained per card it is that
   card's own running total, so it detects a missed message and names the exact amount. It is a
   server-side integrity check that surfaces only what the owner needs to act on, never a balance.
4. **Refunds and transfers are not modelled.** Money coming in that offsets a payment is recorded
   *on that payment* as not really spent (FR-018), which also covers paying for someone else and
   being paid back. The previous unwind-in-reverse requirement is gone.
5. **Overspend is a negative figure**, not zero — reversing the earlier decision.
6. **Two capabilities added** from the owner's statement of purpose: cumulative savings broken down
   by which allowance they came from (FR-031), and budget proposals drawn from observed spending
   (FR-034 to FR-038, User Story 5).
7. **"Any point in time is calculable"** is now stated outright, and flagged for the constitution
   rather than left in a feature spec.

### Validation pass 3 — 2026-08-29, both markers resolved

**FR-030 — unplanned spending.** All three figures are reported: saved against the allowances,
spent outside them, and the net. A month additionally shows the projected saving already known from
income less budgeted spending, so projected, actual and extra can be read together.

**FR-031 — what governs the total.** The answer dissolved the conflict rather than picking a side:
*projected* and *confirmed* spending follow different rules on purpose. A projection cascades, so a
tier that runs out passes the excess down and never reports a negative saving. A confirmation does
not cascade — the money lands where the owner said, and overspends that allowance if it must.

The property that makes both safe is now FR-031c and SC-008a: **the total saved for a window is the
same however its payments were decided.** 40.00 against a 30.00 daily allowance is either "daily
used up, 10.00 taken from weekly" or "daily 10.00 overspent", and both leave the window's total
saving identical. Confirming moves attribution, never the arithmetic. Worth a test naming exactly
that, because it is the invariant that keeps the breakdown trustworthy.

Also settled: the fourth bucket accumulates as **extra unplanned spending for the month**, and
confirmed decisions are placed before projections fill in around them (FR-013a), so a day's result
does not depend on the order the owner happened to make decisions in.

**Status: planned.** Phase 0 and Phase 1 artifacts generated.

### Validation pass 4 — 2026-08-29, four additions from the owner

All four were accepted; two turned out to be one mechanism.

1. **A confirmation is a list, and may be partial** (FR-014, FR-014a). One supermarket payment is
   routinely part dinner and part household. An unaccounted remainder rejoins the cascade, so "₾20
   of this was dinner, work out the rest" is a normal thing to say. `SpendAllocation.projected`
   already carried the per-part distinction, so a part-confirmed payment needed no new concept.
2. **Confirming one payment re-proposes the others** (FR-014b). Already implied by FR-013a — this
   is precisely why confirmations are placed before projections rather than taking their turn in
   clock order — but it is the behaviour the owner cares most about, so it is now stated outright
   with scenarios in both directions and its own invariant.
3. **Spending today for tomorrow's allowance** and 4. **one payment covering several days** are the
   same feature: an allocation gains `forDay`/`throughDay` and spreads evenly across the span.
5. **The consequence worth naming**: a payment now has **two days** — when the money left, and
   whose allowance it consumed. Real spending and cash flow follow the first; the ladder and
   savings follow the second (FR-014f). Every figure must state which, and every test must fix
   both. This is the largest single increase in complexity in the feature, and it is the owner's
   call, taken knowingly.

Also found and closed while reworking: **a confirmed allocation whose line item is later deleted**
(FR-019a). It is surfaced for re-decision and counted as extra, never silently dropped — dropping
it would reduce reported spending, the one failure this feature must not have.

### Validation pass 5 — 2026-08-29, confirming closes an allowance

The owner asked what happens to an allowance's remainder once part of it is confirmed — a case the
algorithm answered only by the order of its steps, which is why it had to be asked at all.

**Chosen: a confirmation closes its line item to the cascade for that period** (FR-014g), while
leaving it **open to further confirmations** (FR-014h). The unconsumed remainder reads as a saving,
not as capacity (FR-014i).

The reason is the feature's whole point: if breakfast cost ₾7 of ₾10 and an unrelated payment
quietly absorbs the other ₾3, the ₾3 actually saved is invisible. The obvious objection — that
confirming would cost spending room and so discourage confirming — is answered by the second half:
coffee and dessert bought separately are one meal in two payments, and both can be confirmed. So
confirming costs nothing; it only stops *guesses* landing where the owner has already said what
happened.

**Accepted cost, stated in the spec**: confirm one breakfast payment, forget a second, and the
second lands on the next allowance down. Confirming it fixes it, and no total is ever wrong — only
the attribution, because the §2 invariant holds regardless. Verified: ₾35 spent against ₾30 daily
and ₾130 weekly gives ₾125 saved whether nothing is confirmed or ₾20 is.

Also refined: **FR-047 no longer applies uniformly.** A projected line item must read as a marker
along a bar, never a checklist entry. A *confirmed* one may legitimately read as settled, because
the owner has stated the truth about it — and its remainder must show as saved rather than
available (FR-047a).

**Status: ready for `/speckit-tasks`.**
