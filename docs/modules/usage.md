# Usage: the numbers

Roadmap step 3, first part. `apps/api/src/usage`, `libs/shared/domain/src/lib/usage.ts`, web
`app/settings/numbers`. Developer only.

## What it answers

`GET /usage?range=7|30|90&today=YYYY-MM-DD` → `UsageReport` (`libs/shared/types/src/lib/usage.ts`).
`today` is the developer's own calendar day, sent by the browser.

| Figure | Meaning |
|---|---|
| `totalAccounts` | Every account that exists, suspended ones included |
| `newAccounts` | Accounts created in the range |
| `activeToday`, `active7`, `active30` | Distinct people who did something today, in the last 7 days, in the last 30 days |
| `newAccountsActivated` | Of the accounts created in the range, how many ever did anything |
| `retention` | For 1, 7 and 30 days: of accounts created in the last 90 days and old enough, how many did something on that day after joining or later |
| `people` | Distinct people who logged food, trained, weighed in, posted, or engaged (liked, commented, messaged) in the range |
| `days` | Per day: new accounts, active people, people who logged food, trained, posted |

**"Active" means the person did something that leaves a record.** Opening the app and only
reading is not recorded anywhere, so it is not counted. The page says so.

## Where it reads

`USAGE_SOURCES` lists each source: collection, the field holding the person, and either a stored
calendar day or a timestamp turned into a day in `USAGE_TIMEZONE` (`Asia/Tbilisi`).

| Kind | Collection | Day |
|---|---|---|
| food | `meal_entries` | `day` |
| training | `workout_sessions` | `day` |
| weight | `weigh_ins` | `day` |
| post | `food_posts` (live, not reposts) | `createdAt` |
| social | `post_comments`, `post_likes`, `messages` | `createdAt` |

Sign-ups are `users.createdAt`. The look-back is always 90 days, whatever range is shown,
because retention needs it.

## Rules

- **Derived, never stored** (principle 3): there is no collection. Each read aggregates distinct
  (person, day) pairs per source, and `usageReport()` (pure, "today" explicit) counts them.
- **No person leaves the API.** Ids are used to count distinct people and are never returned.
- **Only who and when is read**, never a record's content.
- `UsageService` reads other modules' collections by name through the database driver. That is
  allowed only here and in `AccountService` (DECISIONS, 2026-11-22).
- A new kind of activity is one line in `USAGE_SOURCES`.

## Not here

Visits, where people come from, and where sign-up loses them: the second part of the roadmap
step, which needs something that counts page views.

## Tests

`libs/shared/domain/src/lib/usage.spec.ts` (counts, windows, retention, an empty app) and
`apps/api/src/usage/usage.module.spec.ts` (sources exist, kinds, developer only, no id in the
answer). The aggregation itself runs only against a real database.
