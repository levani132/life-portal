# Module: loans (Widget 1 — Debts)

Tracks money owed to other people. Built for many debts with an explicit repayment priority,
not for one hard-coded loan.

**Code:** `apps/api/src/loans/` · `apps/web/src/app/loans/page.tsx`
**Domain logic:** `libs/shared/domain/src/lib/loan-scenarios.ts`, `summaries.ts`

## Collections

| Collection | Purpose |
| --- | --- |
| `loans` | The debt itself: lender, `principalCents`, `startDate`, `interestRate`, `priority`, `status`. |
| `loan_payments` | Payments that actually happened. Immutable in spirit. |
| `repayment_plans` | *Intentions*, not history. Feed the scenario engine. |

**`loans` never stores a remaining balance.** It is folded on read as
`principalCents − Σ payments`, clamped at zero (principle III). Back-dated payment edits are
therefore correct for free, and `status` is reconciled in both directions after every payment
write by `closeIfRepaid()` — deleting a payment reopens a loan that was marked paid.

## Recorded versus expected

`remainingCents` counts **recorded payments only**. Plans are intentions; treating one as history
would understate a real debt.

But the recurring plan's linked expense leaves the cash projection every month whether or not a
payment is recorded, so the two widgets can end up disagreeing about the same dollar.
`loanBalance()` in `libs/shared/domain/src/lib/loan-balances.ts` reconciles them:

| Field | Meaning |
| --- | --- |
| `unrecordedScheduledCents` | Instalments from enabled, **guaranteed** plans that have fallen due with no recorded payment to cover them. Capped at the outstanding balance. |
| `unrecordedScheduledCount` / `FromDate` | How many, and the earliest one still unaccounted for. |
| `expectedRemainingCents` | `remaining − unrecordedScheduled`: what is owed if the plan was kept to. An estimate, marked as one in the UI. |

Recorded payments are credited to instalments oldest-first, and only payments dated **on or after
the first scheduled date** count — an opening-balance adjustment predating the schedule is already
in `remaining` and must not be spent twice. Item and share plans never appear: they are
possibilities, not commitments. Scenarios still start from `remainingCents`, never the estimate.

The Debts screen shows the gap as an amber note with a prefilled "record it as paid" action, so the
figures converge on the truth by the user confirming what happened rather than by the app guessing.

## Plan kinds

| `kind` | Amount comes from | Counted in "salary only"? |
| --- | --- | --- |
| `recurring` | `linkedExpenseId` → the cash-flow expense, else `amountCents` | yes, if `guaranteed` |
| `one_off` | `amountCents` on `date` | yes, if `guaranteed` |
| `items` | derived: items earmarked for this loan | no |
| `stocks` | derived: lots earmarked for this loan, at target price | no |

`items` and `stocks` plans carry **no amount**. They resolve against live widget data on every
read, so they stay correct as holdings change. This is why the seed can create them once and
never touch them again.

## The interlink

A recurring plan created with `createLinkedExpense: true` also creates an `Expense` with
`category: 'loan'` and `linkedLoanId`, and stores its id as `linkedExpenseId`. **The expense
owns the amount.** `resolvePlanAmountCents()` reads from it; the plan's own `amountCents` is a
fallback for when the expense has been deleted.

Editing the amount from the Debts screen writes through to the expense
(`LoansService.updatePlan`). Editing it from Free money edits the same row directly. There is
no synchronisation code because there is nothing to synchronise.

## Scenarios

`buildLoanScenarios()` returns three, all simulating month by month with interest accrued
monthly, payments capped at the outstanding balance, and a 120-month modelling horizon.

| Key | Label | Items priced at | Shares priced at | Sale timing |
| --- | --- | --- | --- | --- |
| `best` | Everything sells at target | asking | target | items +1mo (or `expectedSaleDate`), shares at target horizon |
| `expected` | Realistic | realistic | market now | items +3mo, shares +1mo |
| `worst` | Salary only | — | — | nothing sells |

**`best` can finish later than `expected`.** Waiting for the target price recovers more money
but takes longer than selling today. See `docs/DECISIONS.md`; there is a test asserting it.

`behindSchedule` is true when `targetPayoffDate` is set, money is still owed, and the
salary-only case either misses that date or never pays off at all.

## Endpoints

```
GET    /api/loans                    every loan with detail + summary
GET    /api/loans/summary
GET    /api/loans/:id                LoanDetail: balances, plans, inflows, scenarios
POST   /api/loans
PATCH  /api/loans/:id
DELETE /api/loans/:id                cascades payments + plans; unlinks (keeps) expenses
PUT    /api/loans/priority           { order: string[] } — bulk reorder
GET    /api/loans/:id/payments
POST   /api/loans/:id/payments
PATCH  /api/loans/payments/:paymentId
DELETE /api/loans/payments/:paymentId
GET    /api/loans/:id/plans
POST   /api/loans/:id/plans          { createLinkedExpense?: boolean }
PATCH  /api/loans/plans/:planId      amount writes through to the linked expense
DELETE /api/loans/plans/:planId      ?keepExpense=true to keep the budget line
```

## Cross-links

- **← cashflow** — `linkedExpenseAmounts` supplies recurring plan amounts, and the same figures
  drive `loanBalance()`'s expected-versus-recorded reconciliation.
- **← items** — `itemsProceedsForLoan()` supplies expected/pessimistic/optimistic proceeds.
- **← stocks** — `proceedsForLoan()` supplies net-of-tax proceeds now and at target.
- **→ dashboard** — `summary()` provides the focus loan and its payoff dates.

## Seeded state

One loan: lender "Friend", $17,000 principal, 0% interest, priority 1, with a $6,500 opening
payment leaving $10,500 outstanding. Three plans: salary (guaranteed, $1,000/mo on the 7th,
linked to an expense), items, stocks.

## Open questions

- Should surplus money auto-allocate across loans by `priority`? The field exists and sorts the
  list, but nothing spends against it automatically yet.
- Interest accrues monthly on the outstanding balance. Fine for 0% and for simple informal
  loans; a real amortising loan would need a schedule.
