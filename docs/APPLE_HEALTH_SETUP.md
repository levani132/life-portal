# Apple Health implementation and device handoff

Implemented: step-based onboarding, separate everyday/exercise estimates, editable profile
preferences/timezone/day boundary, raw Health upload receiver, account-scoped pairing and
revocation, single-use upload tickets, daily source snapshots, pure calorie adjustment, Food
rings/activity details, Home freshness bridge and a tap fallback. No hosting deployment was run.

## Supported setup: build directly in Shortcuts

Follow [the complete manual iPhone Shortcut guide](integrations/apple-health-shortcut-manual.md).
The supported Shortcut imports the newest 50 Active Energy and 50 Steps samples once per
run, with no date filters or window loop. The app supplies `{token, uploadUrl, limitPerKind}`.
Its JSON upload body is only `{samples}`; `x-health-ticket` carries the scoped credential.
The previous generated window-based sources are obsolete and must not be installed.
Manual editing on the iPhone avoids the Mac signing/iCloud dependency. Share the tested copy
via a fresh iCloud link and update Settings → Apple Health Shortcut (developer only).

## Manual sync and returning to the PWA

Sync is now manual only. Mount, focus, resume and timers refresh receipt information without
opening Shortcuts. The visible button says `Sync due` after six hours without a successful
receipt (or when no receipt exists); it remains usable at any time. A receipt does not prove
complete tracking. Activity Info shows the last upload and its sample count separately from
the last nonempty data receipt. More than 50 new samples between syncs can leave gaps.

Launch uses `shortcuts://run-shortcut` without `x-success`, `x-cancel` or `x-error` web callbacks.
Do not add Open URL at the end of the manually created Shortcut. This removes the app's cause
of the extra Safari tab. Return through the existing PWA's Home Screen icon or app switcher.
We found no documented iOS mechanism to guarantee targeting that existing PWA/browser window;
no native-app universal-link behavior is claimed for the PWA. Its manifest already has
`display: standalone`, `id: /`, `scope: /`.

## Required iPhone acceptance check

1. Install; run from Life Portal, grant read permissions for Active Calories and Steps and
   network access. Match one sample's exact time/source/unit against Health. Test kcal and kJ.
2. Verify valid receipt changes last-sync and records nonzero samples. Denied read permissions,
   an empty list, cancel, browser return or callback alone must never claim complete tracking.
3. Repeat an upload; ensure source overlaps and repeated uploads do not multiply energy.
   Test 03:59/04:00 and a changed day boundary. Compare only matching sample periods.
4. Revoke and try an old ticket; it must fail. Pair another account and verify isolation.
5. Test Safari and installed Home Screen app, app resume, and shortcut missing/cancelled.
   Confirm nothing opens automatically, no browser return tab appears, and manual return
   refreshes receipts. Check the six-hour reminder and manual Sync retry.

This Shortcut and receiver currently import Active Energy and Steps only. They do not
establish that no workouts occurred or infer a walking/lifting calorie split.

## Model and coverage policy

Mifflin–St Jeor / measured resting rate / measured lean-mass equation remain as before.
New everyday movement fractions of resting rate: sitting 0.15, mixed/varies 0.30, moving 0.50,
demanding 0.75. These are explicit planning heuristics, not measured PAL categories.
Exercise net kcal = `(MET − 1) × kg × hours × sessions/week / 7`. MET assumptions are
3.5 strength (including normal rests), 5 walking/running, 6 cycling/swimming/sports, 4.5 mixed.
Broad mixed activities are uncertain; no precision is claimed. Digestion is estimated at 10%
of maintenance: `(resting + everyday + exercise) / 0.9`. Existing goal percentages, guardrails
and manual starting-target overrides remain. Brain energy is already in resting expenditure.
Legacy all-activity targets are preserved until the separate movement question is answered;
no activity adjustment is applied to that inseparable legacy multiplier.

For new profiles, expected replaceable movement is distributed over 07:00–23:00 local time,
an explicit forecast assumption (not detected sleep). Only sampled matching intervals replace
it; future/missing intervals retain forecasts. Overlapping raw sources use stable source-name,
then sample-ID priority, picking one source per interval. This avoids summing devices but is
**not** a reproduction of HealthKit's source-prioritized statistics. Same-source overlapping
samples also use one interval rather than summing. Under-counting is possible and is disclosed.

`adjustment = max(0, recorded active kcal − expected kcal in matched sampled intervals)`.
`current target = starting target + adjustment`. Digestion/resting/goal adjustment are never
replaced. No downward adjustment is enabled: Shortcuts exposes neither assured wear coverage
nor permission-denial evidence sufficient to prove inactivity. Steps are explanatory only;
workout/step energy is never added to active energy. Macros retain their starting goals.
Daily storage buckets retain historical samples. Recent uploads replace only matching
source/type/ID records and preserve all unreceived records. Empty uploads never delete data.
Revocation deletes stored uploads. Timestamps are normalized to UTC; displayed day
assignment uses the profile timezone and day-start hour, including DST.

## Sources

- [Mifflin–St Jeor original equation](https://pubmed.ncbi.nlm.nih.gov/2305711/)
- [2024 Adult Compendium](https://pacompendium.com/)
- [Apple Find and Filter actions](https://support.apple.com/en-asia/guide/shortcuts/apd3c845e881/ios)
- [Apple Shortcut URL execution](https://support.apple.com/en-au/guide/shortcuts/apd624386f42/ios)
- [Apple active energy type](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned)
- [Captured iOS action parameter reference](https://github.com/viticci/shortcuts-playground-plugin/blob/main/codex/skills/shortcuts-playground/HEALTHKIT.md)
