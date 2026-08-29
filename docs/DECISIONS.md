# Decisions

Why things are the way they are. Append, do not rewrite — a superseded decision is more
useful with its replacement noted underneath than deleted.

Format: what was decided, what it buys, and what it costs.

---

## 2026-08-03 · The API's port variable is `API_PORT`, not `PORT`

`AppConfig.port` resolves `API_PORT` first, then `PORT`, then 3333. The web app's dev and start
ports are pinned to 4200 in `apps/web/project.json`.

**Why:** `PORT` is not an API-specific variable — `next dev` and `next start` read it too. With a
single `PORT=3333` (which `.env.example` originally told you to set), `npm run dev` started both
apps against the same socket and whichever lost the race died with `EADDRINUSE`. Passing
`--port 4200` explicitly to Next means the web app ignores `PORT` entirely, so the two can never
collide again regardless of what the environment holds.

**Why keep the `PORT` fallback:** Render, Railway and Fly inject `PORT` and expect the process to
bind it. Only the API runs there, so there is nothing to collide with, and honouring it keeps
deployment zero-config.

**Verified** by exporting `PORT=3333` *and* `API_PORT=3333` and running `npm run dev`: API on
:3333, web on :4200, no `EADDRINUSE`, and a CORS preflight from `http://localhost:4200` accepted.

---

## 2026-08-03 · Optional money fields have no schema default

`centsField` (the optional variant) deliberately sets **no `default: 0`**. Only
`requiredCentsField` defaults to zero, because there the value must exist anyway.

**Why:** "not set" and "zero" are different facts, and a `default: 0` conflates them, breaking
every `??` fallback downstream. Two real bugs this caused, both caught by an end-to-end run
rather than by the type checker — the types said `number | undefined` while Mongo returned `0`:

- A `StockTarget` carrying only a horizon (exactly what the seed creates) stored
  `targetPriceCents: 0`. Since `0 ?? suggestion` is `0`, the suggested target was silently
  discarded and *every* "value at target", liquidation and earmarked figure came out zero.
- A `SellableItem` with no walk-away price stored `minPriceCents: 0`, so
  `minPriceCents ?? expectedPriceCents` made the pessimistic proceeds zero rather than falling
  back to the realistic price.

**Also hardened at the consumer**, because defence in depth is cheap here: `foldPositions()`
treats a target price of `0` as "not set" regardless of how it got there — a target of zero is
meaningless as an instruction to sell. Regression tests live in `stock-positions.spec.ts`.

**Lesson worth keeping:** a Mongoose default silently widens what a nullable field can contain,
and TypeScript cannot see it. Prefer no default on anything optional.

---

## 2026-08-03 · Config is a `@Global()` module, not an `AppModule` provider

`CONFIG` is provided and exported by `ConfigModule` (`@Global()`), not declared inline in
`AppModule`.

**Why:** a provider declared in `AppModule` is **not** visible to the modules `AppModule`
imports. `FinnhubProvider` inside `StocksModule` could not resolve `APP_CONFIG`, and the app
failed to boot with `UnknownDependenciesException`. Typecheck and both builds passed — only
actually starting the process caught it, which is why a boot smoke test is part of the gate.

Configuration is genuinely cross-cutting (auth, the JWT strategy, the Finnhub client and the
scheduled job all need it), so `@Global()` is the honest description rather than threading an
import through every feature module.

---

## 2026-08-03 · Calendar dates are stored as strings, not `Date`

Every user-facing date (`purchaseDate`, `asOf`, `dueDate`, …) is a `YYYY-MM-DD` string in
Mongo, in DTOs and in the domain library. Only Mongoose's automatic `createdAt`/`updatedAt`
are real timestamps.

**Buys:** a salary lands "on the 7th", not "at 00:00 UTC on the 7th". Strings remove every
timezone question — no server-locale surprises, no daylight-saving off-by-one, no accidental
date shift when a document round-trips through JSON. ISO day strings also sort lexicographically,
so Mongo range queries and `Array.sort()` work without a comparator.

**Costs:** no native date arithmetic in queries, and the domain library needs its own date
helpers (`libs/shared/domain/src/lib/dates.ts`, ~150 lines, UTC-anchored).

---

## 2026-08-03 · The cash-flow expense owns the loan repayment amount

A monthly loan repayment exists as one row: an `Expense` with `linkedLoanId`. The loan's
`RepaymentPlan` holds `linkedExpenseId` and reads the amount from it, treating its own
`amountCents` as a fallback only.

