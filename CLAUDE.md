# Life Portal — agent guide

A private-by-default dashboard for each account's financial and personal state: debts, cash flow,
sellable assets, share holdings, work obligations, side projects, personal plans, food and
training.

**Read these before changing anything:**

1. `.specify/memory/constitution.md` — the six principles this codebase is built on. They
   are not aspirational; the code follows them and reviews enforce them.
2. `docs/modules/<module>.md` — one doc per module: schema, endpoints, formulas, cross-links.
3. `docs/DECISIONS.md` — why things are the way they are, including the non-obvious ones.
4. `docs/ROADMAP.md` — what's built, what's next and in what order, the infrastructure tiers
   and the business model.

## The six principles, in one line each

1. **Widget = bounded module.** One concern → one Nest module → one Mongo collection family →
   one Next route. A widget renders twice: summary card, detail page. A card may carry **one**
   quick action and nothing more (amended in 1.1.0 for logging food).
2. **Money is integer cents**, in fields named `*Cents`. Never floats. Nutrition follows the
   same rule: whole kcal, macros as whole milligrams in `*Mg`, body weight in grams.
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
libs/shared/domain Pure projection/scenario/valuation/nutrition/training/fx logic.
.specify/         Spec Kit: constitution, templates, /speckit-* skills
docs/             Module docs, decisions, changelog
```

The API is guarded globally: **every** route needs a valid access token unless marked
`@Public()`. Every query goes through `OwnedCrudService.scoped()` or an explicit `userId`
filter. Explicit public-food catalogue reads, audience-checked social projections and developer-only
feature administration use dedicated authorization and responses; they never open private
tracking records. Read docs/modules/social.md before changing social access.

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
- **`min-width: 0` is the global default** (`apps/web/src/app/global.css`), because grid and flex
  items otherwise refuse to shrink and one long label makes the whole page wider than a phone. If
  something must not shrink, use `shrink-0` (which still works) or an explicit `min-w-*`.
- **The service worker (`apps/web/public/sw.js`) must never cache `/api`.** It holds one person's
  financial and health data; the cache outlives the tab. Shell and hashed assets only.
- **Never put `default: 0` on an optional money field.** Mongo then returns `0` where the type
  says `undefined`, and every `a ?? b` fallback silently breaks. This caused two real bugs; see
  `docs/DECISIONS.md`. Use `centsField` (no default) for optional, `requiredCentsField` for
  required.
- **A logged workout exercise freezes the exercise too.** `workout_exercises.snapshot` follows the
  meal rule below: built by the server, never accepted from a request, never refreshed, and
  `exerciseId` is not editable. A workout started from a plan follows the same rule for
  `workout_exercises.planned` and `workout_sessions.plan`: copied from the plan at start, never
  from a request, never refreshed; a swap is a new row (spec 023). Training stores whole grams, metres and seconds; kg/lb is display
  only. Its shared catalogue rows have no `userId`, so `CatalogueService` cannot use
  `OwnedCrudService` (see `docs/modules/training.md`).
- **A logged meal freezes the food's numbers.** `meal_entries.facts` is a snapshot taken at log
  time — the one place in this codebase where a value is copied rather than referenced, so that
  correcting a food never rewrites past days. Never refresh it on a `PATCH`, never accept it from a
  request, and never make `foodId` editable. See `docs/modules/nutrition.md`.
- **Which day a meal belongs to is decided in the browser**, from the local clock and the profile's
  `dayStartHour` (default 4, so a 01:00 snack lands on the previous day), and sent explicitly as
  `?today=` / `day`. The server's day is not the eater's day.
- **Grams and millilitres are never converted.** A food is measured in one unit, its facts are per
  100 of that unit, and there are no densities in this app.
- **A field may not appear in `$set` and `$setOnInsert` in the same update.** Mongo answers the
  whole thing with `ConflictingUpdateOperators` — a 500, not a merge. Both upsert-with-defaults
  services (`settings`, `nutrition`) now seed only the fields the caller did not send. This was a
  live 500 on saving settings until the food widget's boot check hit it.
- **Config lives in a `@Global()` `ConfigModule`.** A provider declared in `AppModule` is not
  visible to modules `AppModule` imports, so declaring `CONFIG` there broke DI at boot.
- **Zoom is locked off, and form controls are 16px on coarse pointers.** `maximumScale`/
  `user-scalable=no` are ignored by iOS Safari in a browser tab; the `@media (pointer: coarse)`
  rule making `.field` 16px is what actually stops iOS zooming in when an input takes focus. If you
  add a text control, route it through `Input`/`Select`/`Textarea` so it inherits that. The same
  applies to decimal fields for a second reason: on Georgian (and many other) keyboard locales the
  iOS decimal pad offers a **comma**, not a dot, and `Number(',5')` is `NaN` — `Input` (when
  `inputMode="decimal"`) and `MoneyInput` convert it, so fractions are typeable at all.
- **Don't set the `animation` shorthand where an `[animation-delay:*]` utility is used.** The
  shorthand resets the delay to zero — it is why the loader's bars use animation longhands
  (`components/portal-loader.tsx`, `global.css`).
- **Two things keep long-press-to-drag alive on a touch screen**, and both look like tidying-up:
  the grid's non-passive `touchmove` listener is registered when it *mounts* (a browser that finds
  no cancellable listener at `touchstart` hands the gesture to the compositor and answers the first
  move with `pointercancel`), and a card stays an `<a>` in edit mode with its click cancelled —
  replacing the node the finger is touching cancels the touch. Either mistake gives the same
  symptom: the card lifts and the drag dies immediately. `npm run check` passed through both.
- **The shell is mounted once, by the root layout (`PortalShell`), and the five tab roots never
  unmount** (`components/tab-host.tsx`). A page's own `<AppShell>` is a pass-through. Keep the
  shell's tree identical on every route (toggle with props, like `PullToRefresh enabled`, never
  by wrapping or unwrapping), or a navigation remounts every tab and loses its scroll. Swiping
  follows the pull-to-refresh rules: non-passive `touchmove` at mount, and a `defaultPrevented`
  gesture is never a swipe. At rest no tab may have a transform, because modals are
  `position: fixed` inside it. A swipe that starts in anything that scrolls sideways belongs to
  that element; mark other sideways gestures with `data-no-tab-swipe`.
- **Top chrome starts at `var(--top-chrome)` (or `var(--chat-top)`), not `env(safe-area-inset-top)`.** In the installed
  iOS app it adds room for the blur iOS 26 draws over the top of web apps; content placed in that
  band looks out of focus and nothing turns the blur off. See `docs/DECISIONS.md`.
- **A payment's `day` is stored, and the *server* applies `dayStartHour`** — both deliberate, both
  the opposite of how meals work. Deriving the day later would move historic payments when the
  setting changed; a Shortcut cannot read the profile, so only the server can apply the rule. See
  `docs/DECISIONS.md`.
- **A duplicate bank message is matched on text *and* arrival time.** BOG messages carry no time, so
  two identical coffees on one day are byte-identical — a content hash alone silently deletes the
  second and under-reports spending. 120-second window.
- **`POST /api/spending/ingest` must answer 2xx even when it cannot parse.** A Shortcut has no error
  handling, so any 4xx loses the message for good. Unreadable ones are stored raw and queued.
- **`@TokenAuth()` is not `@Public()`.** The ingest route is authenticated, just not by a session.
  Keeping the markers separate means grepping for unauthenticated routes never turns up the one
  that writes every payment.
- **Money is stored in the currency it was recorded in and converted only on read.** A row's
  `currency` is a fact about the amount (EPAM shares trade in USD); `settings.displayCurrency` is
  only what it is *rendered* as. Never persist a converted amount, and never convert at today's
  rate — `fx_rate_history` archives a rate per day so a past figure does not move when the lari
  does. Pass `fx` into `projectCash()` and the summary functions; without it they add dollars to
  lari. See `docs/modules/fx.md`.
- **Every push must show a notification; never decide to drop one in `sw.js`.** iOS revokes a
  subscription that receives pushes which show nothing, so "don't notify" is decided on the
  server (`NotificationTypeDef.suppress`). `notify()` is never awaited by the action that caused
  it, and it never throws. A new notification type is registered by its own module; see
  `docs/modules/notifications.md`.
- **The messages `sync` call is also the presence signal.** It marks the conversation read and
  sets `viewingAt`, which is what stops a notification while someone has the chat open. Don't
  make polling call something else, and don't poll while the page is hidden. A shared post in a
  chat is a `postId` re-checked with `PostsService.detail()` every time it is shown; never copy
  post content into a message. See `docs/modules/messages.md`.
- **Post media never passes through the API, and a bucket is never public.** The browser PUTs
  to R2 with a link whose type and size are signed; reads are signed after the audience check,
  per read. Never return a storage `key`, never make the bucket or a URL permanent, and never
  accept a media id that `PostMediaService.reserve()` has not checked. A photo is re-encoded in
  the browser (that is what strips GPS), so don't add a path that uploads the original file. See
  `docs/modules/posts.md`.
- **`GET /api/public/posts/:id/preview` is the only `@Public()` posts route**, for link-preview
  crawlers. It answers for public, live, original posts only and returns a narrow projection;
  don't widen it or add a sibling. Share images are only for own or public posts
  (`canShareImage()`), and the canvas must load the photo with `fetch` (CORS, no-store), never
  an `<img>`, or the cached copy taints it. See `docs/modules/posts.md`.
- **A post may have no food.** `publication`, `previewHash` and `kind` are optional; check
  `post.kind` (web) or `row.publication` (API) before touching food fields.
- **Badge awards are written once and never edited or deleted** (`$setOnInsert`, unique per
  user/badge/tier), so erasing history never revokes one; progress is always derived. Badges
  read other modules only through their exported reads, and evaluation runs when the browser
  calls `POST /badges/check` — there is no event bus. `badgeEarned` is the only `selfAllowed`
  notification; don't use that flag to let any other type notify its own actor. A reminder from
  the app with no actor (`restOver`) is a `personal` type sent with `remind()`, not `notify()`. See
  `docs/modules/badges.md`.
- **Only training, nutrition and social may keep data on the device** (spec 027). The outbox and
  the IndexedDB cache throw for any other module; money, banking, investments and work stay
  online-only. Adding a module there is a privacy decision for `docs/DECISIONS.md`, not a code
  tweak. Offline writes go through `enqueueWrite()` with a client id that is sent as
  `Idempotency-Key`; the API's global interceptor replays the stored answer, so a write that can
  be retried must carry one. A failed send is never dropped silently, and only "no answer at all"
  (`NetworkError`) counts as offline: an `ApiError` is the server's verdict. See
  `docs/modules/offline.md`.
- **Training creates carry the client's id** (spec 028). Start, add, swap and log-set accept an
  `id` the device chose; the API must keep checking that no user has it (`ID_TAKEN`), and plan
  rows keep their `plannedRowId(requestId, planExerciseId)` ids, which the web derives the same
  way. A start with an `id` while one is open is `SESSION_CONFLICT`, never a resume. Client times
  are clamped (`clientTime`). The workout on screen is the cached copy plus the outbox's writes
  (`training-overlay.ts`): keep every op idempotent, and never compute records or ranks there.
- **Food logged offline still never sends facts** (spec 029). `POST /nutrition/entries` takes a
  device `id` and `meal/:id/log` takes `ids`; the server snapshots at sync. The Food day
  (`/nutrition?today=&day=`) is the one cached read with a query string (14 days, 2,000 foods).
- **Edits carry `baseVersion`; nothing is merged on its own** (spec 030). Sets, workout
  exercises, workouts, meals and weigh-ins have `version` (missing = 0), bumped by `$inc` on each
  edit and never by bookkeeping (reorder, finish). A stale edit is 409 `STALE_EDIT` with `current`;
  the person picks in the sync sheet. A resolved write is `Outbox.replace()`d with a new id, since
  an idempotency key belongs to one body. Deleting what is already gone succeeds.
- **Social writes are queued too, but no post is kept for reading** (spec 031). Likes, reposts
  and comments go through `lib/social-offline.ts`; keeping other people's posts on the device is
  S3 of #20 and waits for the owner. A like/unlike pair cancels only when `!maybeSent`.
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

- **Food publishing is explicit, snapshot-based and separate from live widget sharing.** Read
  `docs/modules/posts.md` and `specs/007-food-posts/` before changing it. All post access needs
  social + nutrition + foodPosts, current graph/audience checks and no-store responses.
  NutritionPublicationService alone projects owned nutrition facts and creates attributed
  private imports. Preserve idempotency keys and deletion tombstones; never log meals on import.
- **`/new` (the new post page) is not a tab.** It is a normal route the shell renders without
  header or nav, like a chat. Don't add it to the tab roots or it would stay mounted with a live
  camera. A food posted without "Save to my foods" is created `archived`; never list archived
  foods in the picker, and don't drop the archived exception from the single-food publication.
  A food's `image.key` never leaves the API: responses carry a signed `url` instead.
