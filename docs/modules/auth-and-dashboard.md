# Modules: auth, settings, dashboard

The three modules that are not widgets.

---

# auth

**Code:** `apps/api/src/auth/`

`users` collection: email, name, bcrypt `passwordHash` (cost 12, `select: false`), `roles`,
`emailVerifiedAt` (issue #27; absent until confirmed).
A legacy `refreshTokenHash` may still be on old rows; nothing reads it, and signing in `$unset`s
it (issue #27).

`auth_sessions` collection (issue #27), one row per signed-in device:

| Field | Meaning |
|---|---|
| `userId` | the account (string, like every other module) |
| `tokenHash` | SHA-256 hex of the refresh token valid now (unique) |
| `previousHash`, `rotatedAt` | the token it replaced, and when, to tell a race from a replay |
| `lastUsedAt` | the last sign-in or refresh |
| `expiresAt` | now + `REFRESH_TOKEN_TTL_SECONDS`, moved forward on each refresh; a TTL index deletes the row after it |
| `device` | a coarse label from the user-agent ("Safari on iPhone"), at most 80 chars |
| `revokedAt`, `revokedReason` | `logout`, `logout_all`, `revoked`, `password_change`, `password_reset` or `replay` |

## Guarded by default

`JwtAuthGuard` is registered as a global `APP_GUARD` in `app.module.ts`, so **every** route needs
a valid access token unless it is marked `@Public()`. Guarding by default rather than by
annotation means a newly added controller cannot accidentally ship unauthenticated.

Public routes: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`,
`GET /auth/capabilities`, `POST /auth/forgot-password`, `POST /auth/reset-password/check`,
`POST /auth/reset-password`, `POST /auth/verify-email`, `GET /health`.

## Tokens

Access and refresh tokens are both JWTs signed with `JWT_SECRET`, distinguished by a `typ`
claim. Both carry `sid`, the `auth_sessions` row they belong to, and a refresh token also carries a
random `jti`, so no two refresh tokens are alike.

`JwtStrategy.validate()` rejects `typ: 'refresh'`, so a refresh token cannot be used as a bearer
token on data routes. It also checks that the token's session is still live, with one indexed
read per request. That makes logout, "sign out everywhere" and a password change take effect
immediately, not when the 15-minute access token runs out. A token without `sid` predates
sessions and is refused.

Lifetimes are configured **in seconds** (`ACCESS_TOKEN_TTL_SECONDS`, default 900;
`REFRESH_TOKEN_TTL_SECONDS`, default 30 days) — see `docs/DECISIONS.md` for why not `15m` strings.

**Refresh tokens rotate, and each works once** (issue #27). `POST /auth/refresh` signs a new
pair for the same session. It then swaps the session's `tokenHash` with one atomic
`findOneAndUpdate`, whose filter requires the presented hash to be the current one. Of two
simultaneous refreshes with one token, exactly one wins. When nothing matched,
`refreshFailure()` (`session-rules.ts`) decides:

| Situation | Answer | Session |
|---|---|---|
| no session, revoked or expired | 401 `SESSION_ENDED` | — |
| the token it just replaced, within 30 s (`REFRESH_GRACE_MS`) | 409 `REFRESH_SUPERSEDED` | kept |
| any other old token | 401 `REFRESH_REUSED` | **revoked** (a replay: one holder is not the owner) |
| no `sid` (issued before #27) | 401 `LEGACY_SESSION` | — |

Only the one session is revoked on a replay, never the account's others, so a bug or a race
cannot sign someone out everywhere.

The web client makes tabs take turns: `refreshSession()` in `apps/web/src/lib/api.ts` runs under
the `lp.refresh` Web Lock. A tab that gets the lock after another tab refreshed just uses the
stored tokens. Without Web Locks, a `REFRESH_SUPERSEDED` makes it wait up to 2 s for the other
tab's tokens to land in storage before giving up. `LEGACY_SESSION` leaves `lp.signedOutReason`,
so the login page can say why everyone had to sign in again once. Writes still in the outbox stay
on the device and are sent after the same account signs in (spec 027).

### Where the web keeps them (issue #29)

**No token is readable from JavaScript once the web reaches the API on its own origin.** The web
calls `/api` on its own host; `vercel.json` rewrites that to the API on Render, at the CDN, with
no function in between. The browser and the API are then one site, so a cookie can be
first-party. A cookie on `onrender.com` would be third-party to `vercel.app`: never sent with
`SameSite=Strict`, and blocked by Safari altogether.

- **Cookie mode is fixed at build time:** it is on when `NEXT_PUBLIC_API_URL` is relative (`/api`),
  `cookieSession` in `apps/web/src/lib/api.ts`. With an absolute URL (another site), tokens stay
  in `localStorage` as before, so the deploy order of the API and the web cannot sign anyone out.
- **The refresh token is the `lp_refresh` cookie**: `HttpOnly; SameSite=Strict; Path=/api/auth;
  Max-Age=` the refresh lifetime, and `Secure` everywhere except plain-http localhost
  (`session-cookie.ts`). The access token lives in memory only, so a reload starts with one
  refresh.
- **Opt-in per request.** The web sends `x-lp-session: cookie` with every request. On register,
  login, refresh and the Google exchange steps, the API then sets the cookie and leaves
  `refreshToken` out of the body. A request without the header (the integration tests, an older
  app version) gets tokens in the body as before, and no cookie.
- **CSRF.** A refresh from the cookie needs the header *and* an `Origin` in `CORS_ORIGINS`.
  Another site cannot add the header without a CORS preflight, which the API refuses for
  origins it does not list, and `SameSite=Strict` keeps the cookie off cross-site requests
  anyway. Data routes still take the bearer access token, which a browser never attaches by
  itself. A refused cookie refresh clears the cookie; `logout` and `logout-all` clear it too.
- **Storage keeps only `lp.session`**: the signed-in account's id, a hint that a cookie may
  exist and whose. It is not a credential. It decides whether the app tries to restore a session
  at boot (`tokens.present`), and it is what spec 034's replay check compares while no access
  token is in memory yet (`tokens.subject`, `offline/send.ts`). Offline start still opens as the
  remembered user (spec 027).
- **Moving over.** A token left in `localStorage` from before is sent once in the body of the
  first refresh, with the header; the answer sets the cookie and the web deletes both stored
  tokens. Nobody is signed out by the change.
- **Tabs** still take turns under the `lp.refresh` Web Lock: the cookie is shared, so a tab that
  waited just refreshes with the newest one. Without Web Locks, a `REFRESH_SUPERSEDED` in cookie
  mode retries once after 300 ms.

**The visitor's address behind the proxy.** Requests through Vercel arrive at Render from Vercel's
addresses, which would put everyone in one per-IP sign-in limit. The rewrite adds `x-lp-proxy`
with a shared secret (`LP_PROXY_SECRET` on Vercel, `WEB_PROXY_SECRET` on the API). Only with the
right secret does the API take the visitor's address from Vercel's `x-real-ip`
(`app/web-proxy.ts`). Anything else, including direct calls to Render, keeps the `trust proxy`
address, so a direct caller still cannot pick its own IP. `GET /api/health` reports
`proxied: true` for a request that proved itself. `proxy` names the step a request reached (`ok`, `unconfigured`, `no-header`, `unsubstituted`, `mismatch`, `no-ip`), never a value. Setup: `docs/runbooks/web-api-proxy.md`.

Clients outside the browser keep the Render URL: Settings → MCP and the Shortcut ingest page show
`NEXT_PUBLIC_API_PUBLIC_URL` (`externalApiUrl()`), and link previews read `API_INTERNAL_URL`
server-side.

| Route | What it does |
|---|---|
| `POST /auth/logout` | ends this session |
| `POST /auth/logout-all` | ends every session, this one included |
| `GET /auth/sessions` | the live sessions: `id`, `device`, `createdAt`, `lastUsedAt`, `current` |
| `DELETE /auth/sessions/:id` | ends one of your own sessions (404 for anyone else's) |
| `POST /auth/sessions/revoke-others` | ends every session except this one |
| `POST /auth/change-password` | needs the current password; keeps this session and ends the others |

## Abuse protection (issue #27 S2)

**Rate limits.** `SecurityService.hit()` counts fixed windows in `auth_rate_limits`, one upsert
per hit, and a TTL index removes each counter when its window ends. Subjects are HMAC-hashed with
a key derived from `JWT_SECRET`, so the collection holds no email or IP. Over the limit, the
answer is 429 `RATE_LIMITED`, with the same message for every subject and the seconds to wait in
`retryAfter`.

| Rule | Subject | Limit |
|---|---|---|
| `login:ip` | IP | 30 / 15 min |
| `login:acct` | email; covers the MCP consent page too | 10 / 15 min |
| `register:ip` | IP | 10 / hour |
| `refresh:ip` | IP | 300 / 15 min |
| `pwchange:user` | account | 10 / hour |
| `forgot:ip`, `forgot:acct` | IP, email | 10 / hour, 3 / hour |
| `reset:ip` | IP | 20 / hour |
| `verify:user` | account | 5 / hour |

The values are in `security/rate-limit-rules.ts`. The per-account limit counts every attempt,
successful or not: 10 sign-ins in 15 minutes is already unusual. `req.ip` depends on
`TRUST_PROXY_HOPS` (default 1, for Render). It used to be set only when MCP OAuth was enabled.
Without it, every request behind the proxy would share one IP limit.

**Security events.** `security_events` keeps `type`, `userId` (when known), `ipHash`, a short
fixed `detail` (such as the rate-limit bucket) and `at`, and expires them after 90 days. It never
holds an email, a password, a token or a raw IP. Recorded types:
- `register`;
- `login_succeeded`, `login_failed`;
- `logout`, `logout_all`;
- `session_revoked`, `sessions_revoked_others`;
- `refresh_replay`;
- `password_changed`, `password_change_failed`;
- `rate_limited`;
- the reset and verification events, once S3 and S5 add them.

`record()` never throws.

**Password policy** (`security/password-policy.ts`) applies wherever a password is *set*:
registration, change and reset. Signing in never checks it.
- at least 10 characters, counted as characters;
- at most 72 bytes of UTF-8, which bcrypt would otherwise silently cut short (about 24 Georgian
  letters);
- not on the bundled common list;
- at least 4 distinct characters;
- not the email address.

A break is a 400 `WEAK_PASSWORD` with a `reason`. Changing to the current password is a 400
`SAME_PASSWORD`.

**Timing.** An unknown email is checked against a real cost-12 bcrypt hash of a random secret,
made once at boot. The placeholder string used before was not a valid hash, so bcrypt answered
in about 1 ms instead of about 280 ms, which revealed which emails exist.

## Forgot / reset password (issue #27 S3)

Email goes through `MAILER` (`apps/api/src/mail/`). It is `ResendMailer`, or `DevMailer`, or
`null` when `MAIL_PROVIDER` is unset. `DevMailer` stores messages in `dev_mail` for a day, and
config refuses it unless `WEB_BASE_URL` is loopback. No mailer ever logs a body. Reset is
available only with a mailer **and** `WEB_BASE_URL`, and `GET /auth/capabilities` says so. Setup
is in `docs/runbooks/email.md`.

`auth_email_tokens` holds one-time tokens for both resets and verifications:
- `purpose`, `userId`, `tokenHash` (SHA-256; the token itself is never stored);
- `email` (verification only);
- `createdAt`, `expiresAt` (TTL), `usedAt`.

1. **`POST /auth/forgot-password {email}`** always answers **202** with the same message.
   - It is rate-limited by IP and by email.
   - For an existing account, the token and the email are made *after* answering, so timing
     reveals nothing either.
   - Asking again voids the previous link.
   - A send failure goes to the log and to `security_events` (`send_failed`), never to the
     person.
2. **The link** is `WEB_BASE_URL/reset-password#token=…`. The token is 32 random bytes in the
   **fragment**, which browsers never send to a server, so it stays out of logs and `Referer`.
   The page removes it from the address bar at once.
3. **`POST /auth/reset-password/check {token}`** tells the page whether the link still works.
4. **`POST /auth/reset-password {token, password}`** answers 400 `RESET_INVALID` for a link
   that is expired, used, replaced or made up. Otherwise it:
   1. checks the password policy *before* spending the link, so a weak password does not burn it;
   2. spends the link with an atomic `findOneAndUpdate` (two concurrent resets change the
      password once);
   3. sets the bcrypt hash;
   4. **ends every session**;
   5. voids all other reset links.

   It does not sign in: the page sends the person to `/login?reset=done`.

Links last 30 minutes (`RESET_TTL_MINUTES`).

## Email verification (issue #27 S5)

Verification **never blocks anything**. Accounts from before #27, and new unverified ones, sign
in and use everything as before. `emailVerifiedAt` exists so that #28 can link another sign-in
method (Google) only to an address the person has proved they read. #28 must not link on an
email match alone.

- **After sign-up**, a link is sent when email is available. This is best effort and never
  delays or fails the sign-up.
- **`POST /auth/verify-email/send`** (signed in) sends a new link and voids the previous one.
  It answers `{alreadyVerified: true}` when there is nothing to do, and it is limited to 5 an
  hour per account.
- **The link** is `WEB_BASE_URL/verify-email#token=…` and lasts 48 hours. It is an
  `auth_email_tokens` row with `purpose: 'verify_email'`, holding the address it was sent to.
- **`POST /auth/verify-email {token}`** is public, because the link may open on a device that
  isn't signed in. It spends the token atomically and sets `emailVerifiedAt` only if the
  account's email is still that address. Otherwise it answers 400 `VERIFY_INVALID`.
- **A completed password reset** also sets `emailVerifiedAt` when it is missing, because it
  needed the inbox too.

The web side is `/verify-email`, plus the Email panel on `/settings/security`, which shows
Confirmed or Not confirmed yet and offers "Send confirmation link" only when the server can send.

## Continue with Google (issue #28)

OpenID Connect authorization-code flow with PKCE (S256), `state` and `nonce`, exchanged on the
server with `google-auth-library` (Google's own, CommonJS; `openid-client` and `jose` are
ESM-only and this API is CommonJS). Off unless configured: `GET /auth/capabilities` says
`google: false` and the web shows no button. Setup: `docs/runbooks/google-oauth.md`.

**Config.** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `API_PUBLIC_URL` (the API's public
origin, HTTPS except on loopback), plus `WEB_BASE_URL`. All or nothing: a partial setup refuses
to boot. The redirect URI is always `API_PUBLIC_URL/api/auth/google/callback`.
`GOOGLE_OIDC_TEST_BASE` points the client at a fake Google and is accepted only on loopback,
with a loopback `API_PUBLIC_URL`; the integration suite uses it.

**The round trip.**
1. The web keeps a random **binding secret** in `localStorage` (`lp.google.binding`) and
   navigates (never a popup) to `GET /auth/google/start?binding=<sha256 hex>&returnTo=…`.
2. `start` stores an `oauth_flows` row (`kind: 'start'`, 10 min) holding the PKCE verifier,
   the nonce and the binding hash, keyed by the hash of `state`, and redirects to Google.
3. `GET /auth/google/callback` spends the `state` row (once), exchanges the code with the
   verifier, verifies the ID token (signature, `iss`, `aud`, `exp`) and checks the nonce. It
   decides what happened, stores that as a `kind: 'result'` row (5 min) bound to the binding
   hash, and redirects to `WEB_BASE_URL/auth/google#code=<one-time code>`, or `#error=<code>`.
   It never throws and never puts a token in a URL. Both redirects are `no-store`,
   `Referrer-Policy: no-referrer`.
4. `/auth/google` (web) strips the fragment and sends `POST /auth/google/exchange {code,
   binding}`. The code works once, and only with the secret whose hash began the flow, so a
   code opened in another browser (a forced sign-in, or a callback that lands in Safari instead
   of the installed app) is refused (400) rather than signing anyone in.
5. A sign-in issues an ordinary session (#27): rotation, device list and revocation are the same
   whatever the sign-in method.

**What a Google account maps to** (`decide()`), in order:
- Google has not verified the email → `email_unverified`, nothing created.
- **Linking from Settings** (`intent=link`, with a two-minute ticket from
  `POST /auth/google/link-ticket`): link to that signed-in account, unless this Google account
  is linked elsewhere (`already_linked_elsewhere`) or the account already has a different one
  (`account_has_google`).
- A linked identity (`user_identities`, keyed on Google's `sub`, never on email) → sign in.
  The stored email is refreshed; a changed Google email changes nothing else.
- **An account with the same email exists → `needs_password`.** It is never linked on the email
  match alone, verified or not: the person enters that account's password once
  (`POST /auth/google/link-with-password`, same per-account limits as sign-in). A wrong
  password keeps the ticket for another try.
- Sign-up is invite-only → `needs_invite` (`POST /auth/google/complete-signup` with the code).
- Otherwise a new account with no password and `emailVerifiedAt` set (Google verified it).

`needs_*` answers carry a five-minute ticket bound to the same binding secret.

**Without lockout.** `GET /auth/methods` → `{password, google, googleAvailable}`.
`DELETE /auth/google` unlinks, and answers 409 `LAST_SIGN_IN_METHOD` when the account has no
password. `change-password` answers 400 `NO_PASSWORD` for a Google-only account; such an account
adds a password through forgot-password, which sets one whether or not one existed. Revoking the
app in the Google account only stops future Google sign-ins; sessions already issued end the
usual ways (#27).

**Schemas.** `user_identities` {userId, provider: 'google', subject, email, linkedAt,
lastUsedAt}, unique on (provider, subject) and on (userId, provider). `oauth_flows` {kind:
start | result | link_ticket, keyHash (unique), bindingHash, codeVerifier, nonce, intent,
userId, returnTo, outcome, expiresAt (TTL)}: every secret is stored as a SHA-256.
`users.passwordHash` is optional.

**Logged** in `security_events` (no emails, no tokens): `google_signin`, `google_linked`,
`google_unlinked`, `google_failed` with the error code. `start` is limited to 60 per 15 minutes
per IP (`googleByIp`).

`returnTo` is a path on the web app or nothing (`/`); the web checks it again before navigating.

## Web: Sign-in & security (issue #27 S4)

`/settings/security` is linked from Settings and backed by `components/account-security.tsx`.
- **Google** (#28) shows the linked Google email with Unlink, or a Link button. Unlink is
  replaced by an explanation while Google is the only way in. A Google-only account sees no
  change-password form, only how to add a password.
- **Change password** asks for the current password and the new one twice. It has Show/Hide
  toggles (`PasswordInput`, with `aria-pressed`) and shows the API's policy messages as they
  come. On success it clears the fields and says the other devices were signed out.
- **Signed-in devices** lists `GET /auth/sessions`, with this device marked and each device's
  last activity. It can sign out one device or all the others.
  - **"Sign out everywhere"** first ends the other sessions, then signs this device out through
    `useAuth().logout()`. Writes still in the outbox therefore get the usual question before
    anything is discarded.
  - The list is a plain SWR read. Like everything money- or account-related, it is never kept
    offline.

## Other details worth keeping

- Login compares against a real dummy hash when the email does not exist (see Timing above), so
  neither the timing nor the message reveals which emails are registered. Registration does say
  "already registered" (409). That is accepted while sign-up is invite-only; reconsider before
  opening it.
- The `User` schema's `toJSON` deletes `passwordHash` and the legacy `refreshTokenHash` on the way
  out, so even a controller that returned a raw user could not leak them.
- Refresh tokens are hashed with SHA-256, not bcrypt. bcrypt only reads the first 72 bytes, and
  every refresh token of one user shares those (the JWT header and the start of the payload,
  which is the user id). See `docs/DECISIONS.md`.
- Since #29 the web keeps no token where a script can read it, once it reaches the API through
  its own `/api` (see "Where the web keeps them"). A Content-Security-Policy is a separate
  follow-up.
- `REGISTRATION_INVITE_CODE`, when set, closes registration. Set it in production.

---

# settings

**Code:** `apps/api/src/settings/settings.module.ts`

Portal access, onboarding and module selection are described in [portal.md](portal.md).

One row per user, created on first read via upsert rather than at registration — so a user
seeded straight into Mongo still gets sane defaults.

| Field | Default | Used by |
| --- | --- | --- |
| `displayCurrency` | `GEL` | dashboard roll-ups |
| `salaryDayOfMonth` | 7 | defaults in forms |
| `capitalGainsTaxRate` | 0 | stock liquidation maths (Georgia: 0% on most personal share sales) |
| `fxRates` | `{}` | `convertCents()`, keyed `USD_GEL` style |
| `widgetOrder` | `[]` | the dashboard's card order — see below |

`widgetOrder` is written only by `PUT /api/dashboard/order`, also by setup through `PUT /api/portal`, never by `PUT /api/settings`: the DTO
there deliberately does not accept it, so currency changes cannot accidentally overwrite arrangement and cannot
arrive bundled with a currency change. `SettingsService.setWidgetOrder()` is that writer.

---

# dashboard

**Code:** `apps/api/src/dashboard/` · `apps/web/src/app/page.tsx`

`GET /api/dashboard` returns only selected, available cards and summaries in one request. See [portal.md](portal.md) for gating, setup and consolidated Money/Projects cards.

## The registry pattern

`DashboardService.build()` calls each widget's own `summary()` in parallel, then maps each to a
card via a private `build*Card` method. Nothing here reaches into another widget's collections
(principle I). **Adding a widget means adding a `WidgetKey`, a summary and one `build*Card`
method — never editing another widget.**

Cards carry at most three `WidgetStat`s with pre-formatted `value` strings, an optional
`progress` ratio, an optional `alert` line, a `tone` and an `order`. `estimated: true` on a stat
renders the `est` marker (principle VI).

Projects share one overview card. The developer-only EPAM board retains a separate card.

Quick actions (`WidgetQuickAction.kind`): `log-food` (Food: opens the log modal),
`start-workout` and `resume-workout` (Training: start one for the browser's day, or open the one
in progress). `start-workout` may carry `plan {planId, planWorkoutId}`, the plan workout to start
(issue #7, see `training.md`); without it the workout is empty. The API names the kind;
`home-dashboard.tsx` maps it to behaviour.

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
