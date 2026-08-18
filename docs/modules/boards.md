# Module: boards (Widgets 5, 6, 7 — EPAM, client project, SoulArt, ShopIt)

Four screens that are the same shape with different names, so they are **rows in one
collection**, not four near-identical modules.

**Code:** `apps/api/src/boards/` · `apps/web/src/app/boards/[key]/page.tsx`

## Why one module

The user's brief described widgets 5–7 as "pretty much the same, mostly the names will be
different". Implementing them separately would triple the surface for every future change.
Instead a `Board` row carries a `features` array and the detail page renders only the sections
the board opted into — SoulArt carries no dead people-management UI.

| Board | `kind` | Features |
| --- | --- | --- |
| `epam` | `employer` | tasks, notes, **people**, **contributions**, wins |
| `client-project` | `client_project` | tasks, notes, wins |
| `soulart` | `side_project` | tasks, notes |
| `shopit` | `side_project` | tasks, notes |

Routes accept a slug or a Mongo id: `resolve()` checks `isValidObjectId` and falls back to
`key`, so `/boards/epam` works and stays readable.

## Collections

`boards`, `board_tasks`, `board_notes`, `board_people`, `board_contributions`, `board_wins`.
All scoped by `userId` **and** `boardId`. Deleting a board cascades all five.

## People (EPAM only)

The brief asked to "show their states, if any of them requires my attention or will require my
attention at some point, with some notes for why".

`attentionState` is one of `ok` · `upcoming` ("will need me") · `needs_attention` ("needs me
now") · `at_risk`, and `attentionReason` carries the why. `nextCheckIn`, `lastOneOnOne` and
`oneOnOneCadenceDays` (default 14) drive an **overdue 1:1** flag computed on read by
`isOneOnOneOverdue()` — never stored, per principle III. `POST /people/:id/one-on-one` stamps
today and pushes the next check-in out by the cadence, optionally prepending a dated note.

## Contributions — the promotion tracker

This is the part the brief asked for suggestions on. EPAM's Talent Partner perks come from
work outside the client project: interviews, referrals, helping projects staff people. Those
accumulate towards promotion and are exactly the kind of thing nobody remembers at review time.

So each one is logged with a type, a date and a **points** weight (`CONTRIBUTION_POINTS` in
`shared-types` supplies the default per type, so the user never has to invent a number):

`hire_closed` 8 · `certification` 5 · `staffing_help` 4 · `article_or_talk` 4 ·
`referral` 3 · `mentoring` 3 · `interview` 2 · `internal_activity` 2 · `other` 1

`contributionPointsLast6Months` sums a rolling six months, matching the review cycle. The weights
are a nudge, not a formula — tune them freely.

## Wins — review evidence

For the EPAM and client-project boards. A dated line with `impact` ("what changed, ideally with a
number") and `witnesses` ("who noticed"). Directly serves the brief's "any way I can show off
myself better to the client for better performance reviews": the hard part of a review is
remembering specifics six months later, so the fix is capturing them when they happen.

## Tasks

Priority 1–4 (now / soon / normal / someday) and an optional `impact` field
(`promotion` · `performance_review` · `revenue` · `maintenance` · `learning`) so the list can be
sorted by what moves the needle rather than only by urgency. `completedAt` is stamped server-side
when status becomes `done` and cleared when it moves back, so history cannot drift from status.

## Endpoints

```
GET    /api/boards                      boards + summaries (drives the nav and the cards)
POST   /api/boards
GET    /api/boards/:key                 full detail, honouring `features`
PATCH  /api/boards/:key
DELETE /api/boards/:key                 cascades everything on the board

GET    /api/boards/:key/tasks           ?status=
POST   /api/boards/:key/tasks
PUT    /api/boards/:key/tasks/order     { order: string[] }
PATCH  /api/boards/tasks/:id
DELETE /api/boards/tasks/:id

POST   /api/boards/:key/notes           PATCH/DELETE /api/boards/notes/:id
POST   /api/boards/:key/people          PATCH/DELETE /api/boards/people/:id
POST   /api/boards/people/:id/one-on-one
POST   /api/boards/:key/contributions   PATCH/DELETE /api/boards/contributions/:id
POST   /api/boards/:key/wins            PATCH/DELETE /api/boards/wins/:id
```

## Cross-links

- **→ dashboard** — one card per board, from `summaries()`. People and contribution stats appear
  only on boards with those features.
- **→ app shell** — the nav is built from `GET /api/boards`, so adding a board adds its nav entry
  without a deploy.

## Open questions

Ideas the brief invited but that are not built yet:

- **Promotion target.** Points are counted but there is no goal to count towards. A configurable
  target per review cycle with a progress bar would make the number actionable.
- **Attrition risk.** `at_risk` exists as a state but nothing prompts a follow-up.
- **Interview pipeline.** Candidates are logged as one-off contributions; there is no
  candidate-through-stages view.
- Recurring tasks. Boards have none — only the cashflow module has recurrence.
