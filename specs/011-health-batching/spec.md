# Historical: manual Health sync and resumable query batches

Superseded on November 2, 2026 by the recent-samples protocol in
`docs/integrations/apple-health-shortcut-manual.md`. Runtime batch routes and
window planning have been removed. Existing uploaded records remain stored.

The former protocol used six-hour windows, splitting capped results into smaller
queries. iPhone filter behavior made exact time-window coverage unreliable.
The replacement imports the newest 50 samples per type in one request, without
claiming complete history or deleting older imports.
