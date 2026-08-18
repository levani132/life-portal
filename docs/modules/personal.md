# Module: personal (Widget 8 — Personal life)

Activities, date nights, trips, goals and travel history — plus automatic budgeting of what they
cost.

**Code:** `apps/api/src/personal/personal.module.ts`
**Domain logic:** `summarisePersonal()`, `personalPlanDate()` in `shared-domain/summaries.ts`

## Collection: `personal_plans`

One row covers everything the brief asked for, distinguished by `type`
(`activity` · `date_night` · `trip` · `goal` · `purchase`) and `company`
(`alone` · `girlfriend` · `friends` · `family` · `other`).

Status flows `idea` → `planned` → `booked` → `done`, with `cancelled` as an exit.
An **idea** is simply a plan with no date, which is why the wishlist and the calendar are the
same collection.

Single-day plans use `targetDate`; trips use `startDate`/`endDate`. `personalPlanDate()` picks
whichever applies, so every consumer asks one function rather than branching.

## Auto-expense — the money interlink

The brief: *"whatever I add here could also automatically go to the salary/free money widget as
an expenditure."*

With `autoExpense: true` **and** an `estimatedCostCents` **and** a date, the API keeps a one-off
cash-flow expense in sync with the plan. `syncExpense()` runs after **every** write and decides
create / update / delete in one place, so the two can never drift:

| Plan state | Mirrored expense |
| --- | --- |
| `autoExpense`, has cost + date, status not `done`/`cancelled` | created or updated |
| anything else | deleted |

The plan owns the amount (principle IV); the expense carries `linkedPersonalPlanId` back. Change
the cost here and the budget follows. Deleting the plan deletes the expense — unlike a loan
repayment, that money was only ever going to be spent because of this plan.

A `done` plan drops its mirrored expense, because the money has been spent and the projection is
forward-looking. `actualCostCents` then records what it really cost, and feeds
`spentThisYearCents`.

## Travel history

`country` plus `visited`/`status: 'done'` produces two lists in the summary:
`countriesVisited` and `countriesWishlist`. No separate places collection — a visited trip and a
wished-for trip differ only by status.

## Endpoints

```
GET    /api/personal            plans + summary; ?status= filters
GET    /api/personal/summary
POST   /api/personal
PATCH  /api/personal/:id        re-syncs the mirrored expense
DELETE /api/personal/:id        deletes the mirrored expense too
```

## Cross-links

- **→ cashflow** — via `syncPersonalPlanExpense()` / `removePersonalPlanExpense()`.
- **→ dashboard** — next plan and days until, idea count, committed upcoming spend.

## Open questions

- Trips create **one** expense for the whole cost on the start date. Spreading it across the trip
  dates, or splitting deposit vs balance, would model reality better.
- No recurring personal plans (a weekly gym session is a cashflow expense today, not a plan).
- `countriesVisited` is derived from trip rows, so a country visited before using the app has to
  be entered as a `done` trip to appear.
