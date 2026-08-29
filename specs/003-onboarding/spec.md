# Feature Specification: Onboarding and re-baselining

**Feature Branch**: `003-onboarding`

**Created**: 2026-08-29

**Status**: Draft — not scheduled. Written now so the decisions it depends on are made while the
spending waterfall is still being built.

**Input**: Get a person from an empty account to a dashboard that tells the truth, and let someone
already using the app put it back in touch with reality when it drifts.

## Why this exists

Two audiences, and the second is the surprising one.

**A new person** signs in and sees a dashboard of zeroes. Nothing tells them what to enter first,
and the things worth entering — a salary, a balance, the spending they expect — live on three
different screens behind four different buttons.

**The person already using it** has the opposite problem, and it is the owner's own words:

> I'm having some second thoughts about how I'll move on to using this feature, especially since I
> was using it with only budgeted spendings and I think I wrote some initial money when I started
> it, but now it clearly shows very incorrect amount, very different from what I really have.

A balance entered once and never revisited quietly poisons everything downstream, because the
projection is anchored to it. Onboarding is therefore not a one-time gate — it is a **flow that can
be re-run**, in whole or in part, whenever the numbers stop matching life.

## The decision this feature forces

**When does a financial month start?**

The owner's salary lands on the 7th and every monthly budget line is dated the 7th. If the monthly
allowance resets on the 1st while the money arrives on the 7th, there is a six-day window each month
where the app says the budget is fresh and the bank says otherwise.

