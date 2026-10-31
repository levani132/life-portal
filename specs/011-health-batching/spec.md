# Manual Health sync and resumable query batches

Approved behavior: visible compact Sync button; reminder after six hours; no automatic
Shortcuts launches or HTTPS return callbacks; manual iPhone setup instructions instead of
plist import. Server owns bounded query windows and acknowledgements. Capped results split,
interrupted sessions resume, and repeated acknowledgements do not duplicate stored energy.
No query result establishes wear/permission completeness or enables downward adjustment.

Implementation: legacy upload remains compatible; a separate Health-only batch credential is
bound to account, connection and a 15-minute session. Cursor advancement follows successful
writes. First sync considers 72 recent hours; caught-up runs recheck six hours for delayed
samples. At most 12 windows per Shortcut run, 250 rows per kind per query, adaptive splitting
and an explicit blocked state for irreducibly dense one-second intervals. Preserve previously
known records when permissions/data are missing. Replace matching source/type/ID records.

Verification: focused API queue, split, replay, write failure and owner-isolation tests; client
six-hour boundary and no-auto-launch tests; type and lint checks. Generated Shortcut references
and control-flow are checked mechanically. Manual iPhone assembly, execution, platform prompts
and PWA handoff remain device acceptance work. No signed/importable artifact is claimed.