**Buys:** editing the $1,000 monthly figure from either the Debts screen or the Free money
screen changes the same row, so the two can never disagree. The debt's payoff scenarios and
the cash projection are automatically consistent.

**Costs:** `LoansService` depends on `CashflowService`, and deleting a plan has to decide what
happens to the expense. It deletes it by default (`?keepExpense=true` opts out), whereas
deleting the whole *loan* unlinks the expense but keeps it — the money is still leaving the
account, and silently deleting a budget line would be a nasty surprise.

---

## 2026-08-03 · Scenarios are named by assumption, not by outcome

The three loan scenarios are labelled "Everything sells at target", "Realistic" and
"Salary only" rather than best/expected/worst. The keys stay `best`/`expected`/`worst`.

**Why:** the best case maximises money *recovered*, which can make it finish **later** than the
realistic case — holding shares until they reach the target price pays more but takes longer
than selling at today's price. A card reading "best case: April 2027, realistic: January 2027"
looks like a bug. Naming them by what they assume makes it legible, and each scenario returns
its `assumptions` array for the UI to show.

There is a test asserting the realistic case can beat the best case, so nobody "fixes" it later.

---

## 2026-08-03 · Free money excludes obligations due on payday

`CashSnapshot.committedBeforeNextIncomeCents` counts expense occurrences in the window
*(date, nextIncomeDate)* — exclusive of the income day itself.

**Why:** the loan repayment falls on the 7th and so does the salary. It is funded by that
salary. Counting it against the balance you hold on the 3rd would understate free money by a
full month of obligations. Tested both ways in `cash-projection.spec.ts`.

---

## 2026-08-03 · Suggested target price is a transparent blend, not a model

Four weighted anchors: 52-week high (0.30), damped trend extrapolation (0.30), peer-P/E
reversion (0.30), cost-basis hurdle (0.10). Missing inputs drop their term and the remaining
weights renormalise. The result is clamped to 0.85×–2.5× the current price.

**Buys:** every term is returned with its own `basis` string and weight, so the UI can show the
full arithmetic — required by constitution principle VI for a number that could drive a sell
decision. Degrades gracefully: a symbol with only a 52-week high still gets a suggestion, at
`low` confidence.

**Costs:** it is a heuristic, not a valuation. The `basis` string says so explicitly.

Two specifics worth knowing:

- **Trend is halved before extrapolation** and clamped to [−25%, +35%] a year. Undamped
  momentum on a strong runner produces a fantasy number.
- **Peer P/E, not the symbol's own P/E.** Using its own trailing P/E makes the term collapse to
  `eps × (price/eps)` = the current price, contributing nothing. Peers cost ~6 Finnhub calls,
  so they are fetched on demand (`POST /stocks/refresh-fundamentals/:symbol`), not on every
  quote refresh.

---

## 2026-08-03 · Price history is grown, not backfilled

Finnhub's free tier does not serve `/stock/candle`. Rather than pay or scrape, the app appends
each refreshed quote to `stock_price_history` as one point per day.

**Costs:** the trend term of the suggested target is unavailable for the first ~90 days
(`MIN_DRIFT_DAYS`), and the price chart starts the day the app does.

**Mitigation:** `POST /stocks/history/:symbol` accepts a batch of `{ date, closeCents }` points,
so history can be imported by hand from any source.

---

## 2026-08-03 · JWT lifetimes are configured in seconds

`ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_SECONDS`, not `15m`-style strings.

**Why:** `@nestjs/jwt` types `expiresIn` as `number | StringValue`, where `StringValue` is a
template-literal union from `ms`. A plain `string` read from `process.env` does not satisfy it,
so a string-based config needs a cast that defeats the point of the type. Seconds are also
unambiguous.

---

## 2026-08-03 · Refresh tokens rotate, and the client shares one refresh

Every successful refresh issues a new refresh token and stores its bcrypt hash on the user,
replacing the previous one. Logout and password change clear the hash, which genuinely revokes
outstanding sessions rather than asking the client to forget a still-valid token.

**Consequence the client must respect:** two concurrent 401s must not both call `/auth/refresh`
— the first rotates the token and the second would present a stale one and be rejected,
signing the user out mid-session. `apps/web/src/lib/api.ts` shares a single in-flight
`refreshPromise` across all callers for exactly this reason.

---

## 2026-08-03 · Nx config helpers are avoided in Next/Tailwind config files

`apps/web/next.config.js` does not use `@nx/next`'s `withNx`, and `apps/web/tailwind.config.js`
does not use `@nx/react/tailwind`'s `createGlobPatternsForDependencies`.

