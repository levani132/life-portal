# Module: cashflow (Widget 2 — Free money)

Answers one question well: *on any date, how much will I have, how much is already spoken for,
and how much is genuinely mine to spend?*

**Code:** `apps/api/src/cashflow/` · `apps/web/src/app/cashflow/page.tsx`
**Domain logic:** `libs/shared/domain/src/lib/cash-projection.ts`, `recurrence.ts`

## Collections

| Collection | Purpose |
| --- | --- |
| `cash_balances` | Manual reconciliations. One row per `asOf` day; re-saving the same day corrects it. |
| `income_sources` | Recurring inflows. The salary: monthly, day 7. Plus `arrivalOverrides`, below. |
| `expenses` | Recurring and one-off outflows. |

### Arrival overrides — the salary paid early

The salary often lands before a weekend or holiday. `income_sources.arrivalOverrides` is a list of
`{ scheduledDay, actualDay }` pairs, each **moving** one scheduled occurrence to the day the money
really arrived (or is known to be arriving). Moving rather than adding is the invariant: captured
bank credits never feed the projection (see below), so the budgeted occurrence is the only copy of
that payday, and duplicating it would double the month's income.

`incomeOccurrences()` in the domain lib expands the schedule and applies the overrides — the
expansion window is padded by the largest shift so an occurrence moved into the window from just
outside it is still found. `nextIncomeDay()` answers "when does money next arrive" the same way,
which is what stops a salary already received early from being reported as the *next* one. Both
the projection and `summary()` go through these, so the free-money window closes on the real
arrival date automatically. The UI is *landed on another day?* on each income row; saving PATCHes
the whole `arrivalOverrides` array, and `[]` clears every override.

Realised sales are **not** a collection — see below.

## Real spending feeds the projection

Days at or before *today* prefer what was actually spent — captured card payments from the
spending module — over the budgeted figure, with one rule that keeps it safe: **actuals replace
only the `auto` card-spending budget.** Manual-settlement lines (the loan repayment, utilities)
and one-off expenses are money SMS capture cannot see, so they stay counted beside the actuals; a
past day with nothing captured keeps its whole budget, because silence is not evidence of thrift.
Captured *credits* never feed the projection at all — the salary arrives as a bank message too,
and counting both it and the budgeted income source would double every payday.

## Projection

**`currentBalanceCents` is derived, not read.** `summary()` returns the projection's closing
balance for *today*, not the last reconciled figure — the reconciliation is only the anchor
(principle III). `reconciledBalanceCents` + `balanceAsOf` carry the confirmed figure so the UI can
show both and mark the derived one as an estimate. Returning the raw reconciliation meant "on hand
now" still showed the balance from the day the user last checked, ignoring a salary that had since
landed.

`firstShortfallDate` only looks from **today onward**. The window between the last reconciliation
and today is history; warning that you ran out of money last Tuesday is noise and hides whether a
shortfall is still coming.

`projectCash()` starts at the **latest reconciliation**, not at today. If the balance was last
confirmed a week ago, that week's expenses are part of the forecast rather than silently
assumed to have already been deducted. It then walks day by day to the horizon, producing a
`CashProjectionDay` per date with its events.

`monthlyRecurringIn/OutCents` are approximations via `monthlyEquivalentCents()` (daily × 30.4375,
weekly × 4.348, yearly ÷ 12) for the headline figure only. The day-by-day walk is the authority.

## Realised sales

Cash from things already sold is derived, never stored (principle III). `realisedSales()` in
`libs/shared/domain/src/lib/realised-sales.ts` reads the `sold*` fields off `sellable_items` and
`stock_lots` and returns one `RealisedSale` per sale:

- an item counts once it is `status: 'sold'` with a `soldAt` and a non-zero `soldPriceCents`;
- a lot counts once it has `soldAt`, `soldQuantity` and `soldPricePerShareCents` — gross proceeds
  are `soldQuantity × soldPricePerShareCents`, before tax, which is settled elsewhere.

