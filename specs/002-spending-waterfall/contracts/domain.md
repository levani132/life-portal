# Contract — domain functions

`libs/shared/domain`. Pure, no Mongo, no HTTP, no implicit clock — "today" and every window
boundary is an argument (principle V). Both the API and the browser may call these, so a what-if
in the UI and the figure the server returns come from one definition.

---

## `sms-parsers.ts`

```ts
export interface ParsedMessage {
  direction: 'out' | 'in';
  amountCents?: Cents;          // absent only when unreadable
  currency?: Currency;
  merchant?: string;
  cardLast4?: string;
  /** The moment the bank printed, when it printed one. TBC does; BOG does not. */
  statedAt?: string;
  /** TBC's `Nashti`. Completeness check only — never a balance. */
  reportedBalanceCents?: Cents;
  /** TBC's `dagibrunda`. Recorded, then ignored by every figure. */
  cashbackCents?: Cents;
}

export function parseBogMessage(raw: string): ParsedMessage | null;
export function parseTbcMessage(raw: string): ParsedMessage | null;
export function parseBankMessage(raw: string, bank?: 'bog' | 'tbc'): ParsedMessage | null;
```

**`null` means "not recognised"** and the caller stores the message verbatim as `unparsed`. A
parser returns `null` rather than a half-filled object — a partially recorded payment is worse
than an obviously incomplete one.

**Fixtures are the owner's real messages.** The loyalty lines are the trap: `სულ: 1,939.70 PLUS` and
`Ertgul kulabashi gaqvs: 10.14GEL` are not money, and a parser that takes the last number on a line
reads them as one.

---

## `spend-waterfall.ts`

```ts
export interface WaterfallInput {
  /** Reference day. Explicit, always. */
  today: string;
  /** Window to compute over. Must cover the whole month to know monthly consumption. */
  from: string;
  to: string;
  payments: SpendPayment[];
  /** Budgeted expenses, already grouped and ordered by the caller. */
  tiers: LadderTierBudget[];
  /** Rates, per `fx`. Each day converts at its own rate. */
  fx: FxContext;
  ratesByDay?: Record<string, FxContext>;
  weekStartsOn: number;
  /** Day of month a financial month begins. 1 = calendar months. */
  monthStartsOn: number;
}

export function spendWaterfall(input: WaterfallInput): WaterfallResult;
```

### The algorithm, in order

1. **Resolve each payment.** Drop `direction: 'in'` and `status: 'unparsed'`. Spendable =
   `amountCents − (notReallySpentCents ?? 0)`. Convert at the payment's own day's rate.
2. **Place every confirmed allocation first**, on the rung and the day(s) it names, regardless of
   clock order and regardless of which payment it came from. A confirmation may name several rungs
   and may cover only part of its payment. A rung may go past its budget; its remaining capacity
   floors at **zero**, never negative, so a later projection cannot borrow back capacity a
   confirmation already spent.
3. **Expand spans.** An allocation with `forDay`…`throughDay` is divided across those days by
   `splitCentsEvenly`, and each part consumes the allowance of the period *that day* falls in — so
   a span crossing a week or month boundary lands correctly on both sides.
4. **Close every rung a confirmation touched**, for the period that confirmation named. A closed
   rung is removed from the cascade: its unconsumed remainder is a *saving*, not capacity. It stays
   open to further confirmations, because one meal can be two payments.
5. **Route custom purposes to extra** for their month. They consume no rung.
6. **Cascade what is left in `(day, at)` order** — including the unaccounted remainder of a partly
   confirmed payment: the day's daily rungs in `spendOrder`, then that week's weekly rungs, then
   that month's monthly rungs, then yearly, then extra. Skip any rung that is `settlement: 'manual'`,
   `kind: 'one_off'`, or **closed by a confirmation**.
7. **Split** whenever a payment exceeds the current rung's remaining capacity, emitting one
   allocation per rung touched. A payment's allocations always sum to its spendable amount.
8. **Surface orphans.** A confirmed allocation whose `expenseId` no longer resolves is emitted as
   extra and flagged, never dropped.

**Steps 2 and 4 before step 6 are the whole design.** Placing confirmations first is what makes
confirming the morning payment re-propose the evening one against the weekly allowance, and
confirming the evening one push the morning payment there instead — without either being touched,
and without the answer depending on which was decided first.

Closing the rung is what makes a saving the owner earned stay visible. Say breakfast cost ₾7 of its
₾10 and no guess may take the other ₾3; the day reports it saved. The cost, accepted knowingly: a
*second* breakfast payment left unconfirmed lands on the next allowance down. Confirming it fixes
that, and no total is ever wrong — only the attribution.

### Result

```ts
export interface WaterfallResult {
  allocationsByPayment: Record<Id, SpendAllocation[]>;
  ladderFor(date: string): SpendLadder;
  savings: PeriodSaving[];
  cumulative: SavingsBreakdown;
  extraByMonth: Record<string, Cents>;
  unconvertedCurrencies: Currency[];
}
```

