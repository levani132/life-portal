# Life Portal Constitution

A single private dashboard for Levan's financial and personal state: debts, cash flow,
sellable assets, stock holdings, work obligations, side projects and personal plans.
One user, one truth, fast to glance at, fast to update.

## Core Principles

### I. Widget = Bounded Module

Every dashboard concern is one module owning one Mongo collection family, one Nest module,
one API namespace and one Next.js route. A widget renders twice: a **summary card** on the
dashboard (three numbers max, plus **at most one primary quick action**) and a **detail page**
(full CRUD, projections, history). Adding a widget must never require editing another widget's
internals — only registering it in the widget registry.

The quick action is a deliberate, bounded exception to "cards are not dashboards": one button,
for the one thing that happens many times a day and would otherwise start with a navigation
(logging a meal). A second action, an inline form or an editable field on a card is a violation
— that work belongs on the detail page.

### II. Money Is Integer Minor Units

All monetary values are stored and transported as **integer cents** (`amountCents`), never
floats. Formatting to `$10,500.00` happens only at the render edge. Any new field holding
money must be named `*Cents`. Percentages are stored as basis-friendly decimals
(`0.15` for 15%), and share quantities are floats (fractional shares are real).

### III. Derived Never Persisted

Balances, payoff dates, projections, scenarios and free-money figures are **computed on
read** from immutable-ish event rows (payments, expenses, lots, quotes). A loan stores its
`principalCents` and its `payments[]`; it never stores `remainingCents`. This makes history
correct by construction and back-dated edits safe. The only caches allowed are external
data (stock quotes) with an explicit `fetchedAt`.

### IV. Cross-Widget Links Are Single-Sourced

When two widgets show the same fact, exactly one row owns it and the other holds a
reference. The monthly loan repayment is owned by a **cash-flow expense**; the loan's
repayment plan points at it via `linkedExpenseId`. Editing from either screen mutates the
one owning row. Never mirror a value into two collections.

### V. Projections Are Pure Functions

All forecasting — cash projection, loan payoff scenarios, ESPP share estimates, suggested
target prices — lives in `libs/shared/domain` as pure, dependency-free, unit-tested
functions taking plain data and returning plain data. No Mongo, no HTTP, no `Date.now()`
passed implicitly: the "today" reference is always an explicit argument. The API layer
loads data and calls them; the web layer may call the same functions for instant what-if UI.

### VI. Estimates Are Labelled

Any number the system guessed rather than recorded must carry its provenance: a
`basis`/`assumptions` field explaining how it was derived, surfaced in the UI. A suggested
target price shows its inputs and weights. A best-case payoff date states what it assumed
sold. The user must never mistake a model output for a fact.

## Technology Constraints

- **Stack (fixed):** Nx integrated monorepo · NestJS 11 API · Next.js 16 App Router web ·
  MongoDB Atlas via Mongoose 9 · TypeScript strict · Tailwind CSS.
- **Layout:** `apps/api`, `apps/web`, `libs/shared/types` (contracts, zero runtime deps),
  `libs/shared/domain` (pure logic). Web and API both import the shared libs; neither
  imports the other.
- **Validation:** every write endpoint takes a `class-validator` DTO. No `any` in
  controllers or schemas.
- **Auth:** every data route is JWT-guarded and scoped to `userId`. No endpoint may return
  another user's rows, even though there is currently one user.
- **Secrets:** only via env (`MONGODB_URI`, `JWT_SECRET`, `FINNHUB_API_KEY`). Never
  committed. `.env.example` documents every variable.
- **External APIs degrade gracefully:** a missing or rate-limited Finnhub key must leave
  the app fully usable with manually entered prices, never a crash or empty dashboard.
- **Free-tier deployable:** no always-on worker requirement, no paid managed service.
  Scheduled refreshes must also be triggerable on demand via an endpoint.

## Development Workflow

- Work in Spec Kit order: `/speckit-constitution` → `/speckit-specify` → `/speckit-plan`
  → `/speckit-tasks` → `/speckit-implement`. Feature specs live in `specs/<feature>/`.
- Every module keeps a living doc at `docs/modules/<module>.md` with: purpose, schema,
  endpoints, derived formulas, cross-links, open questions. **Changing a module's schema or
  formula requires updating its doc in the same change.**
- Notable decisions and their reasoning append to `docs/DECISIONS.md`; user-visible changes
  append to `docs/CHANGELOG.md`. A future session with zero context must be able to read
  `CLAUDE.md` → constitution → module docs and resume work without re-asking the user.
- Quality gate before declaring work done: `npx nx run-many -t typecheck lint test` passes,
  and `nx build api` + `nx build web` succeed.
- Domain logic changes require a unit test covering the new branch. UI-only changes do not.

## Governance

This constitution supersedes convenience. When a shortcut conflicts with a principle,
either follow the principle or amend the constitution in the same change — never silently
diverge. Amendments bump the version, note the date, and state what changed and why in
`docs/DECISIONS.md`.

Complexity must be justified in writing: a new dependency, a new collection or a new
abstraction layer needs one sentence in the module doc explaining what it buys. Prefer
deleting code over adding configuration.

**Version**: 1.1.0 | **Ratified**: 2026-08-03 | **Last Amended**: 2026-08-19
