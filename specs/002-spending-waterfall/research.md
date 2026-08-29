# Phase 0 — Research: Spending waterfall

Decisions taken before design, each with what it buys and what was rejected. Nothing here is a
technology evaluation: the stack is fixed by the constitution. These are the choices where the
spec left room and getting it wrong would be expensive later.

---

## 1. Where the projected/confirmed split lives

**Decision.** One pure function computes both. `spendWaterfall()` takes every payment in a window
along with each one's decision, places the **confirmed** ones first, then cascades the
**unconfirmed** ones through whatever capacity remains.

**Rationale.** The spec's two rules (FR-031a, FR-031b) are not two algorithms — they are one
algorithm where a confirmed payment skips the cascade and lands on a named rung. Splitting them
into separate code paths would invite the two to disagree about how much of an allowance is left.

Placing confirmed first, regardless of clock order (FR-013a), is what makes the result independent
of the order the owner happened to click things in. The alternative — walking strictly by time and
letting confirmations take their turn — means confirming a 09:00 payment at midnight silently
re-proposes everything after it.

**A confirmation also closes its rung to the cascade** for the period it names, while leaving it
open to further confirmations (FR-014g, FR-014h).

The owner chose this over letting projections fill the gaps, and the reason is the point of the
feature: if breakfast cost ₾7 of ₾10 and an unrelated payment quietly absorbs the other ₾3, the ₾3
they actually saved is invisible. Closing the rung keeps it visible.

The objection to closing — that confirming would cost you spending room and so discourage
confirming — is answered by the "open to confirmations" half. A coffee and a dessert bought
separately are one meal in two payments, and both can be confirmed as breakfast. Confirming
therefore never costs you anything; it only stops *guesses* landing where you have already said
what happened.

**The accepted cost.** Confirm one breakfast payment, forget a second, and the second lands on the
next allowance down. Confirming it fixes it. No total is ever wrong — only the attribution — because
the invariant in §2 holds regardless.

**Consequence to test.** A confirmation that overspends its rung leaves that rung with *zero*
remaining, not negative. Otherwise a later unconfirmed payment would "borrow back" capacity that a
confirmation already spent.

**Alternatives rejected.** Storing the placement on the payment and mutating it on every ladder
change (violates principle III, and the owner explicitly asked for projection); computing the
projection once at ingest time (same problem, and it would freeze a guess).

---

## 2. Savings arithmetic, and the invariant that keeps it honest

**Decision.** For any window, for each allowance: `saving = budget − consumption`, signed.
Confirmed payments contribute consumption to the rung named; unconfirmed payments contribute to
whatever rung the cascade reached. Extra unplanned spending is its own line, and the period's net
is `Σ savings − extra`.

**Rationale.** This produces the property the owner asked for, and it is worth stating as an
invariant because it is what makes the breakdown trustworthy:

> **The total saved for a window does not depend on how its payments were decided.**

Worked, with a 30.00 daily allowance, a 130.00 weekly one, and 40.00 spent:

| | daily | weekly | total |
|---|---|---|---|
| Left as a projection | 30 − 30 = **0** | 130 − 10 = **120** | **120** |
| Confirmed as breakfast | 30 − 40 = **−10** | 130 − 0 = **130** | **120** |

And with 35.00 spent, of which 20.00 is confirmed across the meals — the case that closing a rung
exists for:

| | daily | weekly | total |
|---|---|---|---|
| Nothing confirmed | 30 − 30 = **0** | 130 − 5 = **125** | **125** |
| 20.00 confirmed, rungs closed | 30 − 20 = **+10** | 130 − 15 = **115** | **125** |

Same total, different attribution — exactly as intended, and the second row is the one that shows
the owner the 10.00 they actually saved on meals. `SC-008a` asserts the invariance and it gets a
test named for it.

