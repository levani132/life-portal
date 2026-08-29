# Module: fx (exchange rates and display currency)

Answers one question: *what is this amount worth in the currency I read the app in?*

**Code:** `apps/api/src/fx/` · **Domain logic:** `libs/shared/domain/src/lib/fx.ts`,
`money.ts` (`convertCents`)

## The rule this module exists to enforce

**An amount is stored in the currency it was recorded in, and converted only on the way out.**
Nothing converted is ever persisted (principle III). A salary paid in dollars stays a USD row
forever; `settings.displayCurrency` decides what it is *rendered* as.

The consequence that shaped the design: a conversion uses **the rate in force on the amount's
own day**, never today's rate. Converting at today's rate would silently rewrite history every
time the lari moved — a payment that filled one budget line yesterday would fill a different one
tomorrow. So the published rates are archived and each conversion looks up the day it belongs to.
There is a test asserting a past figure does not move when a newer rate lands.

## Collections

| Collection | Purpose |
| --- | --- |
| `fx_rate_history` | One document per base currency, grown by appending a point per day. |

**`fx_rate_history` has no `userId`.** A published rate is a public fact, so this follows
`stock_quotes` / `stock_price_history` in being global rather than per-owner — the only two kinds
of collection in this codebase that are. Nothing user-specific may be added to it.

### Rates are floats, not cents

`FxRatePoint.rates` holds ordinary numbers. An exchange rate is a *ratio*, not a monetary amount,
and rounding 2.6121 to two decimals would put visible error into every converted figure. This is
the one deliberate exception to principle II; money stays in cents and only the ratio it is
multiplied by is a float.

## Source

The **National Bank of Georgia**: `https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/`.
No API key, no rate limit worth worrying about, and it is the official rate for the lari.

It also accepts `?date=YYYY-MM-DD` and answers with that day's rates, which is what makes the
backfill possible.

Three details that will bite:

- **`quantity` is not always 1.** NBG quotes some currencies per 100 (JPY) or per 1000. The
  per-unit rate is `rate / quantity`. USD and EUR are quoted per 1, but relying on that is a
  latent bug for the day a fourth currency is added.
- **`validFromDate`, not `date`.** `date` is when the rate was published — the *evening before* it
  applies. Filing rates under `date` puts every one of them a day early.
- **Always ask for the day you want.** An unparameterised call made late in the evening answers
  with *tomorrow's* rate, so the archive ends up holding nothing for today and every figure falls
  back to unconverted. This was a live bug: `npm run check` passed and `GET /api/fx` returned
  `inForce: null`. `refresh()` and the cron both pass `today` explicitly now.

`NbgProvider` returns `null` rather than throwing on any failure, exactly like `FinnhubProvider`:
a rate outage must leave the app showing unconverted amounts, never break a page.

## Refresh

`FxRefreshJob` runs at **6am**, not in the evening like the quote refresh. Because NBG publishes
in the evening marked valid from the following day, an evening job would only ever file
*tomorrow's* rate and today would forever fall back to yesterday's.

`onModuleInit` tops the archive up when it holds nothing for today. That covers a host that sleeps
the process and so is never awake at 6am, and it is what fills the archive on the very first boot.
`POST /api/fx/refresh` does it by hand.

### Backfill

`ratePointFor` refuses to extrapolate backwards, so without a backfill every amount recorded before
the app's first run would stay unconverted forever. `backfill(from, to)` fills a range one request
per day, sequentially — a courtesy to a free public endpoint, and never on a user-facing path.

It runs **detached** on first boot for the last 120 days: 120 requests take about 20 seconds and
`onModuleInit` is awaited by Nest, so awaiting it would hold boot open that long.

Asking for a Saturday answers with Friday's rate carrying Friday's `validFromDate`, so a weekend
collapses into the one publication it belongs to — 120 requests yield about 85 points. The backfill
keys by that date, so `added` counts rates filed rather than requests made, and days already held
are skipped.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/fx` | Rates in force today, plus how big the archive is. |
| `POST` | `/api/fx/refresh` | Manual refresh, for a host that cannot be relied on to run cron. |
| `POST` | `/api/fx/backfill` | `?from=` (default 120 days back) `?to=` (default today). |

## Using it from another module

```ts
const { currency, fx } = await this.fx.displayFor(userId, today);
```

`displayFor()` is the one every summary wants. Doing it by hand meant five copies of "fetch the
settings, build the context", and **three of them were simply missing** — which is how `/stocks`,
`/items` and `/personal` came to report `currency: 'GEL'` over unconverted USD amounts while the
dashboard was correct. If you are writing a summary, call `displayFor`.

`context(currency, day)` remains for callers that already know the currency. The dependency runs one
way — settings knows nothing of fx — so there is no cycle.

**Rows keep their own currency; only summaries convert.** The web pages already rely on this: a
stock lot renders at `position.currency`, an item at `item.currency`, while every total renders at
`summary.currency`. A row showing a converted price would be a lie about what was paid.

Then, in the domain layer: `toDisplayCents(cents, from, fx)` for one amount, `sumInDisplay(rows, fx)`
for a mixed-currency total. `rateTable()` pre-computes the **cross rates**, so `USD_EUR` is present
and no caller chains two conversions and rounds twice.

## When there is no rate

Every helper returns the amount **untouched** and reports `converted: false`. An unconverted
number is recoverable; a wrongly converted one is not. Two consequences callers must honour:

- A total that swallowed an unconvertible row still **counts** it — understating a balance is the
  more dangerous error — and names the currency in `CashProjection.unconvertedCurrencies` so the
  UI can mark the figure approximate (principle VI). `fxBasis()` builds that label.
- `ratePointFor()` does **not** extrapolate backwards. An amount dated before the archive begins
  stays unconverted rather than being valued at a rate that did not exist yet.

## Cross-links

- **cashflow** — `projectCash()` takes `fx` and an `openingCurrency`. Without them it adds dollars
  to lari; there is a test named for that.
- **Every controller returning a summary** must call `displayFor`. A summary that reports a
  `currency` it did not convert to is worse than one that reports nothing: the figure looks
  authoritative and is wrong by a factor of the exchange rate.
- **loans**, **items**, **stocks**, **personal** — each summary converts its own rows and reports
  `displayCurrency`. That is what makes the dashboard's `netPositionCents` a single-currency sum.
- **settings** — owns `displayCurrency`, changed at `/settings` in the web app, which also shows
  the rate currently in force. That panel exists because with no rate every figure quietly falls
  back to its recorded currency, and there would otherwise be nothing to say why. The legacy `fxRates` / `fxRatesUpdatedAt` fields on
  `user_settings` are superseded by this module and are no longer read.
