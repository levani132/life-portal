# Changelog

User-visible changes. Newest first.

## 2026-09-04 — Sell shares, and say where the money goes

Each purchase on the Stocks page now has a *sell* action: how many shares (part of a lot is
fine), at what price, on what day — and, in the same dialog, where the money goes. All to your
balance, all earmarked for a loan, or split: pick the loan and say how much of the proceeds it
gets, and the rest lands as spendable cash on the sale day. The earmarked share is set aside for
the debt rather than counted as free money; record the actual repayment on the Debts screen when
you send it, as before.

## 2026-09-04 — Tell the app the salary landed early

Salaries rarely land on the scheduled day — a weekend or a holiday moves them forward. Each income
row now has *landed on another day?*: pick the payday that moved and the day the money actually
arrived, and everything recalculates around the real date — the projected balance rises on that
day, "next salary" skips an occurrence already received, and the free-money window closes on the
real arrival instead of the calendar one. It moves the payday, never duplicates it, and an *undo*
in the same dialog puts it back.

## 2026-09-04 — A hand-entered payment can now name its card

A transfer entered by hand used to make the missing-message check cry wolf: the card's next
balance reading moved by money the chain knew nothing about. The *card last four* field now shows
when editing any payment, not only when adding one — put the card on the transfer and the gap
closes; clear the field and the payment leaves the chain again. (Adding the card at entry time
always worked; now it can be fixed after the fact.)

## 2026-09-04 — One tap to make a split add up

When confirming a payment across several allowances, editing one amount left you doing arithmetic
for the others. Each row now offers *put the remaining X here* (or *take the extra X off this
row*, when the split overshoots) so the second field levels itself.

## 2026-09-04 — The edit form no longer hides behind the payment list

**Fixed:** pressing *edit* inside "Every payment" opened the edit form underneath the list it was
opened from. It now opens on top, and Escape closes only the top-most dialog instead of the whole
stack.

## 2026-09-01 — A dollar payment is no longer a "missed message"

**Fixed:** paying in a foreign currency on the lari card put a permanent gap in the capture-health
panel. The bank prints the charge in dollars but the balance in lari, and the completeness check
deducted the raw dollar figure from the lari balance — so every such payment looked like money
that left the account without a message. Foreign payments are now converted at the National Bank
of Georgia rate for the day they were made, with a small allowance for the bank converting at its
own card rate; a real missed message still shows at its full size.

## 2026-09-01 — Pull down to refresh

The page now refreshes the way the feed apps do: pull down at the top — or just keep dragging,
or flick hard enough, when a scroll reaches it: the top bounces, and a bounce past the threshold
refreshes without a second gesture. The ring fills as you
pull, a small tick (on phones that have one) says when to let go, and releasing refetches
everything on the page — no reload, no lost scroll position elsewhere. The header also casts a
soft shadow once content scrolls under it, and no longer follows the page when the top is
overscrolled — the browser's rubber band is off, and the pull gesture is what lives there now.

## 2026-08-30 — The shortcut works however your phone formats dates

**Fixed:** the very first real message from a correctly set-up shortcut was rejected, because iOS
sends its date variable as human-readable text unless told otherwise, and the server insisted on a
machine format — losing the message over a cosmetic field. Any date format is accepted now; one
the server cannot read just files the payment under the moment it arrived, seconds off at most.
The setup instructions also show how to set the variable to ISO 8601 for exact timing.

**Also fixed before it ever bit:** the day a payment belongs to was computed in the *server's*
timezone, which is UTC in production — an early-morning payment (before 8am Tbilisi) would have
been filed a day early. The day now comes from the timestamp's own wall clock, wherever the
server runs.

## 2026-08-30 — A lari lunch no longer wears a dollar sign

**Fixed:** a budget line entered in one currency was shown with the display currency's symbol on
its raw number — a ₾8.28 lunch read as $8.28 — and the "≈ /month" totals on the spending panels
and the per-category breakdown added raw lari to raw dollars, producing figures that meant
nothing. Every row now shows its own currency (the converted view lives on the bar beneath it),
and every total converts each line at today's rate before summing.

## 2026-08-30 — A day now says what it spent, not just what it paid

The date panel used to answer only the bank's question — how much money left the account that day.
It now also answers yours: **how much that day actually consumed**, whichever day paid for it. Milk
bought once spends across every breakfast it covers, so a quiet day can still have spending, and a
₾7.67 shopping day can have spent only its own slice. The two figures sit side by side as *paid
out* and *spent*, with the day's slices listed underneath — each saying which payment it came from
and when that was paid.

## 2026-08-30 — The comma key now types fractions

On a Georgian keyboard the iPhone's number pad offers a comma where the decimal point should be,
which made fractions impossible to type into any amount field. Typing a comma now simply becomes a
decimal point, everywhere — money, portions, body weight.

## 2026-08-30 — One money page

**The Spending page has merged into Free money.** They were always the same question — where is my
money, where is it going, what have I kept — and now one page answers it.

