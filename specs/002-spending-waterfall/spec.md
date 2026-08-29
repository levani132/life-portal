# Feature Specification: Spending waterfall

**Feature Branch**: `002-spending-waterfall`

**Created**: 2026-08-25

**Status**: Draft

**Input**: Capture card payments from bank SMS, propose what each was spent on against a ladder of budgeted line items, and report what was really spent, really saved, and where the budget no longer matches life.

## What this feature is for

Four things, in the owner's words:

1. Know **exactly how much was really spent** in a day, a week, a month — actual, not budgeted.
2. Know **how much was saved or overspent** in that day, week, or month.
3. Know **how much has been saved in total**, and how much of that came from the daily, weekly and
   monthly allowances.
4. **Notice when the budget no longer matches life** and say so — if food has averaged ₾10 a day
   against a ₾15 allowance for a while, propose the smaller figure.

Budget, spend, save, analyse — with as little typing as possible.

## The shape of it

A payment records only what happened: when, how much, where. It never records what it was *for*.

What it was for is **proposed**: the ladder of budgeted line items is walked in order and the
payment is decomposed against it. That proposal is a projection, recomputed on read like every
other derived figure in this codebase, so nothing is frozen by having been guessed at.

The owner can then do one of three things with a payment:

- **Leave it.** It stays a projection and keeps re-deriving.
- **Confirm it**, in whole or in part. A confirmation is a *list* of allocations, not a single
  choice: ₾20 of this was dinner and ₾30 was chores. Anything left unaccounted for simply rejoins
  the cascade, so "I know ₾20 was dinner, work out the rest" is a normal thing to say.
- **Say what it really was.** A custom purpose, which sits *outside* the ladder — it consumes no
  planned allowance — and can be promoted into a new daily, weekly or monthly line item with one
  button when it turns out to be a recurring part of life.

**A confirmation is a fixed point, and the projections rearrange around it.** Confirm the morning
payment as the whole day's food and the evening one re-proposes itself against the weekly
allowance, because the daily one is gone. Confirm the evening one instead and the morning payment
moves to weekly. Neither needs touching; both follow from the same read.

**Confirming an allowance closes it to guesses — not to facts.** Once the owner says what breakfast
cost, no projection may quietly fill the rest of that allowance: the unspent part is a saving they
earned and should be able to see. But a second payment can still be *confirmed* as breakfast, since
food in one place and dessert in another is one meal in two transactions. Closed to projections,
open to confirmations.

The trade-off is deliberate. Confirm one breakfast payment and forget a second, and that second one
will land on the next allowance down rather than on breakfast — because the app was told breakfast
was already accounted for. Confirming the second one puts it right.

**A payment has two days.** The day the money left the account, and the day whose allowance it
paid for. Usually they are the same. But food bought this evening for tomorrow belongs to
tomorrow's allowance, and milk bought for the next four breakfasts belongs, in quarters, to four
days at once. The owner says so, and the payment spreads. Real spending and cash flow follow the
money; the ladder and savings follow the allowance.

**Projected and confirmed spending follow different rules, deliberately.** A projection cascades:
daily first, then weekly, then monthly, then into extra unplanned spending for the month — so a
tier that runs out simply passes the excess down, and never reports a negative saving. A
confirmation does not cascade: the payment lands on the allowance it was confirmed against and
stays there, and if that takes it past its budget, that allowance is overspent and says so.

Spending 40 against a 30 daily allowance therefore reads two ways, both correct. Left alone, the
daily allowance is used up and 10 went to the weekly one. Confirmed as breakfast, the daily
allowance is 10 overspent. The total saved for the window is identical either way — only the
attribution moves.

### Worked: a day that is part confirmed

A ₾30 daily allowance of Breakfast ₾10 and Lunch + Dinner ₾20. ₾20 is confirmed across the meals
and a further ₾15 is left unconfirmed.

| | budget | confirmed | closed to guesses? | the ₾15 |
| --- | --- | --- | --- | --- |
| Breakfast | 10 | 7 | yes | — |
| Lunch + Dinner | 20 | 13 | yes | — |
| *weekly* | 130 | — | no | **15** |

The day reports **₾35 really spent**, **₾10 saved** on the daily allowance, and ₾15 of the weekly
allowance consumed. Had nothing been confirmed, the same ₾35 would have filled the daily allowance
and spilled ₾5 into weekly — **₾125 saved in total either way**. Confirming moved which allowance
bore the money and made the ₾10 visible; it did not change the arithmetic.

