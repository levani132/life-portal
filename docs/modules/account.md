# Account: leaving and taking your data

Spec 038. `apps/api/src/account`, web `app/settings/data` and `components/account-data.tsx`.

## What it does

- **Export**: `GET /account/export` → `AccountExport` (`libs/shared/types/src/lib/account.ts`):
  the account, `data` (one list per collection, records as stored), `files` (signed links to the
  account's photos and videos, about an hour) and `notes`. `no-store`. 6 an hour.
- **Delete**: `POST /account/delete {password}` or `{confirmEmail}` (accounts with no password).
  Immediate and final. 5 attempts an hour. Codes: `WRONG_PASSWORD`, `CONFIRM_EMAIL`,
  `DEVELOPER_ACCOUNT`, `FILES_NOT_DELETED` (503: nothing was deleted, try again).

No collection of its own. It stores nothing.

## The plan

`account-plan.ts` lists **every** collection the API declares with one of three rules:

| Rule | Meaning |
|---|---|
| `owned` | Rows found by `userId` (or `field`). Deleted with the account; exported unless `export: false` (sessions, tokens, caches). |
| `custom` | Handled by name in `AccountService`: the account itself, and rows shared between people. |
| `kept` | Holds no person, with the reason written beside it. |

`account-plan.spec.ts` reads the API source for `collection: '…'` and fails when a collection is
missing from the plan or the plan names one that is gone. **A new collection must be added to the
plan in the same change.**

## Deleting, in order

1. **Files.** Every storage key found in the account's rows of `FILE_COLLECTIONS`
   (`storageKeysIn()`, pure, in `libs/shared/domain`). If one cannot be deleted, stop with
   `FILES_NOT_DELETED` before touching the database: a file with no record could never be found.
2. **Credentials**: sessions, assistant credentials, Shortcut tokens, push devices, email tokens.
   `JwtStrategy` checks the session on every request, so access ends here.
3. **What others hold of the account**: likes, comments and reports on its posts; other people's
   reposts of them; "not interested" rows about it; its place in other people's link-only posts;
   friendships and blocks; conversations it is in, with all their messages; its membership and
   frozen result in tournament groups. Copies people saved from its posts stay and lose the name
   (`Shared by a former member`).
4. **What it owns**: every `owned` collection.
5. **The account row**, last, so an interrupted deletion can be run again after signing in.

Then a security event with no account (`account_deleted`) and, when email is configured, a
message to the deleted address.

## Exporting

Owned collections marked for export, plus the account's posts, friendships and the messages it
sent. `exportRecord()` (pure) turns ids and dates into text and drops, at any depth, any field
whose name contains hash, secret, token or fingerprint, link keys and viewers, and storage
locations. At most 50,000 records per collection.

## Web

Menu → **Your data and account**. Export is two taps (Prepare, then Save): a phone lets a page
hand over a file only straight after a tap. After a deletion the device forgets the account with
`useAuth().forget()`, which also discards unsent offline changes.

## Tests

`account.service.spec.ts` runs export and deletion against an in-memory store with two accounts
and asserts that nothing naming the deleted account is left anywhere and the other account is
whole. `libs/shared/domain/src/lib/account.spec.ts` covers the two pure helpers.
