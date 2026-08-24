# Modules: auth, settings, dashboard

The three modules that are not widgets.

---

# auth

**Code:** `apps/api/src/auth/`

`users` collection: email, name, bcrypt `passwordHash` (cost 12, `select: false`), `roles`,
and `refreshTokenHash`.

## Guarded by default

`JwtAuthGuard` is registered as a global `APP_GUARD` in `app.module.ts`, so **every** route needs
a valid access token unless it is marked `@Public()`. Guarding by default rather than by
annotation means a newly added controller cannot accidentally ship unauthenticated.

Public routes: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /health`.

## Tokens

Access and refresh tokens are both JWTs signed with `JWT_SECRET`, distinguished by a `typ`
claim. `JwtStrategy.validate()` rejects `typ: 'refresh'`, so a refresh token cannot be used as a
bearer token on data routes.

Lifetimes are configured **in seconds** (`ACCESS_TOKEN_TTL_SECONDS`, default 900;
`REFRESH_TOKEN_TTL_SECONDS`, default 30 days) — see `docs/DECISIONS.md` for why not `15m` strings.

**Refresh tokens rotate.** Each refresh issues a new pair and replaces the stored
`refreshTokenHash`. Logout (`$unset`) and password change genuinely revoke outstanding sessions
rather than asking the client to forget a still-valid token. The consequence is that the client
must not run two refreshes concurrently — `apps/web/src/lib/api.ts` shares one in-flight
`refreshPromise` for exactly this reason.

## Other details worth keeping

- Login compares against a dummy hash when the email does not exist, so response timing and the
  error message do not reveal which emails are registered.
- The `User` schema's `toJSON` deletes `passwordHash` and `refreshTokenHash` on the way out, so
  even a controller that returned a raw user could not leak them.
- `REGISTRATION_INVITE_CODE`, when set, closes registration. Set it in production.

---

# settings

**Code:** `apps/api/src/settings/settings.module.ts`

One row per user, created on first read via upsert rather than at registration — so a user
seeded straight into Mongo still gets sane defaults.

| Field | Default | Used by |
| --- | --- | --- |
| `displayCurrency` | `USD` | dashboard roll-ups |
| `salaryDayOfMonth` | 7 | defaults in forms |
| `capitalGainsTaxRate` | 0 | stock liquidation maths (Georgia: 0% on most personal share sales) |
| `fxRates` | `{}` | `convertCents()`, keyed `USD_GEL` style |
| `widgetOrder` | `[]` | the dashboard's card order — see below |

`widgetOrder` is written only by `PUT /api/dashboard/order`, never by `PUT /api/settings`: the DTO
there deliberately does not accept it, so the rearrange gesture has exactly one writer and cannot
arrive bundled with a currency change. `SettingsService.setWidgetOrder()` is that writer.

---

# dashboard

**Code:** `apps/api/src/dashboard/` · `apps/web/src/app/page.tsx`

`GET /api/dashboard` returns every card and every summary in one request.

## The registry pattern

`DashboardService.build()` calls each widget's own `summary()` in parallel, then maps each to a
card via a private `build*Card` method. Nothing here reaches into another widget's collections
(principle I). **Adding a widget means adding a `WidgetKey`, a summary and one `build*Card`
method — never editing another widget.**

Cards carry at most three `WidgetStat`s with pre-formatted `value` strings, an optional
`progress` ratio, an optional `alert` line, a `tone` and an `order`. `estimated: true` on a stat
renders the `est` marker (principle VI).

Board cards are generated one per board from `boards.summaries()`, at `order` 10+, so the number
of cards follows the data.

## The card order is the user's

`GET /api/dashboard` returns `cards` **already sorted for display**. `arrangeWidgets`
(`libs/shared/domain/src/lib/widget-order.ts`) applies the user's `widgetOrder` — the list of card
ids they dragged the cards into — and each card's own `order` decides only where a card they have
never arranged goes.

| Case | Result |
| --- | --- |
| id in `widgetOrder` | sits where the user put it |
| card not in `widgetOrder` | after every arranged card, ranked among newcomers by `order` |
| id in `widgetOrder` with no card | ignored |

That third row is why the arrangement is a list of *preferences* rather than a `position` field per
card: cards are derived on every read (principle III) and archiving a board must not need a
migration or leave a hole.

```
PUT /api/dashboard/order   { "order": ["nutrition", "cashflow", "board:epam", ...] }
→ { "order": [...] }       // an empty array resets to the widgets' own ranking
```

Ids are pattern-checked (`loans`, `board:epam` shaped) and capped at 64, so the field cannot be
used as arbitrary storage. Unknown ids are *accepted* — an older client may still know a card this
deploy removed, and `arrangeWidgets` ignores them rather than failing the write.

The gesture itself is `apps/web/src/components/sortable-grid.tsx`: long-press a card to enter edit
mode and lift it, drag to reorder, drop to save. Arrow keys move a focused card. The dashboard
holds the in-flight order locally so a drag stays responsive, then hands ownership back to the
payload once the `PUT` and its revalidation have landed. Two things in there are load-bearing and
non-obvious — the up-front `touchmove` listener and the card staying an `<a>` in edit mode; both
are written up in `docs/DECISIONS.md`.

## Net position

```
cash + expected item proceeds + (share market value ?? share cost) − debts outstanding
```

Shares fall back to **cost** when no quote exists, so an unpriced holding is not silently counted
as worthless.

## Attention feed

The one place a widget may comment on another. Currently: salary landing within 5 days, negative
free money, a debt with no guaranteed repayment plan, stale share prices, people needing
attention, overdue 1:1s, and a personal plan within a week. Each carries a tone and a deep link.

## `today` is explicit

`GET /health` aside, every dashboard and widget endpoint accepts `?today=YYYY-MM-DD` via the
`@Today()` decorator (`apps/api/src/common/today.ts`). Projections take it as an argument
(principle V), which makes "what does this look like on 1 December?" a query parameter and makes
the API deterministic under test.
