# Quickstart — validating the spending waterfall

`npm run check` is necessary but not sufficient here, and this feature is a worse offender than
most: it can typecheck, lint and pass every unit test while capturing nothing at all. The FX work
that preceded it shipped a live bug (`inForce: null`, no conversion anywhere) that only running it
exposed. So the last three sections are the ones that matter.

## Prerequisites

Never point at `.env`. Its `MONGODB_URI` is the owner's live Atlas cluster and a `nx serve api` on
`:3333` is usually already running against it.

```bash
docker start lp-mongo                      # already exists, host port 27019
npx nx build api
MONGODB_URI=mongodb://127.0.0.1:27019/lp-spend JWT_SECRET=$(openssl rand -hex 32) npm run seed
```

Then a second API off the built bundle, so it does not collide with the running serve:

```bash
MONGODB_URI=mongodb://127.0.0.1:27019/lp-spend \
JWT_SECRET=testsecret_at_least_32_chars_long_xx \
API_PORT=3334 CORS_ORIGINS=http://localhost:4300 \
node dist/apps/api/main.js
```

Log in as the seeded owner (`SEED_EMAIL` / `SEED_PASSWORD`) and keep the access token to hand.

## 1 — Unit tests first

```bash
npx nx test shared-domain --testPathPatterns="sms-parsers|spend-waterfall|completeness|spend-suggestions"
```