### Invariants — each gets a test named for it

| Invariant | Why it matters |
| --- | --- |
| A payment's allocations sum exactly to its spendable amount | SC-005. The bars must add up. |
| A spread allocation's per-day parts sum exactly to the amount spread | SC-008b. ₾10.01 over 3 days is 3.34 / 3.34 / 3.33, never a lost tetri. |
| Confirming payment A re-proposes payment B without B being touched | FR-014b. Both directions, morning-confirmed and evening-confirmed. |
| A partly confirmed payment's remainder cascades from where it would have | FR-014a. |
| A confirmed rung is skipped by the cascade for that period, and its remainder reads as saved | FR-014g, FR-014i, SC-008c. |
| A confirmed rung still accepts a second confirmation, which adds to it | FR-014h. Coffee and dessert are one meal in two payments. |
| Un-confirming reopens the rung and the projections re-fill it | The state moves both ways. |
| **The total saved for a window is identical however its payments were decided** | SC-008a, research §2. Confirming moves attribution, never arithmetic. |
| `cumulative.daily + weekly + monthly` equals `cumulative.totalCents` | SC-007. |
| Reordering rungs leaves total real spending unchanged | SC-008. |
| A `manual` rung never receives an allocation from the cascade | FR-026. One big evening must not spend the loan repayment. |
| A planned one-off never receives an allocation from the cascade, but accepts a confirmation | FR-020a. A coffee must not settle the credit-card payment. |
| A projected tier's saving is never negative; a confirmed rung's may be | FR-031a vs FR-031b. |
| Result does not depend on the order decisions were made in | FR-013a. |

### The two days

Every figure states which it uses (FR-014f):

- **Real spending, cash flow** → `payment.day`, when the money left the account.
- **Allowance consumption, ladder, savings** → the allocation's `forDay`…`throughDay`.

They coincide for every unconfirmed payment. They diverge only when the owner says tonight's
shopping is for tomorrow, or that one payment covers four breakfasts.

### Period boundaries

- **Day** — `localDay(at, dayStartHour)`, written at ingest.
- **Week** — starts on `weekStartsOn`. A week straddling a month end draws its monthly overflow
  from the month the **spending day** falls in, not the month the week began in.
- **Month** — the financial month containing the spending day, which begins on `monthStartsOn`.
  With `monthStartsOn: 7`, 3 September belongs to the month that began on 7 August. `1` gives
  calendar months, which is the default and today's behaviour.

---

## `spend-suggestions.ts`

```ts
export function suggestBudgets(input: {
  today: string;
  tiers: LadderTierBudget[];
  history: PeriodSaving[];
  dismissals: Record<Id, { at: string; cents: Cents }>;
}): BudgetProposal[];
```

Median of complete periods against the budget. Minimum history: 28 days / 8 weeks / 4 months.
Proposes only past a 15% **and** ~₾5 deviation. Returns `Estimate<Cents>` values carrying the
observed median and the window, so the UI can show the working (principle VI).

A dismissal suppresses the same figure until the median moves materially away from it.

---

## `completeness.ts`

```ts
export function detectMissedMessages(
  payments: SpendPayment[],
): CompletenessGap[];
```

Chains each card's `reportedBalanceCents` in `at` order. A gap is any consecutive pair where
`previous − Σ payments between − current ≠ 0`, reported with the amount and the window.

Only TBC prints a balance, so only that card self-checks; BOG payments produce no gaps and their
absence is not evidence of completeness. The UI must not imply otherwise.

Verified against the owner's real messages:

```
1472.30 − 186.48 = 1285.82 ✓   1285.82 −  6.95 = 1278.87 ✓
1278.87 −  14.45 = 1264.42 ✓   1264.42 − 22.19 = 1242.23 ✓
```

---

## `money.ts` — one addition

```ts
/**
 * Divides `total` into `parts` whole cents that sum back to `total` exactly.
 * The indivisible remainder goes to the earliest parts, so 1001 over 3 is
 * [334, 334, 333] rather than three 333s and a lost cent.
 */
export function splitCentsEvenly(total: Cents, parts: number): Cents[];
```

Needed by spreading (FR-014e). It belongs in `money.ts` beside `scaleCents` because it is the same
kind of decision: rounding happens in one place, deliberately, rather than by accident at each call
site.

---

## Reused, not rewritten

- `localDay(at, dayStartHour)` — `dates.ts`. The 4am rule has one implementation.
- `toDisplayCents`, `sumInDisplay`, `fxContext`, `fxBasis` — `fx.ts`.
- `arrangeWidgets`-style ordering — `spendOrder` behaves the same way and tolerates ids that no
  longer exist.
- `occurrencesBetween`, `monthlyEquivalentCents` — `recurrence.ts`, for turning a recurring expense
  into the allowance for a given day.