There is no closing of a *period*. **Any point in time is calculable**, from the payments and the
budget as they stand.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Payments appear without me typing them (Priority: P1)

The owner pays for coffee. Their bank texts them, as it already does. Seconds later that payment
is in the app — amount, currency, merchant, card — with nothing opened and nothing typed. What the
app cannot read confidently is kept verbatim and queued rather than guessed at, and anything the
bank never texted about (cash, a transfer made instead of a card payment) can be added by hand in
seconds.

**Why this priority**: Nothing else exists without a stream of payments. On its own it already
replaces the daily chore of remembering and typing what was spent.

**Independent Test**: Create a token, submit the text of a real bank message, and confirm the
payment is listed with the right amount, currency, merchant, card and day. Deliverable with no
budgeting behaviour at all.

**Acceptance Scenarios**:

1. **Given** a valid, unexpired token, **When** the text of a BOG payment message
   (`გადახდა: GEL4.00 / Card:***9582 / Georgian Coffee Group>Tbilisi GE / 23.08.2026`) is
   submitted, **Then** a payment of ₾4.00 at "Georgian Coffee Group" on card 9582 is recorded for
   23 August.
2. **Given** a valid token, **When** a TBC payment message is submitted, **Then** the payment
   amount is recorded and the balance, cashback and loyalty lines are all ignored.
3. **Given** a message reporting money coming *in*, **When** it is submitted, **Then** it is not
   recorded as spending and does not appear in the ladder.
4. **Given** a message the parser does not recognise, **When** it is submitted, **Then** the raw
   text is stored unchanged and queued for the owner, never discarded and never partly recorded.
5. **Given** no token, an expired token, or a revoked token, **When** a message is submitted,
   **Then** it is refused and nothing is recorded.
6. **Given** the owner paid cash or transferred money instead of paying by card, **When** they
   record it by hand, **Then** it behaves exactly like a captured payment thereafter.
7. **Given** a run of messages from one card where one was never delivered, **When** the day is
   read, **Then** a missed message is reported naming the exact amount, derived from the balances
   the surrounding messages carried — **And** that balance is never shown as the owner's balance.

---

### User Story 2 - I can see what a payment was probably for, and fix it (Priority: P2)

The owner opens a payment. It shows what the app believes it went on — "₾1.81 finished Breakfast,
₾6.69 went to Lunch + Dinner" — as a proposal, not a claim. They confirm it, or they type what it
actually was ("vase"), which takes it out of the allowances entirely. If "vase" turns out to be
the sort of thing that happens every month, one button turns it into a monthly line item.

Sometimes part of a payment was never really theirs — dinner for two, half of it paid back. They
mark that part as not really spent, and only the rest counts.

**Why this priority**: This is what makes the numbers true rather than merely plausible. It is the
difference between a guess and a record, and it is testable on hand-entered payments alone.

**Independent Test**: Enter a payment, open it, confirm the proposal on one and give a custom
purpose to another, and verify the first consumes its allowances while the second consumes none.

**Acceptance Scenarios**:

1. **Given** a payment with no decision made, **When** it is opened, **Then** its proposed
   decomposition is shown, marked as a projection rather than a fact.
2. **Given** a proposed decomposition, **When** the owner confirms it, **Then** it becomes concrete
   and no longer changes when the ladder or a budget changes.
3. **Given** a payment, **When** the owner gives it a custom purpose, **Then** it consumes no
   planned line item, and later payments that day are proposed as though it had not touched the
   ladder.
4. **Given** a payment with a custom purpose, **When** the owner promotes it, **Then** a new daily,
   weekly or monthly line item is created from it and appears in the ladder from then on.
5. **Given** a ₾100 payment of which ₾50 was paid back, **When** ₾50 is marked as not really spent,
   **Then** real spending counts ₾50 and only ₾50 is decomposed against the ladder.
6. **Given** a payment marked entirely as not really spent, **When** figures are read, **Then** it
   contributes nothing to spending and consumes no allowance.
7. **Given** a ₾50 payment, **When** the owner confirms ₾20 of it as dinner and ₾30 as chores,
   **Then** both allowances are consumed accordingly and the parts sum to ₾50.
