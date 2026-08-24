# Changelog

User-visible changes. Newest first.

## 2026-08-24 — Put the widgets where you want them

**Hold a card and drag it.** The dashboard's cards are no longer stuck in the order the app picked.
Press and hold any card for a moment: the cards start to wobble, the one under your finger lifts,
and dragging it moves it — the others slide out of the way, the same as rearranging icons on a
phone. Let go and it stays there, on every device you sign in on.

There is a **Rearrange** button above the cards for when a long press is not what you feel like
doing, particularly with a mouse, and while rearranging a bar at the bottom offers **Reset order**
to put everything back the way it shipped. **Done** — or Escape — leaves rearranging. With a
keyboard, tab to a card and the arrow keys move it.

A card you have never arranged — a board you add tomorrow — appears at the end rather than pushing
its way into the middle of the order you set. Removing a board just removes its card; everything
else keeps its place.

## 2026-08-24 — Yesterday's breakfast, one tap away

**Every meal now offers what you usually eat then.** Under breakfast, lunch, dinner, snacks and
anything else there is an "Again" row of the things that slot has eaten over the last fortnight,
each one a single button: the food, the portion you actually had, and what it adds. Press it and
the meal is logged — no picker, no amount to type. Eat the same porridge most mornings and it sits
first every morning; a one-off from yesterday is offered too, just below the routine.

The portion offered is the one from the last day you ate it, and the calories are the food's
numbers as they are now, so the button says exactly what pressing it will add. Anything already
logged in that slot today drops off the row, and the row follows the day you are looking at — fill
in Saturday and it offers what the Saturdays before it ate, not what today ate.

## 2026-08-21 — The loading screen is the logo, and the app no longer zooms

**The boot screen is centred, and animated.** Opening the app used to show a small spinner and a
line of text pinned near the top of an otherwise empty page. It now fills the screen with the app's
own mark — the portal ring from the icon, with its gauge sweeping to 100%, holding for a beat and
unwinding back to 0% while the three bars inside breathe. It reports no percentage, because the boot
has no measurable stages and a fake number would be a claim the app cannot support. With
"reduce motion" turned on it shows the static logo instead.

**Zoom is off.** Pinch-zoom and double-tap zoom are disabled, and — the actual daily annoyance —
iOS no longer zooms in by itself every time you tap a text field: form controls are 16px on touch
screens, which is the threshold above which it leaves the page alone. Nothing needs magnifying to
read, and a stray pinch no longer leaves the app sitting off-centre with no browser chrome to
reset it.

## 2026-08-18 — Today's balance is calculated, not remembered

**"On hand now" was showing the figure you last typed in**, not what you have today. It is now the
reconciliation rolled forward through every salary, expense and sale since — so the salary that
landed on the 7th is in it — and it is marked as the estimate it is, with the confirmed figure and
its date underneath. The "Update balance" form opens on that projected number so you only have to
correct it.

**"On this plan you run out of money on …" no longer points at the past.** It only reports a
shortfall from today onward; the stretch between your last reconciliation and today already
happened.

**Debts now tell you when the ledger has fallen behind the plan.** If scheduled repayments have
fallen due with no payment recorded, the loan shows how many and how much, and what you would owe
if they all went out as planned — with a one-click prefilled way to record them. Outstanding itself
still counts only payments you have recorded: a plan is an intention, and assuming it was followed
would understate a real debt.

## 2026-08-18 — Free money: spending split by cadence, and a day-detail panel

Recurring spending was one flat list where a daily habit sat next to a yearly premium. It is now
four panels side by side — **Daily, Weekly, Monthly, Yearly** — each with its entry count and
monthly equivalent (labelled as the estimate it is), plus the total across all of them. A
"No schedule" panel appears only if a recurring row somehow has no recurrence, so nothing is hidden.

**One-off spending** has its own section with a month chooser: pick a month, step through with
‹ ›, or jump to any month that has entries, and see just that month's one-offs and their total.
Paused rows are shown but excluded from the total, matching the projections.

**State on a specific day** is a new panel: opening, in, out and closing balance for the day you
pick, then everything that lands on it — salary, recurring spending, one-offs and cash from things
you sold, each labelled with what put it there. **Any date works, including past ones.** Balances
only exist from your last reconciliation onward, so for earlier days the two balance figures read
"—" and you still see everything that moved.

Each cadence panel has a **`+`** that opens the add form already set to that cadence, and the
one-off panel's `+` dates the new entry into the month you are looking at. Empty panels offer the
same button instead of just saying nothing is there.

**Changing the date no longer reloads the page.** The planning panel used to refetch everything
for the new date, which blanked the whole screen to a spinner; the three numbers are now computed
from the projection already in hand.

**Selling something now shows up as money in.** Marking an item sold, or selling shares from a
lot, produces a one-off inflow in the projection and in the day panel — derived from the item or
lot itself, so there is nothing extra to record and nothing that can drift out of step. Proceeds
you earmarked for a debt are deliberately left out of the cash figure, because the Debts screen
already counts them; a fully earmarked sale is listed at $0 with a "to debt" tag rather than
hidden. And a sale no longer counts as a payday, so it cannot make "due before payday" look
smaller than it is.

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

**Food** — what you ate today against what you should eat. Log a meal in three taps from the
dashboard itself, or from any of breakfast, lunch, dinner, snacks and anything else, choosing
servings or grams and seeing the calories and macros before you commit to them. Your own food
database, entered from the packet either per serving or per 100 g, or imported by name or barcode
from Open Food Facts — and still fully usable by hand when that is unavailable. Calorie, protein,
carb and fat targets worked out from your height, age, weight, activity and one of six goals —
including body recomposition, for losing fat and building muscle at the same time, each
figure showing the equation and inputs behind it, with warnings when a goal asks for a deficit
deeper than is useful. Weigh-ins are dated, so the targets follow your weight and the trend is
drawn for you. The week is shown beside the day, because that is what actually moves the scale, and
a cheat day you set gets a countdown, a priority list of what you want to eat, and the calories
banked from the days you came in under.

The food database starts with the eleven things you actually eat — the Fresco chicken meals, both
protein shakes, the Go On bar, grilled chicken breast, buckwheat, and eggs — loaded by
`npm run seed:foods`, which is safe to re-run.

**Install it on your phone** — Life Portal is now a proper app: add it to your home screen and it
opens without browser chrome, with its own icon and splash screen, and still loads the shell when
the connection drops. It caches no data of yours to do that. The mobile layout was rebuilt at the
same time: no more sideways scrolling, and the eleven widgets live behind a menu button instead of
four rows of wrapped links.

**Under the hood** — full authentication with rotating refresh tokens, every API route guarded by
default and scoped to the owner, integer-cent money throughout, calendar dates as strings to
sidestep timezones, and 182 unit tests over the projection, scenario, ESPP, target-price and
nutrition logic.
