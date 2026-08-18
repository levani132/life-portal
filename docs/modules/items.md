# Module: items (Widget 3 — Items to sell)

Things owned that should be sold, with listings, buyer interest and three price points.

**Code:** `apps/api/src/items/items.module.ts` (schema, DTOs, service and controller in one file
— the module is small enough that splitting it would cost more than it saves)
**Domain logic:** `libs/shared/domain/src/lib/summaries.ts`

## Collection: `sellable_items`

Three prices, because a single number cannot answer both "what will I get?" and "is this offer
worth taking?":

| Field | Meaning | Used by |
| --- | --- | --- |
| `askingPriceCents` | What it is advertised for | the best-case loan scenario |
| `expectedPriceCents` | Realistic, after haggling | the realistic scenario, and the headline total |
| `minPriceCents` | Walk-away price | the pessimistic total |

`expectedPriceCents` defaults to the asking price on create, so projections are never zero
merely because the user has not thought about haggling yet.

## Statuses

`draft` → `listed` → `has_interest` → `reserved` → `sold`, plus `abandoned` for "decided to keep
it". `OPEN_ITEM_STATUSES` (the first four) is exported from `shared-types` and is what every
total filters on — `sold` and `abandoned` are excluded from future money.

`nearlySoldCount` counts `has_interest` + `reserved`: the items closest to becoming cash, which
is what the dashboard card flags.

## Earmarking

`allocateToLoanId` + `allocationRatio` (default 1) send the proceeds to a specific debt.
`itemsProceedsForLoan()` filters to open items earmarked for that loan and returns all three
price variants plus the earliest `expectedSaleDate`, which the best-case scenario uses to date
the inflow instead of assuming a month.

## Endpoints

```
GET    /api/items                items + summary; ?status= filters
GET    /api/items/summary
GET    /api/items/:id
POST   /api/items
PATCH  /api/items/:id
POST   /api/items/:id/sold       { soldPriceCents, soldAt? }
DELETE /api/items/:id
```

`POST /:id/sold` only marks the item. Recording the money against a debt is a separate
`POST /api/loans/:id/payments` call, which the web UI chains behind a checkbox when the item was
earmarked. Keeping them separate means marking something sold never writes to a ledger by
surprise.

## Cross-links

- **→ loans** — expected/pessimistic/optimistic proceeds per loan.
- **→ dashboard** — open count, expected proceeds, realised proceeds, buyers waiting.

## Open questions

- `listings` and `interests` are stored as subdocuments but the UI only reads them; there is no
  form to add a listing or log an offer yet. The API accepts them on create/update.
- No photo upload — `photoUrl` takes an external URL only.
