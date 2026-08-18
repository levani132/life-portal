# Life Portal

A private dashboard for one life: what you owe, what you have, what is coming in, what needs
doing, and what you are planning. Eight widgets, each a small card on the dashboard with a full
page behind it.

Nx monorepo · NestJS 11 · Next.js 16 · MongoDB Atlas · TypeScript strict

## What is in it

| Widget | What it answers |
| --- | --- |
| **Debts** | What is left, and when it is finished under three different sets of assumptions. |
| **Free money** | On any date: what you will have, what is already spoken for, what is genuinely yours. |
| **Items to sell** | What is still to sell, and what it is realistically worth. |
| **Stocks** | Per-purchase cost basis, live prices, target prices with the maths shown, and the EPAM share plan projected forward. |
| **EPAM** | Your people and who needs attention, plus the perk-earning work that builds a promotion case. |
| **Client project** | Tasks and a review-evidence log. |
| **SoulArt / ShopIt** | Prioritised backlogs. |
| **Personal life** | Activities, trips and travel history — with the costs auto-budgeted. |

The interesting part is that they are wired together. The $1,000 you repay each month is **one
row**: edit it on the Debts screen or in Free money and both change, because both read the same
record. Items and share lots earmarked for a debt feed its payoff scenarios automatically. A
planned holiday with a cost and a date appears as spending in your projection without being
entered twice.

## Getting started

**1. A database.** Create a free M0 cluster at [cloud.mongodb.com](https://cloud.mongodb.com),
add a database user, allow your IP, and copy the connection string.

**2. Configure.**

```bash
cp .env.example .env
openssl rand -hex 32        # paste into JWT_SECRET
```

Fill in `MONGODB_URI`. Optionally add a free [Finnhub](https://finnhub.io/register) key for live
share prices — without one the app works fine and you enter prices by hand.

**3. Install, seed, run.**

```bash
npm install
npm run seed     # your account, the loan, the ESPP plan and the four boards
npm run dev      # API on :3333, web on :4200
```

Sign in, then set the two things the seed deliberately left blank because it could not know them:
your **cash balance** and your **salary amount**, both on the Free money page. Fabricating either
would have quietly corrupted every projection on the dashboard, so they start at zero and the UI
flags them in amber.

The loan is seeded correctly: $17,000 borrowed, $6,500 recorded as repaid, $10,500 outstanding.
That repayment is one clearly-labelled opening adjustment rather than an invented monthly
history — delete it and enter the real payments whenever you have them, and every balance and
payoff date recomputes.

## Commands

```bash
npm run dev          # both apps: API on :3333, web on :4200
npm run dev:api      # API only, :3333
npm run dev:web      # web only, :4200
npm run seed         # idempotent — safe to re-run
npm run check        # typecheck + lint + test: the quality gate
npm test
npm run build
```

## How it is put together

```
apps/api             NestJS · Mongoose · JWT auth · every route guarded by default
apps/web             Next.js App Router · Tailwind · SWR · Recharts
libs/shared/types    Contracts used by both sides. Zero runtime dependencies.
libs/shared/domain   Pure projection, scenario and valuation logic. 97 unit tests.
```

Six rules the code actually follows, in full in `.specify/memory/constitution.md`:

1. A widget is a bounded module — a summary card and a detail page, nothing reaching sideways.
2. Money is integer cents, in fields named `*Cents`.
3. Derived values are never stored. A loan keeps its principal and its payments; the balance is
   folded on read, so back-dated edits stay correct for free.
4. When two screens show the same fact, one row owns it and the other holds a reference.
5. Every projection is a pure function with "today" as an explicit argument.
6. Any number the system guessed carries its reasoning, and the UI marks it.

## Documentation

Written so a new session — human or agent — can pick this up cold:

- **`CLAUDE.md`** — start here, including the things that will trip you up.
- `.specify/memory/constitution.md` — the six principles in full.
- `docs/modules/*.md` — per module: schema, endpoints, formulas, cross-links, open questions.
- `docs/DECISIONS.md` — why, including the non-obvious calls and what they cost.
- `docs/CHANGELOG.md`

The project uses [GitHub Spec Kit](https://github.com/github/spec-kit), so
`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement` is the flow for
anything non-trivial.

## Deploying free

The API is a stateless Node process and the web app is a normal Next build, so:

- **API** → Render / Railway / Fly free tier. Build `npm run build:api`, start
  `npm run start:api`, health check `/api/health`. Set every variable from `.env.example`, and
  **set `REGISTRATION_INVITE_CODE`** so a stranger who finds the URL cannot sign up. These hosts
  inject their own `PORT`, which the API honours as a fallback — leave `API_PORT` unset there.
- **Web** → Vercel. Set `NEXT_PUBLIC_API_URL` to the deployed API, and add the web origin to the
  API's `CORS_ORIGINS`.
- Free hosts sleep idle processes, so the daily quote-refresh cron may not fire. Every refresh is
  also a plain endpoint (`POST /api/stocks/refresh`) — point an external scheduler at it, or press
  the button on the Stocks page.

## Not investment advice

The suggested target price is a documented heuristic: a weighted blend of four anchors, each shown
with its own weight and reasoning in the UI. It exists to help you judge when a sale is worth
making, and it says as much in its own output. It is not a valuation.