What changed, walking down the page: the four headline tiles are now *on hand now*, *used against
allowances*, *saved this month* (with your all-time saving underneath) and *monthly net*. The chart
lets you choose how far ahead to look, marks today, and draws the past from your **actual**
payments and the future from your plan. Picking a date now works for past days too, and shows the
real payments of that day — labelled confirmed, projected or planned — beside the transfers and
one-offs. "Where it goes" shows what you have actually spent per category against what you
budgeted. Your daily, weekly, monthly and yearly spending panels now fill up as real payments
arrive (x of y on every line), can be dragged into the order the money should drain in, and carry
the app's budget suggestions inline. One-off spending keeps its month view and gains the unplanned
overflow — anything past every allowance lands there. Payments and capture health live in compact
side panels, and the projection itself is now anchored to reality: past days use what you really
spent, while transfers and one-offs the messages cannot see stay counted.

Runway is gone (never looked at), and "free to spend" folded into the date picker where it always
made more sense.

## 2026-08-29 — Spending: see where the money went, and what you saved

Building on the capture below, the app now works out **what each payment was probably for** and
keeps score.

**Your budget becomes a ladder.** The spending you already planned — daily meals, weekly fuel and
chores, the monthly lines — fills up in the order you choose. A payment fills the first allowance,
then the next; when the day's allowances are used up it draws on the week's, then the month's, and
anything past that is unplanned spending you can sort out later. One payment can split across
several allowances, so the bars always add up to what you actually spent.

**The app guesses; you decide.** Every payment shows where it probably went, marked plainly as a
guess. Confirm it and it becomes fact — across several allowances if one shop trip was part dinner
and part household, or only partly if you only know some of it. Say it was something else entirely
and it stops touching your budget at all, and one button turns it into a new budget line if it
turns out to happen every month.

**Confirming one payment rearranges the guesses around it.** Say the morning shop was the whole
day's food and the evening one moves to your weekly allowance by itself. And once you have said
what an allowance went on, no guess may quietly fill the rest of it — that unspent part is a saving
you earned, and it stays visible.

**Two things you can now say that most budget apps cannot.** That tonight's shopping was for
tomorrow, and that one carton of milk covers the next four breakfasts — the cost spreads evenly
across those days, so tomorrow correctly shows as already partly paid for. And where part of a
payment was never really yours — a shared dinner someone paid you back for — you can mark that part
as not really spent.

**It keeps score.** For any day, week or month: what you saved against your allowances, what you
spent outside them, and the net. Across all time: how much you have saved in total and how much of
it came from your daily, weekly and monthly allowances. Overspending shows as overspending, not as
zero.

**And over time it will tell you when your budget is wrong.** Once there is enough history — four
weeks for a daily line — it proposes a figure that matches what you actually spend, always saying
what it is based on. Nothing changes until you accept it.

## 2026-08-29 — Your card payments arrive on their own

**Your bank already texts you every time you pay. The app now listens.** Set up a shortcut on your
phone once — there are step-by-step instructions and copy buttons on the new Spending screen — and
from then on every card payment appears within a minute, with the amount, the shop and the card,
without you opening anything.

Anything it cannot read confidently is **kept exactly as it arrived and queued** rather than
guessed at, so a bank changing its wording is a short list to work through rather than a hole in
your records. Cash and anything your bank did not text about can be added by hand in seconds.

It also **checks its own arithmetic**. One of your banks prints the account balance in every
message, so when the balance and the payments disagree, the app can tell you a message went
missing and exactly how much it was for — rather than letting a lost text quietly look like a
cheap day.

Loyalty points, cashback and account balances are read but never counted as money, and a transfer
into your account is never mistaken for spending.

## 2026-08-29 — Choose the currency when you enter an amount

**Every amount you enter now has a currency picker**, sitting inside the amount box. Spending,
income, your balance, items to sell, debts and personal plans all have one, and it starts on your
display currency so most of the time there is nothing to change.

Until now no form offered the choice, so everything was recorded as dollars whatever you meant —
which is why a lari expense could end up stored as a dollar one. Existing records keep whatever
they were saved as; correct any that are wrong by editing them and picking the right currency.

Share lots deliberately have no picker: a share's currency is set by the exchange it trades on,
not by preference, and choosing the wrong one would quietly corrupt every position figure.

## 2026-08-29 — The currency setting now reaches every page

**Fixed:** the Stocks, Items and Personal pages showed their totals with a lari sign over dollar
amounts, and changing the display currency in settings did nothing to them. Only the dashboard had
been converting. All three now honour the setting, as does every figure they show.

Individual rows still read in the currency they were recorded in — a share bought at $114 says
$114, because that is what was paid. It is the totals that follow your display currency.

## 2026-08-25 — Everything in lari

**The app now reads in one currency, and it is yours to choose.** Figures recorded in dollars —
the salary, the loans, the EPAM shares, the budget lines — are converted and shown in Georgian
lari, so the dashboard's net position is finally one number rather than dollars and lari added
together. Set it back to USD or EUR in settings whenever you like; nothing about your data changes,
only what it is displayed as.

**Rates come from the National Bank of Georgia**, refreshed each morning, and every amount is
converted at the rate that applied *on its own day*. A figure you looked at last week still reads
the same this week, even though the lari has moved since.

Where a rate is genuinely unavailable, the amount is shown in the currency it was recorded in and
marked as such, rather than quietly presented as though it had been converted.

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
