# Module: stocks (Widget 4 — Stocks)

Share holdings recorded as immutable lots, with live prices, target prices, a suggested-target
heuristic, and the EPAM employee share purchase plan projected forward.

**Code:** `apps/api/src/stocks/` · `apps/web/src/app/stocks/page.tsx`
**Domain logic:** `stock-positions.ts`, `target-price.ts`, `espp.ts`

## Collections

| Collection | Purpose |
| --- | --- |
| `stock_lots` | One row per purchase. Same symbol bought three times = three cost bases. |
| `stock_quotes` | Latest price per symbol. The **only** permitted cache, with `fetchedAt` + `stale`. |
| `stock_price_history` | Daily closes, one point per day, grown by appending each refresh. |
| `stock_fundamentals` | EPS, P/E, peer P/E. Feeds the suggested target. Refreshed on demand. |
| `stock_targets` | The user's own target price and horizon, per symbol. |
| `espp_plans` | The EPAM share plan configuration. |

Positions are folded on read by `foldPositions()`: average cost is weighted across **open** lots
only, so selling a cheap lot does not distort the remaining average. A quote older than 4 days
is marked stale on read, so an unrefreshed price starts flagging itself.

## EPAM ESPP

$2,880 per six-month period, 15% discount, boundaries **1 May** and **1 November**.

```
periodStart   = the boundary before the purchase date
referencePrice = min(close at periodStart, close at periodEnd)   ← look-back provision
purchasePrice  = referencePrice × (1 − 0.15)
shares         = 2880_00 / purchasePrice
```

The look-back is why a falling share price still gives a good entry: the higher earlier price is
discarded. For a *projected* grant the period end is always in the future, so the current price
stands in for it and the grant is flagged `modelled: true`. A grant whose period start is a real
close is only half-modelled, and its `basis` string says which half.

## Suggested target price

Four weighted anchors, renormalised over whichever are available, clamped to 0.85×–2.5× the
current price:

| Anchor | Weight | What it is |
| --- | --- | --- |
| 52-week high | 0.30 | The stock traded there within a year, so no new thesis is needed. |
| Trend | 0.30 | Annualised historic return, **halved**, clamped to [−25%, +35%], over the horizon. |
| P/E reversion | 0.30 | `epsTtm × peerPe`, grown by EPS growth. Pulls expensive stocks down. |
| Cost-basis hurdle | 0.10 | `averageCost × (1 + 15% × years)`. Not a market signal — "below this, selling is not worth it". |

Every component is returned with its own `basis` and weight so the UI shows the arithmetic
(principle VI). Confidence: `high` with ≥3 anchors including P/E, `medium` with 2, else `low`.

**Peer P/E, not own P/E** — using the symbol's own trailing P/E makes the term collapse to the
current price and contribute nothing. Peers cost ~6 API calls, hence the separate on-demand
endpoint.

`effectiveTargetPerShareCents` = the user's target if set, else the suggestion. That is what
`valueAtTargetCents` and the loan scenarios use, and `effectiveTargetIsSuggested` tells the UI
which it was.

## Finnhub

`FinnhubProvider` returns `null` on a missing key, a failure, a 403 (free tier refusing a
premium endpoint) or a 429 (rate limit). All are expected operating conditions, not incidents.
A failed refresh marks the existing quote stale rather than deleting it — a stale price beats no
price. Without a key the app is fully usable via `PUT /api/stocks/quote`.

Free tier has **no `/stock/candle`**, which is why history is grown rather than backfilled.
`POST /api/stocks/history/:symbol` imports points by hand.

## Liquidation and earmarking

`liquidationValueCents()` = gross proceeds − capital-gains tax on the **gain only** (rate from
user settings, default 0 — Georgia taxes most personal share sales at 0%). Losses offset
nothing; a personal dashboard does not need loss-carry accounting and pretending otherwise would
overstate the cash.

`earmarkedByLoan()` splits proceeds per lot by `allocateToLoanId` × `allocationRatio`. Lots with
no allocation contribute to no loan.

### Selling, and where the money goes

Each open lot has a **sell** action (partial or whole). The sale decides the destination in the
same request: `POST /lots/:id/sell` also accepts `allocateToLoanId` — a loan id earmarks the
proceeds (`allocationRatio` says how much of them; the UI takes an amount and converts), `''`
routes everything to the balance and clears any earmark set at purchase, and omitting the field
keeps whatever the lot already said.

The earmarked share is *excluded* from the realised-sale cash inflow (`realisedSales()` —
principle IV: that money is the loans widget's) and, once the lot is sold, it leaves
`earmarkedByLoan()` too because only open quantity counts there. The earmark is a signal that
the cash is spoken for; the actual repayment is still recorded on the Debts screen when the
money is sent, which is what reduces the balance owed.

A lot sold twice keeps one `soldPricePerShareCents` and one destination (the open question below),
so selling in several tranches at different prices or to different destinations needs the lot
split by hand first.

## Endpoints

```
GET  /api/stocks                          positions, summary, ESPP, targets, provider status
GET  /api/stocks/summary
GET  /api/stocks/positions
GET  /api/stocks/history/:symbol
POST /api/stocks/history/:symbol          { points: [{ date, closeCents }] }
GET  /api/stocks/lots
POST /api/stocks/lots
PATCH /api/stocks/lots/:id
POST /api/stocks/lots/:id/sell            partial sales via { quantity }; destination too — see below
DELETE /api/stocks/lots/:id
GET  /api/stocks/targets
PUT  /api/stocks/targets                  upsert by symbol
DELETE /api/stocks/targets/:symbol
PUT  /api/stocks/quote                    manual price; also appends to history
POST /api/stocks/refresh                  quotes + metrics for every held symbol
POST /api/stocks/refresh-fundamentals/:symbol   peers too; several API calls
GET  /api/stocks/espp
GET  /api/stocks/espp/projection?through=
PUT  /api/stocks/espp
```

A cron job refreshes quotes daily at 22:00 (`DISABLE_SCHEDULES=true` to turn off), but every
refresh is also reachable by endpoint — a free host that sleeps the process will rely on that.

## Cross-links

- **→ loans** — `proceedsForLoan()` gives net proceeds now and at target, plus the longest
  target horizon, which dates the best-case share sale.
- **→ cashflow** — a sold lot becomes a one-off cash inflow of
  `soldQuantity × soldPricePerShareCents`, derived by `realisedSales()`. Gross of tax, and net of
  anything earmarked to a loan; see `docs/DECISIONS.md`.
- **→ dashboard** — market value, gain, value at target, next ESPP date.

## Open questions

- Currency is assumed USD throughout. A non-USD holding would need FX at the position level.
- ESPP contributions are not modelled as cash outflows in the cashflow widget. They should
  probably appear as a recurring expense; today they only appear as future shares.
- Partial sale of a lot keeps one `soldPricePerShareCents`, so selling the same lot twice at
  different prices overwrites the first price. Splitting the lot would be more correct.