8. **Given** a ₾50 payment, **When** the owner confirms only ₾20 of it as dinner, **Then** that
   ₾20 lands on dinner and the remaining ₾30 rejoins the cascade as a projection.
9. **Given** an unconfirmed evening payment proposed against the daily allowance, **When** the
   morning payment is confirmed as the whole of that day's food, **Then** the evening payment
   re-proposes itself against the weekly allowance without being touched.
10. **Given** an unconfirmed morning payment and a later confirmation of the evening payment
    against the daily allowance, **When** figures are read, **Then** the morning payment moves to
    the weekly allowance — the result does not depend on which was decided first.
11. **Given** food bought this evening for tomorrow, **When** the owner says it is for tomorrow,
    **Then** tomorrow's allowance is consumed and today's is not, while the money still left the
    account today.
12. **Given** milk bought for the next four breakfasts, **When** the owner spreads it across those
    four days, **Then** each day's breakfast allowance takes a quarter, and the four parts sum
    exactly to the payment.
13. **Given** ₾7 confirmed against a ₾10 breakfast allowance, **When** an unrelated unconfirmed
    payment arrives that day, **Then** it does **not** consume the remaining ₾3, and the day reports
    ₾3 saved on breakfast.
14. **Given** that same closed breakfast allowance, **When** the owner confirms a second payment —
    a dessert bought elsewhere — against it too, **Then** both are counted against breakfast and the
    saving reduces accordingly.
15. **Given** ₾20 confirmed across a ₾30 daily allowance and a further ₾15 unconfirmed, **When** the
    day is read, **Then** it reports ₾35 really spent, ₾10 saved on the daily allowance, and ₾15
    consumed from the weekly one.

---

### User Story 3 - I can see how much is left today (Priority: P3)

Payments fill the daily allowances in the order the owner set — the first payment starts filling
the first line item, and when one is full the next continues into the one below. When the daily
tier is used up, spending draws on the weekly tier, then the monthly. Anything past the last tier
becomes extra unplanned spending for that month.

**Why this priority**: This answers the question the feature exists for — *can I still spend
today?* — but it needs payments and the decomposition model beneath it.

**Independent Test**: Enter several payments against a known ladder and confirm each is proposed
where the waterfall says, that a payment straddling two rungs is split across both, and that the
parts sum to the whole.

**Acceptance Scenarios**:

1. **Given** a daily tier of Breakfast then Lunch + Dinner, **When** a payment smaller than the
   remaining Breakfast allowance arrives, **Then** it is proposed against Breakfast alone.
2. **Given** Breakfast has 1.81 left, **When** a payment of 8.50 arrives, **Then** 1.81 completes
   Breakfast and 6.69 continues into Lunch + Dinner, as one payment split across two rungs.
3. **Given** the daily tier is used up, **When** another payment arrives, **Then** it is proposed
   against the first available weekly line item.
4. **Given** every tier is used up, **When** another payment arrives, **Then** it is added to that
   month's extra unplanned spending.
5. **Given** a line item settled by hand — a loan repayment, a utility direct debit — **When** the
   waterfall cascades past it, **Then** it is skipped and never absorbs a card payment, while
   still counting towards its tier's budgeted total.
6. **Given** a new day, **When** the ladder is read, **Then** the daily tier is whole again while
   the weekly and monthly tiers carry their consumption forward.

---

### User Story 4 - I know what I saved (Priority: P4)

For any day, week or month: what was saved against the allowances, what was spent outside them,
and the net of the two — what the period actually gained or lost. For a month, alongside the
projected saving already known from income less budgeted spending. Across all time: how much has
been saved in total, and how much of it came from the daily, weekly and monthly allowances.

**Why this priority**: This is the payoff and the reason to keep the ladder honest, but it needs
real spending to be trustworthy first.

**Independent Test**: Run a known set of payments across a known ladder and confirm each period's
saving equals its budget minus its real spending, and that the cumulative figure equals the sum of
the periods that make it up.

**Acceptance Scenarios**:

1. **Given** a day with a 30.00 daily allowance and 18.22 really spent, **When** savings are read,
   **Then** that day saved 11.78.
2. **Given** a day where 18.22 went on allowances and 20.00 more was spent as extra, **When** the
   day is read, **Then** it reports 11.78 saved, 20.00 extra, and 8.22 down on the day.