The parsers are fixture-driven on the owner's real messages. The waterfall's tests are named for
the invariants in [contracts/domain.md](contracts/domain.md#invariants--each-gets-a-test-named-for-it) —
in particular the one that matters most:

> the total saved for a window is identical however its payments were decided

## 2 — Mint a token

```bash
curl -sX POST localhost:3334/api/spending/tokens \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"label":"quickstart","expiresAt":"2027-01-01"}'
```

Copy the `token` from the response — this is the only time it exists. Then confirm it is genuinely
one-way: `GET /api/spending/tokens` must never return it again.

## 3 — Replay a real day

The owner's actual 24 August, in order. Paste each `raw` exactly, Georgian and all.

```bash
INGEST="curl -sX POST localhost:3334/api/spending/ingest -H 'X-Ingest-Token: $LPTOKEN' -H 'content-type: application/json'"
```

| Time | Bank | Message | Expected |
| --- | --- | --- | --- |
| 13:05 | tbc | `6.95GEL\n(*6810)\nFENIX 222 LLC\nNashti: 1278.87GEL\ndagibrunda: 0.03GEL\nErtgul kulabashi gaqvs: 10.17GEL\n24/08/26 13:05` | ₾6.95, card 6810, cashback recorded but ignored |
| 13:30 | tbc | `14.45GEL\n(*6810)\nmcdonald s draivi\nNashti: 1264.42GEL\n…` | ₾14.45 |
| 18:37 | tbc | `22.19GEL\n(*6810)\nfresco west georgia ll\nNashti: 1242.23GEL\n…` | ₾22.19, **split across two rungs** |
| 21:15 | bog | `ჩარიცხვა: GEL185.46\nიმ ანი ბეროშვილი\n24.08.2026` | recorded as money **in**, absent from the ladder |
| ~21:20 | bog | `გადახდა: GEL4.00\nCard:***9582\nNILE\n24.08.2026` | ₾4.00 |

Then:

```bash
curl -s "localhost:3334/api/spending?today=2026-08-24" -H "authorization: Bearer $TOKEN"
```

**Expected**, with the ladder at Breakfast $10 → Lunch + Dinner $20 and 1 USD = 2.6121 GEL:

- total spent ₾47.59 — the credit is **not** in it
- Breakfast full at ₾26.12, Lunch + Dinner ₾21.47 of ₾52.24
- the Fresco payment shows **two** allocations summing to ₾22.19
- `extraCents: 0`, no tier past daily touched
- every figure marked as a projection, and the payload's `basis` naming both the lower bound and
  the NBG rate

## 4 — The things that only break in real life

**Duplicate versus genuine repeat.** Send the NILE message twice, five seconds apart: one payment,
`duplicate: true` on the second. Send it again an hour later: **two** payments. BOG messages carry
no time, so two identical coffees are byte-identical — a content hash alone would silently delete
the second, understating spending. See [research §3](research.md).

**A missed message.** Replay the TBC run with the 14:45 one withheld. The completeness check must
report a gap of exactly ₾14.45 on card 6810, derived from the surrounding `Nashti` readings — and
that balance must appear nowhere as a balance.

**Confirming changes attribution, not arithmetic.** Note the day's total saving. Confirm the Fresco
payment onto Breakfast, forcing it past its budget. Breakfast now reports an overspend, Lunch +
Dinner is untouched — and **the day's total saving is unchanged**. If it moved, `spendWaterfall` is
wrong in the way that matters most.

**Confirming one payment moves another.** Leave the whole day unconfirmed and note where the
evening payment sits. Now confirm the *morning* payment as the whole day's food. The evening
payment must re-propose itself against the weekly allowance on the next read, untouched. Undo the
confirmation and it must go back. This is FR-014b, and it is the behaviour most likely to be
quietly broken by an "optimisation" that caches proposals.

**A payment split across two rungs, and one for tomorrow.** Confirm a supermarket payment as part
dinner and part chores, and check both allowances move and the parts sum to the payment. Then
confirm an evening payment with `forDay` set to tomorrow: today's allowance must be untouched,
tomorrow's must shrink, and today's *real spending* must still include it — the two days are
different questions.

**Milk across four breakfasts.** Confirm ₾10.01 spread across three days. Expect ₾3.34, ₾3.34,
₾3.33 — not three lots of ₾3.33 with a tetri lost.

**A confirmed allowance is closed to guesses but open to facts.** Confirm ₾7 against the ₾10
breakfast allowance, then add an unrelated ₾15 payment and leave it unconfirmed. The ₾15 must
**skip** breakfast entirely and land on the weekly allowance; breakfast must report ₾3 saved, not
₾3 available. Then confirm a second small payment as breakfast too — it must be accepted and added,
because coffee and dessert are one meal in two payments. Un-confirm the first and breakfast must
reopen to the cascade.

**A manual rung is never charged.** Set the loan repayment to `settlement: 'manual'`, then spend
past every automatic rung. The overflow must reach extra unplanned spending without ever touching
the loan.

**Unparsed is kept, not lost.** Send `hello world`. Expect `201` with `status: "unparsed"` — not a
4xx. A Shortcut cannot handle an error, so any non-2xx means the message is gone for good. It must
appear in the queue with its text intact.

**Currency.** Every amount above is GEL against USD budgets. If the ladder reads ₾10 for a $10
breakfast, the day's rate was not applied.

## 5 — In the browser

```bash
npx nx serve web    # needs its own checkout to run alongside the owner's :4200
```

- The dashboard card shows today's remaining allowance and **one** quick action (principle I).
- The ladder renders as filling bars with names as markers — **not** tick-boxes. A name records
  which allowance was consumed, not what was bought, and a checklist would read as a lie.
- Opening a payment shows its decomposition, visibly a projection until confirmed.
- Giving a payment a custom purpose removes it from the allowances; promoting it creates a budget
  line that appears in the ladder.

## 6 — Tear down

```bash
docker stop lp-mongo      # it was found stopped; leave it that way
```

## Definition of done

- [ ] `npm run check` passes
- [ ] every invariant in [contracts/domain.md](contracts/domain.md) has a test named for it
- [ ] §3 and §4 pass against a running API
- [ ] `docs/modules/spending.md` written, `docs/DECISIONS.md` and `docs/CHANGELOG.md` appended
- [ ] the two DECISIONS entries this feature owes: **`day` is written, not derived**, and **the
      server applies `dayStartHour`, unlike meals where the browser does**