**Alternatives rejected.** Flooring a tier's saving at zero (loses the overspend the owner asked
to see); computing a day's saving as `allowance − that day's real spending` in all cases (reads
well per day but double-counts the overflow, so the daily/weekly/monthly parts stop summing).

---

## 3. Duplicate detection — the trap in hashing the message

**Decision.** A submission is a duplicate when its raw text matches an existing payment's **and**
it arrived within 120 seconds of it.

**Rationale.** The obvious design — a unique index on `hash(userId + raw)` — is wrong here, and
the owner's own data shows why. A BOG message carries **no time**, only a date:

```
გადახდა: GEL4.00
Card:***9582
NILE
24.08.2026
```

Two ₾4.00 coffees at NILE on the same day produce **byte-identical** messages. A pure content hash
would silently discard the second one — the app would under-report spending, which is precisely the
failure mode the whole feature exists to avoid.

A retried automation fires seconds apart; a genuine second coffee does not. The time window
separates them. 120 seconds is generous for a retry and far shorter than any real repeat purchase.

**Alternatives rejected.** Unique index on the raw text (drops real payments); no dedupe at all
(iOS automations do re-fire); dedupe on amount + merchant + day (same false positive, worse).

**Test to write**: two identical BOG messages 5 seconds apart → one payment. The same two an hour
apart → two payments.

---

## 4. Ingest token format and verification

**Decision.** `lp_<tokenId>_<secret>`. The id selects the row; the secret is compared against a
**bcryptjs** hash, reusing what `auth.service.ts` already does for refresh tokens.

**Rationale.** bcrypt is deliberately slow, so comparing a presented token against *every* stored
hash costs ~100 ms each. Embedding the row id means exactly one comparison regardless of how many
tokens exist. This is the standard personal-access-token shape and it needs no new dependency —
`bcryptjs` is already in `package.json` and already hashes refresh tokens, so the precedent and the
cost are both known.

The secret is 32 bytes from `crypto.randomBytes`, base64url. The plain value is returned once from
the create call and never stored (FR-042, FR-043).

**Alternatives rejected.** A fast hash (SHA-256) — faster, but diverges from how every other
credential in this codebase is stored for no real gain at this volume; storing a prefix for lookup
(same as embedding the id, but less explicit).

---

## 5. Rate limiting without a new dependency

**Decision.** A small fixed-window counter in the ingest guard, in memory: 60 accepted submissions
per token per hour.

**Rationale.** The constitution requires a new dependency to justify itself in a sentence, and
`@nestjs/throttler` cannot: this is one endpoint, one user, and a handful of legitimate requests a
day. The threat is a leaked token flooding the record, and a counter stops that.

Its weakness is honest and acceptable: an in-memory window resets when a free host sleeps the
process. That turns "no more than 60 an hour" into "no more than 60 an hour per process lifetime",
which still bounds the damage and still costs nothing.

**Alternatives rejected.** `@nestjs/throttler` (a dependency and a global module for one route);
persisting counters in Mongo (a write per request, on the one route that should stay cheap).

---

## 6. Parsers live in the domain library

**Decision.** `libs/shared/domain/src/lib/sms-parsers.ts`, pure `(raw: string) => ParsedMessage | null`.

**Rationale.** They are exactly what that library is for: no Mongo, no HTTP, no clock, and they
benefit more from dense unit testing than anything else in this feature. The owner's real message
bodies become fixtures, so a bank changing its wording is caught by a failing test rather than by a
quiet drop in reported spending.

**Parsing rules, from the owner's real messages.** Both are keyword-anchored and both must reject
rather than guess (FR-007).

*BOG* — Georgian, currency **prefix**, date only:
- `გადახდა:` = outgoing payment, `ჩარიცხვა:` = money in (recorded but never spending, FR-004).
- `Card:***9582` → last four.
- Line 3 is the merchant; a trailing `>City CC` is stripped for display.
- `დაგერიცხა:` and `სულ:` are **PLUS loyalty points**, not money (FR-005). A parser that grabs the
  last number on the line would read `სულ: 1,939.70 PLUS` as a balance.
- `DD.MM.YYYY`, **no time**.

*TBC* — transliterated Latin, currency **suffix**, with a time:
- Line 1 `186.48GEL` — no keyword at all, so the shape itself is the anchor.
- `(*6810)` → last four.
- `Nashti:` = account balance after the payment. Used only for §7.
- `dagibrunda:` = cashback, which accrues to the loyalty pot — verified against the owner's data:
  `10.14 + 0.03 = 10.17`, `+0.07 = 10.24`, `+0.11 = 10.35`, and none of it moves `Nashti`. So it is
  **not** an account inflow and must not be netted off the payment.
- `Ertgul kulabashi gaqvs:` = loyalty balance, not spendable.
- `DD/MM/YY HH:MM`.

**Anything unmatched is stored verbatim and queued** (FR-006, FR-007). Never partially recorded.

---

## 7. The completeness check

**Decision.** Derived, not stored. `detectMissedMessages()` chains each card's `Nashti` readings in
time order and reports a gap where `previousBalance − Σ payments between − currentBalance ≠ 0`.
Never surfaced as a balance and never written to `cash_balances` (FR-010b).

**Rationale.** The reading is one account of several across two banks, so as *the* balance it is
wrong — which is why the owner rejected that use. As a running total of **one card's own stream** it
is exact, and it was verified against the owner's screenshots:

```
1472.30 − 186.48 = 1285.82 ✓   1285.82 − 6.95 = 1278.87 ✓
1278.87 − 14.45 = 1264.42 ✓    1264.42 − 22.19 = 1242.23 ✓
```

Four consecutive messages, exact. Deriving it rather than storing it keeps principle III and means
a payment added by hand later closes the gap automatically.

**Only TBC carries a balance**, so only that card self-checks. BOG payments are unverifiable, which
the UI must not obscure.

---

## 8. Ordering is a preference; settlement is a fact

**Decision.** Two different homes, for two different kinds of thing.

- **Order** → `spendOrder: string[]` on `user_settings`, the same shape as `widgetOrder` and the
  loans `order`.
- **`settlement: 'auto' | 'manual'`** → a field on the **expense row** itself.

**Rationale.** The comment on `widget-order.ts` already argues this case: an arrangement has to
tolerate ids it has never seen and ids that no longer exist, because the things being arranged come
and go. Expenses are added and deleted, so their order is a preference list, not a `position`
column that needs backfilling on every insert.

Settlement is the opposite: "this line is paid by direct debit, not by card" is a fact *about the
expense*, true regardless of who is looking. It belongs on the row, and it is what stops one big
night out being charged to the loan repayment.

**Ownership stays with cashflow** (principle IV). The spending module reads expenses through
`CashflowService`, exactly as `LoansService` already does for `linkedExpenseAmounts`. It never
touches the `expenses` collection directly.

---

## 9. Which rate converts a budget

**Decision.** For a given day, both the payments on it and the allowances it draws on are converted
at **that day's** rate.

**Rationale.** Budgets are recorded in USD and payments arrive in GEL, so something must convert.
Converting a payment at its own day's rate is already settled (`fx` module). Converting the
allowance at the *same* day's rate keeps the comparison internally consistent: a day's ₾ spending is
measured against that day's ₾ allowance. Mixing rates across the two sides would make a day look
overspent because the lari moved.

**Consequence.** A USD allowance is worth slightly different amounts on different days. That is
correct — it *is* a dollar allowance — and it is why every figure carries the `fx` basis label.

---

## 10. Budget proposals

**Decision.** Median of complete periods over a trailing window, with a minimum history and a
minimum deviation before anything is proposed.

- daily lines: 28 complete days, propose if the median differs by >15% and >the equivalent of ₾5
- weekly lines: 8 complete weeks, same thresholds
- monthly lines: 4 complete months, same thresholds

**Rationale.** The **median** rather than the mean, for the same reason the trailing statistic for
the cashflow suggestion is: one holiday, one dentist, one broken phone should not move a routine
allowance. The minimums exist because FR-037 forbids proposing from too little history, and the
deviation threshold stops a permanent trickle of ±3% noise that trains the owner to ignore it.

**Dismissal** is recorded on the expense as `suggestionDismissedAt` + the value dismissed, rather
than in a new collection: a new collection needs to buy something, and two fields on a row the
suggestion already concerns buys the same thing for less.

**Alternatives rejected.** Auto-applying a proposal (FR-036 forbids it, and it would silently
rewrite the budget the projection depends on); the mean (one bad month moves it); proposing on
every deviation (noise).

---

## 11. Which day a payment belongs to

**Decision.** The Shortcut sends an ISO timestamp with offset; the **server** applies
`localDay(at, dayStartHour)`.

**Rationale.** This inverts the meals convention deliberately. For a meal, the browser decides the
day and sends `?today=`, because the browser knows the profile. A Shortcut cannot read the profile,
so it can only report the moment; the server holds `dayStartHour` and is the only place that can
apply it.

`localDay` already exists — it moved from `nutrition.ts` to `dates.ts` during the FX work — so this
is reuse, not a second implementation of the 4am rule.

**Needs a DECISIONS.md entry**, because the inconsistency with meals is deliberate and a future
session would otherwise "fix" it.

---

## 12. A payment has two days

**Decision.** `payment.day` is when the money left the account. A confirmed allocation's
`forDay`…`throughDay` is which day's allowance it consumes. Real spending and the cash projection
use the first; the ladder and savings use the second.

**Rationale.** The owner buys food in the evening for tomorrow, and buys milk that covers four
breakfasts. Forcing an allowance to be consumed on the day the card was tapped would make tomorrow
look affordable when it is already paid for, and would put four days of breakfast on one day's
budget.

**The cost is real and worth stating.** Every figure in the feature now has to say which of the two
it uses, and every test has to fix both. The alternative — a single day — is simpler and wrong in a
way the owner would notice weekly.

**Consequence for the invariant.** "Total saved is unchanged however payments were decided" now
holds over **a window containing every day the allocations touch**. Spreading moves attribution
across days exactly as confirming moves it across tiers; over a wide enough window, neither changes
the arithmetic. SC-008a says so precisely.

**Alternatives rejected.** A separate "prepaid" collection (a second place money lives, and
principle IV forbids the duplication); moving `payment.day` itself (breaks the cash projection,
which must follow the money).

---

## 13. Splitting a spread without losing a tetri

**Decision.** `splitCentsEvenly(total, parts)` in `money.ts`, giving the indivisible remainder to
the earliest parts: 1001 over 3 is `[334, 334, 333]`.

**Rationale.** `money.ts` already exists to make rounding a decision taken in one place rather than
an accident at each call site — that is the file's own opening comment. Spreading is exactly that
problem: three lots of `Math.round(1001/3)` is 1002, three lots of `Math.floor` is 999, and both are
wrong in a ledger. The helper makes the parts sum to the whole by construction.

**Alternatives rejected.** Rounding at the call site (the bug this file exists to prevent);
storing fractional cents (principle II).

---

## 14. A confirmed allocation whose line item is deleted

**Decision.** Surface it. The allocation is emitted as extra unplanned spending, flagged as needing
a decision, and never dropped.

**Rationale.** Deleting an expense is allowed today and would otherwise orphan the allocations
pointing at it. Silently discarding them would reduce reported spending, which is the one failure
mode this feature must never have. Blocking the delete would be worse — it makes cashflow's
behaviour depend on a widget it does not know about, against principle I.

Snapshotting the label onto the allocation was considered and rejected: `meal_entries.facts` is
documented as *the one place* in this codebase where a value is copied rather than referenced, and
that exception was bought with a strong reason (correcting a food must not rewrite history). Nothing
here justifies a second.

**Alternatives rejected.** Cascade-delete the allocations (loses money); block the delete (couples
the modules); copy the label (a second snapshot exception without cause).

---

## Open questions

None. The two the spec carried were resolved by the owner on 2026-08-29 and are folded into
§2 above.
