# Module: spending (Widget 8 — the spending waterfall)

Answers four questions: *what did I really spend, what did I save, where did the money go, and is
my budget still the right shape?*

**Code:** `apps/api/src/spending/` · `apps/web/src/app/spending/`
**Domain logic:** `libs/shared/domain/src/lib/sms-parsers.ts`, `spend-waterfall.ts`,
`completeness.ts`, `spend-suggestions.ts`
**Spec:** `specs/002-spending-waterfall/`

## The rule the module turns on

**A payment records what happened, never what it was for.**

What it was for is *proposed*: the ladder of budgeted expenses is walked in order and the payment is
decomposed against it. That proposal is recomputed on every read (principle III), so reordering the
ladder or correcting a budget re-attributes the past correctly. The owner may leave it, confirm it
in whole or in part, or replace it with a custom purpose.

## Collections

| Collection | Purpose |
| --- | --- |
| `spend_payments` | One row per payment. What happened, plus the owner's decision. Never what it was for. |
| `ingest_tokens` | Credentials letting a phone automation submit. bcrypt-hashed, never recoverable. |

The ladder itself is **not** a collection. It is the cash-flow `expenses` grouped by
`recurrence.cadence` (principle IV) — there is no second copy of a budget anywhere.

### `day` is written, not derived

The one place in this feature where a value is stored rather than computed. `dayStartHour` is a
setting the owner can change, and recomputing historic days would silently move payments between
them. See `docs/DECISIONS.md`.

### Two notions of "when"

| Question | Uses |
| --- | --- |
| What did I really spend today? What does the cash projection see? | `payment.day` — when the money left |
| How much of today's allowance is left? What did this period save? | the allocation's `forDay`…`throughDay` |

They coincide for every unconfirmed payment. They diverge when the owner says tonight's shopping is
for tomorrow, or that one carton of milk covers four breakfasts.

## Capture

Two iOS Shortcuts "Message" automations POST the raw message to `POST /api/spending/ingest`, which
authenticates with `X-Ingest-Token` rather than a JWT.

**Three rules that look like bugs and are not:**

1. **A duplicate is the same text within 120 seconds**, not the same text. BOG messages carry no
   time, so two identical coffees on one day are byte-identical; a content hash would delete the
   second.
2. **An unreadable message answers `201`**, stored raw and queued. A Shortcut cannot handle an
   error, so any 4xx loses the message permanently.
3. **The route is `@TokenAuth()`, not `@Public()`.** It is authenticated; the markers are kept apart
   so nobody greps for public routes and finds this one.

### Message formats

Both parsers are keyword-anchored and return `null` rather than a half-filled object.

**BOG** — Georgian, currency prefix, **no time**: `გადახდა:` is an outgoing payment, `ჩარიცხვა:` is
money in. `დაგერიცხა:` and `სულ:` are **PLUS loyalty points, not money** — a parser taking the last
number on a line reads them as a balance.

**TBC** — transliterated Latin, currency suffix, has a time. `Nashti:` is the account balance,
`dagibrunda:` is cashback that accrues to a loyalty pot (verified: it never moves `Nashti`), and
`Ertgul kulabashi gaqvs:` is a loyalty balance. Only the payment amount is money.

## Completeness

`detectMissedMessages` chains each card's `Nashti` readings and reports a gap where the balances and
the captured payments disagree. Derived, so a payment added by hand later closes its own gap.

**It is never a balance and never reconciles an account.** The reading covers one account of several
across two banks, so as *the* balance it would be wrong; as one card's own running total it is
exact, which is the only job it does. Only TBC prints one, so a card with no gaps is not evidence of
completeness.

## The waterfall

Confirmed allocations are placed **first**, regardless of clock order, and the projections fill in
around them. That is what makes confirming the morning payment re-propose the evening one against
the weekly allowance — and confirming the evening one push the morning payment there instead —
without either being touched, and without the result depending on which was decided first.

**A confirmation closes its rung to projections** for the period it names, while leaving it open to
further confirmations. If breakfast cost ₾7 of ₾10, no guess may absorb the other ₾3: the owner
earned that saving and must be able to see it. But a coffee and a dessert bought separately are one
meal in two payments, so both can be confirmed against breakfast.

The cascade skips any rung that is `settlement: 'manual'`, `kind: 'one_off'`, or closed by a
confirmation. That is what stops one expensive evening being charged against the loan repayment.

### The invariant

> **The total saved for a window does not depend on how its payments were decided.**

₾40 against a ₾30 daily and ₾130 weekly allowance saves ₾120 whether it reads as "daily used up,
₾10 from weekly" or "daily ₾10 overspent". Confirming moves attribution, never arithmetic. There is
a test named for it, and it is what makes the daily/weekly/monthly breakdown trustworthy.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/spending/ingest` | Token-authenticated. Always 2xx. |
| `GET` | `/api/spending/payments` | `?from=&to=&status=` |
| `POST` `PATCH` `DELETE` | `/api/spending/payments[/:id]` | Manual entry; PATCH also completes an unparsed row |
| `PUT` | `/api/spending/payments/:id/decision` | `confirmed` (a list, possibly partial) · `custom` · `none` |
| `POST` | `/api/spending/payments/:id/promote` | Custom purpose → budget line, via `CashflowService` |
| `GET` | `/api/spending/gaps` | Suspected missed messages |
| `GET` `POST` `DELETE` | `/api/spending/tokens[/:id]` | The plain token exists in exactly one response |

## Cross-links

- **cashflow** owns the ladder. This module reads expenses through `CashflowService` and never
  touches that collection, exactly as `LoansService` does for `linkedExpenseAmounts`.
- **fx** converts payments to the display currency at the rate in force on each payment's own day.
- **nutrition** owns `dayStartHour`, read to decide which day a payment belongs to.
- **settings** owns `spendOrder`, `weekStartsOn` and `monthStartsOn`.

## Open questions

- Does the financial month start on payday or the 1st? `monthStartsOn` defaults to 1, which is
  today's behaviour. Collected by `003-onboarding`.
- Render cold starts will drop some messages. Mitigations, in order: keep the service warm with an
  external ping; the completeness check tells you when one was lost; a paste-import screen would
  make recovery ten seconds rather than manual re-entry.
