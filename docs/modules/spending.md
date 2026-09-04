# Module: spending (Widget 8 — the spending waterfall)

Answers four questions: *what did I really spend, what did I save, where did the money go, and is
my budget still the right shape?*

**Code:** `apps/api/src/spending/` · UI merged into `apps/web/src/app/cashflow/page.tsx` — see
DECISIONS; only the capture-setup page remains at `/spending/tokens`
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

The sender filter is entirely phone-side — the app never checks who a message came from; the
`bank` field in the body picks the parser. That matters because iOS mangles TBC's alphanumeric
sender when typed by hand (`TBC SMS` → `TBCSMS`), and whether the mangled form still matches is
undocumented. The robust trigger is **Message Contains `Nashti`** with no sender at all: every TBC
payment message carries it, OTPs and marketing do not. BOG's `4444` is numeric and safe to type.
The token page's `lastUsedAt` is the empirical test either way — "not used yet" means the
automation has never fired.

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

`Nashti`'s currency is kept apart from the payment's (`reportedBalanceCurrency`): a $10 charge on
a lari card prints a USD amount over a GEL balance, and the completeness check needs both to
chain the readings in one currency.

## Completeness

`detectMissedMessages` chains each card's `Nashti` readings and reports a gap where the balances and
the captured payments disagree. Derived, so a payment added by hand later closes its own gap.

**It is never a balance and never reconciles an account.** The reading covers one account of several
across two banks, so as *the* balance it would be wrong; as one card's own running total it is
exact, which is the only job it does. Only TBC prints one, so a card with no gaps is not evidence of
completeness.

**A manual payment joins the chain by naming its card.** A transfer entered by hand moves the real
balance, so the next reading would otherwise report a false gap of exactly its size. Any payment
carrying `cardLast4` — manual or ingested — is deducted from that card's chain, and `cardLast4` is
editable after the fact (`PATCH`; an empty string clears it), so a gap caused by a forgotten card
field is closed by editing the payment, not re-entering it.

**The chain runs in the account's currency, not each payment's.** A foreign-currency payment is
converted at the NBG rate in force on its own day before it is deducted — deducting the raw dollar
figure from a lari balance invented a permanent gap per dollar payment. Because the bank converts
at *its* card rate rather than the published one, a segment that needed conversion is checked to
within 5% of the amount converted (the spread is a percent or two; a lost message misses by its
whole size) instead of to the tetri. A foreign payment whose day has no rate makes its segment
unverifiable, and an unverifiable segment reports nothing — unknowable is not missing, exactly as
with BOG's silence.

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

### Verified against a running server

One day, four payments, a ₾78.38 daily allowance (a $30 budget at 2.6125) and a ₾130 weekly one:

```
all projected           Big evening 60.00 -> Lunch + Dinner 19.11 + Breakfast 26.13 + Fuel 14.76
                        daily consumed 78.38  saving   0.00 | weekly consumed 14.76 | saved 3475.95

confirmed as breakfast  Big evening 60.00 -> Breakfast 60.00
                        daily consumed 93.14  saving -14.76 | weekly consumed  0.00 | saved 3475.95

undone                  back to the first row exactly
```

Three things to read out of it. One payment splits across three rungs and two tiers, and the parts
sum to it. Confirming the evening payment pushed the *other* payments' proposals off the weekly
allowance entirely, without any of them being touched. And the total saved is identical in every
state — confirming moved which allowance bore the money and made the overspend visible, but not one
tetri of the arithmetic.

## Budget proposals

`spend-suggestions.ts`. What the owner's real spending says an allowance ought to be. Derived on
read, never applied: the endpoint returns proposals and a budget only changes when the owner
accepts one (FR-036).

The statistic is the **median of complete periods**, never the mean. A budget funds a routine, and
the statistic describing a routine has to survive the days that were not routine — one holiday, one
dentist, one broken phone. A single ₾500 evening inside a month of ₾20 days drags the mean to ₾37
and would propose nearly doubling the food allowance on the strength of one dinner; the median does
not move. There is a test asserting exactly that the mean would have proposed differently.