**Why:** Next 16 builds with Turbopack, which bundles config files' transitive requires. Both
helpers reach into the Nx devkit, which requires `@angular-devkit/architect` — a package this
workspace has no reason to install — and `next build` fails with ten module-not-found errors.

**Costs:** Tailwind's content globs list `libs/**/src/**` by hand instead of deriving them from
the project graph. Add a line if a new UI library appears.

---

## 2026-08-03 · Registration can be closed with an invite code

If `REGISTRATION_INVITE_CODE` is set, `POST /auth/register` requires it. If unset, registration
is open.

**Why:** the app is meant for a free public host. Leaving registration open would let anyone
create an account on your instance. Set the variable in production; leave it unset locally.

---

## 2026-08-03 · The seed records the $6,500 already repaid as one opening payment

The friend loan is seeded with its true `principalCents` of $1,700,000 (i.e. $17,000) and a
single payment of $6,500 dated at the loan start, leaving the correct $10,500 outstanding.

**Why:** the real payment dates are not known, and inventing a plausible monthly history would
put fictional data in a ledger that principle III makes authoritative. One clearly-labelled
adjustment is honest and easy to replace: delete it and enter the real payments, and every
balance and scenario recomputes.

---

## 2026-08-18 · The web app deploys to Vercel, the API to Render, from one repo

`vercel.json` builds only `web` and points `outputDirectory` at `apps/web/.next`. `render.yaml`
builds only `api` and starts `dist/apps/api/main.js`.

**Why:** Nx runs `next build` with `apps/web` as its cwd, so the output lands in `apps/web/.next`
while Vercel looks for `.next` at the repo root — the first deploy failed with "The Next.js
output directory .next was not found" even though the build had succeeded. Narrowing each
platform's build command to a single project also stops Vercel from building the NestJS API and
Render from building the Next app, neither of which the other can serve.

The API is a long-lived process holding a Mongoose connection pool and running the daily quote
cron, so it cannot be a Vercel serverless function without being rewritten.

**Costs:** two dashboards and two sets of environment variables. Three of them are coupled and
easy to get wrong:

- `NEXT_PUBLIC_API_URL` (Vercel) must carry the `/api` prefix, and is baked in at build time —
  changing it requires a redeploy, not just a restart.
- `CORS_ORIGINS` (Render) must list the Vercel origin, or every browser request fails against a
  perfectly healthy API.
- `API_PORT` must **not** be set on Render. Render injects `PORT` and waits for the process to
  bind it, but `AppConfig.port` resolves `API_PORT` first — an `API_PORT` copied over from
  `.env.example` makes the API listen on 3333 while Render scans 10000, and the deploy never
  goes live despite a clean boot.

Vercel's **Root Directory must stay at the repo root**, not `apps/web`. `outputDirectory`
resolves relative to it, so a Root Directory of `apps/web` looks for
`apps/web/apps/web/.next` and fails. The repo root is the honest root anyway: there are no npm
workspaces and no `apps/web/package.json`, and pointing Vercel inside `apps/web` also makes it
warn that it cannot find an Nx `build` target. The equivalent alternative — Root Directory
`apps/web` plus `outputDirectory: .next` — was rejected to keep the whole deploy config in git
rather than split between git and the dashboard.

Neither file carries a `"//"` comment key: Vercel validates `vercel.json` against a schema with
`additionalProperties: false` and rejects it. `render.yaml` is YAML and comments freely.

---

## 2026-08-18 · Node is pinned to 22 LTS for deploys

`.node-version` and `package.json` `engines` both pin Node 22.

**Why:** Render defaults to the newest Node when nothing pins it, and picked 24.14.1. Node 24
ships OpenSSL 3.5, whose stricter default security level fails the TLS handshake against a
MongoDB Atlas shared-tier cluster with `tlsv1 alert internal error` (SSL alert 80). Mongoose
reports that as its generic "your IP isn't whitelisted" message, which sends you looking in the
wrong place — the Atlas access list can be perfectly correct.

A `NODE_VERSION` entry in `render.yaml` did not take effect; the two files do.

**Costs:** the pin has to be lifted deliberately once the driver and Atlas agree on OpenSSL 3.5.

---

## 2026-08-18 · Cash from a sale is derived from the sold row, and earmarked proceeds are excluded

Selling an item or a share lot now shows up as cash in the Free money widget. It is **derived on
read** by `realisedSales()` from the `sold*` fields the item and lot rows already carry — there is
no transactions collection and no second write when something sells (constitution principle III).
Correcting a sale price on the Items screen corrects the cashflow in the same edit.

