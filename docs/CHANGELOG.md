# Changelog

User-visible changes. Newest first.

## 2026-08-03 — Fixed a dev-server port clash

`npm run dev` started the API and the web app on the same port. `PORT` is read by both NestJS and
Next, so a single value made whichever started second fail with `EADDRINUSE`. The API now reads
`API_PORT` (falling back to `PORT` for managed hosts) and the web ports are pinned to 4200, so
they cannot collide. **Rename `PORT` to `API_PORT` in your `.env`.**

## 2026-08-03 — Initial build

The whole portal, end to end: eight widgets with summary cards and detail pages, wired together.

**Debts** — many loans with an explicit repayment priority. Payment history, repayment plans, and
three payoff scenarios ("Everything sells at target", "Realistic", "Salary only") each listing
what it assumed. Seeded with the real friend loan: $17,000 borrowed, $10,500 outstanding.

**Free money** — reconcile your balance, record income and recurring or one-off spending, then see
a day-by-day projection and, for any date you pick, the three numbers that matter: what you will
have, what is due before your next salary, and what is genuinely free.

**Items to sell** — three price points per item (asking, realistic, walk-away), statuses from
draft through to sold, buyer interest, and earmarking of proceeds to a specific debt. Marking
something sold can record the payment against that debt in the same step.

**Stocks** — holdings as individual purchases so the same share bought twice keeps both cost
bases. Live prices from Finnhub with graceful fallback to manual entry, your own target prices,
and a suggested target that shows its full arithmetic. The EPAM share plan is projected forward:
$2,880 every six months at 15% off the lower of the 1 May and 1 November closes.

**EPAM** — direct reports with attention states and the reason behind each one, 1:1 tracking with
an overdue flag, a promotion-points log for interviews, referrals and staffing help over a rolling
six months, and a review-evidence log.

**Client project, SoulArt, ShopIt** — prioritised task lists with notes; the client project also
keeps review evidence.

**Personal life** — activities, date nights, trips and goals, with travel history. A plan with a
cost and a date can add itself to your budget automatically.

**Dashboard** — every widget as a card with at most three numbers, a net-position figure, and a
cross-widget attention feed (salary landing soon, negative free money, a debt with no guaranteed
plan, stale share prices, people needing attention, overdue 1:1s, a plan this week).

**Under the hood** — full authentication with rotating refresh tokens, every API route guarded by
default and scoped to the owner, integer-cent money throughout, calendar dates as strings to
sidestep timezones, and 79 unit tests over the projection, scenario, ESPP and target-price logic.