3. **Given** 40.00 spent against a 30.00 daily allowance and left as a projection, **When** savings
   are read, **Then** the daily allowance reports nothing saved and the weekly allowance shows
   10.00 consumed.
4. **Given** the same 40.00 confirmed as breakfast, **When** savings are read, **Then** the daily
   allowance reports 10.00 overspent and the weekly allowance is untouched.
5. **Given** those two cases, **When** the window's total saving is compared, **Then** it is
   identical — confirming moved which allowance bore the money, not how much was saved.
6. **Given** several weeks of payments, **When** total savings are read, **Then** the total is
   broken down into how much came from daily, weekly and monthly allowances, and the parts sum to
   the whole.
7. **Given** a month, **When** it is read, **Then** the projected saving, the actual saving and the
   extra spending are shown together.
8. **Given** a day in the past, **When** the cash projection is built, **Then** it uses what was
   really spent that day; **And** for a future day it uses the budgeted allowances.

---

### User Story 5 - The app tells me when my budget is wrong (Priority: P5)

Over time the app compares what was budgeted against what is actually spent, and proposes changes:
food has run at ₾10 a day against a ₾15 allowance for six weeks, so it suggests ₾10. Every
suggestion says what it is based on. Nothing changes until the owner accepts it.

**Why this priority**: The most valuable thing in the feature long-term, and impossible until
there is enough real spending to draw on.

**Independent Test**: Feed a stretch of history where one line item is consistently underspent and
confirm a suggestion appears naming the observed figure, the period it was measured over, and that
accepting it updates the budget while ignoring it changes nothing.

**Acceptance Scenarios**:

1. **Given** a line item consistently spent below its budget over a sustained period, **When**
   suggestions are read, **Then** a lower figure is proposed with the evidence behind it.
2. **Given** a line item consistently overspent, **When** suggestions are read, **Then** a higher
   figure is proposed on the same terms.
3. **Given** a suggestion, **When** the owner accepts it, **Then** the line item's budget changes;
   **And when** they dismiss it, **Then** nothing changes and it is not proposed again immediately.
4. **Given** a custom purpose that has recurred often enough to look like a habit, **When**
   suggestions are read, **Then** adding it as a budgeted line item is proposed.
5. **Given** too little history to be confident, **When** suggestions are read, **Then** none is
   offered, rather than one drawn from a handful of days.

---

### User Story 6 - I can shape the ladder (Priority: P6)

The order of the rungs is the whole mechanism, so the owner sets it — Breakfast before Lunch +
Dinner, not whatever order the list happens to return. They can also mark which line items are
settled by hand rather than by card.

**Why this priority**: Everything works with a default order; this makes it right for the owner
rather than merely consistent.

**Independent Test**: Reorder two rungs and confirm unconfirmed payments re-propose accordingly
while confirmed ones do not move.

**Acceptance Scenarios**:

1. **Given** a tier's line items in some order, **When** the owner reorders them, **Then** the
   order persists and unconfirmed payments re-propose to match, including on past days.
2. **Given** a confirmed payment, **When** the ladder is reordered, **Then** its decomposition does
   not change.
3. **Given** a line item, **When** the owner marks it settled by hand, **Then** it stops absorbing
   card payments while still counting towards its tier's budget.

---

### Edge Cases

- **A payment after midnight but before the day starts.** A 01:00 taxi belongs to the day that is
  ending, decided by the owner's day-start hour, not by the clock rolling over.
- **A week straddling a month end.** Overflow out of the weekly tier draws on the month the
  *spending day* falls in, not the month the week began in.
- **A financial month that does not start on the 1st.** With a month starting on the 7th, spending on
  3 September belongs to the month that began on 7 August.
- **The same message arrives twice.** A retried automation must not create a second payment.
- **A payment in a currency with no known rate.** Still counted — understating spending is the more
  dangerous error — but shown in its own currency and marked unconverted.
- **A tier with no line items** (the yearly tier today) is skipped rather than blocking the cascade.
- **A line item's budget is edited.** Unconfirmed payments re-propose against the new figure;
  confirmed ones do not move.
- **A confirmed payment is un-confirmed.** It returns to being a projection, and the allowances
  around it re-propose.
- **A confirmation that overspends its allowance.** The allowance goes negative and says so; the
  excess does not cascade, because the owner has said where the money went.