**Earmarked proceeds are left out of the inflow.** When a sale is allocated to a debt
(`allocateToLoanId` + `allocationRatio`), the loans widget already counts that money against the
balance owed. Counting it as spendable cash as well would let the same dollar do two jobs, which
is exactly what principle IV exists to prevent. So `RealisedSale.amountCents` is the unearmarked
share only; `grossCents` keeps the full figure for display. A fully earmarked sale produces no
cash event at all, and the day panel shows it as a `$0` row labelled "to debt" rather than hiding
it.

**A sale is not a payday.** `snapshotFromDays()` used to end the committed-spending window at the
next day with *any* inflow. With sales in the projection that would close the window on the day
you sold your laptop, dropping every obligation between then and the real salary out of "due
before payday" and overstating free money. It now looks for `sourceKind === 'income'` — income
sources only. Tested.

**Costs:** `CashflowModule` now imports `ItemsModule` and `StocksModule`, so every projection
reads two more collections. Both are small, unindexed-scan-cheap lists, and the alternative —
writing an income row on every sale — trades that for two rows that can disagree.

A sale dated before the last reconciliation is outside the projection window and so is ignored,
on the same reasoning that already applies to expenses: the reconciled balance includes it.

---

## 2026-08-18 · Today's cash balance is derived; the loan's is not

**Cash.** `CashflowSummary.currentBalanceCents` is now the projection's closing balance for today
rather than the latest `cash_balances` row. The reconciliation is an anchor, not an answer: with a
balance last confirmed on the 3rd and a salary paid on the 7th, the old headline was two weeks and
one payday out of date while every other figure on the screen was current. `reconciledBalanceCents`
keeps the confirmed figure for display, and the derived one carries an `est` mark (principle VI).

`firstShortfallDate` became forward-looking for the same reason — it was reporting a dip that
happened before today, which is neither actionable nor necessarily what really happened.

**Debt.** The symmetric change was *rejected*. `remainingCents` still counts recorded payments
only, because a repayment plan is an intention: rolling it forward would quietly mark a debt as
repaid on the strength of a schedule, and the person owed the money would disagree. Instead
`loanBalance()` reports the gap — instalments that have fallen due with nothing recorded — plus
`expectedRemainingCents` as a labelled estimate, and the UI offers to record the missing payments.
The user confirms what happened; the app does not decide.

**Costs:** two figures where there was one, and a note on the Debts screen that will look alarming
the first time a schedule has been running longer than the payment history. That is the honest
reading of the data: either the payments happened and want recording, or the debt really is that
big.


---

## 2026-08-19 · Constitution 1.1.0 — a summary card may carry one quick action

Principle I said a summary card has "no interaction beyond navigation". The food widget breaks
that: logging a meal happens three to six times a day, and making every entry start with a
navigation is the difference between a tracker that survives and one that is abandoned in week
three. The governance clause allows exactly two responses — follow the principle, or amend it in
the same change. Amended.

The exception is deliberately narrow: **one** primary action per card, nothing else. A second
button, an inline form or an editable field on a card is still a violation, because the moment a
card takes arbitrary input it has become a second, worse detail page.

**Rejected:** a floating quick-add in the app shell. It needs no amendment, but it puts a
food-specific action into chrome shared by every widget, which is a worse boundary violation than
one button on the widget's own card — and it would be the first thing to break when a second
widget wants the same treatment.

---

## 2026-08-19 · Nutrition facts are per 100 base units, as integers, with macros in milligrams

Amounts are logged in base units, so per-100 storage makes every derivation one multiply and
removes the serving size from the arithmetic entirely — editing a serving size can no longer change
a food's calorie density. Storing what the label says (per serving) would have made every figure
depend on a mutable field, and two foods with different serving sizes incomparable.

Precision follows principle II by analogy: whole kilocalories, and macronutrients as whole
**milligrams** in `*Mg` fields — three decimal places of a gram, far more than any label carries,
and no float ever reaches Mongo. Optional nutrients have **no `default: 0`**, for exactly the
reason `centsField` does not: "unknown fibre" and "no fibre" are different facts.

The food form still accepts per-serving *or* per-100 input and remembers which via `entryMode`, so
the owner types what the packet says and reopens the form to find what they typed.

---

## 2026-08-19 · A logged meal freezes the food's numbers

A `meal_entries` row stores `foodId` **and** a `facts` snapshot: name, brand, serving size and the
per-100 numbers as they were at that moment.

