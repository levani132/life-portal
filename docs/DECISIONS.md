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

*Data at rest superseded on 2026-11-14 (issue #16): the service worker still caches no `/api`
response, but training, food and social now keep allowlisted data in the page's IndexedDB.*

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

## A budget proposal is the median, and a dismissal suppresses a figure rather than a line

**2026-08-29.** Two decisions in `spend-suggestions.ts` that look like arbitrary statistics choices
and are not.

**The median, never the mean.** A budget funds a routine, so the statistic describing one has to
survive the days that were not routine. Twenty-seven ordinary ₾20 days and one ₾500 dinner give a
mean of ₾37.14 — 86% over the allowance, past both thresholds, and the app would confidently
propose nearly doubling the food budget on the strength of a single evening. The median reports
₾20 and proposes nothing. `spend-suggestions.spec.ts` asserts both halves of that: no proposal, and
that a mean would have crossed the thresholds.

**A minimum history, and a minimum deviation, and both thresholds.** 28 days / 8 weeks / 4 months
(FR-037), because a proposal is a claim about a habit and a handful of days is not evidence of one
— and because capture is incomplete at the start, so early periods read as thrift when they are
really silence. That is also why `observedFrom` drops periods predating the first captured message.
The deviation floor is 15% **and** ~₾5 together: 15% of a ₾10 daily line is ₾1.50 and ₾5 of a ₾900
rent line is noise, so either alone is wrong in one direction. A permanent ±3% trickle of proposals
is a notification that is never read, which costs more than the silence.

**Dismissal is about the number, not the line.** Stored as `suggestionDismissedAt` +
`suggestionDismissedCents` on the expense row rather than in a collection — a new collection has to
buy something, and two fields on the row the proposal already concerns buy the same thing for less.
Storing the *value* rather than a flag is what lets the proposal return once the median has moved
materially (the same 15%-and-₾5 test) away from what was refused: refusing "cut breakfast to ₾4"
must not silence "breakfast has become ₾20" for ever.

A consequence worth naming: a proposal for a purpose that has no budget line yet has no row to
record a dismissal on, so `POST /suggestions/purpose:…/dismiss` is a 400. Accepting one creates the
expense through `CashflowService`; the alternative was a collection existing solely to remember a
"no", which is what the whole design avoids.

## Cashflow reads `spend_payments` directly, and actuals replace only the card budget

**2026-08-30.** The projection now prefers what was really spent on days already past. Two
decisions inside that, both of which look wrong from one side or the other.

**1. `CashflowService` reads the `spend_payments` collection itself** instead of asking
`SpendingService`, which owns it. `SpendingModule` already imports `CashflowModule` to read the
budget, so the reverse import is a cycle, and a `forwardRef` would couple the two modules'
lifecycles to save one collection read. A scoped, read-only query of another widget's rows is the
same trade `realisedSales()` already makes with `sellable_items` and `stock_lots`. Writes still
have exactly one owner.

**2. Captured payments replace only the `auto` card-spending budget.** The loan repayment and the
utilities are transfers and direct debits — SMS capture never sees them — and a one-off expense is
a dated record of money that left, not a repeating plan. Replacing a whole past day with its
captured payments would silently delete the ₾2,600 loan repayment from the projection on every
repayment day. So for a past day with actuals: `out = captured + manual-settlement occurrences +
one-off records`. The same reasoning keeps **captured credits out of the projection entirely**:
the salary arrives as a `ჩარიცხვა` message, and counting the capture *and* the budgeted income
source would double every payday.

## The spending UI lives inside the Free money page

**2026-08-30.** Principle I says one module, one route — and the spending widget shipped that way:
its own `/spending` page beside `/cashflow`. The owner merged them after using both: *"in the end
they kind of have the same goal"*, and they are right — budget, balance, spending and savings are
one question asked four ways, and answering it across two pages meant the best view of each half
was missing the other.

So the **module boundary stays** — `apps/api/src/spending/` keeps its own collections, endpoints
and service, and reads the budget through `CashflowService` exactly as before — but its **UI
renders inside the Free money page**: the cadence panels are the ladder, the one-off panel carries
the waterfall's overflow, the day panel shows captured payments beside planned lines, and payments
and capture-health sit in compact side panels. `/spending` as a page is gone; `/spending/tokens`
(capture setup) remains.

Read this as a deliberate, owner-decided amendment to the "one Next route" half of principle I,
not drift: the API namespace separation that principle exists for is untouched.

## A payment's day comes from the timestamp's own wall clock — and ingest never rejects over it

**2026-08-30.** Two production bugs found the day the owner set up their real Shortcut, both
invisible on a developer machine in Tbilisi.

**1. The 400 that lost messages.** `at` was validated `@IsISO8601()`, and an iOS date variable
left on its default format sends the device locale's prose — "30 Aug 2026 at 22:38". The request
was rejected, which violates this module's founding rule: a Shortcut cannot handle an error, so a
non-2xx loses the message for good — and here it was lost over a *metadata* field while the raw
message it carried was perfectly parseable. `at` is now an unvalidated string; anything unreadable
falls back to the arrival time, which for a live automation is seconds from the truth.

**2. The server-timezone day.** `localDay(new Date(at))` reads `getHours()` in the *server's*
zone. On this Mac (Asia/Tbilisi) every test passed; on Render (UTC), 05:00+04:00 is 01:00 server
time, so the 4am rule fired against the wrong clock and filed every early-morning payment a day
early. `wallClockDay()` now reads the literal fields out of the string — the wall clock a phone,
a browser or a bank message sends is already the owner's — and the server's zone plays no part.
Verified with `TZ=UTC`.

Candidate order matters and is deliberate: a timestamp *with a clock* (TBC's own, or the phone's)
outranks BOG's date-only stamp, because a printed date cannot say that a 01:00 payment belongs to
yesterday. `localDay(Date)` remains for the browser, where the `Date` really is in the owner's
zone.

## The completeness chain converts foreign payments, and forgives the bank's spread

**2026-09-01.** A $10 charge on the lari card made `detectMissedMessages` report a permanent
"missed payment": the message prints the amount in USD but `Nashti` in GEL, and the chain deducted
the raw 10.00 from a lari balance — reporting the difference between ten dollars and their lari
value as missing money, forever.

Three decisions, each following an existing rule rather than adding a new one:

1. **The chain runs in the account's currency.** The parser now keeps `Nashti`'s currency
   (`reportedBalanceCurrency`) instead of discarding it, and a payment in any other currency is
   converted at the rate in force on *its own day* — the fx module's one rule — before it is
   deducted. Rows ingested before the field existed are all lari accounts, so its absence reads
   as GEL.
2. **A converted segment is checked to within 5% of the amount converted, not to the tetri.**
   The bank converts at its card rate; the archive holds the published NBG rate. The spread is a
   percent or two, so demanding exactness would swap one phantom gap for a smaller one. A lost
   message misses by its own whole size and still shows; the tetri-exact check remains wherever
   nothing was converted, which is almost every segment.
3. **No rate means no verdict.** A foreign payment on a day the archive does not reach makes its
   segment unverifiable, and an unverifiable segment reports nothing — the same "silence is not
   evidence" stance the check already takes for BOG. Its closing reading still anchors the next
   segment, so one unratable day never blinds the whole chain.

## An early salary moves the payday — it never adds one, and it is never inferred

**2026-09-04.** The salary regularly lands days before its scheduled date, and the projection kept
paying it on the calendar day: "on hand now" lagged the real account for half a week and the
free-money window closed on the wrong date. Three options were considered.

1. **Infer it from the captured bank credit.** Rejected: captured credits deliberately never feed
   the projection (counting them beside the budgeted income source doubles every payday), and
   guessing which credit *is* the salary would import that double-count risk through the back
   door.
2. **Add a one-off income for the real day.** Rejected: the scheduled occurrence still exists, so
   the same salary lands twice unless the owner also remembers to end-date the schedule around it.
3. **Move the occurrence** — chosen. `income_sources.arrivalOverrides` holds
   `{ scheduledDay, actualDay }` pairs; the scheduled day identifies which occurrence moved, so
   the schedule itself is untouched and next month is back to normal with no cleanup. Because it
   is a move, the money can never be counted twice, "next salary" skips an occurrence already
   received (`nextIncomeDay()`), and marking a payment *late* works with the same mechanism.

The occurrence expansion pads its window by the largest shift among the overrides, so a payday
moved into the window from just outside it is found and one moved out of it is dropped —
`incomeOccurrences()` has the tests.

## 2026-10-18 · MCP OAuth supports phone sign-in without changing dashboard sessions

A fixed token cannot supply the plugin portal's missing token-entry flow. The API now offers
OAuth authorization code + S256 PKCE using the existing MCP SDK and explicit nutrition consent.
DCR avoids a manually provisioned shared client secret and supports host-specific callbacks.
The canonical issuer is configured, not inferred from untrusted request headers. Mongo stores
registrations and hashed expiring grants so Render restarts do not disconnect every assistant.
Client registration metadata is encrypted because confidential clients include a shared secret.

The consent page checks the existing account password without calling `login()`, which would
rotate the dashboard refresh token. OAuth tokens are independent, opaque, resource-bound and
accepted only by MCP. Existing manually generated tokens retain their behavior. Every transport
request now verifies a credential and session ownership: a session ID must never become a
substitute bearer token. Users can revoke OAuth connections from the AI Assistant settings.

## 2026-10-21 · Consent privacy headers must preserve native form Origin

The OAuth page used `no-referrer`, which makes a browser's native HTML form POST carry
`Origin: null`. Our strict CSRF guard therefore rejected legitimate sign-ins before checking
credentials. Previous HTTP smoke tests explicitly supplied Origin and missed browser behavior.
Use `strict-origin` to preserve native POST origins without leaking the ticket path/query in
Referer. Keep exact issuer-origin checks, browser-binding cookies and single-use tickets;
do not allow null origins. Reproduce and verify with a real browser form as well as HTTP tests.

The consent CSP also allows the validated request's callback origin alongside self. Chrome
applies `form-action` to the POST's redirect, so self alone prevents returning to the assistant.
The server still validates exact registered redirect URIs; no wildcard destinations are allowed.

## 2026-10-22 · Separate feature availability, Home selection and sharing

The portal is preparing for invited users and later social sharing. Registration now explicitly
assigns production access (Food by default); missing legacy cohorts retain internal access.
The legacy owner role is common to all users and cannot grant administration. Developer identity
is an explicit server account ID, and EPAM is reserved for it. A small feature_policies collection
allows cohort release switches without deployment, with individual overrides on users.

Hidden selections retain data. Dashboard summary loading is conditional, and net position is
omitted when any contributing module is absent. Money and Projects each have one product card
while retaining existing bounded services. Setup owns the same preferences as module/privacy
settings and can be skipped, resumed and revisited. Home/Menu navigation leaves social tabs for
their actual implementation. All module audiences start private; existing food visibility is
reset once using atomic per-row version markers, and public queries exclude unversioned foods.

Verification uses an isolated ephemeral Mongo database and separate API/web ports. No seed,
configuration changes or migration is run against the connected production database.

Constitution 1.2.0 records the move from a single-user dashboard to private-by-default accounts,
permits related modules to share a product card while keeping collection ownership intact, and
names the bounded exceptions for explicit food catalogue sharing and developer feature-account
administration. Owner-scoped tracking APIs remain the rule.

The API also includes an empty local `.fork-ts-checkerrc.json`, so Webpack's checker does
not inherit or try to read unrelated ancestor/home configuration files. This made the normal
API build reproducible across the workspace's two macOS account paths without changing any
home-directory permissions or skipping typechecking.

## 2026-10-22 · Social profiles use dedicated projections and atomic connection pairs

Constitution 1.3.0 permits explicit audience-checked social projections while maintaining the
private tracking API boundary. Profiles live separately from auth users so social APIs cannot
accidentally return email/credentials. Discovery is opt-in; known links work independently.

One canonical pair owns friendship, directional blocks and mutes. Conditional state writes
prevent opposite requests auto-accepting and prevent accept-after-block races. A global graph
service also lets Food honor blocks without importing the entire SocialModule back into
Nutrition and creating a module cycle. Shared widgets use separate allowlisted stats instead
of stripping fields from the much larger owner dashboard. Food's category switches constrain
its shared stats independently of the module audience.

Social is a feature flag, not a selectable tracking module. It defaults to internal/developer
only. Search/Friends ship with their behavior; Wall remains deferred until real posts exist.

### 2026-10-22 — Explicit food publication snapshots (constitution 1.4)

A post is an intentional publication event, independent of a live widget's audience. Server-created snapshots freeze the facts an author reviewed; a preview fingerprint catches source changes before publishing. This adds a narrow principle III/IV exception for immutable publications and recipient-owned imports while keeping derived totals and social widget projections transient. UUID/tombstone publishing and uniquely indexed copy imports make retries safe, without Mongo transactions or new dependencies. Imports preserve provenance, start private and cannot be recalled after another account copies them; audience changes and deletion revoke subsequent reads/imports. Public posts still require authenticated enabled accounts. Mute affects Wall; bilateral blocks and unfriend immediately affect every read. Reports hide a post from the reporter and provide a developer removal queue without granting access to private post payloads.

### 2026-10-22 — Pull-to-refresh requires a separate gesture at the top

Momentum and scroll-to-pull chaining caused accidental refreshes during normal navigation. Remove momentum-driven bounce/refresh and require the gesture to start at the page top. Keep the existing pull distance and release threshold; cancel upward/sideways gestures, interrupted touches and gestures claimed by another control. Regression tests cover normal scroll arrival, starting below the top, deliberate release, short pulls and cancellation.

### 2026-10-31 — Appearance is a browser preference

Build light/dark mode on the existing RGB semantic tokens, with System as the default and a versioned local-storage override. Resolve the saved palette in the document head to prevent a wrong-theme first paint, and synchronize OS changes, other tabs, native controls and browser chrome after hydration. This preference needs no account schema or API change. Accent text uses shared tokens; text-only status overrides improve light-mode contrast without changing nutrition progress fills.

## 2026-10-31 — Separate movement forecasts and conservative Health replacement

New profiles separate resting energy, digestion, everyday movement and net exercise; legacy
multipliers stay stable until reviewed. Only matching sampled periods can replace expected
activity. No downward adjustments are enabled because missing/zero Shortcuts data does not
establish complete wear/permission coverage. Steps and workouts never add calories on top of
active energy. Scoped one-use upload tickets avoid storing account secrets in the shared
Shortcut. Daily source snapshots preserve history. See `docs/APPLE_HEALTH_SETUP.md` for equations,
source merging assumptions and the actual iCloud-signing/device-verification blocker.

Setup completion now uses stable step IDs; legacy completion covers only the original steps.
New questions do not reset widget choices. The homepage wall replaces duplicate Wall navigation.

Constitution 1.6.0 explicitly permits the fifth Food quantity as a non-progress activity
adjustment, matching the approved UI. Weekly/cheat banking continues to use the starting target;
a sync adjustment for today must not be copied onto all other days' allowances.

## 2026-11-01 — Explicit Health sync, no browser callback, resumable query windows

The actual iPhone handoff was disruptive: launching Shortcuts automatically and returning via
an HTTPS callback opened a browser tab outside the installed PWA. Sync now requires a user tap;
a six-hour reminder replaces the five-minute launch policy. No success/error/cancel browser
callback is supplied. The existing PWA refreshes receipts on manual return. There is no claimed
iOS API for forcing an existing PWA/tab to receive that external return.

The new Shortcut uses acknowledged, server-owned hour windows rather than guessing how many
samples a calorie total needs. Capped queries split; interruptions preserve the queue. Record
identity upserts preserve previously known data when a query returns nothing, since permission
loss and actual inactivity/deletion are indistinguishable. The legacy path remains compatible.
Users build the updated Shortcut directly from the manual guide; generated plist source is
not represented as an installable signed file.

## 2026-11-03 — Push notifications: one shared system, decided on the server, no worker

Notifications are a global module that other modules register types with (who receives it,
access re-check, collapse key, URL, optional `suppress`) rather than a feature of Social or
Posts. Chat and challenges will register their own types and badge sources without touching it.

- **Whether to notify is always decided on the server, never in `sw.js`.** iOS revokes
  subscriptions that receive pushes showing nothing, so the service worker must show every push
  it gets. "Skip while the recipient is looking at the conversation" is therefore a
  server-side `suppress` hook.
- **No worker.** `notify()` is called after the write and not awaited, with a 5-second limit per
  device, because the constitution requires the app to run on free tiers. The cost is that a
  push in flight during a restart is lost. Activity still shows the item because it is derived
  on read.
- **Collapsing without a timer**, using one atomic `findOneAndUpdate` on
  `notification_deliveries`. The first like in a window sends; the rest are counted, and the
  next push after the window says "and N others". On the device, a shared `tag` replaces rather
  than stacks.
- **Activity and the badge are derived** from likes, comments and connections, with only
  `activitySeenAt` stored. Withdrawn likes, deleted comments and new blocks drop out with no
  cleanup code.
- **Subscription endpoints are allow-listed** to known push services. Otherwise a client could
  make the API POST to any URL, including internal addresses.
- **Development registers `/sw.js?mode=push`.** This makes push testable on localhost while
  keeping the old rule that development never caches bundles.
- **`web-push` (3.6.7) is used despite having no release since January 2024.** The protocol is
  frozen, and only `push-sender.ts` imports it.

The lockfile was updated by hand-merging the seven new entries. On this machine npm 11 also
pruned the Linux optional builds (rolldown) that Render and Vercel need.

## 2026-11-03 — Direct messages: friends only, polling as presence, references for posts

- **Friends only.** Only accepted friends with no block can message. A private-by-default
  health app should not let strangers send messages. Message requests can come later.
  Unfriending or blocking keeps the history readable and stops new messages.
- **Short polling instead of sockets.** A 3-second `sync` runs while a conversation is
  visible, and nothing runs in the background. This needs no always-on service (constitution:
  free tier). The same sync records `viewingAt`, which is the presence signal the `message`
  notification's server-side `suppress` hook reads. That works across devices because it is
  stored per member. A WebSocket gateway with Redis fan-out is the Tier 1 upgrade; the `sync`
  payload stays the contract.
- **Nothing derived is stored.** The inbox's last message and unread counts are computed on
  read (principle III). The cost is one count per conversation (at most 50), acceptable at this
  scale. A read model later needs a constitution amendment.
- **Shared posts are `postId` references**, rendered through `PostsService.detail()` for each
  viewer (principle IV). A recipient outside the post's audience sees "Post unavailable", and
  deleting or narrowing a post updates every card.
- **Unsend erases content** and keeps a tombstone, so ordering and "Seen" stay consistent.
  Sync reports IDs unsent since the last poll, so older bubbles update too.
- **The rate limit (30 a minute) is counted in Mongo**, so it holds across instances without
  Redis.
- **Message previews on the lock screen are opt-in** (`showMessagePreviews`), like comment
  previews.

## 2026-11-04 — Swiping between tabs: who owns a sideways swipe, and preloaded neighbours

- **Only the five tab roots swipe**, and only on touch screens. Swiping on a detail page (a
  module, a profile, a chat) would fight its own gestures and has no obvious neighbour.
- **A swipe that starts in anything that scrolls sideways belongs to that element for the whole
  gesture, even at its end.** This is how iOS nests scroll views. Android instead hands the
  gesture to the pager once the inner scroller can't move further, which is the behaviour that
  makes people change tabs by accident while flicking past the last item. The same applies to
  form controls, charts (`.recharts-wrapper`), fixed layers (modals, the editing toolbar) and
  anything marked `data-no-tab-swipe`.
- **The direction is decided once**, after 10px, and sideways must beat vertical by 1.2×. A
  vertical start stays a scroll, and a sideways one never scrolls the page.
- **All tab roots stay mounted** (superseding the first version, which mounted read-only
  previews of the neighbours and navigated to a fresh page). The shell (`PortalShell`) now lives
  in the root layout, so it survives navigation, and `TabHost` keeps every tab mounted: the
  open one in the normal page flow (the window scrolls it, so the hiding header,
  pull-to-refresh and status-bar-tap-to-top keep working), the others as hidden, inert, fixed
  layers. Each tab's scroll position is restored before the first paint after a switch. The
  previews had two costs this removes: a page shown twice, and a jump on landing (the preview's
  inline top padding replaced the page's own, so content shifted by that padding).
- **The scroll position is recorded on every touch, click and back**, not only on scroll
  events. A browser may not deliver the last scroll event before a switch (a background tab
  delivers none), and after the switch commits the old position is gone.
- Pages still wrap themselves in `AppShell`, which is now a pass-through, so the 28 pages did not
  change. On a tab root the shell ignores the page's own render and shows the live tab.
- The cost: the five tabs' data loads, and the inbox polls, while the portal is open.
- **At rest no tab has a transform at all**, not `translateX(0)`. Modals render inside the
  tab with `position: fixed`, and any transform on an ancestor would pin them to the tab.
- The tab pages' contents moved into components (`home-dashboard`, `people-search`,
  `friends-list`, `menu-content`), because a Next page file may only export the page itself and
  the pager needs to render the neighbour without its shell.

## 2026-11-04 — iOS 26's top blur: move the header below it, don't fight it

Since iOS 26, a Home Screen web app gets the system "scroll edge effect": a progressive blur over
roughly the top 40pt of the page, below the status bar. Other projects tried removing
`black-translucent`, adding an opaque strip and splitting the header's `backdrop-filter` into
another layer, and none of those removed it on a device. The approach reported to work is
keeping content out of that band. In the installed app on iOS (`display-mode: standalone` with
`@supports (-webkit-touch-callout: none)`), `--top-chrome` (the app header) is the safe-area
inset plus 0.375rem, and `--chat-top` (a conversation's header) the inset plus 2rem. The app
header already had 16px of its own padding and only its top few pixels were blurred; 1.5rem
there, tried first, pushed it visibly too low on an iPhone. The chat header has 0.5rem of
padding and needed the full clearance. The band
is the header's own flat colour, so blurring it changes nothing visible. The cost is a few pixels of
app header and 24px of chat header, only on iPhone/iPad Home Screen apps. If a future iOS changes the depth,
this is the one value to tune.


## 2026-11-04 — Post media: signed links straight to R2, re-encoded on the phone, video only from the camera

Spec 014 adds photos and video to posts on the free tier. The choices, and why:

- **The browser uploads straight to a private R2 bucket with a signed PUT**; the API never
  handles the bytes (Render's free instance has little memory and bandwidth). R2 because egress
  is free and 10 GB is free. The type *and exact size* are signed into the link (`aws4fetch`
  with `allHeaders`), so R2 itself answers 403 to a different file; the size is checked again
  with a `HEAD` when a post claims the upload. `aws4fetch` (zero dependencies) instead of the AWS
  SDK, which is several MB of packages for four calls.
- **Reads are signed links, never a public bucket.** Friends-only photos must stop working for
  someone who leaves the audience. Each read signs after the post's audience check; the
  signature uses the time floored to the hour and lasts two hours, so the same URL repeats for
  an hour (the browser cache keeps working across feed refreshes) and any link dies within two.
- **An upload ledger (`post_media`) with a reservation by `requestId`.** A publish first claims
  its uploads for its own request id, then checks the files, then inserts the post. Two posts can
  never take the same upload, a retried publish finds its own reservation, and anything never
  claimed is deleted after a day. The post keeps a copy of each file's facts (dimensions, kind,
  keys): these describe immutable files, not derived values, so principle 3 is not bent.
- **Photos are re-encoded on the device** (canvas, 2048 px, JPEG 0.85). It strips EXIF/GPS,
  which nothing on the server could do without receiving the file, and keeps uploads around
  300–600 KB. The cost: no HEIC/PNG originals, no transparency.
- **Video only from the in-app camera, 30 s.** No transcoding exists (free tier), so the app
  only accepts video it recorded itself: known length, a codec the recording browser can play
  (MP4 on Safari, WebM on Chrome). A WebM recorded on Chrome may not play on an older iPhone;
  accepted until Tier 1 adds a video service (Mux or Cloudflare Stream, see the roadmap).
  The duration comes from the recorder's clock because a MediaRecorder WebM reports `Infinity`.
- **Moderation relies on reports for now.** Public images need automated scanning before a
  public launch; it is listed as a gap in the roadmap.

## 2026-11-04: the new post page (015)

- **`/new` is a route, outside the tabs.** The tab bar's middle **+** navigates there; it is not
  one of the four tab roots, so it does not take part in swiping and never stays mounted. The
  shell hides its header and nav there, the way it does in a chat.
- **The camera is half the page and lazy.** Its stream runs only while it is visible, and the
  microphone is asked for on the first video, not when the page opens, so photo-only use never
  sees a microphone prompt. Typing puts the camera away, because the keyboard and a half-screen
  camera do not fit on a phone together. iOS may ask for camera permission again on a later visit;
  that is the browser's choice.
- **An unsaved new food is an archived food.** A post must snapshot server-side facts, and the
  publication service only builds from owned records. Creating the food archived keeps it out of
  the list and the picker without a second publication path. The single-food publication now
  accepts archived foods; the database kind does not.
- **Food photos are copies of uploads.** See [nutrition](modules/nutrition.md#food-photos-015).
- **Macro rings show shares of calories, not targets.** A post's viewers have different targets;
  shares mean the same to everyone and need no private data.
- **The media ledger moved to its own global `MediaModule`.** Foods and posts both use uploads;
  the collection name `post_media` is unchanged, so no migration.

## 2026-11-05: one camera stream per session

The installed iOS app asked for camera permission every time the new post page opened, the
camera panel came back or the camera flipped, because each did a fresh `getUserMedia` after the
previous tracks were stopped. `lib/camera-stream.ts` now keeps one stream: putting the camera away
*disables* its tracks (iOS turns the camera and its indicator off) and only ten idle minutes stop
it. Flipping asks for the new camera before stopping the old one. The microphone works the same
way between recordings. Don't go back to stopping tracks on unmount; that brings the prompts back.

The microphone is now asked for right after the camera opens, not on the first hold of the
shutter: a prompt in the middle of a hold ended the gesture, so the first video never recorded.
Its track stays muted until a recording starts.

## 2026-11-05: one Share button with a sheet, not Send and Share

A post's footer had four buttons (Like, Comment, Send, Share). Send and Share are now one Share
button opening a bottom sheet: chat heads first (sending in a chat is the share people use most),
then Copy link and More… (the system share sheet, shown only where `navigator.share` exists). The
sheet is the place to grow: reposting to your own wall and app-specific targets (Instagram,
TikTok, Messenger) belong in its second row. Every route still carries only a reference or a
`/posts/:id` link, so the post's audience applies wherever it lands.

## 2026-11-05: a repost is a reference row, and the original's audience always wins (016)

A repost is a `food_posts` row holding only `repostOf`, never a copy of the post: copying would
let content outlive its author's deletion or audience change. Every feed read checks the
repost's own audience (so a friends-only repost reaches the reposter's friends) and then the
original's, loaded fresh (so it reaches only those who could read the original anyway). For a
friends-only post that means friends of both. One-tap reposts copy the original's audience
rather than asking; a private post cannot be reposted at all. The `requestId` `repost:<id>`
reuses the existing unique index for idempotency, and a repost id is never addressable, so likes,
comments, reports and imports can only ever reach the original.

## 2026-11-05: sharing outside the app shows only what a stranger may see (017)

A Story image or a link preview leaves the app for good, so both follow the strictest audience.
The image is offered only for your own posts (you choose to show your own) and public ones
(`canShareImage()`); a friend's friends-only post never becomes a picture someone can repost
anywhere. It is drawn in the browser from what the viewer already has, so nothing new is stored.

Link previews need an unauthenticated read, because crawlers have no session. That is the
`@Public()` route `GET /public/posts/:id/preview`, deliberately narrow: public, live, original
posts only, a 404 that does not distinguish "hidden" from "missing", and a projection of title,
short caption, author name, totals and one signed photo. Everything else gets a generic preview.
Keep it the only public posts route, and keep the web page itself behind sign-in.

The canvas loads the photo with `fetch` and `createImageBitmap`, not an `<img>`: the post's own
`<img>` fetched the same URL without CORS, and reusing that cached copy taints the canvas so it
cannot be exported. The image is rendered when the sheet opens, because iOS only lets
`navigator.share` run within the tap that started it.

## 2026-11-05: one palette for calories and macros

`apps/web/src/lib/macro-colors.ts` holds the colours (`MACRO_COLORS` hex for SVG and canvas,
`MACRO_TEXT` classes for text): calories green because they are energy, protein purple, carbs
blue, fat amber. The Home widget, Food page, rings, Story image and OG card had drifted into
three different palettes. Use the constants; don't write a macro hex at a call site.


## 2026-11-11: CI runs the quality gate on every push, with no services

`.github/workflows/check.yml` runs `npm ci` and `npm run check` on every push to main and every
pull request, on the Node version in `.node-version`. Nx Cloud is off (`NX_NO_CLOUD`).

**Why now, before any launch:** the project commits straight to main, often many times a day,
and `npm run check` only ran when someone remembered. Polishing touches shared code (posts,
sharing, the shell) where a quiet regression is easy to miss on a phone.

**What it does not cover:** it needs no MongoDB and no secrets, so it does not boot the app.
CLAUDE.md's "Verifying a change" still applies; CI is the floor, not the check.

**Access tests:** the same change added specs for `AccessService` and `ModuleAccessGuard`,
`SocialService` (profiles, diaries, search, connection actions across blocks) and money widget
sharing. They assert that a refused viewer never causes the owner's summary to be computed, not
only that the response is empty, so a leak through a later field cannot hide behind a filter.

## 2026-11-11: a Claude session works GitHub issues labelled `claude`

A long-running Claude session on the owner's Mac checks issues every 15 minutes and follows
`.claude/issue-watcher.md`. It runs as one session rather than a GitHub Action so it keeps
context across questions and answers; the cost is that the Mac must stay awake. The repo is
public, so it acts only on issues the owner labelled and comments the owner wrote, and marks its
own comments (they post under the owner's account) with `🤖 **Claude watcher**`. Finished work
goes straight to `main` because the project is a test environment; revisit both when it launches.

## 2026-11-12: For You shows only discoverable authors, and only originals

Spec 018 (issue #2). Public has always meant "any signed-in member", but until now a stranger
reached someone's public posts only by opening their profile. A feed pushes them to everyone, so
an author who switched off "Let people find me" would be surprised to be broadcast; For You
therefore takes candidates only from `discoverable` profiles. Reposts are not candidates, so the
same original never appears twice; reposts become a ranking signal in #3. A page shows at most two
posts per author and skips the rest rather than deferring them, the simplest rule that stops one
prolific poster filling the page until #3 ranks properly. Its cursor is keyed separately from
Wall's so positions are never interchangeable. The `forYou` flag stays off for production until
image moderation exists (roadmap launch gate).

## 2026-11-13: For You interests match published topics only

Issue #10 (owner decisions). Interests are explicit, private choices stored in `feed_preferences`,
never an inferred profile and never health attributes. A broad interest is defined by the post
topics it matches (#8): diet tags, or a few caption hashtags. That keeps the promise honest (an
interest can only lift posts that actually say they're about it) and means the catalogue can grow
without touching ranking. Interests only add to a score; they never filter, so a thin interest
cannot empty the feed. *Clear interests* and *Reset recommendations* are separate: one forgets what
you chose, the other what you did. The setup step is optional for existing members, offered through
the existing setup continuation, and never blocks Home.

## 2026-11-13: For You ranking v1 stores a short-lived order, and reads no nutrition

Issue #9 (owner decisions on the review). Ranking is derived on read like everything else, but a
ranked feed cannot be paged by position the way a newest-first feed can: likes arriving between
pages would move posts across the page boundary, so a reader would see some twice and miss others.
So a first page stores **only the order**: `for_you_sessions`, one row per viewer, ≤ 300 post ids
with reason codes, deleted by a TTL index after 30 minutes. It is the one exception to principle 3
in posts. It holds no content and no scores, and every page re-reads and re-checks its posts, so
the cache can never show something the viewer may no longer see. Budget: ≈ 15 KB a viewer.

Inputs are the viewer's own likes, comments and reposts (90 days) and, later, chosen interests.
**Imports are not a signal**: they are recorded only in the viewer's private food rows, and even a
post-id-only read crosses the nutrition boundary; a future social "save" event could carry them
after its own privacy review. Exploration is seeded per session rather than random so ranking stays
deterministic and testable. `forYouRanking` is a separate flag from `forYou` (the production
moderation gate), off for production. Hiding an author stays an exclusion, not a down-weight.

## 2026-11-12: For You ranking is on hold; Not interested ships first

Issue #3 asked for signals, an interest profile, topics, ranked paging and metrics at once. The
owner chose to validate the plain For You feed with real use first: ranking, onboarding
interests, impression tracking and the TTL feed-session design are on hold, and #3 stays open as
the umbrella. What shipped is the user control (task A): Not interested and hide an author, in
`feed_feedback`. Hiding an author excludes them rather than down-weighting, because with no
ranking there is nothing to weigh; it can become "show fewer" when ranking exists. Recorded rule:
private nutrition logs, weight, targets and Apple Health never drive recommendations.

## 2026-11-12: Training comes before diet plans, and its catalogue is facts only

The owner wants programs (diet, training or both, possibly paid). Programs need both halves, so
training was built first (spec 020). Its exercise catalogue is seeded from free-exercise-db,
whose data is public domain, but **only its facts** are imported: its images have no stated
source and an open issue claims some come from ExRx.net, and its instruction text has the same
unknown origin. So shared exercises have no pictures or instructions yet; licensed ones are a
later addition. The catalogue seeds itself at boot (production needs it, the free tier has no job
runner) and only when the file's `version` changes. One open workout per person is enforced by a
partial unique index, which is why `status` is stored next to `endedAt`. Sets are their own rows
so two devices never overwrite each other. Training produces no burned-energy figure: Apple
Health's Active Energy already feeds Food, and counting a workout too would double it.

## 2026-11-12: Profile replaces Menu as the last tab; own profile decided by who you are

The feed links every author to `/people/:id`, and `ProfileView` chose "own" from whether the
route had an id, so your own name opened your profile as a stranger. "Own" is now decided from
the signed-in user, and `/people/<your id>` redirects to `/profile` so the Profile tab is lit and
there is one URL for one page. Menu moved behind a ☰ on your profile: people visit their profile
far more often than settings, and a fifth tab would crowd the New post button. Accounts without
social keep Menu as the tab, because they have no profile.

Profile photos reuse the food-photo path rather than a new upload type: an ordinary image upload,
copied server-side to `avatars/<userId>/` so a post using the same capture never shares the file.
The browser crops to a 512 px square because the photo is drawn beside every post in a feed; a
2048 px original there would be wasted bandwidth. The photo is identity, so it has no audience of
its own; it is signed wherever the name is shown, after that response's own check. Only your own
profile carries a friend count: showing other people's counts would reveal the size of a private
list. No cover photo: it would be a second upload flow for little, and the owner wanted the page
to stay serious.

## 2026-11-12: Training search ranks in memory; a workout's machine may be corrected

**Search ranking (spec 020 US2).** `GET /training/exercises` filters in Mongo and ranks in the
service: name or alias starts with the query, then a word starts with it, then it appears inside a
word; recent use (90 days) first within each tier. Ranking needs every match before paging, and the
catalogue is under a thousand rows, so it is done in memory with a 2,000-row cap rather than with an
aggregation or a search index. Atlas Search is the move if the catalogue or private rows grow by an
order of magnitude. The third tier exists because "row" otherwise listed "Ball throw" among the rows.

**The machine part of a snapshot is correctable.** `workout_exercises.snapshot` still never
refreshes from the catalogue, but `PATCH …/exercises/:weId {machineId}` sets the machine and copies
its current name and brand. Saying which machine was used is a fact about the workout being
corrected, not a catalogue change leaking backwards; renaming the machine afterwards changes no past
workout.

**Measure is locked once an exercise is logged** (409 `MEASURE_LOCKED`) rather than migrating old
sets, whose fields were validated against the old measure.

**`Modal` renders a `<form>` only when it has `onSubmit`.** The training picker opens "Create
exercise" and "New machine" (form modals) from inside a plain modal; every `Modal` used to wrap its
body in a form, so those nested one form in another (invalid HTML; React warns and the inner form is
unreliable). A modal without `onSubmit` never submitted anything, so nothing else changes.

## Group feature access has no "default" option

The access screen offered "Built-in default" for a cohort, which hid the value production users
actually got behind code in `resolveFeatureAccess`. `GET /api/access/users/policies` now returns
each cohort's resolved `access` map and the group editor saves the full map, so the admin sees
and owns every value. The code fallback remains only for a feature never saved for a group (a new
flag ships with it), and it is shown as a concrete value, not as "default". Individual accounts
keep "Group default", because inheriting from the group is meaningful there.

## 2026-11-12: Training estimates use Epley; kg/lb is display only

**Epley** (`load × (1 + reps / 30)`, one rep = the load) is the 1RM estimate, used only for
working sets of 1–12 reps: past about 12 reps every formula drifts, and Epley and Brzycki agree
closely below that. The estimate is never a bare number: it carries `basis` (formula, the set
it came from, and the weigh-in day for bodyweight work) and the UI prints it (principle 6).

**The weight unit changes no stored number.** Weights are whole grams; `training_profiles.weightUnit`
only decides how they are shown and how a typed value is read (1 lb = 453.59237 g, rounded to
grams once). Display keeps two decimals, so 225 lb reads back as "225 lb" and 1.25 kg plates
survive; one decimal would have shown 101.25 kg as 101.3. The Home card is built on the server,
so the summary carries the unit, read without creating a profile row: a dashboard read should
not write.

## 2026-11-12: When a training set counts as a personal record

Records (spec 020 US3) are computed on read from every set of an exercise, in **done order**
(session day, session start, set order). `loggedAt` is not used for order: a set added to last
week's workout today still happened last week.

- **A set is marked only once there is an earlier session to beat.** Otherwise a first workout
  marks every heavier set as a "PR", which teaches people to ignore the badge. Within a later
  session, each set that beats everything before it is marked, so a progression of top sets can
  all be records.
- **Marks look backwards only.** A set's marks depend only on earlier sets, so a later set never
  removes an earlier badge, and deleting or lowering a record set hands the record to the true
  best remaining set with no stored state to clean up.
- **"Most reps" on weighted exercises is at this load or heavier.** Comparing reps across loads
  would make light, high-rep sets the only reps records. The current best of the kind is still
  "most reps in one set", shown with its load.
- **Bodyweight loads need a weigh-in on or before the day.** Without one there is no load, so no
  volume, heaviest or 1RM: no figure rather than a guessed one (FR-020). The weigh-in day travels
  with every figure that used it.

## 2026-11-12: Badge awards are stored facts; progress is derived

Profile badges (spec 022) store one row per person, badge and tier the moment a tier is reached,
and nothing else about progress. The award is a fact about a moment, like a published post, not
a cache of a live value. It is never recomputed, edited or deleted, so later edits to history
cannot revoke it.
- **Why it has to be stored:** unfriending unsets `acceptedAt` and sets the pair back to
  `none`, so "had a first friend" cannot be derived afterwards. Deleting meals would likewise
  revoke streak badges.
- **What stays derived:** streak lengths, totals and on-target days are computed on every
  evaluation (principle III).

**Evaluation is triggered by the browser.** There is no event bus, the free tier allows no
worker, and Nutrition, Training, Posts and SocialGraph must not import Badges (Posts imports
Social, so a cycle would follow). So evaluation runs on the badges read and on a throttled,
unawaited `POST /badges/check`. The web fires it from the API client's `onSuccessfulWrite` hook
after qualifying writes, and once at app start. Writes from MCP or a Shortcut are picked up at
the next app start.

**"On target" uses the starting target.** It is the target before the Apple Health activity
adjustment, with the weigh-in in effect on that day. The adjustment depends on Health samples
that are deleted on disconnect, so it cannot be reproduced for past days. Weekly banking already
uses the same figure. The Food profile is not versioned, so past days are judged against the
current goal; this is labelled in the badge's description.

**Earned dates come from history.** An award is dated the day the history reached the tier, not
the day the check ran. Launch backfill and back-dated logging then follow one rule, and no "first
evaluation" marker is needed.

## 2026-11-12: How workout plans become a workout (spec 023)

- **A started plan copies its targets onto the workout (`planned`) — a third snapshot.** Editing
  or deleting a plan must not change a workout in progress or in history, and the suggestions must
  survive a reload or another device. Reading the plan live would let an edit rewrite a workout.
  Suggestions are not stored as unlogged sets: every volume, record and summary query would have
  to exclude them forever.
- **Logged sets use targets up in order; nothing links a set to a target.** "Three sets of eight"
  means three sets, so the open suggestions are `targets.slice(loggedCount)`. No extra field to
  keep consistent through edits and deletes, and deleting a set brings its suggestion back.
- **A swap is a new row.** `exerciseId` stays immutable on a workout exercise, so swapping replaces
  the row in the same position, and only before any set is logged.
- **One document per plan, with stable inner ids.** A plan is read and saved whole by one person;
  sessions point at a workout `id`, so ids survive edits and re-seeds (seeded workouts use the
  file's keys).
- **Nested Mongoose classes need `@Schema()`.** The plan's workout/exercise/target classes first
  had only `@Prop`s and `SchemaFactory.createForClass`; Mongo then stored every workout as `{}`
  while every unit test (on the in-memory fake) passed. Found by running the app. A string-union
  field also needs an explicit `type: String`, or the API refuses to boot.
- **Own plans are replaced whole (`PUT`), last write wins.** One person edits a plan, usually on
  one device; a patch language for nested lists (move, insert, remove) would be most of the code
  for no gain. What must not be lost is identity, so a sent `id` is kept and an `id` the plan does
  not have is refused (400) rather than trusted: a client cannot invent ids that sessions point at.
- **A copy is unlinked.** `copiedFrom {planId, name}` is a label for "Based on", never followed:
  updates to a ready-made plan do not flow into copies, and deleting the original changes nothing.
- **Progress and "next" are computed on read from sessions** (principle III). Storing a
  "current workout" pointer would have to be repaired on every session delete and edit; reading
  the sessions that carry `plan` needs one indexed query, and a deleted session just stops
  counting. An open session counts as done, so the next suggestion moves on as soon as you start.
- **An own exercise a plan uses is archived, not deleted**, as one a workout used already was, so
  a plan never names something that no longer exists.

## 2026-11-12: The badge notification is the one a person sends themself

**Decision.** `badgeEarned` is registered with `selfAllowed: true`, and `shouldNotify` skips
its `'self'` rule only for such a type. Activity keeps a `selfAllowed` type's own rows too.

**Why.** The `'self'` rule exists so a person never hears about their own like or comment, and
it is the safeguard that stops every other type from notifying the actor. A badge is the first
event that is about the recipient's own doing, so actor and recipient are the same person. A
per-type opt-in keeps the rule for everything else instead of weakening it globally.

**Also decided.** One push per evaluation, not per award, so the first check after launch (which
may backfill several badges) sends one "You earned n badges". Training consistency counts weeks
with two workouts, not consecutive days, because rest days are part of training.

## Training colours are derived, not stored (spec 024)

**Decision.** Training's colours come from data it already has: an exercise's first primary
muscle (or its measure, for cardio) and a plan's position among the ready-made plans, else a hash
of its id. Nothing is persisted and the API did not change. Colours are `--train-<hue>` CSS
variables, themed per theme block, plus `-solid` variants for white text.

**Why.** A stored colour would be a second source of truth for something the muscles already say,
and a user-picked plan colour is a feature nobody asked for yet. Two variables per hue because
one value cannot be both readable as text on white and dark enough under white text in both
themes. Plan colours by seed position, not hash, so the four ready-made plans never collide.

## 2026-11-12: Sticky content sits under the header and fills the status-bar band itself (issue #4)

**Decision.** The app header publishes `--header-offset` (its height while shown, `0px` once
hidden) and `--header-band` (`0px` while shown, `var(--top-chrome)` once hidden) on `<html>`.
Content that sticks to the top (the workout's rest timer) uses `top: var(--header-offset)`, a
solid background and `padding-top: var(--header-band)`.

**Why.** Home's feed tabs once stuck at `--top-chrome` when the header hid, and the iOS status-bar
band above them showed through hollow, so they were made non-sticky (spec 019). The rest timer has
to stick, so it fills that band itself, as the chat header does. On Training the header never
hides, so today it simply sits under the header. It is the same element made sticky, not a copy
shown on scroll, so its state can't fork and there is never a duplicate.

## 2026-11-12: Supersets are neighbours with the same key, and logging stays per exercise (spec 025)

**Decision.** A superset is a `superset` key on plan and workout exercises; only adjacent
exercises with the same key count. Sets are still logged on each exercise. Done, current and
the rest after a set are derived in the domain lib, never stored.

**Why.** A superset changes the order you do things in and when you rest, not what a set is, so
history, records and 1RM need no change. Adjacency instead of a group table means reordering can
never leave a broken group behind: an exercise moved away simply stops belonging. A key rather
than a "linked to next" flag, because a flag would follow the exercise when it moves and silently
link it to its new neighbour.

## 2026-11-12: A workout's rest is its own field, not an edit to `planned` (spec 025)

**Decision.** Changing an exercise's rest during a workout sets `workout_exercises.restSeconds`;
`planned` stays the frozen copy of the plan. Saving it to the plan is a separate, explicit PUT of
the person's own plan.

**Why.** `planned` is a snapshot (the meal rule): editing it would make it lie about what the plan
said. The timer's ±15 s and Skip are not stored at all; they are about this one rest.

## 2026-11-12: No live notification for a running workout (spec 025)

**Decision.** The open workout is shown by a bar inside the app, not by an ongoing notification.

**Why.** A PWA cannot make one: iOS Live Activities need a native app (ActivityKit), and the web
Notification API has no ongoing or chronometer notification on Android; the scheduled-
notification proposal (Notification Triggers) was abandoned. A rest-over notification through
the existing web push is possible and is the natural next step.

## 2026-11-12: Rest-over pushes are personal reminders, timed in memory (spec 025)

**Decision.** `restOver` is a `personal` notification type sent with `NotificationsService.remind()`,
not `notify()` with `selfAllowed`. The browser tells the API when the rest ends; the API holds one
`setTimeout` per person and never stores it.

**Why.** `selfAllowed` exists for a member's own doing reported back to them (a badge) and stays
limited to that; a reminder has no actor at all, so the actor, block and mute rules are
meaningless for it rather than bypassed. Only the browser knows the rest (superset rule, ±15 s,
Skip), so it must send the time. In memory because the free tier has no job runner and a rest
lasts minutes: losing a pending alarm on a restart costs one missed reminder, and storing it
would persist something derived. **Cost:** with more than one API instance, an alarm lives on
whichever instance received the last update; it still fires once.

## 2026-11-13: Training levels are computed on read, from your own finished workouts (issue #5a)

**Decision.** An uncapped level from XP for meaningful finished workouts:
- 100 XP each, plus up to +20 for extra sets.
- Weekly and daily diminishing returns: 4 full a week, then 2 half; a second workout in a day earns half.
- A quadratic curve: `17 × L` XP from level L to L+1.
- Computed by a pure function on every read; nothing about it is stored.

**Why.**
- **Deriving it** (principle III) means edits, deletions and backfilled history need no special
  handling and the rules can change without a migration.
- **Sets rather than kilograms** for the bonus, because XP measures participation, not strength.
- **Diminishing returns rather than a cap**, so farming earns little, nobody is pushed past about
  six sessions a week, and rest is never penalised.
- **The quadratic curve** gives quick early levels and about level 100 after five years at three a
  week (the owner's calibration target), with no maximum.

**Also decided.** Strength ranks (#5b) are not built: using other members' private training data,
the cohort threshold and the reference data need explicit owner approval first.


## 2026-11-13: For You measurement is built but off for everyone, with pseudonymous keys (issue #11)

**Decision.** Count what For You shows and what people do with it as **daily aggregates only**,
behind `forYouMetrics`, which is **off for every cohort and the developer** until turned on
(`DEFAULT_OFF_FEATURES`, a new rule in `resolveFeatureAccess`; the developer follows the internal
group's value for these). De-duplication, visits and the daily cap use **HMAC keys** keyed by a
secret derived from `JWT_SECRET`, kept 2–8 days. Opting out in Settings stops counting at once and
deletes the account's keys. The metrics never feed ranking.

**Why.**
- **Building, not collecting.** The owner lifted the hold for building only. A flag that is off by
  default even for the developer means existing code collects nothing until someone decides to.
- **HMAC, not a plain hash.** A SHA-256 of a user id, post id and day can be reversed by anyone
  holding the database, because the inputs are guessable. With a keyed HMAC only the server can
  link a key to an account. That is still pseudonymous, not anonymous, and the docs say so.
- **Aggregates, not events.** No row says who saw what; a per-account history cannot be built from
  stored data beyond the 2-day key window, and only with the secret.
- **Rates need 30.** A rate over three views describes three people, not the post.

**Not met / open.** A post with one known viewer still shows a count of one to the developer.
There is no per-IP or bot defence beyond per-account limits. Rollout needs a separate decision.

## 2026-11-13: Strength ranks are personal, fixed-standard and derived (issue #5b)

**Decision.** Rank each standard lift against **fixed, versioned published standards** (an
allometrically scaled Epley one-rep max, or reps for push-ups), never against other members.
Show a **current** rank (best valid set in 90 days; none → inactive, never lower) and a
**highest-ever** rank (each set judged by the benchmark version of its day). **Store nothing:**
both are recomputed from the member's own sets and weigh-ins on every read. Standards (men's or
women's) are the member's own explicit choice in the training profile.

**Why.**
- **Owner decision**: fixed benchmarks replaced live population percentiles, so no cross-member
  data is collected and workouts stay private.
- **Derived, not persisted**: edits, deletions, backfills and corrected weigh-ins need no special
  handling, and "never lost to a later benchmark" holds because old versions stay in code with their
  date ranges. Persisting achievements would have kept ranks earned from data later found wrong.
- **2/3 exponent** rather than load ÷ body weight, which over-rewards light lifters; no height or
  age, which would need evidence and data we don't have.
- **An explicit standards choice** rather than reading `sex` from the Food profile: a training rank
  should not quietly depend on a nutrition field, and the member can see and change it.

**Open, for the owner.** The v1 thresholds are a draft (`v1-draft`) until reviewed; whether two
standards sets (and these references, 80 kg and 60 kg) are the right categories; the exercise list.

## 2026-11-13: Tournament seasons run on Tbilisi time and group by division, mixing standards (issue #12, proposed)

**Status: superseded** by "Tournaments run on UTC, in separate categories chosen with consent" below: the owner chose UTC and separate men's and women's categories.

- **One clock for everyone.** A tournament needs a single lock and finish instant for every
  entrant, unlike meals and payments, whose day belongs to one person. Asia/Tbilisi is UTC+4 all
  year, so there is no daylight-saving edge. A set still belongs to the month by its workout's
  own `day`.
- **Lock, then grace.** Enrolment locks at 00:00 on the 1st, with no late entries, so groups are
  formed once and never reshuffled. Three days of grace let late-logged workouts count. A set
  saved after grace never counts, which is what makes final standings final.
- **Groups mix men's and women's standards.** A milestone is already normalised to each member's
  own standards. Splitting groups by standards would tell up to 100 people which one a member
  chose.
- **Sparse is honest.** Short divisions widen upward, and the widened range is shown. An exercise
  with fewer than 3 entrants has no tournament that month. Nobody is invented.
- **Snapshots are coming.** Entries will snapshot rank and baseline at lock, and results will be
  frozen at finalisation. This is a deliberate exception to "derived never persisted", for the
  same reason as `meal_entries.facts`: a later edit or benchmark change must not rewrite a
  finished competition. Not built yet.

## 2026-11-13: Rank standards v1-draft-2: researched, more exercises, machines, capped work capacity (issue #5)

**Owner direction (2026-11-13):** fixed, stable, research-informed thresholds per exercise;
separate variants including machines; separate men's and women's standards; a modest, capped
work-capacity part; no invented percentiles; no automatic calibration; any later population
analysis needs its own privacy and consent decision.

- **Derived from a few base lifts, by ratios.** Men's back squat, deadlift, bench, pull-up and dip
  thresholds are set directly. Variants are a base times a ratio from the research (front squat
  0.80, incline 0.80, overhead press 0.65, …). Women's thresholds are the men's times a factor
  per movement family. Each threshold is therefore explainable in one line, and a later
  correction changes one number rather than forty. The full evidence and its strength are in
  `docs/modules/training.md`.
- **Legend stays below world records.** It is held at about 65–80% of IPF raw records at the
  reference weight, and a test fails if it passes 85%.
- **Machines get their own, rougher standards** instead of being excluded. A free-weight lift
  still does not count a set with a specific machine attached, because that is not the lift.
  No research compares machines, so the panel says machine ranks are rough.
- **Work capacity is scored per workout and capped.** +1% for each hard set (≥ 75% of the
  workout's best) after the first, up to +5%. It is per workout so that spreading sets across the
  week, or logging dozens of light sets, earns nothing. It is capped so that it moves a rank by
  about one division at most. Tier starts stay pure strength. This replaces the earlier "no
  work-capacity component" decision, on the owner's direction.
- **Still a draft.** The version is `v1-draft-2`, which replaces `v1-draft` in place (drafts may
  change). v1 is frozen only after the owner reviews it. After that, changes are new versions,
  and highest-ever ranks are kept under the version of their day.

## 2026-11-13: Tournaments run on UTC, in separate categories chosen with consent (issue #12)

Owner decisions on #12. Scoring followed later the same day (next entry).

- **UTC is canonical.** Every boundary is a UTC instant; the web shows it in local time. It
  replaces the proposed Tbilisi clock: one instant for everyone, with no zone the app has to
  explain.
- **Separate categories, chosen explicitly.** Men's and women's tournaments are separate,
  matching the separate standards. The member picks the category, told that group members will
  see it, and it must match the standards their rank uses. The join is refused rather than
  silently converted, so the private standards setting is only ever disclosed by the member's
  own choice. The recorded `consentVersion` makes a later change to what is disclosed require
  fresh consent.
- **The lock is a snapshot, formed lazily or hourly.** Groups and each entrant's frozen rank are
  written once, at the first read or hourly job after the lock. They are the second exception to
  "derived never persisted", for the same reason as `meal_entries.facts`. A unique
  `tournament_locks` row makes formation happen once across instances; a stale claim is taken
  over. The rank at the lock counts only sets saved before the lock instant, so a backdated set
  logged later cannot change the group.
- **Retention by TTL.** Every row expires 12 months after the season finalises, so retention
  needs no job. Withdrawal deletes the entry at once rather than marking it.

## 2026-11-13: Tournament scoring: absolute strength with a capped improvement bonus (issue #12)

Owner-approved formula: `best × (1 + min(5%, improvement / 15% × 5%))`. The choices made in
building it:

- **Strength alone.** `best` and the baseline strip the rank's work-capacity bonus
  (`basis.strengthScore`). Otherwise extra sets would buy a higher score, which the owner ruled
  out.
- **The baseline is frozen at the lock, from sets saved before it.** A post-lock edit, deletion
  or backdated set can't move it. Season sets must be dated in the month and saved before
  `finalizesAt`.
- **Rounding never grants a bonus.** Improvement and bonus are whole basis points rounded down;
  the score is rounded to a whole unit. Exact ties are therefore exact integer equality, and
  they share the place.
- **A replaced draft withholds the bonus.** Ranks are still drafts that can be replaced in place.
  If the version frozen at the lock is gone, the season is scored on the current standards with
  no bonus, because a baseline under other standards would invent or hide improvement. Flagged
  to the owner.
- **Live, then frozen once.** Standings are derived on read during the season. Results are
  written once at `finalizesAt` by a conditional update, so the results reminder goes out once.
  Places are derived from frozen scores and current members, so leaving still takes effect.
- **Others see place and score only.** The breakdown (best, baseline, improvement, bonus, day)
  goes to the viewer alone, matching the owner's privacy limits.

## 2026-11-13: Rank standards v1-draft-3: 280 exercises, provisional ratio standards, load conventions everywhere (issue #5)

Owner direction: rank substantially more of the catalogue, keep variants distinct, label weaker
evidence instead of excluding it, and make the weight convention obvious.

- **Ratios to a main lift, labelled provisional.** There are no published tables for most
  isolation, dumbbell, cable and machine lifts. Each one is a typical ratio to the squat,
  deadlift or bench standard, and is flagged `provisional`. The rank shows a "Provisional" tag
  and explains it, instead of the exercise staying unranked.
- **Variants stay distinct.** Smith, machine, cable, EZ-bar, dumbbell and barbell versions each
  have their own standard and load convention. A Smith press is never a bench press, and the
  rules that keep machine sets off free-weight standards are unchanged.
- **Every standard states how load is entered, and logging shows it.** A set entered per pair
  instead of per dumbbell, or with the sled's weight included, would rank wrongly. The note comes
  from the standard (`rankLoadNote`), is shown under the exercise in a workout, and is derived
  on read, never stored.
- **The catalogue measure is checked, not assumed.** A test pins every standard to its catalogue
  row and that row's measure. That is how the 17 body-weight lifts filed under "other" equipment
  (weighted pull-ups, ring dips…) were found to be logged as weight only; they stay excluded
  rather than ranked on the added weight alone.
- **Reps tiers are at least 3 apart**, so every division is reachable. That moved women's push-up
  Explorer from 2 to 3 reps.
- **Still a draft.** `v1-draft-3` replaces `v1-draft-2` in place. Not frozen, production off.


## 2026-11-13: Weighted pull-ups and dips as body weight plus a signed load; a season keeps one standard; rank standards v1-rc1 (issue #5)

Owner direction (12:55Z): support weighted pull-ups, dips and related lifts without reinterpreting
history; freeze one standard per tournament season; check the standards systematically against
public evidence and propose a named release candidate, without enabling production.

- **Signed load, not a new measure.** `bodyweight_reps` now accepts added weight *or* assistance,
  never both. A new measure would have split Pullups' existing history; the signed load reads
  every existing body-weight set exactly as before (they carry no assistance) and lets assisted
  Pullups and Dips count, which v1-draft-3's doc wrongly claimed they already did.
- **The catalogue measure changes; history does not.** Catalogue v2 measures 16 "other" pulls and
  dips as body weight. Sets keep their snapshot measure, so a weight-only set logged before stays
  weight only. Reading it as "added load" would have been a guess (some people log the total), so
  those sets are left out of the new measure's figures and counted (`earlierMeasureSets`)
  instead. Converting them would need each person to say which they meant: a migration choice
  for later, not taken silently. Sled Row stays weight × reps: the sled is the load.
- **Nine of the 17 stay unranked** with reasons: muscle-ups (skill), one-arm chin-up (no data),
  rare chin variants, a combination drill, a feet-on-floor dip, an unclear row setup, the sled.
- **A tournament copies its standard at the lock.** A version name could be resolved to a
  replaced draft, which forced the "bonus withheld" fallback. The copy (`lockedStandard`) makes
  the season immune to new versions and measure changes; the fallback remains only for entries
  locked without a copy, of which there are none.
- **Spread for ratio standards.** Public app-user tables (Strength Level) showed constant ratios
  were up to 2× too strict at the top for small isolation lifts, and their implausibility ceiling
  would have discarded genuine sets. Ratio standards now widen above Explorer by
  (base_i / base_Explorer)^spread: 0.5 for small raises, flyes and kickbacks, 0.25 for other
  isolation lifts and machines. Kickbacks and rear-delt raises moved from 0.09–0.10 to 0.11–0.12
  of the bench. The bent-over low-pulley lateral was dropped: its divisions are about 1 kg apart,
  finer than stack plates.
- **v1-rc1** is the name for review. Still `draft: true`; freezing it is the owner's go/no-go.

## 2026-11-13: Strength standards v1 frozen (issue #5)

The owner approved promoting `v1-rc1` to official `v1`. It is the same definition: 287 standards
with the same thresholds, mappings, load notes and labels. A test checks a sha256 fingerprint of
the content, taken from `v1-rc1` before the promotion.

- **Why a fingerprint test.** Nothing else stops an innocent-looking ratio edit from moving every
  rank. A failing fingerprint says plainly that a frozen version was touched; the fix is a new
  version, not a new fingerprint.
- **Why an alias instead of keeping the old name.** "rc1" in the UI and API would read as
  unfinished. `v1-rc1` → `v1` keeps any record made under the old name (a tournament entry's
  `lockedVersion`) resolving to the same standard, so it is not treated as a replaced draft.
- **What freezing does not do.** `trainingRanks` stays off in production, and weight-only sets
  logged before catalogue v2 stay as logged.

## 2026-11-13: Tournament release readiness: no machine tournaments, reminders once per season, an erase hook (issue #12)

- **Machine and cable standards have no tournament.** The owner asked not to claim
  cross-machine fairness. Machines are private rows (`training_machines`), so two members'
  "Leg Press" can be different sleds with different cams and carriage weights, and the app can't
  tell. `tournamentExclusion()` excludes all 99 `machine: true` standards of v1, and ranks are
  unchanged. Free weights are safe because machine sets never count toward a free-weight
  standard. The way back is a shared machine identity, not a looser rule.
- **The enrolment reminder moved into the hourly job, with a unique row per season.** The daily
  00:10 cron sent nothing if the server was down at that minute, and two instances (or a manual
  rerun) would each have sent it. The trade-off: a crash between the claim and the sends loses
  that month's reminder. Losing one is better than sending two, since a reminder is optional and
  a duplicate costs trust.
- **`eraseMember()` exists before account deletion does.** Deletion is not claimed. The hook
  removes entries, group membership and frozen results, so the future flow has one call to make
  and a test that says what it must remove.
- **The group view reads `method` and `standardsVersion` from the frozen copy.** It used to read
  today's rank view, so a later release could have changed how a finished season's scores were
  labelled.

## 2026-11-14: One exercise picker; private machines retired without a migration (issue #14)

**An exercise names its equipment, and there is no machine step.** Adding an exercise was two
choices (the exercise, then which of your machines), and the machine was a private record with a
name, brand and photo. The machine added nothing the exercise could not say, and it was a second
catalogue to keep. Now picking an exercise adds it; equipment is a filter and a label. The
`/training/machines` routes and every `machineId` input are gone (an old client sending one gets
a 400 from `forbidNonWhitelisted`, rather than having its choice silently dropped).

**No data was migrated, on purpose.** Every history query, record, statistic, rank and tournament
figure was already keyed on `exerciseId`; the machine sat on top as an attribute. So nothing needed
re-pointing. Past workouts keep `machineId` and the frozen machine name, shown read-only, and
`training_machines` rows stay because those ids point at them. Rewriting history to "canonical"
exercises would have meant guessing what a free-text machine name meant.

**The ambiguous case stays as it was.** A free-weight exercise logged with a machine attached (a
barbell squat on a Smith machine) is really another movement. Ranks already left those sets out of
the free-weight standard, and they still do, so no rank or tournament score moves. They are
not re-pointed to a machine exercise, because that would silently add sets to another rank;
`npm run training:machines-audit` lists them for an explicit decision instead.

**Naming over merging.** Catalogue v3 adds "(Machine)" or "(Cable)" to the 19 machine and cable
rows whose dataset names hide it, keeping the old name as an alias. Look-alike rows (plate-loaded
*Leverage Chest Press*, selectorised *Machine Bench Press*) are not merged: merging shared rows
moves people's history and rank standards between exercises, which is the silent combining the
issue rules out.

## 2026-11-14: Rank emblems and the rank journey (issue #13)

**Signed off before building.** The emblems were shown as a concept sheet first and the owner
approved the direction and five defaults: the silhouettes and materials, pips for III/II/I, Legend
at the top of the ladder scrolled to the member, motion only on Legend's rays (none under reduced
motion), and entry points on each exercise's rank card and the training level.

**A shape per tier, not a colour per tier.** The old badge was one hexagon in eight gradients with
the tier's initial, which leaned on colour. Each emblem now has its own silhouette and glyph, and
the division is a count of filled pips with the empty ones outlined, so both read in greyscale.
The rank stays written as text everywhere, so emblems are `aria-hidden` unless labelled.

**The journey only reads the rank view.** `rankLadder` and `oneRepMaxToNextGrams` are pure
functions over the view the API already returns; frozen v1 thresholds, scoring and tournament
rules are untouched. The "load still needed" figure runs the score formula backwards, assuming the
same body weight and work-capacity bonus, and is labelled "est" (principle 6). Opened from the
training level, the journey shows the tiers alone: thresholds belong to an exercise, and there is
no account-wide strength rank by design.

## 2026-11-14: Updating a plan day from a workout is a patch, with per-day revisions (issue #15)

**A patch onto today's day, not a copy of the workout.** Copying the workout over the day would
undo anything edited after the workout started, and would turn this workout's performance into
next week's prescription. `planDayUpdate` instead applies only what the workout changed (added,
removed, swapped, moved, rest, superset) to the day as it is now; everything else stays.

**Removal must be explicit.** Finishing drops planned exercises with no logged set, so after a
workout "not done" and "removed" looked the same. Treating every missing one as a removal would
silently shrink a plan after one short session. `removedPlanExerciseIds` records deliberate
removals from now on; workouts logged before this never propose removals.

**Never a weight, never an unlogged set.** Targets are derived only where there are none to keep
(a new exercise, a swap to another measure): one per logged set, type plus reps, time or distance.
A kept exercise's sets are not touched, even if more or fewer were done.

**Per-day revisions, checked on both writers.** A plan-level version would make an edit to Legs
block updating Push. The day's `revision` is bumped on content change only (a rename is not), the
update is a conditional `$[day]` write, and the plan editor and "Also save to plan" send back the
revision they loaded so a stale editor cannot undo an update either. Old clients that send none
keep last-write-wins rather than breaking.

**Once per workout; ready-made plans become a copy.** `planUpdate` on the session makes any repeat
return the first result, which also covers the ad-hoc exercise that, once added to the plan, the
workout still has no link to. Ready-made plans are seed-owned and read-only, so applying copies
the plan first (ids mapped by position, which `copy()` preserves) and updates the copy. That is
the one product call flagged on the issue for the owner to overrule.

---

## 2026-11-14 · Some data now lives on the device, and only some (supersedes the data-at-rest half of 2026-08-20, issue #16)

2026-08-20 said no private data rests on the device: the service worker caches no `/api`
response. That still holds for the **service worker**, unchanged. What changes is that the page
itself now keeps data in IndexedDB, because a set logged at the gym with no signal was lost when
the app closed, and #17/#18 need training and food to work offline at all. The owner approved
this on #16 with conditions, which are the design:

- **Allowlist, enforced in code.** Only `training`, `nutrition` and `social` may store anything
  (plus the exact key `shell:portal`, module flags with no records, without which the shell cannot
  draw offline). Money, banking, investments and work stay online-only; the outbox and cache throw
  for any other key, and a test asserts that money keys are refused.
- **Opt-in by use, minimum kept.** Nothing is stored until an offline-capable screen stores it.
  Unused cached reads go after 30 days, the refresh-token lifetime. Unsynced writes never expire.
- **Not encrypted at rest.** Browser storage is readable by anyone using that browser profile, and
  iOS can evict a site's storage after weeks without use. Settings says both, plainly.
  `navigator.storage.persist()` is requested, which reduces but does not end eviction.
- **One database per account**, deleted on logout, never replayed under another identity: a 401
  pauses the queue until the same account signs in. A second account on the device does not see
  the first's data.
- **Never silently discard a write.** Logout and "Clear offline data" with anything pending show
  the count and offer Sync now / stay / discard, the last behind a second confirmation.
- **Idempotency on the server, not just the client.** A retry after a lost response is the normal
  case offline, so every authenticated write may carry `Idempotency-Key`, stored per user for 7
  days. 4xx refusals are replayed too (the write was decided); 5xx releases the key.
- **"No answer" is not "signed out".** A token refresh that gets no answer used to clear the
  session, which offline meant being logged out by a tunnel. Now only a refusal does.
- **No dependency.** `idb` and `fake-indexeddb` were approved in principle; installing either
  rewrote ~1,400 unrelated lockfile entries, and the adapter needed is four operations on two
  stores. Hand-written, tested through an in-memory store behind the same interface.

See `docs/modules/offline.md` and `specs/027-offline-foundation/`.

## 2026-11-14 · Offline workouts: client ids, a pure overlay, the server decides (issue #17)

A workout done with no signal has to show every set at once, survive a reload and sync exactly
once, while records, ranks and tournaments stay the server's. The owner approved the defaults on
#17; these are the non-obvious parts:

- **The device chooses ids.** A set logged offline must be editable, untickable and removable
  before the server has seen it, and must not change identity when it has. So every create sends
  an ObjectId-shaped `id`; the API validates the format and refuses one that *any* user already
  has (409 `ID_TAKEN`), so a guessed id cannot reach another account's row. Rows a plan start copies
  get ids derived from the start's `requestId` (sha256, first 24 hex), the same function on both
  sides with a shared test vector, so the device knows them without an answer.
- **No second store.** What the screen shows is computed: the cached server copy with the outbox's
  writes applied in order (`training-overlay.ts`). Nothing is copied into a "local workout" that
  could drift; a reload rebuilds the same thing. Each op is idempotent, so an acknowledged write
  stays applied until the refetch arrives — no flicker, no double.
- **Two open workouts are the person's call.** A start with a client id while one is open is 409
  `SESSION_CONFLICT`, never resumed or merged: merging two sets of sets silently is how a PR gets
  counted twice. The sync sheet offers finishing the other (at its last set) or discarding this
  one. The exception is an online start that collides with nothing logged on it yet: that is the
  old "a stale screen pressed Start" case, and it still just shows the open workout.
- **Client times are clamped, not trusted.** `startedAt`, `loggedAt` and `endedAt` are accepted so
  a workout synced an hour later is timed correctly, but clamped to now and to 48 h back, a set
  never before its workout, a finish never before the last set. A wrong device clock can shift a
  workout, not invent one in another week.
- **Derived figures stay on the server.** Records, ranks, levels, 1RM and tournament results are
  not computed on the device, even provisionally as numbers; the workout says they update once
  synced. One code path computes them, so there is nothing to reconcile and nothing to duplicate.
- **The plan half of a rest change stays online.** "Also save to plan" is a whole-plan `PUT`; queuing
  it would overwrite edits made elsewhere. The workout's rest is saved offline; the plan says it
  needs a connection. A plan-day update (#15) is different: it is conditional on the day's
  revision, so it is queued and a `PLAN_CHANGED` refusal sends the person back to review.

- **A 409 is not replayed (amends spec 027).** The idempotency layer stored every 4xx and
  replayed it for the same key, so a write refused with `SESSION_CONFLICT` kept getting the same
  refusal after the other workout was finished: "resolve, then Retry" could never work. A conflict
  is about the state at the time, not the write, so a 409 now releases the key like a 5xx. Other
  refusals (a 400 for a bad set) are still replayed. Found by the runtime check, not the tests.

See `specs/028-offline-workouts/`, `docs/modules/offline.md`.

## 2026-11-14 · Offline food: the server still takes the snapshot (issue #18)

The snapshot rule says a meal's facts are built by the server and never accepted from a request.
Offline, the server only sees the meal when it syncs, so the food may have been corrected in
between (on another device, say). The owner kept the rule: the device shows the meal with the
food as it has it, marked provisional, and sends only the id, food, amount, day and slot; the
server snapshots at sync and its numbers win. When they differ, the meal says "Updated after sync"
with both figures. Accepting the device's facts would let any client write arbitrary nutrition
history, which is what the rule exists to prevent.

- **A day never opened is still loggable.** The newest kept day is reused with nothing eaten, so
  crossing midnight (or the day-start hour) in a basement does not lock Food. Its week and
  targets are the latest copy's, which is close enough for provisional figures.
- **2,000 foods, most recently used first.** Waiting meals carry their own facts, so trimming the
  foods can never break one; the owner's "never evict a food a pending entry needs" holds by
  construction rather than by bookkeeping.
- **Withdraw, don't delete.** Removing a meal that never reached the server discards its queued
  create (and its corrections) instead of queuing a delete the server would 404.
- **The settling list is shared.** Training's "acknowledged but not refetched" list moved to
  `lib/offline/settling.ts`; both modules use it.

See `specs/029-offline-food/`.

## 2026-11-14 · Edits carry the version they were made against; nothing is merged on its own (issue #19)

**Context.** Since #17/#18 edits can be queued on several devices and arrive hours apart. Every
`PATCH` was last-write-wins: correcting a set on the phone and on the laptop kept whichever
arrived last, silently.

**Decision.** A counter `version` on every row a device can edit (sets, workout exercises,
workouts, meals, weigh-ins), bumped with `$inc` by each edit, and an optional `baseVersion` on
each edit. A mismatch is 409 `STALE_EDIT` with the current row; the update is also filtered on
the version, so a race between the check and the write is caught. The owner chose the policies:
numbers are mine-or-theirs by explicit choice; a note may be combined only through a preview the
person edits and confirms; a weigh-in is never overwritten without a choice (and the choice can
be undone); deleting what is already gone succeeds; editing a deleted row is `ROW_DELETED`,
recoverable by discarding or adding it again.

**Why a counter, not `updatedAt`.** Clocks differ across devices and Mongo's `updatedAt` moves on
bookkeeping writes. A counter only moves on edits, and only the server increments it.

**Why bookkeeping does not bump it.** Reordering exercises, finishing a workout or recording a
plan update cannot clash with a note or a rest time; bumping on them would turn harmless
concurrent actions into conflicts the person has to resolve.

**Why unchecked edits still work.** The MCP tools and Shortcuts edit without a version, as do
writes queued by an older build. They keep last-write-wins, which is what they had.

**Why "keep mine" gets a new outbox id.** The idempotency fingerprint covers the body; the same
key with a new `baseVersion` would be `IDEMPOTENCY_KEY_REUSED`. A resolved write is a new request.

**Why deletes no longer 404.** Two devices deleting the same row is not an error the person can
do anything about. The delete still only matches the caller's own rows, so answering "deleted" for
an id that is someone else's reveals nothing and changes nothing.

## 2026-11-14 · Offline likes and comments; a like/unlike pair cancels only if it never left (issue #20 S1)

**Context.** The owner split offline social into S1 (likes, reposts, comments), S2 (drafts) and
S3 (reading kept posts, deferred until a privacy policy for other people's posts is confirmed).

**Decision.** S1 rides the outbox like training and food. Comments take a device-chosen id. A
"post not readable" 404 carries `POST_GONE`, so a queued like or repost on it is dropped quietly,
while a comment (the person's own words) waits in the sync sheet with its text.

**Why cancelling needs `maybeSent`.** The owner wants a like/unlike made offline to send nothing.
But a like whose answer was lost may already be on the server; withdrawing its unlike would leave
the server liked and the screen not. So `api.ts` refuses without fetching when the browser says it
is offline (`NetworkError(notSent)`), and the outbox marks any other transient failure
`maybeSent`. Only a write that provably never left is withdrawn; otherwise both are sent, which
ends in the same state, at the cost of the author possibly seeing a notification.

**Why no posts are kept.** Interactions need a post on screen, which is enough for S1. Keeping
other people's posts on the device is S3 and is waiting for the owner.

## 2026-11-14 · A post draft is one outbox item that holds its photos (issue #20 S2)

**Decided:**
- A post written with no connection is kept as a single outbox item (`social.post`) whose body
  holds the photos themselves. The runtime sends it with its own sender, which performs the
  several requests a post needs.
- The outbox's `send` gained `save(body)`, so each uploaded photo's id is written onto the item as
  soon as it lands.
- Upload links are asked for at publish time and never stored.
- `POST /posts` relies on the draft's `requestId` rather than an Idempotency-Key, because the
  body may legitimately change: a photo the server lost (`MEDIA_GONE`) is uploaded again, once.

**Buys:**
- Drafts get the outbox's ordering, retries, auth handling, the sync sheet and `dependsOn` for
  free. A draft of a meal logged offline simply waits for that meal.
- A retry never uploads a photo twice, and never creates a second post: `requestId` makes a
  repeat return the same post, and the composer copies the ids of photos already uploaded.

**Costs:**
- Up to 50 MB sits in the outbox while it waits.
- A large upload holds back the writes queued after it.
- Discarding the meal a draft depends on discards the draft too.
- Limits follow the owner's answer on #20: photos only, at most 4 per draft, 50 MB in all.

