# Contract — HTTP API

All routes are under `/api` and JWT-guarded by the global guard, **except** `POST /spending/ingest`,
which authenticates with an ingest token instead. No route is `@Public()`.

Every read takes the usual optional `?today=YYYY-MM-DD` override so the UI can ask "what did this
look like on the 3rd" and tests stay deterministic.

---

## Ingest

### `POST /api/spending/ingest`

The only route a phone automation calls. Authenticated by header, **not** by JWT and **not**
public.

```
Headers:  X-Ingest-Token: lp_<tokenId>_<secret>
          Content-Type: application/json
```

```jsonc
{
  "source": "sms",
  "bank": "bog",              // "bog" | "tbc"
  "raw": "გადახდა: GEL4.00\nCard:***9582\nNILE\n24.08.2026",
  "at": "2026-08-24T21:15:04+04:00"   // ISO with offset; the phone's clock
}
```

**Response `201`**

```jsonc
{
  "recorded": true,
  "duplicate": false,
  "status": "recorded",       // or "unparsed"
  "paymentId": "…",
  "day": "2026-08-24"         // after localDay(at, dayStartHour)
}
```

| Case | Response |
| --- | --- |
| Parsed cleanly | `201`, `status: "recorded"` |
| Not recognised | `201`, `status: "unparsed"` — raw kept, queued. **Never a 4xx**: the automation must not retry, and the message must not be lost |
| Same raw text within 120 s | `201`, `duplicate: true`, nothing written |
| Missing / expired / revoked token | `401`, nothing written |
| Over 60 accepted in the hour | `429` |

The success-on-unparsed rule matters: a Shortcut has no way to handle an error, so anything other
than 2xx means the message is gone for good.

---

## Payments

### `GET /api/spending/payments?from=&to=&status=`

Payments in a day range, newest first, each with its derived decomposition.

```jsonc
{
  "payments": [{
    "id": "…",
    "day": "2026-08-24", "at": "2026-08-24T13:30:00+04:00",
    "amountCents": 1445, "currency": "GEL",
    "displayAmountCents": 1445,
    "merchant": "mcdonald s draivi", "cardLast4": "6810",
    "source": "sms", "bank": "tbc", "status": "recorded",
    "notReallySpentCents": null,
    "decision": null,
    "allocations": [
      { "target": "expense", "expenseId": "…", "label": "Breakfast",
        "amountCents": 1445, "forDay": "2026-08-24", "projected": true }
    ],
    "basis": "Projected against the ladder; not confirmed"
  }],
  "total": 4
}
```

### `POST /api/spending/payments`

Record one by hand — cash, or a transfer made instead of a card payment.

```jsonc
{ "amountCents": 2500, "currency": "GEL", "merchant": "Barber",
  "at": "2026-08-24T18:00:00+04:00", "day": "2026-08-24" }
```

`day` is optional; omitted, the server derives it from `at`.

### `PATCH /api/spending/payments/:id`

`amountCents`, `currency`, `merchant`, `at`, `day`, `notReallySpentCents`. Also how an `unparsed`
row is completed — supplying an amount flips `status` to `recorded`.

### `DELETE /api/spending/payments/:id`

### `PUT /api/spending/payments/:id/decision`

```jsonc
// A list, because one supermarket payment is routinely part dinner and part household.
{ "kind": "confirmed", "allocations": [
    { "expenseId": "…", "amountCents": 2000 },
    { "expenseId": "…", "amountCents": 3000 }
] }

// Partial: ₾20 was dinner, work out the rest. The remainder rejoins the cascade.
{ "kind": "confirmed", "allocations": [{ "expenseId": "…", "amountCents": 2000 }] }

// Tonight's shopping is for tomorrow's allowance. The money still left today.
{ "kind": "confirmed", "allocations": [
    { "expenseId": "…", "amountCents": 3000, "forDay": "2026-08-25" }
] }

// One carton of milk covers four breakfasts — spread evenly across the span.
{ "kind": "confirmed", "allocations": [
    { "expenseId": "…", "amountCents": 4000, "forDay": "2026-08-25", "throughDay": "2026-08-28" }
] }

{ "kind": "custom", "purpose": "vase" }      // consume no allowance
{ "kind": "none" }                           // back to a projection
```

Allocations may sum to **at most** the spendable amount; a shortfall is legal and cascades. `403`
if an `expenseId` is not the caller's, `400` if the allocations exceed the payment or if
`throughDay < forDay`.

**Confirming one payment re-proposes the others.** No other call is needed: the next read of
`GET /api/spending` reflects it, because every unconfirmed payment is projected against whatever
allowance is left after confirmations are placed.

### `POST /api/spending/payments/:id/promote`

Turns a custom purpose into a budgeted line item (FR-017). Creates an **expense** through
`CashflowService` — this module never writes that collection itself.