This is the only place in the codebase where a value is copied rather than referenced, and it is
not a cached derivation — it is what an event row is *for*. Without it, fixing a typo in a food's
calories next month silently rewrites every day that food has ever appeared in, and the log stops
being evidence of anything. A stock lot stores its purchase price for the same reason.

What follows from it: the snapshot is built server-side and never accepted from a request;
`PATCH /entries/:id` corrects an amount **without** re-pricing the meal; `foodId` is immutable
(a different food is a different meal); and deleting a food that has been eaten *archives* it, so
the picker stays clean while history keeps its name.

**Rejected:** pure reference (retroactively mutates history), immutable foods (forbids ever fixing
a typo), and versioned foods (fills the picker — the one surface that must stay clean — with
near-duplicates).

Totals are still never stored. Only the inputs are.

---

## 2026-08-19 · Amounts stay in the food's own unit; grams and millilitres are not interchangeable

A food is measured in grams or millilitres and its facts are per 100 of that unit. Nothing is
converted between them, because we have no densities: 1 ml = 1 g is wrong by −8% for oil, +3% for
milk and +40% for syrup, and that error would quietly corrupt every total involving a liquid.

The original request was to convert everything to grams. The UX it was asking for — "let me type
servings or millilitres, whichever I prefer" — needs only the serving size, which the modal already
has, so nothing was lost by keeping the honest unit.

**Rejected:** a per-food density field. It adds a field to every liquid to enable a conversion
nothing in the app performs.

---

## 2026-08-19 · The verdict on a target's rate is wider than the recommended band

Recommended rates are 0.5–1.0% of body weight a week for loss and 0.25–0.5% for gain. Using those
as *verdict* thresholds made the app flag its own `fat_loss` recommendation — about 0.45% a week
for an 80 kg frame — as "too slow". A tool that contradicts its own advice teaches you to ignore
its warnings, so the thresholds are now `fast` above 1.0% (loss) or 0.5% (gain) and `slow` below
0.25% either way, with the recommended bands still shown as the target.

Caught by a unit test asserting the five goals, not by review. This is what "a test per branch"
is for.

---

## 2026-08-20 · Recomposition is its own goal, not a shade of fat loss

"Lose fat and build muscle at once" is a real outcome with its own numbers, and squeezing it into
`fat_loss` gets both halves wrong: fat loss uses too big a deficit for muscle to arrive, and
`lean_gain` uses a surplus. Recomposition sits between them — maintenance − 10%, protein 2.4 g/kg
of body weight (2.8 g/kg of lean mass when it is known), fat 0.8 g/kg.

It is the only goal whose **outcome depends on behaviour the app cannot observe**, so it is the
only one that ships a `goalNote` about conditions rather than arithmetic: resistance training, the
protein target actually being hit, sleep, and how much fat there is to start with. Naming the
conditions is the same principle as labelling an estimate — the number is not the whole claim.

It also needed its own protein ceiling. The default 40%-of-energy guard exists to stop a per-kg
figure going silly at a high BMI, but at recomposition intakes it would clip a target the evidence
supports (Longland 2016 used 2.4 g/kg in a deep deficit), so `GOAL_PLAN` gained an optional
`proteinEnergyCap` and this goal sets it to 50%.

**Not changed:** the model still refuses to promise recomposition. It reports a deficit and a
protein target; whether muscle arrives is decided in the gym.

---

## 2026-08-20 · `min-width: 0` is the default, everywhere

Grid and flex items default to `min-width: auto`, meaning they refuse to shrink below their
content's min-content width. One `shrink-0` control cluster beside a long food name was enough to
make `/nutrition` 496px wide and `/cashflow` 485px wide inside a 390px phone: the page scrolled
sideways, the header wrapped into four rows, and — the part that took longest to see — **every
`truncate` in the app was inert**, because the item grew instead of the text ellipsing.

`global.css` now sets `min-width: 0` on everything, wrapped in `:where()` so it carries zero
specificity: an explicit `min-w-*` utility still wins, and `shrink-0` still protects control
clusters from being squashed — it only stops them widening the page. Measured after the change:
every page fits exactly at 390, 768 and 1280.

**Rejected:** `overflow-x: hidden` on the body. It hides the symptom, leaves the content clipped
instead of wrapped, and the next long label reintroduces it somewhere new.

---

## 2026-08-20 · Installable, and the service worker caches no data

The app is a PWA: manifest, maskable icons, `display: standalone`, theme colour, safe-area padding
for the notch and the home indicator. The reason is mundane — this is a dashboard opened several
times a day from a phone home screen, and browser chrome is wasted vertical space.