- **A confirmed payment sitting between unconfirmed ones.** Confirmations are placed first and the
  projections fill around them, so the result does not depend on the order decisions were made in.
- **Marking part of a payment not really spent after confirming it.** The confirmed decomposition
  is reduced proportionally, or the owner is asked to re-confirm.
- **Loyalty points, cashback, balances.** None is money spent and none may reach the ladder.
- **A message with a merchant but no readable amount.** Queued, not partly recorded.
- **The bank changes its wording.** Unrecognised messages are preserved verbatim, so nothing is
  lost while the parser catches up.
- **A custom purpose promoted to a line item.** Payments already given that purpose are not
  retrospectively pulled into the ladder; the line item applies from its start date.
- **A spread that does not divide evenly.** ₾10.01 across three days must come to ₾3.34, ₾3.34 and
  ₾3.33 — never three lots of ₾3.33 with a tetri lost, and never three lots of ₾3.34.
- **A spread reaching into the future.** Tomorrow's allowance is consumed before tomorrow arrives,
  so tomorrow correctly shows less to spend. The money still left the account today.
- **A spread crossing a month or week boundary.** Each day in the span consumes the allowance of
  the period *that day* falls in.
- **A confirmed line item is deleted.** Its allocations must not vanish with it; they surface as
  needing a decision and count as extra in the meantime.
- **Confirming more than the payment.** Allocations may never sum to more than what was really
  spent.
- **A confirmation undone.** The line item reopens to the cascade and the projections re-fill it.
- **A confirmation against a future day, or spread across days.** It closes that line item on each
  day it names, so tomorrow's breakfast correctly shows as already accounted for.
- **A forgotten second payment to a closed allowance.** It lands on the next allowance down rather
  than on the one it belonged to. This is the accepted cost of closing a rung; confirming it fixes
  it, and no total is wrong — only the attribution.
- **A planned one-off, like a credit-card payment or a family obligation.** It has no cadence, so it
  is no tier's rung and the cascade never reaches it — but the payment that settles it can still be
  confirmed against it, which is the only way that plan is ever closed out.

## Requirements *(mandatory)*

### Functional Requirements

**Capture**

- **FR-001**: System MUST accept a submitted bank message and record the payment it describes,
  authenticated by a token carried in the request rather than an interactive login.
- **FR-002**: System MUST refuse any submission with no token, an expired token, or a revoked
  token, recording nothing.
- **FR-003**: System MUST read, from a payment message: amount, currency, merchant, the last four
  digits of the card, and when the payment happened.
- **FR-004**: System MUST NOT record money coming in as spending, and MUST NOT place it in the
  ladder.
- **FR-005**: System MUST NOT treat loyalty points, cashback, loyalty balances or account balances
  as money spent.
- **FR-006**: System MUST store the original message text of every submission, recognised or not.
- **FR-007**: System MUST queue any message it cannot read confidently for the owner to complete,
  rather than recording a partial or guessed payment.
- **FR-008**: System MUST ignore a repeated submission of a message it has already recorded.
- **FR-009**: Users MUST be able to record a payment by hand, indistinguishable in behaviour from a
  captured one thereafter.
- **FR-010**: System MUST assign a payment to a day using the owner's day-start hour, so a payment
  made after midnight but before that hour belongs to the previous day.
- **FR-010a**: System MUST use the account balance some messages carry to verify its own record:
  chained per card, two consecutive balances must differ by exactly the payments captured between
  them, and any discrepancy means a message was missed.
- **FR-010b**: System MUST NOT present that balance to the owner as a balance, and MUST NOT
  reconcile any account from it. It covers one account of several across two banks, so as a balance
  it would be wrong; as a check on one card's own stream it is exact.
- **FR-010c**: System MUST record a suspected missed message with the amount and the window it
  falls in, and surface it alongside unread messages rather than leaving it in a log.

**What a payment was for**

- **FR-011**: System MUST record only what happened for each payment, never what it was for.
- **FR-012**: System MUST propose a decomposition of each payment against the ladder, and MUST
  present it as a projection rather than a fact.
- **FR-013**: System MUST recompute every unconfirmed proposal on read, so a change to the ladder
  or a budget is reflected in past days as well as today.
- **FR-013a**: System MUST place confirmed payments first and propose the unconfirmed ones against
  what remains, regardless of the order they were made in. A confirmation is a fact; a projection
  fills in around it.
