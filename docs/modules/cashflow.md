# Module: cashflow (Widget 2 — Free money)

Answers one question well: *on any date, how much will I have, how much is already spoken for,
and how much is genuinely mine to spend?*

**Code:** `apps/api/src/cashflow/` · `apps/web/src/app/cashflow/page.tsx`
**Domain logic:** `libs/shared/domain/src/lib/cash-projection.ts`, `recurrence.ts`

## Collections

| Collection | Purpose |
| --- | --- |
| `cash_balances` | Manual reconciliations. One row per `asOf` day; re-saving the same day corrects it. |
| `income_sources` | Recurring inflows. The salary: monthly, day 7. |
| `expenses` | Recurring and one-off outflows. |

## Projection

`projectCash()` starts at the **latest reconciliation**, not at today. If the balance was last
confirmed a week ago, that week's expenses are part of the forecast rather than silently
assumed to have already been deducted. It then walks day by day to the horizon, producing a
`CashProjectionDay` per date with its events.

`monthlyRecurringIn/OutCents` are approximations via `monthlyEquivalentCents()` (daily × 30.4375,
weekly × 4.348, yearly ÷ 12) for the headline figure only. The day-by-day walk is the authority.

## Free money — the important formula

For a target date:

```
projectedBalanceCents          = closing balance on that date
nextIncomeDate                 = first inflow strictly after it
committedBeforeNextIncomeCents = Σ outflows in (date, nextIncomeDate)   ← exclusive both ends
freeCents                      = projectedBalance − committedBeforeNextIncome
```

The window **excludes the income day itself**. The loan repayment falls on the 7th and so does
the salary; it is funded by that salary. Counting it against the balance held on the 3rd would
understate free money by a whole month of obligations.

`lowestBalanceCents`/`Date` report the dip between today and the target date, because a healthy
closing balance can hide a near-zero moment mid-period. `firstShortfallDate` is the first day
the projection goes negative at all.

## Recurrence

`occurrencesBetween()` expands a schedule inside a window. Two things it gets right:

- **Day-of-month clamping.** A 31st schedule yields 28/29 February, not a spill into March.
- **Fast-forward.** It jumps to the first occurrence on or after the window start rather than
  stepping from `startDate`, so a daily expense started in 2015 costs a handful of iterations,
  not four thousand. Capped at 5,000 occurrences as a backstop.

`endDate` is **inclusive**.

## Cross-links

- **→ loans** — `linkedExpenseAmounts()` returns `{ expenseId: amountCents }` for every active
  loan-linked expense. This is the source of truth for recurring repayment amounts.
- **← personal** — `syncPersonalPlanExpense()` creates/updates/deletes the one-off expense
  mirroring a personal plan. Called after every personal-plan write, so the two cannot drift.
- **→ dashboard** — `summary()` provides balance, free-today, next-salary and monthly net.

## Endpoints

```
GET    /api/cashflow                      everything the page needs; ?to= ?snapshotDate=
GET    /api/cashflow/summary
GET    /api/cashflow/snapshot?date=        the three planning numbers for one date
GET    /api/cashflow/balance
PUT    /api/cashflow/balance               upsert by asOf day
GET    /api/cashflow/incomes
POST   /api/cashflow/incomes
PATCH  /api/cashflow/incomes/:id
DELETE /api/cashflow/incomes/:id
GET    /api/cashflow/expenses
POST   /api/cashflow/expenses
PATCH  /api/cashflow/expenses/:id
DELETE /api/cashflow/expenses/:id
```

Default projection horizon is 12 months from today; `defaultHorizon()` in the domain lib is
365 days for callers that do not specify.

## Seeded state

An `EPAM salary` income source, monthly on the 7th, **with `amountCents: 0`** — deliberately,
because the real figure is not known and a fabricated salary would silently corrupt every
projection on the dashboard. The UI flags it in amber until it is set. Also a zero cash balance
as of the seed date, and the $1,000/mo loan repayment expense.

## Open questions

- Multi-currency: `convertCents()` and a static `fxRates` table exist in settings, but the
  projection assumes a single currency. Mixing GEL and USD expenses would need conversion at
  the event level.
- No actuals-vs-plan tracking. The projection is entirely forward-looking; there is no import
  of real transactions to compare against.
