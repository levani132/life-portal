# Phase 1 — Data model: Spending waterfall

Two new collections, two fields added to things that already exist, and a lot that is deliberately
**not** stored. Money is integer minor units in `*Cents` fields (principle II); calendar days are
`YYYY-MM-DD` strings; only `createdAt`/`updatedAt` are real timestamps.

---

## What is stored

### `spend_payments`

One row per payment. It records **what happened**, never what it was for (FR-011).

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | `Id` | Indexed. Every read scoped. |
| `amountCents` | `Cents` | Required. What was charged. |
| `currency` | `Currency` | What it was charged in — GEL from a message, chosen for a manual entry. |
| `merchant` | `string?` | Shown so the payment is recognisable. **Never interpreted.** |
| `cardLast4` | `string?` | 4 digits. Keyed on for the completeness check. |
| `at` | `IsoDate` | Full timestamp with offset, as the phone reported it. Orders the cascade. |
| `day` | `IsoDate` | `YYYY-MM-DD`, indexed. Derived once at write by `localDay(at, dayStartHour)`. |
| `direction` | `'out' \| 'in'` | `in` is recorded but never spending (FR-004). |
| `source` | `'sms' \| 'manual'` | |
| `bank` | `'bog' \| 'tbc'?` | Absent for manual entries. |
| `raw` | `string?` | The original message, kept for every submission (FR-006). |
| `rawReceivedAt` | `IsoDate?` | When the submission arrived. Drives duplicate detection. |
| `status` | `'recorded' \| 'unparsed'` | `unparsed` rows carry `raw` and little else, and queue for completion (FR-007). |
| `reportedBalanceCents` | `Cents?` | TBC's `Nashti`. Feeds the completeness check **only** — never a balance (FR-010b). |
| `cashbackCents` | `Cents?` | TBC's `dagibrunda`. Accrues to a loyalty pot, so it is recorded and then ignored by everything. |
| `notReallySpentCents` | `Cents?` | Paid back, or refunded. Optional — uses `centsField`, **no `default: 0`**. |
| `decision` | `Decision?` | See below. Absent means "leave it as a projection". |

**Indexes**: `{ userId, day }` for the window reads that drive every figure;
`{ userId, cardLast4, at }` for the completeness chain.

**`day` is written, not derived** — the one exception to computing on read in this feature. The
server needs `dayStartHour` to compute it and that is a *setting the owner can change*; recomputing
historic days when they change it would silently move payments between days. Writing it at ingest
freezes the answer that was true when the payment happened. Recorded in DECISIONS.md.

### `Decision` (embedded on a payment)

The owner's answer to "what was this for" (FR-014, FR-015). Absent for most payments.

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | `'confirmed' \| 'custom'` | |
| `allocations` | `ConfirmedAllocation[]?` | `confirmed` only. May cover **part** of the payment; the remainder rejoins the cascade (FR-014a). |
| `purpose` | `string?` | `custom` only. Free text — "vase". |
| `decidedAt` | `IsoDate` | |
| `promotedToExpenseId` | `Id?` | Set when a custom purpose became a budget line (FR-017). |

### `ConfirmedAllocation` (embedded on a decision)

| Field | Type | Notes |
| --- | --- | --- |
| `expenseId` | `Id` | The rung this part lands on. |
| `amountCents` | `Cents` | `requiredCentsField`. In the payment's own currency. |
| `forDay` | `IsoDate?` | First day whose allowance this consumes. Defaults to the payment's `day`. |
| `throughDay` | `IsoDate?` | Last day of the span. Defaults to `forDay`. Spread evenly across the span (FR-014d). |

**A confirmed part does not cascade** — it lands where it was told and overspends that rung if it
must. A **custom** payment consumes no planned allowance and joins that month's extra unplanned
spending.

*Why a list rather than one `expenseId`*: a single supermarket payment is routinely part dinner and
part household, and forcing it onto one rung would make the owner choose which lie to tell.

*Why `kind` rather than two nullable fields*: it makes confirmed and custom mutually exclusive by
construction, so no row can be both.

### The two days

`ConfirmedAllocation.forDay`/`throughDay` are the reason a payment now has **two** notions of when
(FR-014f):

| Question | Uses |
| --- | --- |
| How much did I really spend today? What does the cash projection see? | `payment.day` — when the money left |
| How much of today's allowance is left? What did this period save? | the allocation's `forDay`…`throughDay` |

Unconfirmed payments have no allocations, so both answers collapse to `payment.day`. They only
diverge when the owner says food bought tonight is for tomorrow, or that one carton of milk covers
four breakfasts.

### `ingest_tokens`

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | `Id` | Indexed. |
| `label` | `string` | "iPhone — TBC". |
| `secretHash` | `string` | bcrypt. The plain value is returned once and never stored (FR-042, FR-043). |
| `expiresAt` | `IsoDate` | Required — no non-expiring credential for a route that writes money (FR-041). |
| `lastUsedAt` | `IsoDate?` | What tells the owner the automation still runs (FR-044). |
| `revokedAt` | `IsoDate?` | Set rather than deleted, so a revoked token stays auditable. |

Presented as `lp_<tokenId>_<secret>`: the id selects the row so exactly one bcrypt comparison
happens per request, regardless of how many tokens exist.

---

## What is added to what already exists

### `expenses` (owned by cashflow — principle IV)

