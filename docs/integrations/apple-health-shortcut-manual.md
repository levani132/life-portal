# Life Portal Health: latest samples

Create or edit **Life Portal Health** on your iPhone. No plist import or Mac signing is required.
Share the tested Shortcut via iCloud. The developer updates its link in Settings → Apple Health Shortcut.
Installation/update prompts compare that URL with the version confirmed on each device.

## App input

The app passes exactly these JSON fields:

- `token`: Health-only, single-use upload credential, valid for 15 minutes.
- `uploadUrl`: full endpoint address; use directly without appending a path.
- `limitPerKind`: currently **50**, applied separately to both searches.

There are no date bounds, window IDs, counts, next requests or outer repeats.

## Shortcut actions

1. Get Dictionary from **Shortcut Input**. Read `token`, `uploadUrl`, and `limitPerKind`
   from that same dictionary and save each as a named variable.
2. Create an empty List and Set Variable `Samples`.
3. Find Health Samples: **Active Energy / Active Calories**, no date filters, Group None,
   Sort **Start Date**, **Newest First**, Limit enabled with `limitPerKind`, unit **kcal**.
4. Repeat each result. Read the current inner Repeat Item's Start Date, End Date,
   Source and Value. Format both dates as `yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX`.
   Create a dictionary and Add to Variable `Samples`:

   | Key | Value |
   | --- | --- |
   | `id` | formatted start + `/` + formatted end |
   | `type` | literal `activeEnergy` |
   | `source` | source name |
   | `start` | formatted start |
   | `end` | formatted end |
   | `value` | sample value (number or numeric text) |
   | `unit` | literal `kcal` |

5. Find **Steps**, no date filters, Group None, Sort Start Date, **Newest First**,
   Limit `limitPerKind`, unit **count**. Repeat as above with type `steps` and unit `count`.
   Append to the same `Samples` list; do not reset between searches.
6. Get Contents of **uploadUrl** once:
   - Method **POST**.
   - Header `x-health-ticket`: input `token` variable.
   - JSON body containing only `samples`: combined `Samples` list.
     The receiver also accepts JSON-text arrays, individual dictionaries and newline-separated
     JSON dictionaries produced by Shortcuts. Empty text is treated as an empty list.
7. Optionally show the response's `received` count and stop. Return to your existing
   Life Portal app manually; do not open a browser return URL.

Example empty body: `{ "samples": [] }`.
Example response: `{ "received": 100, "limitPerKind": 50 }`.

`received` means distinct records processed, not necessarily newly inserted. Repeats merge
by source/type/ID. Successful uploads consume the ticket; failed storage leaves it retryable
until expiry. Empty uploads never erase records or advance the last data receipt.

## Coverage

This imports recent samples, not complete history. More than 50 new records of one type
between runs can leave gaps. Previously imported records remain stored. Missing samples
and read permissions never establish inactivity or full device wear.

If iOS blocks sharing, check Settings → Shortcuts → Advanced → Allow Sharing Large Amounts
of Data and the Shortcut's Privacy permissions. Prompts vary by iOS version.