This is not only an onboarding question. **The spending waterfall's monthly tier is defined as "the
calendar month of the spending day"**, and if the financial month runs 7th→6th that definition is
wrong. Whichever way this is settled, `002-spending-waterfall` has to agree with it — see
[the cross-feature note](#cross-feature-consequences).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - From empty to useful in a few minutes (Priority: P1)

A new person signs in and is walked through the smallest set of facts that makes the dashboard mean
something: what they earn and when, what is in the account now, and roughly what they expect to
spend. They are told plainly that all of it is editable later, so nothing needs to be exact.

**Why this priority**: Without it the app is a set of empty widgets with no obvious first move.

**Independent Test**: Register a fresh account, complete the flow, and confirm the dashboard shows a
believable balance, a projection that reaches the next payday, and a spending ladder with rungs on
it — with nothing else touched.

**Acceptance Scenarios**:

1. **Given** a newly registered account, **When** the person signs in, **Then** they are offered the
   setup flow rather than an empty dashboard.
2. **Given** the flow, **When** they enter a salary, a payday, a current balance and a display
   currency, **Then** the projection reaches the next payday with a believable figure.
3. **Given** the spending step, **When** they accept the suggested starter allowances, **Then** a
   daily, weekly and monthly ladder exists and is immediately editable.
4. **Given** any step, **When** they choose to skip it, **Then** they reach the dashboard and the
   skipped step remains offered rather than lost.
5. **Given** a part-finished flow, **When** they return later, **Then** it resumes where they left
   off rather than starting again.

---

### User Story 2 - Put it back in touch with reality (Priority: P2)

Someone who has been using the app for months finds the balance badly wrong. They re-run the money
step alone: confirm what is actually in the account today, and everything downstream re-anchors. No
history is rewritten and nothing else is disturbed.

**Why this priority**: This is the owner's problem *today*, and it is the difference between a
figure being trusted and being quietly ignored.

**Independent Test**: With months of data, re-run the balance step with a new figure and confirm the
projection re-anchors from that day forward while past records are untouched.

**Acceptance Scenarios**:

1. **Given** an existing account, **When** the person re-runs the money step, **Then** they may
   correct the balance without re-entering their salary or budgets.
2. **Given** a corrected balance, **When** the dashboard is read, **Then** the projection starts from
   it and no past record has changed.
3. **Given** a badly stale balance, **When** the dashboard is read, **Then** it says how long ago the
   figure was confirmed and offers to re-check it.

---

### User Story 3 - Set up message capture and see it working (Priority: P3)

The setup step for bank-message capture: mint an ingest token, give copy buttons for the URL and the
token, spell out the automation steps, and then **wait and confirm** — the page shows when the first
message arrives, so the person knows it works rather than hoping.

**Why this priority**: The spending waterfall is unusable without capture, and a silent setup failure
looks exactly like a quiet month.

**Independent Test**: Follow the steps on a phone, send one message, and confirm the page moves from
"waiting" to "received" without a refresh.

**Acceptance Scenarios**:

1. **Given** the capture step, **When** it is opened, **Then** a token is offered along with the
   exact values to paste and the steps to follow.
2. **Given** a token has been created but never used, **When** the step is shown, **Then** it says
   capture is not yet working.
3. **Given** a first message arrives, **When** the step is open, **Then** it confirms receipt and
   shows what was captured.
4. **Given** the person has no compatible bank, **When** they skip the step, **Then** the rest of the
   app works and manual entry is offered instead.

---

### User Story 4 - Nothing is a dead end (Priority: P4)

Every step is skippable, resumable and re-runnable. The dashboard surfaces what is still missing —
no balance, no income, no allowances — as an invitation rather than an error.

**Why this priority**: A flow that must be completed in one sitting will be abandoned in one sitting.

**Acceptance Scenarios**:

1. **Given** an incomplete setup, **When** the dashboard is read, **Then** what is missing is named,
   with a way to supply it.
2. **Given** a completed setup, **When** the dashboard is read, **Then** nothing nags.

---

### Edge Cases

- **More than one income.** Two salaries, or a salary and a side income, on different days of the
  month. The schema already supports several income sources; the flow must not assume one.
- **Paid weekly, or twice a month.** A payday is not always a day of the month.
- **A salary in one currency and a life in another** — the owner's own case. The flow must let the
  two differ without either being wrong.
- **Someone with no regular income at all.**
- **A person who skips everything** and starts entering data by hand. Nothing may block them.
- **Re-running the flow after months of use.** It must correct, never reset — no past record is
  rewritten, and no existing budget line silently replaced.
- **A starter allowance the person does not want.** Suggested rungs are a starting point, and
  declining them must leave nothing behind.
- **A balance entered in the wrong currency** and corrected afterwards.

## Requirements *(mandatory)*

### Functional Requirements

**The flow**

- **FR-001**: System MUST offer a guided setup to an account that has no income, no balance and no
  budgeted spending.
- **FR-002**: System MUST allow every step to be skipped, and MUST keep a skipped step available
  rather than discarding it.
- **FR-003**: System MUST resume a part-finished flow where it was left.
- **FR-004**: System MUST allow any step to be re-run at any later time, independently of the others.
- **FR-005**: System MUST NOT block access to the rest of the app at any point in the flow.
- **FR-006**: System MUST tell the person that everything they enter is editable later.

**What it collects**

- **FR-007**: System MUST collect the currency figures are displayed in.
- **FR-008**: System MUST collect at least one income, its amount, its currency and when it arrives,
  and MUST support more than one.
- **FR-009**: System MUST support incomes that arrive other than monthly.
- **FR-010**: System MUST collect the current account balance, its currency, and the day it is true
  for.
- **FR-011**: System MUST collect the day a financial month begins, defaulting to the day income
  arrives.
- **FR-012**: System MUST collect the day a week begins.
- **FR-013**: System MUST offer a starter set of daily, weekly and monthly allowances that the person
  can edit or decline, and MUST create nothing they declined.
- **FR-014**: System MUST let the person set up bank-message capture, and MUST make skipping it
  harmless.

**Re-baselining**

- **FR-015**: System MUST let the balance be re-confirmed without re-entering anything else.
- **FR-016**: System MUST NOT alter any past record when the flow is re-run.
- **FR-017**: System MUST show how long ago the balance was confirmed, and MUST prompt for a re-check
  once it is old enough to be untrustworthy.

**Capture setup**

- **FR-018**: System MUST provide the exact values needed for the phone automation in a form that can
  be copied in one action.
- **FR-019**: System MUST report whether capture has ever succeeded, and MUST confirm the first
  message when it arrives.
- **FR-020**: System MUST make clear that a message is tied to the account whose token signed it, so
  one person's payments can never reach another's ledger.

**Prompting**

- **FR-021**: System MUST surface what setup is still missing on the dashboard, as an invitation
  rather than an error.
- **FR-022**: System MUST stop prompting once setup is complete.

### Key Entities

- **Setup progress**: which steps have been completed, skipped or never seen. Enough to resume and to
  know whether to prompt. Not a copy of the answers — those live in the widgets that own them.
- **Financial month start** *(new setting)*: the day of the month a budgeting month begins.
- **Week start** *(new setting)*: the day a budgeting week begins.

Everything else the flow collects is written to the collection that already owns it — income
sources, cash balances, expenses, settings. **The flow owns no financial data of its own** (principle
IV); it is a path through screens that already exist.

## Success Criteria *(mandatory)*

- **SC-001**: A new person reaches a dashboard showing a believable balance and a projection to the
  next payday in under five minutes.
- **SC-002**: Completing the flow requires no visit to any other screen.
- **SC-003**: Correcting a stale balance takes under thirty seconds and touches nothing else.
- **SC-004**: Re-running any step leaves every past record byte-identical.
- **SC-005**: A person who skips every step still reaches a fully usable app.
- **SC-006**: After setting up capture, the person learns within one minute of their next card
  payment whether it is working.
- **SC-007**: The dashboard names every missing piece of setup, and names nothing once complete.

## Cross-feature consequences

**This spec changes `002-spending-waterfall`.** FR-011 makes the start of a financial month a
setting. The waterfall currently defines its monthly tier as *"the calendar month of the spending
day"* ([contracts/domain.md](../002-spending-waterfall/contracts/domain.md)), which is only correct
when a financial month starts on the 1st.

Both features must read the same setting. Since 002 is being built first, it should take the setting
now — defaulting to 1 preserves today's behaviour exactly, so nothing is blocked on this spec being
scheduled, and nothing needs rewriting when it is.

The same applies to `weekStartsOn`, which 002 already introduces. 003 collects it rather than
defining it.

## Assumptions

- **Registration stays invite-gated.** This flow is about the first minutes *after* an account
  exists, not about opening the app to the public.
- **The flow guides, it does not own.** Every answer is written to the widget that already owns that
  fact, so the same figure can be edited afterwards from its own screen.
- **Nothing is mandatory.** A person with no salary, no compatible bank and no interest in budgets
  should still find the app usable.
- **Starter allowances are suggestions, not defaults.** They are shown as a proposal to accept or
  decline; declining creates nothing.
- **Setup is a state, not an event.** It can be incomplete, complete, or complete-but-stale, and the
  stale case is the one that matters most in practice.

## Dependencies

- **cashflow** — owns income sources, balances and expenses, which is everything the money steps
  write.
- **settings** — owns display currency, payday, and the new month and week starts.
- **002-spending-waterfall** — owns ingest tokens and the capture setup page this flow links to, and
  owns the ladder the starter allowances create.

## Open questions

1. **Does the financial month start on payday or on the 1st?** Affects 002 directly. Defaulting the
   setting to the 1st is safe either way, so this can be answered later without blocking anything.
2. **Is the flow a full-screen wizard or a checklist on the dashboard?** A wizard suits a new person;
   a checklist suits re-baselining, which is the more common case over an account's life. A checklist
   whose items open focused steps may serve both.