| Field | Type | Notes |
| --- | --- | --- |
| `settlement` | `'auto' \| 'manual'` | Default `auto`. `manual` = paid by transfer or direct debit: shown in its tier, counted in its budget, **skipped by the cascade** (FR-026). |
| `suggestionDismissedAt` | `IsoDate?` | With the value below, gives a dismissal a cooldown without a new collection. |
| `suggestionDismissedCents` | `Cents?` | `centsField` — no default. |

The loan repayment and the three utilities become `settlement: 'manual'`, which is what stops one
expensive evening being charged against the loan. Cascade-available monthly is then $344, not
$1,504.

### `user_settings`

| Field | Type | Notes |
| --- | --- | --- |
| `spendOrder` | `string[]` | Expense ids in the order the ladder fills. Same shape as `widgetOrder`: a preference list that tolerates ids it has never seen and ids that no longer exist. |
| `weekStartsOn` | `number` | 0–6, default 1 (Monday). Needed because a week is a real boundary here. |
| `monthStartsOn` | `number` | 1–28, default 1. The day a *financial* month begins. Taken now rather than later because the default reproduces calendar months exactly, while adding it afterwards would mean revisiting the waterfall, its tests, and anything already attributed by it. Collected by `003-onboarding`. |

---

## What is deliberately **not** stored

Everything below is computed on read (principle III). This is most of the feature.

| Derived | From | Why not stored |
| --- | --- | --- |
| **Ladder** — tiers, rungs, consumption, remaining | active expenses + `spendOrder` + payments in the window | Reordering must re-attribute past days (FR-013). Inactive expenses are excluded; `kind: 'one_off'` expenses are confirmable targets but never cascade rungs (FR-020a). |
| **Decomposition** — how a payment splits across rungs and days | the waterfall | A projection by definition. Frozen only in the sense that a *confirmed* part names its rung and days; even then the per-day split is recomputed from that. |
| **Extra unplanned spending** | overflow past the last tier, plus every custom purpose | It is a remainder, not a bucket. |
| **Savings** — per period, per tier, cumulative, split by allowance | budget − consumption | Storing a running total is the classic way to make history unfixable. |
| **Completeness gaps** | the `reportedBalanceCents` chain per card | A payment added by hand later closes the gap automatically. |
| **Budget proposals** | median of complete periods vs the budget | Recomputes as history grows. |
| **Real spending** for any window | `Σ (amountCents − notReallySpentCents)` over `payment.day` | Follows the money, not the allowance. |
| **Per-day allowance consumption** | allocations expanded across their `forDay`…`throughDay` spans | Follows the allowance, not the money. |

---

## Domain types (`libs/shared/types`)

```
SpendPayment            the stored row
SpendDecision           kind + allocations[] | purpose
ConfirmedAllocation     { expenseId, amountCents, forDay?, throughDay? }
IngestTokenSummary      no secret — the shape the UI sees
SpendAllocation         { expenseId | 'extra', amountCents, forDay, projected: boolean }
LadderRung              { expenseId, label, budgetCents, consumedCents, remainingCents, settlement }
LadderTier              { cadence, rungs, budgetCents, consumedCents, savingCents }
SpendLadder             { date, tiers, extraCents, unconvertedCurrencies? }
PeriodSaving            { from, to, cadence, budgetCents, spentCents, savingCents, extraCents, netCents }
SavingsBreakdown        { totalCents, daily, weekly, monthly, extraCents }
CompletenessGap         { cardLast4, from, to, missingCents }
BudgetProposal          Estimate<Cents> + expenseId, observed median, window
```

`SpendAllocation.projected` is what the UI reads to decide whether it is showing a claim or a
guess (FR-012, FR-048), and it is why `Estimate`'s `basis` is carried on every derived figure.

---

## Validation rules

- `amountCents` integer ≥ 0 — `requiredCentsField`.
- `notReallySpentCents` ≤ `amountCents`; a payment entirely paid back contributes nothing anywhere.
- `currency` ∈ `SUPPORTED_CURRENCIES`.
- `cardLast4` matches `^\d{4}$`.
- `day` matches the `YYYY-MM-DD` pattern via `requiredDayField`.
- `decision.allocations[].expenseId` must reference an expense the same user owns.
- `decision.allocations` must sum to **at most** the spendable amount — never more (FR-014b's
  companion rule). A shortfall is legal and rejoins the cascade.
- `throughDay >= forDay` when both are present.
- A spread's per-day parts must sum **exactly** to the allocation's `amountCents`; the indivisible
  remainder is distributed across the earliest days rather than dropped (FR-014e).
- An allocation whose `expenseId` no longer resolves is surfaced for re-decision and counted as
  extra meanwhile — never silently discarded (FR-019a).
- `expiresAt` must be in the future at creation.
- A payment with `status: 'unparsed'` may omit amount, currency and merchant; it may not be
  decomposed and it counts towards no figure until completed.

## State transitions

A payment's decision moves freely and reversibly:

```
        ┌────────────► confirmed ──────┐
        │                  │           │
    (none) ◄───────────────┘           │
        │                              │
        └────────────► custom ─────────┴──► custom + promoted
```

Un-confirming returns a payment to a projection (FR-019). Promoting a custom purpose creates an
expense and records its id; it does **not** retrospectively pull past payments into the ladder —
the new rung applies from its start date.