**Minimum history** before anything is proposed (FR-037): 28 complete days, 8 complete weeks,
4 complete months. Two reasons. A proposal is a claim about a habit, and three days of data is
evidence of three days; and capture is incomplete at the start, so early periods read as
under-spent for reasons that have nothing to do with behaviour. `observedFrom` — the first day
anything was captured — drops periods that predate capture entirely, for the same reason.

**Minimum deviation**: 15% **and** ~₾5 (500 minor units), both. One alone is wrong in one
direction each — 15% of a ₾10 daily line is ₾1.50, and ₾5 of a ₾900 rent line is noise. Without a
floor every line carries a permanent ±3% proposal, and a notification always present is never read.

**Never proposed on**: a `manual` line (the cascade never observed it, so its consumption reads as
zero and the loan repayment would be cut to nil), a planned one-off (an intention, not a habit),
and a line held in a currency other than the display one (its median is in lari and its
`amountCents` is in dollars).

**Dismissal** is stored on the expense row as `suggestionDismissedAt` + `suggestionDismissedCents`
rather than in a collection (research §10). It suppresses the *figure*, not the line: the proposal
returns as soon as the median has moved materially — the same 15%-and-₾5 test — away from what was
refused, so a habit that really is changing is put to the owner again.

**New lines** (FR-049). A custom purpose consumes no allowance, so a recurring one is invisible to
every budget. Once it has been paid at least 4 times, over at least 28 days, across at least 2
complete calendar months, it is proposed as a monthly line at the median of its monthly totals.
Months inside the span with no payments count as **zero** — dropping them would take the median of
only the months the owner spent, which is how a twice-a-year insurance bill becomes a monthly line.
Such a proposal carries a synthetic `expenseId` under the `purpose:` prefix (`isNewLineProposal`);
accepting it creates the expense, and it cannot be dismissed because there is no row to record the
dismissal on.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/spending/ingest` | Token-authenticated. Always 2xx. |
| `GET` | `/api/spending/payments` | `?from=&to=&status=` |
| `POST` `PATCH` `DELETE` | `/api/spending/payments[/:id]` | Manual entry; PATCH also completes an unparsed row |
| `PUT` | `/api/spending/payments/:id/decision` | `confirmed` (a list, possibly partial) · `custom` · `none` |
| `POST` | `/api/spending/payments/:id/promote` | Custom purpose → budget line, via `CashflowService` |
| `GET` | `/api/spending/day` | `?date=` — the day read allowance-first: what it consumed, whichever day paid |
| `GET` | `/api/spending/gaps` | Suspected missed messages |
| `GET` | `/api/spending/suggestions` | Budget proposals, each an `Estimate<Cents>` showing its working |
| `POST` | `/api/spending/suggestions/:expenseId/accept` | Applies it through `CashflowService`; a `purpose:` id creates the line |
| `POST` | `/api/spending/suggestions/:expenseId/dismiss` | Records the figure refused on the expense row |
| `GET` `POST` `DELETE` | `/api/spending/tokens[/:id]` | The plain token exists in exactly one response |

## Cross-links

- **cashflow** owns the ladder. This module reads expenses through `CashflowService` and never
  touches that collection, exactly as `LoansService` does for `linkedExpenseAmounts`. The reverse
  read exists too, and is the one deliberate exception to service-mediated access:
  `CashflowService` reads `spend_payments` directly to feed real spending into the projection,
  because importing `SpendingModule` back would be a cycle. Writes keep one owner.
- **fx** converts payments to the display currency at the rate in force on each payment's own day.
- **nutrition** owns `dayStartHour`, read to decide which day a payment belongs to.
- **settings** owns `spendOrder`, `weekStartsOn` and `monthStartsOn`.

## Open questions

- Does the financial month start on payday or the 1st? `monthStartsOn` defaults to 1, which is
  today's behaviour. Collected by `003-onboarding`.
- Render cold starts will drop some messages. Mitigations, in order: keep the service warm with an
  external ping; the completeness check tells you when one was lost; a paste-import screen would
  make recovery ten seconds rather than manual re-entry.
