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