- **FR-014**: Users MUST be able to confirm a decomposition as a *list* of allocations across
  several line items, after which those parts are concrete and MUST NOT change when the ladder or a
  budget changes.
- **FR-014a**: System MUST accept a confirmation covering only part of a payment, and MUST return
  the unaccounted remainder to the cascade as a projection.
- **FR-014b**: System MUST re-propose every unconfirmed payment whenever a confirmation changes
  what allowances remain, without the owner touching them.
- **FR-014g**: System MUST exclude a line item from the cascade, for the period a confirmation
  names, once any payment has been confirmed against it in that period — so a projection can never
  consume an allowance the owner has already accounted for.
- **FR-014h**: System MUST continue to accept further confirmations against that line item in that
  period, and MUST add them to what it has already consumed, because one meal can be two payments.
- **FR-014i**: System MUST report the unconsumed remainder of a closed line item as a saving for
  that period rather than as capacity still available to spend.
- **FR-014c**: Users MUST be able to say which day an allocation's allowance belongs to, which need
  not be the day the money left the account.
- **FR-014d**: Users MUST be able to spread one allocation evenly across a span of days, so a
  single payment can cover several days' allowances.
- **FR-014e**: System MUST divide a spread allocation so that its parts sum **exactly** to the
  amount spread, distributing any indivisible remainder rather than losing or inventing a minor
  unit.
- **FR-014f**: System MUST count a payment as real spending on the day the money left the account,
  and as allowance consumption on the day or days its allocations name, and MUST state which of the
  two any figure uses.
- **FR-015**: Users MUST be able to give a payment a custom purpose instead.
- **FR-016**: System MUST NOT consume any planned line item for a payment with a custom purpose,
  and MUST propose subsequent payments as though it had not touched the ladder.
- **FR-017**: Users MUST be able to promote a custom purpose into a budgeted line item at a chosen
  cadence, in one action.
- **FR-018**: Users MUST be able to mark part or all of a payment as not really spent — money paid
  back, or a refund — and the marked part MUST count as neither spending nor consumption.
- **FR-019**: Users MUST be able to undo a confirmation, returning the payment to a projection.
- **FR-019a**: System MUST surface, rather than silently drop, any confirmed allocation whose line
  item no longer exists, counting it as extra unplanned spending until the owner decides again.

**The ladder**

- **FR-020**: System MUST build the ladder from the budgeted expenses already kept by the cash-flow
  widget, grouped by how often they recur, and MUST NOT hold a second copy of them.
- **FR-020a**: System MUST offer a **planned one-off** expense as something a payment can be
  confirmed against, while keeping it out of the cascade — the same treatment as a line item settled
  by hand. A planned one-off is a specific intention, so a passing coffee must never consume it.
- **FR-020b**: System MUST exclude an inactive expense from the ladder entirely.
- **FR-021**: System MUST fill line items in an explicit order the owner controls, never in
  incidental list order.
- **FR-022**: System MUST fill each line item to its budgeted amount before moving to the next.
- **FR-023**: System MUST split one payment across several line items when it exceeds what remains
  on the current one, so the parts always sum to the whole.
- **FR-024**: System MUST cascade to the next tier when a tier is exhausted, in the order daily,
  weekly, monthly, yearly.
- **FR-025**: System MUST accumulate spending that exhausts every tier into extra unplanned
  spending for the month it falls in.
- **FR-026**: System MUST skip line items settled by hand when cascading, while still counting them
  towards their tier's budgeted total.
- **FR-027**: System MUST restore each tier at the start of its own period.
- **FR-027a**: System MUST take the day a financial month begins as a setting rather than assuming
  the 1st, because a budget month that resets before the salary arrives reports an allowance the
  account cannot fund. Defaulting it to the 1st keeps calendar months working unchanged.
- **FR-028**: Users MUST be able to reorder line items within a tier, and to mark one as settled by
  hand.

**Spending, savings and analysis**

- **FR-029**: System MUST report real spending for any day, week or month — what actually left the
  account, less anything marked not really spent.
- **FR-030**: System MUST report, for any day, week or month, three figures rather than one: what
  was saved against the allowances, what was spent outside them as extra, and the net of the two —
  what the period actually gained or lost.
