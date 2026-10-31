# Apple Health implementation and device handoff

Implemented: step-based onboarding, separate everyday/exercise estimates, editable profile
preferences/timezone/day boundary, raw Health upload receiver, account-scoped pairing and
revocation, single-use upload tickets, daily source snapshots, pure calorie adjustment, Food
rings/activity details, Home freshness bridge and a tap fallback. No hosting deployment was run.

## Supported setup: build directly in Shortcuts

Follow [the complete manual iPhone Shortcut guide](integrations/apple-health-shortcut-manual.md).
The user has already built a working legacy Shortcut manually; the batching version requires
rebuilding/adapting that Shortcut once. Plist files are reference source, not installable
artifacts. Do not suggest renaming them to `.shortcut`. The signing CLI returned an iCloud
sign-in error even though the user reports being signed in; no account-state diagnosis or
installable artifact is claimed. Manual creation in the iPhone Shortcuts editor avoids import.

The new Shortcut reads app-supplied `token`, `batchUrl` and `to`, requests each pending window,
queries Active Calories/Steps with at most 250 samples per kind, and uploads counts plus rows.
Twelve windows per run bound foreground work. It uses no fixed server address or account JWT.
The previous manually created Shortcut remains compatible with the legacy upload endpoint.
The generated batching source has mechanical reference/control-flow checks only; actual iPhone
filtering, units, serialization, prompts and timing remain to be verified.

## Manual sync and returning to the PWA

Sync is now manual only. Mount, focus, resume and timers refresh receipt information without
opening Shortcuts. The visible button says `Sync due` after six hours without a successful
receipt (or when no receipt exists); it remains usable at any time. A receipt does not prove
complete tracking. Pending batch windows are visible in Activity Info.

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
3. Retry/backfill; ensure source overlaps and repeated uploads do not multiply energy.
   Test 03:59/04:00 and a changed day boundary. Compare only matching sample periods.
4. Revoke and try an old ticket; it must fail. Pair another account and verify isolation.
5. Test Safari and installed Home Screen app, app resume, and shortcut missing/cancelled.
   Confirm nothing opens automatically, no browser return tab appears, and manual return
   refreshes receipts. Check the six-hour reminder and manual Sync retry.

Apple documents Health sample queries, but a supported built-in action for exporting actual
workout records has not been established here. The receiver accepts time-bounded workout
records for forward compatibility; this Shortcut exports none. UI says **No workout data
received**, never **no workout occurred**. No walking/lifting calorie split is inferred.
This limitation must not be hidden behind a successful active-energy upload.

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
Daily raw snapshots retain historical samples. Batch receipts replace matching source/type/ID
records and preserve unreceived records, because missing permissions cannot prove deletion.
Legacy snapshot uploads retain their original window replacement behavior. Revocation deletes stored uploads. Timestamps are normalized to UTC; displayed day
assignment uses the profile timezone and day-start hour, including DST.

## Sources

- [Mifflin–St Jeor original equation](https://pubmed.ncbi.nlm.nih.gov/2305711/)
- [2024 Adult Compendium](https://pacompendium.com/)
- [Apple Find and Filter actions](https://support.apple.com/en-asia/guide/shortcuts/apd3c845e881/ios)
- [Apple Shortcut URL execution](https://support.apple.com/en-au/guide/shortcuts/apd624386f42/ios)
- [Apple active energy type](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned)
- [Captured iOS action parameter reference](https://github.com/viticci/shortcuts-playground-plugin/blob/main/codex/skills/shortcuts-playground/HEALTHKIT.md)
