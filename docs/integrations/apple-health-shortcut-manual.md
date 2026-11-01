# Build the resumable Apple Health Shortcut manually

This guide replaces the unsupported plist import path. Create the actions directly in the
**Shortcuts app on your iPhone**. No signing or plist import is required for a Shortcut you
create there. The receiver and app must have the batching update deployed first.

## Before you start

- Keep a duplicate of your existing Shortcut as a backup with a different name.
- Name the new one **Life Portal Health** exactly. The app launches that name.
- Use **Shortcut Input** (the input passed by Life Portal), not Ask for Input.
- Do not put a website URL, password, access token, or upload ticket into the Shortcut manually.
  The app passes the current addresses, time bounds and expiring Health ticket each run.
- In the instructions below, names such as `Token` and `Window ID` are variables. Insert them
  using the variable picker; do not type their names as literal text.
- Do not add an Open URL/Open App action that opens the website at the end. It can create a
  new browser tab. After it finishes, switch back to the existing PWA yourself.

## 1. Read the app's input — outside all repeats

1. **Get Dictionary from Input** → input **Shortcut Input**. Set Variable → `Launch`.
2. **Get Dictionary Value** → key `token` in `Launch`. Set Variable → `Token`.
3. **Get Dictionary Value** → key `batchUrl` in `Launch`. Set Variable → `Batch URL`.
4. **Get Dictionary Value** → key `to` in `Launch`. Set Variable → `Run end`.

If `batchUrl` is missing, the app/server is still an older version. Stop and reload the app;
do not invent a URL or reuse a ticket from a previous run.

## 2. Add an outer Repeat — 12 times

Everything in sections 3–7 goes **inside this Repeat**. The server stores progress after each
acknowledgement. Twelve is a run budget, not a sample limit or a promise all history is finished.
If interrupted, the next run resumes unfinished windows with a fresh ticket.

## 3. Request the next window

Inside the outer Repeat:

1. **Text** → insert `Batch URL`, then type `/next` immediately after it (no spaces).
2. **Get Contents of URL** → that Text; method **POST**.
   Add header **`x-health-ticket`** → `Token`. No request body is needed.
3. **Get Dictionary from Input** → Contents of URL. Set Variable → `Next`.
4. **Get Dictionary Value** → key `state` in `Next`.
5. **If** that value **is not** `ready`:
   - **Stop and Output** → `Return to Life Portal to see sync status.`
   - End If.
6. **Get Dictionary Value** → key `window` in `Next`. Set Variable → `Window`.
7. Read these keys from `Window`, assigning the variables shown:

| Key | Variable |
| --- | --- |
| `id` | `Window ID` |
| `queryFrom` | `Query start` |
| `to` | `Window end` |
| `limitPerKind` | `Sample limit` |

The server may return an hour or a smaller interval. Always use its values; do not advance
hours yourself. `queryFrom` includes a small overlap so strict “is after” filtering does not
lose records exactly on a boundary. The receiver handles the overlap.

## 4. Reset the row list — each outer iteration

Add an empty **List** action (remove its example items). Set Variable → `Samples`.
This must be inside the outer Repeat, before either Health query, so rows from an earlier
window are not uploaded with the next window.

## 5. Fetch and serialize Active Calories

1. **Find Health Samples** with **All** these filters:
   - Type **is Active Calories** (some iOS versions label this Active Energy).
   - Start Date **is after** `Query start`.
   - Start Date **is before** `Window end`.
   - End Date **is before** `Run end` (not Window end: a sample may span hours).
2. Sort by **Start Date**, **Oldest First**.
3. Enable **Limit** and use variable `Sample limit` for the number. The server supplies **50**.
   Use the number field's variable picker. If your editor cannot bind that field to a variable,
   use the fixed value **50** once; do not change it to match a calorie total.
4. Set Variable → `Active samples` from Find Health Samples.
5. **Count** → **Items** in `Active samples`. Set Variable → `Active count`.
6. **Repeat with Each** item in `Active samples`.

Inside this inner Repeat, use **Repeat Item from the Health-sample repeat**, not the outer
Repeat Index. You can set Variable `Sample` to that Repeat Item to make the wiring obvious.

Use **Get Details of Health Sample** to read `Start Date`, `End Date`, `Source`, `Value`, and
`Unit` from `Sample`. Keep each result in its own variable.

Use **Format Date** on Start Date and End Date, both with Custom format:

```text
yyyy-MM-dd'T'HH:mm:ss.SSSXXXXX
```