- **FR-030a**: System MUST express an overspend as a negative figure rather than zero.
- **FR-030b**: System MUST report, for a month, the projected saving already known from income less
  budgeted spending, the actual saving, and the extra spending, so the three can be read together.
- **FR-031**: System MUST report total savings across all time, broken down by whether each part
  came from a daily, weekly or monthly allowance, such that the parts sum to the total.
- **FR-031a**: System MUST attribute a **projected** payment to the allowance that absorbed it, so
  a tier that overflowed reports no saving rather than a negative one — the overflow left that tier
  and belongs to the one below.
- **FR-031b**: System MUST attribute a **confirmed** payment to the allowance it was confirmed
  against, even when that takes the allowance past its budget, in which case that allowance reports
  the overspend as a negative figure.
- **FR-031c**: System MUST produce the same total saving for a window however its payments were
  decided. Confirming a payment moves which allowance bore it; it MUST NOT change what the window
  saved in total.
- **FR-032**: System MUST make every figure calculable for any point in time, without depending on
  a period having been closed or a total having been carried forward.
- **FR-033**: System MUST use real spending for past days and budgeted allowances for future days
  when projecting cash.
- **FR-034**: System MUST propose a revised budget for a line item whose real spending has
  differed from its budget consistently over a sustained period.
- **FR-035**: System MUST state the evidence behind every proposal — the observed figure and the
  period it was measured over.
- **FR-036**: System MUST NOT change a budget without the owner accepting the proposal.
- **FR-037**: System MUST NOT propose anything from too little history to be confident.
- **FR-038**: System MUST propose adding a budgeted line item for a custom purpose that has
  recurred often enough to look like a habit.

**Currency**

- **FR-039**: System MUST compare payments to budgets in one currency, converted at the rate in
  force on the payment's own day.
- **FR-040**: System MUST still count a payment it cannot convert, showing it in its own currency
  and marking it unconverted rather than implying comparability.

**Tokens**

- **FR-041**: Users MUST be able to create an ingest token with a label and an expiry.
- **FR-042**: System MUST show a new token in full exactly once and never again.
- **FR-043**: System MUST NOT store a token in any form from which it can be recovered.
- **FR-044**: System MUST record and show when each token was last used, so the owner can tell the
  automation is still running.
- **FR-045**: Users MUST be able to revoke a token immediately.
- **FR-046**: System MUST limit how often submissions are accepted, so a leaked token cannot flood
  the record.

**Presentation**

- **FR-047**: System MUST present a line item that has **not** been confirmed as a marker along a
  filling ladder, never as a checklist entry, because for a projection the name records which
  allowance was consumed and not what was bought.
- **FR-047a**: System MUST distinguish a **confirmed** line item, which the owner has stated the
  truth about and which may legitimately read as settled, from a projected one — and MUST show its
  unconsumed remainder as saved rather than as still available.
- **FR-048**: System MUST show, for each payment, which line items it was decomposed against and
  in what amounts, and whether that decomposition is a projection or confirmed.
- **FR-049**: System MUST label spending figures drawn from captured payments as reflecting
  captured payments only, and therefore as a lower bound.
- **FR-050**: System MUST surface unread messages where the owner will see them.

### Key Entities

- **Payment**: What happened — when, how much, in which currency, at which merchant, on which card,
  how it arrived (captured or entered), and the original message. Carries what part of it was not
  really spent. Never carries what it was for.
- **Decision** *(on a payment)*: Absent, confirmed, or a custom purpose. A confirmation is a list
  of allocations — each naming a line item, an amount, and the day or span of days whose allowance
  it consumes — and may cover only part of the payment, the remainder returning to the cascade. A
  custom purpose replaces the decomposition entirely and consumes no allowance.
- **Ingest token**: A credential permitting submission on the owner's behalf. Label, expiry, last
  used, revoked. Never recoverable after creation.
- **Budgeted line item** *(existing expense, extended)*: Gains its position in its tier's order and
  whether it is settled by hand.
- **Ladder** *(derived)*: The tiers, their line items in order, what each has absorbed on a given
  date, and what overflowed. Computed on read.
- **Decomposition** *(derived, or frozen once confirmed)*: How one payment divides across line
  items.
- **Budget proposal** *(derived)*: A suggested figure for a line item, with the observed spending
  and window behind it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A card payment appears in the app within a minute, with no action by the owner.