The service worker is deliberately thin and hand-written (a workbox dependency would need
justifying, and this is forty lines). What matters is what it does **not** cache: **every `/api`
response goes straight to the network, always.** A cache lives on disk long after the tab closes,
and this API returns one person's debts, weight and food log. Offline you get the app shell and an
honest failure, never a stale copy of private numbers. Content-hashed build assets are cache-first;
navigations are network-first with a shell fallback.

**Nav:** eleven widgets do not fit on a phone. Wrapped, they took four rows and pushed the content
below the fold; as a horizontal scroller, half of them hid behind a gesture nobody discovers. Below
`lg` it is now a menu button opening a two-column list — one tap to any widget — and the full row
returns above it.

---

## 2026-08-21 · Zoom is locked off, and 16px inputs are the reason it works

The viewport previously carried a comment saying `maximumScale` was deliberately left alone because
pinch-zoom is an accessibility feature. Reversed, for one concrete reason: **iOS zooms the page in
by itself whenever it focuses a control whose text is under 16px**, and this app's `.field` is 14px.
Every tap on a text field left the layout scaled up and horizontally scrolled, and in a standalone
PWA there is no browser chrome offering a way back out.

Three changes, because no single one of them is enough:

- `maximumScale: 1, userScalable: false` in the viewport. Honoured in a standalone PWA, **ignored by
  iOS Safari in a browser tab** since iOS 10 — which is why it is not the whole fix.
- `.field { font-size: 16px }` under `@media (pointer: coarse)`. This is the part that actually stops
  the focus zoom, and it is a UA behaviour no viewport attribute overrides. Fine pointers keep the
  14px control size. Every text input, select and textarea goes through `Input`/`Select`/`Textarea`,
  so one rule covers the app; the bare `<input>`s left in pages are all checkboxes, which never
  trigger the zoom.
- `touch-action: pan-x pan-y` on the body, which blocks pinch and double-tap zoom in the browsers
  that ignore the viewport flags, while leaving scrolling alone.

**On accessibility:** losing pinch-zoom is a real cost, and it is accepted here because this is a
single-user dashboard whose own text scales with the OS font setting, and because the zoom being
removed was overwhelmingly *unwanted* zoom — triggered by focus, not by intent.

---

## 2026-08-21 · The boot loader is the logo's gauge, animated

`AppShell` rendered the generic inline `Spinner` while the session resolved: a 16px circle with
`py-12`, sitting near the top of an empty page — it read as a broken page rather than a loading one.
The boot state now fills the viewport and centres in it (`100dvh`, so visible browser chrome does
not push the mark low), and it draws the app's own mark from `public/icon.svg`: the ring is already
a progress gauge, so the loading animation is that gauge sweeping to 100%, holding, and unwinding
back to 0%.

Two implementation notes worth keeping:

- The sweep animates **`stroke-dasharray`, not `stroke-dashoffset`**. An offset sweep unwinds from
  the wrong end — the arc slides around the circle instead of shrinking back to where it started.
- `.portal-bar` sets its animation with **longhand properties**, because the three bars are
  staggered with `[animation-delay:*]` utilities and an `animation` shorthand in the later rule
  resets that delay to zero, putting all three back in lockstep.

**No percentage is shown.** The boot is one `/auth/me` round trip with no measurable stages, and a
counter that is not measuring anything is the sort of unlabelled fiction principle VI exists to
forbid. Under `prefers-reduced-motion` the animation stops and the mark falls back to the static
logo.

---

## 2026-08-24 · Per-slot meal suggestions, ranked by recency-weighted frequency

Logging the same breakfast every morning took a picker, a search and an amount. The slot itself now
offers it: `mealSuggestions()` in `libs/shared/domain/src/lib/nutrition.ts` turns the last fourteen
days of log into a short list per slot, and the API ships it on the overview as `suggestions`.

**Ranked by recency-weighted frequency.** Each distinct day a `(slot, food)` pair appeared
contributes `1 / (1 + age in days)`, so yesterday is worth 0.5 and a week ago 0.125. A food eaten
five mornings running therefore outranks yesterday's one-off, and yesterday's one-off still
outranks something eaten once a fortnight ago. Frequency alone would bury a new habit under an old
one; recency alone would make the list flap every day. Ties break on the most recent day and then
the name, so the order cannot depend on the order Mongo returned the log in.