```jsonc
{ "cadence": "monthly", "label": "Home things", "amountCents": 5000, "currency": "USD" }
```

Returns the created expense. The new rung applies from its start date; past payments are not
retrospectively pulled in.

---

## The ladder and the figures

### `GET /api/spending?today=`

Everything the detail page needs in one round trip.

```jsonc
{
  "today": "2026-08-24",
  "ladder": {
    "date": "2026-08-24",
    "tiers": [{
      "cadence": "daily",
      "budgetCents": 7836, "consumedCents": 4759, "savingCents": 3077,
      "rungs": [
        { "expenseId": "…", "label": "Breakfast", "budgetCents": 2612,
          "consumedCents": 2612, "remainingCents": 0, "settlement": "auto" },
        { "expenseId": "…", "label": "Lunch + Dinner", "budgetCents": 5224,
          "consumedCents": 2147, "remainingCents": 3077, "settlement": "auto" }
      ]
    }],
    "extraCents": 0,
    "unconvertedCurrencies": []
  },
  // `spentCents` follows the money (payment.day); the ladder follows the allowance (forDay).
  "today_": { "spentCents": 4759, "savedCents": 3077, "extraCents": 0, "netCents": 3077 },
  "unparsedCount": 0,
  "gaps": [],
  "basis": "Reflects captured payments only, so it is a lower bound. Converted to GEL at the National Bank of Georgia rate for 2026-08-24."
}
```

Amounts are in the display currency, converted at each day's own rate.

### `GET /api/spending/savings?from=&to=`

```jsonc
{
  "periods": [
    { "cadence": "daily", "from": "2026-08-24", "to": "2026-08-24",
      "budgetCents": 7836, "spentCents": 4759, "savingCents": 3077,
      "extraCents": 0, "netCents": 3077 }
  ],
  "cumulative": {
    "totalCents": 41230,
    "daily": 12100, "weekly": 18400, "monthly": 10730,
    "extraCents": 5220
  },
  "month": {
    "projectedSavingCents": 120000,   // income − budgeted spend, from cashflow
    "actualSavingCents": 98400,
    "extraCents": 5220
  }
}
```

`cumulative.daily + weekly + monthly` equals `totalCents` exactly — the invariant from
research §2, and it holds however the payments in the window were decided.

### `PUT /api/spending/order`

```jsonc
{ "order": ["<expenseId>", "<expenseId>", "…"] }
```

Ids across all tiers in one list; within a tier, rungs sort by their index. Unknown ids are
tolerated and unlisted expenses fall to the end, exactly as `widgetOrder` behaves.

---

## Budget proposals

### `GET /api/spending/suggestions?today=`

```jsonc
{
  "suggestions": [{
    "expenseId": "…", "label": "Breakfast",
    "currentCents": 2612, "suggestedCents": 1750,
    "value": 1750,
    "basis": "Median of 28 complete days was ₾17.50 against a ₾26.12 allowance",
    "assumptions": { "periods": 28, "cadence": "daily", "medianCents": 1750 },
    "confidence": "medium"
  }]
}
```

The payload is an `Estimate<Cents>` (principle VI). Nothing changes until accepted.

### `POST /api/spending/suggestions/:expenseId/accept`
### `POST /api/spending/suggestions/:expenseId/dismiss`

Accept updates the expense through `CashflowService`. Dismiss records the value dismissed so the
same figure is not proposed again immediately.

---

## Tokens

### `GET /api/spending/tokens`

```jsonc
{ "tokens": [{ "id": "…", "label": "iPhone — TBC", "expiresAt": "2027-08-25",
               "lastUsedAt": "2026-08-24T21:15:04+04:00", "revokedAt": null }] }
```

Never includes a secret.

### `POST /api/spending/tokens`

```jsonc
{ "label": "iPhone — TBC", "expiresAt": "2027-08-25" }
```

**Response `201`** — the only time the plain value ever exists in a response:

```jsonc
{ "id": "…", "label": "iPhone — TBC", "expiresAt": "2027-08-25",
  "token": "lp_66c1f0a2e4b09d3f2a7c5e11_9Fk2…" }
```

### `DELETE /api/spending/tokens/:id`

Revokes. The row is kept with `revokedAt` set, so a revoked credential stays auditable.

---

## Changed elsewhere

### `PATCH /api/cashflow/expenses/:id`

Gains `settlement: 'auto' | 'manual'`. Owned by cashflow; the spending module only reads it.

### `PUT /api/settings`

Gains `weekStartsOn` (0–6). `spendOrder` is written through `PUT /api/spending/order` rather than
here, so reordering the ladder has exactly one writer and cannot arrive bundled with a currency
change — the same reasoning as `widgetOrder`.