- **SC-002**: Over a week of ordinary spending, at least 95% of payments the bank reported are
  recorded without hand-entry.
- **SC-003**: Every message received is either recorded or visibly queued; none is silently lost.
- **SC-003a**: A message that never arrived is detected on the day it happens, and the amount
  reported for it is exactly the amount of the missing payment.
- **SC-004**: The owner can tell how much of today's allowance remains within five seconds of
  opening the app, without navigating.
- **SC-005**: A payment's decomposition always sums exactly to the payment, less anything marked
  not really spent, to the minor unit.
- **SC-006**: Real spending reported for any day, week or month equals the sum of the payments in
  it, less anything marked not really spent, exactly.
- **SC-007**: Total savings equals the sum of the per-period savings that make it up, and its
  daily, weekly and monthly parts sum to the whole.
- **SC-008**: Reordering the ladder leaves total real spending for any past period unchanged.
- **SC-008a**: Over a window containing every day a payment's allocations touch, confirming or
  un-confirming it leaves the total saved unchanged, moving only which allowance — and which day —
  is shown as bearing it.
- **SC-008b**: A spread allocation's parts sum exactly to the amount spread, for any number of days
  and any amount.
- **SC-008c**: Confirming a payment against an allowance never lets a later projection consume that
  allowance's remainder, and never prevents another payment being confirmed against it.
- **SC-009**: Confirming a payment takes one action; giving it a custom purpose takes under fifteen
  seconds; promoting that purpose to a budget line takes one more action.
- **SC-010**: A budget proposal names the observed figure and the window behind it, every time.
- **SC-011**: An expired or revoked token is refused every time, and a token's value cannot be
  recovered from the system after creation.

## Assumptions

- **One owner, two banks, three currencies.** The formats supported are the owner's two banks; a
  third bank is a new parser, not a new design.
- **The banks keep sending SMS.** If one moved to in-app push only, capture for it would end and
  hand-entry would carry it.
- **Capture is best-effort and says so.** A phone automation can miss a message, so every figure
  drawn from captured payments is labelled a lower bound.
- **Money coming in is not tracked.** Transfers and refunds are skipped rather than modelled:
  recurring income is already owned by the cash-flow widget, and a transfer from someone else is
  not spending. Where money coming in *offsets* a payment, it is recorded on that payment as not
  really spent rather than as an inflow of its own.
- **Merchant is recorded but never interpreted.** It is shown so the owner recognises a payment. It
  deliberately plays no part in proposing what the payment was for, because the same shop sells
  dinner one visit and a vase the next.
- **Unconfirmed is the normal state.** Most payments are never touched; the proposal is good enough
  most of the time, and confirming is for when it matters.
- **A token must carry an expiry.** A non-expiring credential for a route that writes financial
  records is not offered.
- **Tiers restore independently.** A daily allowance is whole each day whether or not the weekly
  tier was drawn on yesterday.
- **This feature sets no budgets.** It reads the ones already kept in the cash-flow widget, and
  proposes changes to them.

## Deliberately rejected

- **Guessing a purpose from the merchant.** Rejected on the owner's evidence: the same supermarket
  sells prepared dinner one visit and a vase the next, and one dinner was for someone else. A
  merchant does not predict a purpose, so it is not used to.
- **Using the bank's balance line to reconcile the account.** One bank prints an account balance in
  every message, but it covers one of several accounts across two banks, so it is not *the* balance
  and treating it as one would be wrong. It is kept for a different job — see FR-010a — where being
  one card's own running total is exactly what makes it work.
- **Tracking refunds as events.** A refund is recorded by marking the original payment as not
  really spent, rather than as a transaction of its own that unwinds allocations in reverse.

## Dependencies

- The **cash-flow widget's expenses**, which are the ladder, and which this feature proposes
  changes to.
- The **exchange-rate module**, for comparing payments in lari to budgets in dollars at the rate in
  force on the payment's own day.
- The owner's **day-start hour**, already kept for deciding which day a meal belongs to.
- The owner's **phone automations**, configured outside the app, which are the only source of
  captured payments.

## Note for the constitution

The owner's framing — *"any point in time should be calculatable"* — is a sharpening of principles
III and V rather than a new rule, but it is the sentence that explains why this feature stores a
payment and derives everything else. Worth adding to the constitution via `/speckit-constitution`
rather than being left in a feature spec.