**Priced with the food's current facts, not with the old snapshot.** Logging one of these goes
through the ordinary `POST /entries`, which takes a fresh snapshot — so pricing the button from a
month-old snapshot would print a number the tap does not deliver. This is the mirror image of the
snapshot rule rather than an exception to it: a *past* meal keeps the numbers it was eaten with, a
*future* meal gets today's.

**The amount is that food's total in that slot on the last day it appeared.** Two spoonfuls of oats
at one breakfast were one breakfast's worth of oats, and repeating it should repeat the portion
rather than half of it. Summing per day also makes the figure independent of input order, which the
"most recent entry" reading is not.

**Nothing is stored, and no endpoint was added.** The list is derived on every read (principle III)
and rides along on the overview the page already fetches — the fourteen-day window it ranks over is
the same query that now serves the day being viewed, so the round trip count did not change. The
day is the one being *viewed*, not today, so filling in a missed evening is offered that evening's
history and never suggests itself. Foods already logged in that slot on that day, and foods since
deleted or archived, are left out — the first is a fact rather than a suggestion, and the second
cannot be logged at all.

The dashboard card was deliberately left alone: it already carries the one quick action a card is
allowed under constitution 1.1.0, and a row of food buttons would be a second one.

---

## 2026-08-24 · The dashboard arrangement is a list of card ids on settings

`user_settings.widgetOrder` holds the card ids in the order the user dragged them into.
`arrangeWidgets` (`libs/shared/domain`) sorts the payload with it; a card the list does not mention
sorts after the ones it does, by the widget's own `order`, and an id with no card is ignored.
Written only by `PUT /api/dashboard/order` — `UpdateSettingsDto` deliberately refuses the field, so
there is exactly one writer.

**Why not a `position` on each card:** there is nothing to put it on. Cards are derived from each
widget's summary on every read (principle III) — they are not rows. The set changes when a board is
added or archived, so the arrangement has to be a list of *preferences* that tolerates ids it has
never seen and ids that no longer exist. It does, which is why archiving a board needs no
migration and leaves no hole.

**Why the server sorts, not the browser:** one definition of the order, and a fresh page load is
already correct before any JavaScript runs. The browser reuses the *same* function to reorder
optimistically while a drag is in flight, then hands ownership back to the payload once the write
has landed.

**Cost:** a card added by a deploy lands at the end for anyone who has ever rearranged, rather than
in the position its author picked. This is the home-screen convention and the alternative — moving
cards somebody has positioned by hand — is worse.

**On principle I** ("a card may carry one quick action and nothing more"): dragging is not a second
control on the card. It belongs to the dashboard, which owns the arrangement of its cards; the card
itself gained no button, and in edit mode it loses the one it had. Nothing in a `build*Card` method
knows this feature exists.

---

## 2026-08-24 · Two things make long-press-to-drag work on a touch screen

Both were found by driving the real gesture in a browser, and both look like tidying-up when read
cold. `apps/web/src/components/sortable-grid.tsx` carries the same notes.

**1. The `touchmove` listener is registered when the grid mounts, not when a card is picked up.**

A browser decides at `touchstart` whether a gesture can be cancelled: if the hit test finds no
non-passive `touchmove` listener, the pan is handed to the compositor and the first movement is
answered with `pointercancel`. Adding the listener at pickup — 420 ms into the gesture — is far too
late, and the symptom is exact: the card lifts, the dashboard enters edit mode, and the drag dies
on the first millimetre with the page scrolling instead. The listener now lives on the grid for as
long as it is mounted and does nothing at all unless a drag is in progress, so swiping the
dashboard is untouched. It sits on the grid rather than the document so only touches that start on
a card pay for the lost compositor fast path.

**2. A card stays an `<a>` in edit mode. Its navigation is cancelled, its element is not replaced.**

Rendering the card as a `div` while rearranging reads better — a link that navigates on the mouse-up
of a drag is a bug waiting to happen — but the long press that turns edit mode on *removes the node
the finger is touching*, and a browser answers that by cancelling the touch. Same dead drag, from a
completely different cause. So the card is always a link, `onClick` calls `preventDefault()` while
editing, and `tabIndex={-1}` keeps it out of the tab order in favour of its draggable slot.

**Cost:** the tidier-looking version of both is wrong, and nothing in a type check or a lint pass
says so. `npm run check` passed through both bugs.

**Also load-bearing, less subtly:** `-webkit-touch-callout: none` on `.widget-slot` (otherwise iOS
raises its link preview over the card being lifted), and swapping a card is locked until the finger
leaves the card it just displaced — cards are different heights, so a swap moves the neighbour
under the finger and the two would otherwise trade places every frame.

## Converted money is never stored, and never converted at today's rate