Call these `Start text` and `End text`. This preserves the offset and milliseconds; ordinary
localized dates are unsuitable for upload.

Create a **Text** action containing `Start text`, a slash `/`, then `End text`. Set Variable →
`Sample ID`. Then create a **Dictionary** with these eight fields. Use **Number** for `value` and **Text** for the others:

| Key | Value |
| --- | --- |
| `id` | `Sample ID` |
| `type` | literal `activeEnergy` |
| `source` | Source result |
| `start` | `Start text` |
| `end` | `End text` |
| `value` | Value result |
| `unit` | Unit result |

Use **Add to Variable** → add that Dictionary to `Samples`. End the inner Repeat.

Do not sum the calories here. Do not convert calories into sample counts. Keep the recorded
unit: the server accepts kcal/Cal and kJ and normalizes kJ. Leave source and timestamps intact
so overlapping devices and later retries do not add the same energy twice.

## 6. Fetch and serialize Steps

Duplicate the Active Calories block, with these changes only:

- Find type **Steps**.
- Store the Find result as `Step samples` and Count as `Step count`.
- Repeat over `Step samples`.
- Dictionary `type` is literal **`steps`**.
- Append to the **same** `Samples` variable. Do not reset it between Active Calories and Steps.

The combined count is at most 100. If either query returns 50, the server conservatively
splits the interval and asks for smaller windows. A capped query is never marked complete.

## 7. Upload the current window

Still inside the outer Repeat, after both inner Health repeats:

1. **Combine Text** → combine `Samples` with separator **Custom**, exactly one comma `,`.
   Each item must be the Dictionary created above, so its text representation is JSON.
   Call the result `Combined rows`.
2. **Text** → type an opening `[`; insert `Combined rows`; type a closing `]`.
   No outer quotation marks. Call this `Rows JSON`. An empty list must produce `[]`.
3. **Text** → insert `Batch URL`, then type `/upload` immediately after it.
4. **Get Contents of URL** → that Text; method **POST**.
   Header **`x-health-ticket`** → `Token`.
   Request Body **JSON**, with these fields:

| Key | JSON body field type | Value |
| --- | --- | --- |
| `windowId` | Text | `Window ID` |
| `activeCount` | Number | `Active count` |
| `stepCount` | Number | `Step count` |
| `samples` | Text | `Rows JSON` |

Using Text for `samples` is intentional: the server decodes one JSON-array string and then
validates every row. Do not double-encode it or put a Dictionary directly into a text field.
Do not use Form body. JSON body automatically supplies the JSON content type.

A successful response acknowledges this window or reports it was split. The next outer
iteration calls `/next` to obtain the authoritative cursor. Do not change Window ID, retry
with a new made-up ID, or derive the next time from the last sample.

End the outer Repeat. Optionally add **Stop and Output** → `Sync run finished. Return to
Life Portal; any remaining windows resume next time.` Do not add an action opening the website.

## Final outline

```text
Get input dictionary → Token / Batch URL / Run end
Repeat 12 times
    POST Batch URL/next with Health ticket
    If state is not ready → Stop and Output
    Read Window ID / Query start / Window end / Sample limit
    Empty Samples list
    Find Active Calories (bounded dates, limit 50)
    Count → Active count
    Repeat each Active sample
        Read details → format dates → Dictionary → Add to Samples
    End Repeat
    Find Steps (same bounds, limit 50)
    Count → Step count
    Repeat each Step sample
        Read details → format dates → Dictionary → Add to Samples
    End Repeat
    Combine sample dictionaries with comma → surround with [ ]
    POST Batch URL/upload with ticket, Window ID, both counts, Rows JSON
End Repeat
Stop; return to the existing Life Portal PWA yourself
```

## Test once on the iPhone

Start with the visible **Sync** button in Life Portal, not the Shortcut's Play button (Play
alone has no app-supplied ticket). Allow Health read access and the request to your API host.
Return to the same PWA through the app switcher or its Home Screen icon. Open Activity Info:
look for an updated last receipt and pending query-window count. If windows remain, tap Sync
again when convenient. The app does not automatically launch Shortcuts.

If validation fails, use the redacted `HealthUpload` log: it names rejected schema fields and
rules without printing your values. Counts of zero or completed query windows do not prove
permission access, full device wear, or inactivity. Unreceived workout records remain unknown.

Once verified, you may share this manually created Shortcut using its real iCloud sharing
link. Generated source and mechanical checks are not an iPhone runtime verification.
