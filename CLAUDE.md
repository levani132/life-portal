# Life Portal — agent guide

A private dashboard for one person's financial and personal state: debts, cash flow,
sellable assets, share holdings, work obligations, side projects and personal plans.

**Read these before changing anything:**

1. `.specify/memory/constitution.md` — the six principles this codebase is built on. They
   are not aspirational; the code follows them and reviews enforce them.
2. `docs/modules/<module>.md` — one doc per module: schema, endpoints, formulas, cross-links.
3. `docs/DECISIONS.md` — why things are the way they are, including the non-obvious ones.

## The six principles, in one line each

1. **Widget = bounded module.** One concern → one Nest module → one Mongo collection family →
   one Next route. A widget renders twice: summary card, detail page.
2. **Money is integer cents**, in fields named `*Cents`. Never floats.
3. **Derived never persisted.** Balances and projections are computed on read from event rows.
   A loan stores `principalCents` + payments, never `remainingCents`.
4. **Cross-widget links are single-sourced.** The monthly loan repayment is owned by a
   *cash-flow expense*; the loan's plan references it via `linkedExpenseId`.
5. **Projections are pure functions** in `libs/shared/domain`, with "today" always an
   explicit argument. No Mongo, no HTTP, no implicit clock.
6. **Estimates are labelled** with their `basis` and shown as such in the UI.

## Layout

```
apps/api          NestJS 11 · MongoDB via Mongoose 9 · JWT auth
apps/web          Next.js 16 App Router · Tailwind · SWR · Recharts
libs/shared/types Contracts shared by both. Zero runtime dependencies.
libs/shared/domain Pure projection/scenario/valuation logic. 97 unit tests.
.specify/         Spec Kit: constitution, templates, /speckit-* skills
docs/             Module docs, decisions, changelog
```

The API is guarded globally: **every** route needs a valid access token unless marked
`@Public()`. Every query goes through `OwnedCrudService.scoped()` or an explicit `userId`
filter — there is no unscoped read anywhere, and new code must keep it that way.

## Commands

```bash
npm run dev          # API on :3333 and web on :4200 together
npm run dev:api
npm run dev:web
npm run seed         # Idempotent. Seeds the owner, the loan, the ESPP plan, the four boards.
npm run check        # typecheck + lint + test across the workspace — the quality gate
npm test
npm run build        # builds both apps
```

Copy `.env.example` to `.env` first. `MONGODB_URI` and `JWT_SECRET` are required and the API
refuses to boot without them.

## Working on this project

Use the Spec Kit flow for anything non-trivial:
`/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`.
Feature specs land in `specs/<feature>/`.

**Changing a module's schema or a formula requires updating its doc in the same change.** That
rule is what keeps a fresh session able to pick this up. Append notable decisions to
`docs/DECISIONS.md` and user-visible changes to `docs/CHANGELOG.md`.

Domain logic changes need a unit test covering the new branch. UI-only changes do not.

## Things that will trip you up

- **Calendar dates are `YYYY-MM-DD` strings, not `Date`.** Everywhere — Mongo, DTOs, the
  domain lib. This is deliberate (see `apps/api/src/common/mongoose.ts`). Only `createdAt` and
  `updatedAt` are real timestamps.
- **Mongoose 9 renamed `FilterQuery` → `QueryFilter`** and removed `RootFilterQuery`.
- **`next.config.js` must not use `@nx/next`'s `withNx`, and `tailwind.config.js` must not use
  `@nx/react/tailwind`.** Turbopack bundles config files' transitive requires and both drag in
  `@angular-devkit/architect`. See `docs/DECISIONS.md`.
- **"Best case" can finish later than "Realistic".** Holding shares for the target price
  recovers more money but takes longer. The scenarios are named by what they assume, not by
  how good the outcome is. This is correct, and there is a test asserting it.
- **The free-money figure excludes obligations falling *on* payday**, because those are funded
  by that salary. Counting them against the prior balance would understate free money by a
  whole month. Also tested.
- Finnhub's free tier has **no historical candles**, so price history is grown by appending
  each day's quote. It starts the day you start using the app.
- **Never put `default: 0` on an optional money field.** Mongo then returns `0` where the type
  says `undefined`, and every `a ?? b` fallback silently breaks. This caused two real bugs; see
  `docs/DECISIONS.md`. Use `centsField` (no default) for optional, `requiredCentsField` for
  required.
- **Config lives in a `@Global()` `ConfigModule`.** A provider declared in `AppModule` is not
  visible to modules `AppModule` imports, so declaring `CONFIG` there broke DI at boot.
- **The API's port is `API_PORT`, not `PORT`.** `next dev` and `next start` also read `PORT`, so
  a shared value makes whichever app starts second die with `EADDRINUSE`. The web ports are
  pinned to 4200 in `apps/web/project.json` for the same reason. `PORT` remains a fallback for
  the API alone, because managed hosts inject it.

## Verifying a change

`npm run check` is necessary but **not sufficient** — it passed while the app could not boot and
while two silent zeroing bugs were live. Both were only caught by running the thing:

```bash
docker run -d --name lp-mongo -p 27019:27017 mongo:7
MONGODB_URI=mongodb://127.0.0.1:27019/lp-dev JWT_SECRET=$(openssl rand -hex 32) \
  npm run seed && npm run dev
```

Then log in and look at the numbers. If you touched projections, cross-links or schemas, check
that a figure you expect to be non-zero actually is.