**2026-08-25.** Adding a display currency looked like a data migration: the owner's rows were all
`USD`, the app was to read in `GEL`, so convert the rows and change the default. That would have
been wrong twice over.

**Converting the stored amounts destroys what the number is.** `stock_lots` and `stock_quotes` hold
EPAM, which trades on NASDAQ in dollars; rewriting them as lari leaves the daily Finnhub refresh
writing a USD quote back next to GEL lots, and every position, gain and ESPP projection silently
becomes garbage. `income_sources` is an EPAM salary genuinely paid in dollars — as lari it would
appear to change every time the exchange rate did. Denomination is a fact about the world, not a
display preference.

**And a converted amount is derived (principle III).** Persisting one bakes one day's rate into
history permanently.

So: rows keep their own currency, `settings.displayCurrency` decides what they are rendered as, and
conversion happens on read. No migration ran; the only write was `displayCurrency: 'GEL'`.

**The non-obvious half.** Converting on read is not enough on its own — it has to be at the rate in
force on *the amount's own day*, which is why `fx_rate_history` exists rather than a flat table of
current rates. The `fxRates: Record<string, number>` field already on `user_settings` was exactly
the wrong shape: with a single snapshot, every past figure re-values itself whenever the lari moves,
so a payment that filled Breakfast yesterday would fill Lunch tomorrow. An exchange rate is an
*observation*, like a share price, so archiving one per day keeps principle III intact while making
history stable. `fx.spec.ts` asserts a past conversion does not move when a newer rate is published.

**Rates are floats.** Principle II says money is integer cents; a rate is a ratio, not an amount,
and rounding 2.6121 to two decimals would put visible error into every conversion. The one
exception, and the reason it is written down here.

## A payment's day is written, not derived — and the server decides it

**2026-08-29.** Two deliberate inconsistencies in the spending module, both of which look like
mistakes and would be "fixed" by a future session that did not know why.

**1. `spend_payments.day` is stored.** Everywhere else in this codebase a day is computed on read
(principle III). Here it is written once at ingest and never recomputed, because deriving it needs
`dayStartHour` — *a setting the owner can change*. Recompute it later and every historic payment
made between midnight and 4am silently moves to a different day, changing what past periods spent
and what they saved. Writing it freezes the answer that was true when the payment happened, which
is the only stable choice.

**2. The server applies `dayStartHour`, unlike meals, where the browser does.** A meal is logged by
the browser, which knows the profile, so it sends `?today=`. A payment is submitted by an iOS
Shortcut, which cannot read anything: it can only report the moment. `localDay` is reused, so the
4am rule still has exactly one implementation — only the caller differs.

## The ingest route is `@TokenAuth()`, deliberately not `@Public()`

**2026-08-29.** `POST /api/spending/ingest` cannot use a JWT: a phone automation has no way to hold
a session or refresh a token. It carries a long-lived ingest credential instead.

The obvious way to let it past the global guard is `@Public()`, and that is wrong here — not
technically, but as documentation. This route writes the collection holding **every payment the
owner makes**. A future reader grepping for unauthenticated routes must not find it and conclude
the app leaks financial data. So `@TokenAuth()` is a separate marker meaning "authenticated, just
not by a session", and `JwtAuthGuard` honours both while the two stay legible apart.

**Found by running it.** With only `@UseGuards(IngestTokenGuard)`, every submission returned 401:
the global guard rejects before a route-level guard runs. `npm run check` was green throughout.

## Duplicate messages are matched on text *and* time

**2026-08-29.** The natural design — a unique index on `hash(userId + raw)` — silently loses money
here, and the owner's own data shows why. A BOG message carries no time, only a date:

```
გადახდა: GEL4.00
Card:***9582
NILE
24.08.2026
```

Two ₾4.00 coffees at the same shop on the same day are **byte-identical**. A content hash would
discard the second, under-reporting spending — precisely the failure the whole feature exists to
prevent. A retried automation fires seconds apart; a real second coffee does not. So a duplicate is
the same text arriving within **120 seconds**, and the same text an hour later is a second payment.

## An unreadable message answers 201

**2026-08-29.** `POST /api/spending/ingest` returns success even when the parser cannot read the
message, storing the raw text and queueing it. This looks like swallowing an error.

iOS Shortcuts has no error handling and no retry. Any non-2xx response means the message is gone
permanently — the SMS stays on the phone, but nothing will ever send it again. Answering 201 with
`status: 'unparsed'` is what makes a bank changing its wording a queue to work through rather than
a silent hole in the record.