**Earmarked proceeds are excluded from the inflow.** With `allocateToLoanId` set, that share of the
money is the loans widget's; counting it as spendable cash too would double-count it (principle
IV). `amountCents` is therefore the unearmarked share and `grossCents` the full figure. A fully
earmarked sale nets to zero and produces no cash event; the day panel still lists it, at `$0`.

A sale dated before `balanceAsOf` falls outside the projection window and is ignored — the
reconciled balance already contains that cash. Same rule as expenses.

## Free money — the important formula

For a target date:

```
projectedBalanceCents          = closing balance on that date
nextIncomeDate                 = first *income source* occurrence strictly after it
committedBeforeNextIncomeCents = Σ outflows in (date, nextIncomeDate)   ← exclusive both ends
freeCents                      = projectedBalance − committedBeforeNextIncome
```

Income *sources* only: a sale is cash, but it is not a payday, and letting one close the window
would drop every obligation between the sale and the real salary out of committed spending.

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

## Page layout

Top row (two thirds / one third): the day-by-day projection chart (sampled weekly) and the
**On a specific date** planning panel, beside income, the category breakdown and runway.

Picking a date there does **not** refetch. The page loads `/cashflow` once with a constant SWR
key and recomputes the three numbers locally with `snapshotAt(projection, date, today)` — the same
pure function the API calls. Keying the request on the date meant every date change hit a key with
no cache, which made `isLoading` true and replaced the entire page with a spinner. For the same
reason the loading guard is `isLoading && !data`: a revalidation after a write must not tear the
page down and lose each panel's local state. `?snapshotDate=` still exists on the endpoint for
`/cashflow/snapshot` callers.

Below it, full width:

- **Recurring spending** — one panel per `Recurrence.cadence`: Daily, Weekly, Monthly, Yearly,
  side by side, each with its entry count, monthly equivalent, and a `+` that opens the add form
  already set to that cadence (an empty panel offers the same thing as its empty state). A recurring row with no
  `recurrence` lands in a fifth "No schedule" panel that appears only when non-empty — dropping it
  silently would hide money. The section header carries the total monthly equivalent.
- **One-off spending** — `kind === 'one_off'` rows for one month at a time, chosen with an
  `<input type="month">` (‹ › steppers, plus a jump list of the months that have entries).
  Filtering is a `date.startsWith(month)` prefix match, exact because calendar dates are
  `YYYY-MM-DD` strings. The total counts active rows only, so it agrees with the projection. Its
  `+` opens the add form dated into the month on screen, not into today.
- **State on a specific day** — opening / in / out / closing for one day, then everything that
  lands on it: salary, recurring spending, one-offs and sale proceeds. Each row's label is
  resolved from the source row via `CashEvent.sourceId`.

  Its date picker takes **any** date, past included, because the rows are rebuilt in the browser
  with `buildCashEvents()` — the same pure function the projection uses — over the `incomes`,
  `expenses` and `sales` in the payload. Balances cannot go back before the last reconciliation,
  so for earlier days opening/closing read `—` and only the movements are shown. This panel has
  its own date state; the forward-only planning panel above keeps `snapshotDate`.

Everything reads from the single `GET /api/cashflow` payload — which is why `sales` ships with it:
the day panel can then rebuild any date without another round trip.

## Cross-links

- **→ loans** — `linkedExpenseAmounts()` returns `{ expenseId: amountCents }` for every active
  loan-linked expense. This is the source of truth for recurring repayment amounts.
- **← personal** — `syncPersonalPlanExpense()` creates/updates/deletes the one-off expense
  mirroring a personal plan. Called after every personal-plan write, so the two cannot drift.
- **← items** and **← stocks** — `sales()` derives realised-sale inflows from sold items and sold
  lots via `realisedSales()`. Read-only: cashflow never writes to either collection.
- **→ dashboard** — `summary()` provides balance, free-today, next-salary and monthly net.

## Endpoints

```
GET    /api/cashflow                      everything the page needs, incl. `sales`; ?to= ?snapshotDate=
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
