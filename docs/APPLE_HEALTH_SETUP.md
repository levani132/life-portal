# Apple Health implementation and device handoff

Implemented: step-based onboarding, separate everyday/exercise estimates, editable profile
preferences/timezone/day boundary, raw Health upload receiver, account-scoped pairing and
revocation, single-use upload tickets, daily source snapshots, pure calorie adjustment, Food
rings/activity details, Home freshness bridge and a tap fallback. No hosting deployment was run.

## Actual blocker and remaining maintainer setup

This Mac has `/usr/bin/shortcuts`, but signing failed with:
`Error: In order to do this, you must be signed into iCloud.`
No installable signed artifact or iCloud sharing URL was fabricated. Pairing UI stays unavailable
until `APPLE_HEALTH_SHORTCUT_URL` contains a real published iCloud Shortcut URL.

The complete generated **unsigned, unverified source** is
`tools/shortcuts/Life Portal Health.plist`; its generator is alongside it. It contains no
account secrets or fixed upload URL. It reads Active Calories/Steps and passes source, time
bounds, displayed unit and value. The app supplies a 72-hour window, upload URL and a one-use
15-minute upload ticket through Shortcut input. Source keeps at most 1,400 samples of each
kind; this is partial tracking, never proof of complete coverage.

On an iCloud-signed-in Mac, copy the plist to a `.shortcut` file, convert to binary with
`plutil -convert binary1`, then use `shortcuts sign --mode anyone --input ... --output ...`.
Install the signed artifact on an iPhone and test it before publishing with Share → Copy iCloud
Link. Set the API's `APPLE_HEALTH_SHORTCUT_URL` to that real link. Users then install the shared
Shortcut and tap Pair & first sync; they do not edit URLs, actions, payloads or account tokens.
Keep its name **Life Portal Health**.

Source syntax was grounded in Apple's documented Find Health Samples and URL scheme plus
captured iOS action parameter references. Plist parsing succeeds. A third-party static validator
could not resolve its Repeat Item Health provenance and lacked a complete action catalog;
this is not a runtime pass. Health field coercion, dictionary-to-JSON serialization, filtering,
unit values and permission prompts remain unverified on device. Repair the source generator
if the actual iPhone export differs, regenerate/sign, and publish only after a successful upload.

## Required iPhone acceptance check

1. Install; run from Life Portal, grant read permissions for Active Calories and Steps and
   network access. Match one sample's exact time/source/unit against Health. Test kcal and kJ.
2. Verify valid receipt changes last-sync and records nonzero samples. Denied read permissions,
   an empty list, cancel, browser return or callback alone must never claim complete tracking.
3. Retry/backfill; ensure source overlaps and repeated uploads do not multiply energy.
   Test 03:59/04:00 and a changed day boundary. Compare only matching sample periods.
4. Revoke and try an old ticket; it must fail. Pair another account and verify isolation.
5. Test Safari and installed Home Screen app, app resume, shortcut missing/cancelled, and
   callback return. Confirm no launch loop or repeated prompts within the five-minute window.
   If the browser blocks automatic opening, use the visible Sync Health button.

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
Daily raw snapshots retain historical samples; resync replaces the window and preserves older
periods. Revocation deletes stored uploads. Timestamps are normalized to UTC; displayed day
assignment uses the profile timezone and day-start hour, including DST.

## Sources

- [Mifflin–St Jeor original equation](https://pubmed.ncbi.nlm.nih.gov/2305711/)
- [2024 Adult Compendium](https://pacompendium.com/)
- [Apple Find and Filter actions](https://support.apple.com/en-asia/guide/shortcuts/apd3c845e881/ios)
- [Apple Shortcut URL execution](https://support.apple.com/en-au/guide/shortcuts/apd624386f42/ios)
- [Apple active energy type](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/activeenergyburned)
- [Captured iOS action parameter reference](https://github.com/viticci/shortcuts-playground-plugin/blob/main/codex/skills/shortcuts-playground/HEALTHKIT.md)
