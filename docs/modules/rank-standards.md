# Rank standards (v1-rc1)

Every exercise strength ranks cover, from `STANDARDS_V1_RC1` in
`libs/shared/domain/src/lib/strength-ranks.ts`; the rules are in [training](training.md),
"Strength ranks". **Release candidate 1 for owner review (#5): still a draft, not frozen, and the
`trainingRanks` flag stays off in production.** Regenerate the thresholds table when the
standards change. `rank-standards.catalogue.spec.ts` checks every row against the catalogue.

The figures are standards, not percentiles: no LifePortal data went into them, and no tier
claims a share of lifters.

## Coverage

| | Exercises |
|---|---|
| Catalogue (free-exercise-db, catalogue v2) | 876 |
| Logged with reps (weight or body weight), so a rank is possible at all | 729 |
| **Ranked** | **287** (280 in v1-draft-3, 36 in v1-draft-2) |

Excluded with a concrete reason:

| Reason | Count | Examples |
|---|---|---|
| Core, neck and forearm work: endurance-like, or no meaningful loaded standard | 97 | crunches, sit-ups, twists, wrist curls, ab wheel |
| Plyometrics: power and skill, not load | 60 | box jumps, bounds, throws |
| Bands or chains: resistance can't be measured | 41 | band good morning, squat with chains, band-assisted pull-up |
| Olympic lifting technique work: skill-limited (Power Clean is ranked) | 35 | clean, snatch, jerk, pulls |
| Strongman implements: not standardised | 20 | atlas stones, sled drags, yoke |
| Body-weight pulls and dips that are skill, partial-body or combination work (below) | 9 | muscle-ups, one-arm chin-up, weighted bench dip |
| Balls, rollers and bands | 10 | ball leg curl, medicine-ball slams |
| Too light to split into divisions on a stack (divisions about 1 kg apart) | 1 | bent-over low-pulley side lateral |

**Not ranked yet: 169 long-tail entries**, mostly kettlebell ballistics and Turkish get-ups,
unusual one-off variants (Bradford press, Cuban press, Tate press), sled work and single-leg
balance lifts. Each needs a standard of its own rather than a ratio, and few are commonly logged.

## Weighted and assisted body-weight lifts (catalogue v2)

Until catalogue v2, 17 body-weight pulls and dips were tagged equipment "other" and logged as
weight only, so a weighted pull-up's 20 kg was read as a 20 kg lift. Catalogue v2 measures 16 of
them as **body weight plus a signed external load** (`BODYWEIGHT_CATALOGUE_IDS`): a body-weight
set may carry added weight (a belt or vest) **or** assistance (a machine), never both, or
neither. Effective load = body weight + added − assistance, never below zero. This also makes
assisted Pullups and Dips count: before, the set rule did not accept assistance on them.

Sets logged before v2 keep the measure in their snapshot. They read and edit exactly as logged
(weight only; assistance is refused), are never reinterpreted, and are left out of the new
measure's history, records, ranks and tournaments. The progress view says how many there are
(`earlierMeasureSets`). No data is migrated or deleted.

| Exercise | Now | Ranked? |
|---|---|---|
| Weighted Pull Ups | body weight ± load | yes: the pull-up standard (main) |
| Parallel Bar Dip, Dips - Chest Version | body weight ± load | yes: the bar-dip standard (main) |
| Mixed Grip Chin | body weight ± load | yes: the pull-up standard (provisional) |
| Ring Dips | body weight ± load | yes: 0.85 × bar dips (provisional) |
| Inverted Row with Straps, Suspended Row | body weight ± load | yes: reps, as the inverted row; keep the body angle the same |
| Suspended Push-Up | body weight ± load | yes: reps, as a feet-elevated push-up |
| Muscle Up, Kipping Muscle Up | body weight ± load | no: skill-limited; a first rep is a technique milestone |
| One-Arm Chin-Up | body weight ± load | no: elite skill, no usable data |
| Gironda Sternum Chins, Side To Side Chins | body weight ± load | no: rare variants with no data |
| Rocky Pull-Ups/Pulldowns | body weight ± load | no: a combination drill |
| Weighted Bench Dip | body weight ± load | no: feet on the floor, so body weight is only partly lifted |
| Bodyweight Mid Row | body weight ± load | no: setup varies too much to compare |
| Sled Row | weight × reps (unchanged) | no: sled friction, not load |

Reps standards ignore added weight and do not count an assisted set.

## Evidence labels

- **main**: a powerlifting lift or a close barbell or body-weight variant, from the researched
  tables (v1-draft-2's research report in training.md).
- **machine**: the machine or cable standards of v1-draft-2. A machine rank is **a rough
  personal benchmark, not comparable across gyms**: stack ratios, cams and sled weights differ.
  The app says so next to every machine rank.
- **provisional**: extrapolated from a main lift by a typical ratio between lifts, not from
  published tables for the exercise itself. This covers isolation, dumbbell and kettlebell
  variants, all new machine and cable work, and body-weight endurance in reps. The app labels
  these "Provisional" and says why.

Women's thresholds use the same movement-family factors as v1-draft-2 (`RANK_WOMEN_FACTORS`):
curls and rows use "pull", triceps and raises "press", and calves and adductors "legs". These
factors are not approved values.

**Spread (new in rc1).** App-user tables put an elite isolation or machine lift 4–7× its
beginner figure, where the base barbell lift is about 3×. A constant ratio therefore made those
standards far too strict at the top, and the implausibility ceiling (1.5 × Legend) would have
thrown out genuine sets. Ratio standards now widen above Explorer by (base tier / base
Explorer)^spread: 0.5 for small raises, flyes and kickbacks (≤ 0.15 of the base), 0.25 for other
isolation-sized lifts and every machine, none for compound free-weight variants.

## Plausibility review (rc1)

Automated checks (`strength-ranks.spec.ts`, "plausibility grid"):

- Squat, bench, deadlift, overhead press, row, pull-up and dip at beginner, intermediate and
  advanced body-weight multiples, men at 55–130 kg and women at 45–100 kg: beginners land at
  Challenger or below, intermediates Explorer–Veteran, advanced Achiever–Master, always in order.
- The same multiple never ranks a heavier lifter lower (the 2/3 scaling direction).
- Public evidence (Strength Level app-user tables, men 80 kg, women 60 kg): lateral raise, curl,
  pushdown, kickback, reverse fly and leg press intermediates rank within a tier of Achiever and
  elites within a tier of Elite, and no elite figure hits the implausibility ceiling.

**Exceptions: unresolved methodology risks worth your decision**

1. **Self-reported evidence.** The public tables are app users' own entries, so isolation
   figures include loose form. Strength Level's reverse-fly elite (42 kg) is above its
   lateral-raise elite (34 kg); only its intermediate figure is held to.
2. **Women's factors are borrowed.** Family factors, not lift-specific data; plausible on the
   grid, unvalidated per lift.
3. **Provisional ratios** (most of the 287) are typical ratios between lifts, not measured
   tables. Labelled in the app.
4. **Heavy lifters on body-weight lifts.** One strict pull-up at 100 kg+ is Challenger, and
   1.6 × body weight at 130 kg is Master; the 2/3 scaling rewards size there by design.
5. **Machines** are never cross-gym comparable (disclosed). Fixing that needs per-machine
   calibration, which the app does not have.

No exception blocks a release candidate; each is disclosed or labelled.

## How load is entered

Every standard states its convention: the bar and plates, one dumbbell, the stack, one stack per
side, plates on a Smith bar or sled, or body weight plus what you add (or minus a machine's
assistance). The same text appears with the rank and, while logging, under the exercise
("Weight: The weight of one dumbbell."). A set entered another way ranks wrongly, so the hint is
shown wherever the weight is typed.

## Tournaments

A tournament season copies its scoring standard (thresholds, method, measure) onto each entry at
the lock (`lockedStandard`) and is scored under that copy to the end. A new release candidate,
a replaced draft or a catalogue measure change never switches a season already under way. See
[tournaments](tournaments.md).

## Thresholds

Multiples of the reference body weight (80 kg men, 60 kg women) where each tier starts after
Initiate, or reps in one set.

| Exercise | Evidence | How load is entered | Men (Explorer → Legend) | Women |
|---|---|---|---|---|
| Alternate Hammer Curl | provisional | The weight of one dumbbell. | 0.14 · 0.25 · 0.34 · 0.46 · 0.56 · 0.67 · 0.79 × BW | 0.10 · 0.18 · 0.24 · 0.33 · 0.40 · 0.48 · 0.57 |
| Alternate Incline Dumbbell Curl | provisional | The weight of one dumbbell. | 0.12 · 0.20 · 0.27 · 0.37 · 0.46 · 0.54 · 0.63 × BW | 0.09 · 0.14 · 0.19 · 0.27 · 0.33 · 0.39 · 0.45 |
| Alternating Kettlebell Press | provisional | The weight of one kettlebell. | 0.15 · 0.27 · 0.37 · 0.50 · 0.61 · 0.73 · 0.85 × BW | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.51 · 0.60 |
| Alternating Kettlebell Row | provisional | The weight of one kettlebell. | 0.19 · 0.33 · 0.46 · 0.62 · 0.76 · 0.91 · 1.06 × BW | 0.14 · 0.24 · 0.33 · 0.45 · 0.55 · 0.66 · 0.76 |
| Arnold Dumbbell Press | provisional | The weight of one dumbbell. | 0.15 · 0.27 · 0.37 · 0.50 · 0.61 · 0.73 · 0.85 × BW | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.51 · 0.60 |
| Barbell Bench Press - Medium Grip | main | The bar and plates together. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Barbell Curl | provisional | The bar and plates together. | 0.28 · 0.47 · 0.65 · 0.88 · 1.09 · 1.30 · 1.51 × BW | 0.20 · 0.34 · 0.47 · 0.63 · 0.78 · 0.94 · 1.09 |
| Barbell Deadlift | main | The bar and plates together. | 0.90 · 1.30 · 1.75 · 2.15 · 2.55 · 2.90 · 3.25 × BW | 0.70 · 1.01 · 1.37 · 1.68 · 1.99 · 2.26 · 2.54 |
| Barbell Full Squat | main | The bar and plates together. | 0.75 · 1.10 · 1.50 · 1.85 · 2.20 · 2.50 · 2.85 × BW | 0.59 · 0.86 · 1.17 · 1.44 · 1.72 · 1.95 · 2.22 |
| Barbell Glute Bridge | provisional | The bar and plates together. | 0.83 · 1.21 · 1.65 · 2.04 · 2.42 · 2.75 · 3.14 × BW | 0.66 · 0.97 · 1.32 · 1.63 · 1.94 · 2.20 · 2.51 |
| Barbell Hack Squat | provisional | The bar and plates together. | 0.45 · 0.66 · 0.90 · 1.11 · 1.32 · 1.50 · 1.71 × BW | 0.35 · 0.51 · 0.70 · 0.87 · 1.03 · 1.17 · 1.33 |
| Barbell Hip Thrust | main | The bar and plates together. | 0.98 · 1.43 · 1.95 · 2.41 · 2.86 · 3.25 · 3.71 × BW | 0.78 · 1.14 · 1.56 · 1.93 · 2.29 · 2.60 · 2.97 |
| Barbell Incline Bench Press - Medium Grip | main | The bar and plates together. | 0.44 · 0.68 · 0.88 · 1.12 · 1.32 · 1.52 · 1.72 × BW | 0.31 · 0.48 · 0.62 · 0.78 · 0.92 · 1.06 · 1.20 |
| Barbell Lunge | provisional | The bar and plates together. | 0.41 · 0.67 · 0.98 · 1.28 · 1.58 · 1.86 · 2.19 × BW | 0.32 · 0.52 · 0.76 · 1.00 · 1.23 · 1.45 · 1.71 |
| Barbell Seated Calf Raise | provisional | The bar and plates together. | 0.45 · 0.66 · 0.90 · 1.11 · 1.32 · 1.50 · 1.71 × BW | 0.35 · 0.51 · 0.70 · 0.87 · 1.03 · 1.17 · 1.33 |
| Barbell Shoulder Press | main | The bar and plates together. | 0.36 · 0.55 · 0.72 · 0.91 · 1.07 · 1.24 · 1.40 × BW | 0.25 · 0.39 · 0.50 · 0.64 · 0.75 · 0.87 · 0.98 |
| Barbell Shrug | provisional | The bar and plates together. | 0.77 · 1.11 · 1.49 · 1.83 · 2.17 · 2.47 · 2.76 × BW | 0.55 · 0.80 · 1.07 · 1.32 · 1.56 · 1.78 · 1.99 |
| Barbell Shrug Behind The Back | provisional | The bar and plates together. | 0.68 · 0.98 · 1.31 · 1.61 · 1.91 · 2.18 · 2.44 × BW | 0.49 · 0.71 · 0.94 · 1.16 · 1.38 · 1.57 · 1.76 |
| Barbell Side Split Squat | provisional | The bar and plates together. | 0.38 · 0.61 · 0.89 · 1.16 · 1.44 · 1.69 · 1.99 × BW | 0.30 · 0.48 · 0.69 · 0.90 · 1.12 · 1.32 · 1.55 |
| Barbell Squat | main | The bar and plates together. | 0.75 · 1.10 · 1.50 · 1.85 · 2.20 · 2.50 · 2.85 × BW | 0.59 · 0.86 · 1.17 · 1.44 · 1.72 · 1.95 · 2.22 |
| Barbell Squat To A Bench | main | The bar and plates together. | 0.71 · 1.05 · 1.43 · 1.76 · 2.09 · 2.38 · 2.71 × BW | 0.55 · 0.82 · 1.12 · 1.37 · 1.63 · 1.86 · 2.11 |
| Barbell Step Ups | provisional | The bar and plates together. | 0.34 · 0.54 · 0.80 · 1.04 · 1.30 · 1.52 · 1.79 × BW | 0.27 · 0.42 · 0.62 · 0.81 · 1.01 · 1.19 · 1.40 |
| Barbell Walking Lunge | provisional | The bar and plates together. | 0.41 · 0.67 · 0.98 · 1.28 · 1.58 · 1.86 · 2.19 × BW | 0.32 · 0.52 · 0.76 · 1.00 · 1.23 · 1.45 · 1.71 |
| Bench Dips | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 8 · 15 · 25 · 35 · 45 · 58 · 75 reps | 6 · 11 · 19 · 26 · 34 · 44 · 56 |
| Bench Press - Powerlifting | main | The bar and plates together. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Bent Over Barbell Row | main | The bar and plates together. | 0.47 · 0.72 · 0.94 · 1.19 · 1.40 · 1.62 · 1.83 × BW | 0.34 · 0.52 · 0.68 · 0.86 · 1.01 · 1.17 · 1.32 |
| Bent Over Dumbbell Rear Delt Raise With Head On Bench | provisional | The weight of one dumbbell. | 0.07 · 0.13 · 0.19 · 0.27 · 0.34 · 0.42 · 0.51 × BW | 0.05 · 0.09 · 0.14 · 0.19 · 0.24 · 0.30 · 0.37 |
| Bent Over Two-Arm Long Bar Row | provisional | The plates loaded on the bar. | 0.41 · 0.64 · 0.83 · 1.05 · 1.24 · 1.43 · 1.61 × BW | 0.30 · 0.46 · 0.60 · 0.76 · 0.89 · 1.03 · 1.16 |
| Bent Over Two-Dumbbell Row | provisional | The weight of one dumbbell. | 0.21 · 0.36 · 0.50 · 0.67 · 0.83 · 0.98 · 1.15 × BW | 0.15 · 0.26 · 0.36 · 0.48 · 0.60 · 0.71 · 0.83 |
| Bent Over Two-Dumbbell Row With Palms In | provisional | The weight of one dumbbell. | 0.21 · 0.36 · 0.50 · 0.67 · 0.83 · 0.98 · 1.15 × BW | 0.15 · 0.26 · 0.36 · 0.48 · 0.60 · 0.71 · 0.83 |
| Bent-Arm Barbell Pullover | provisional | The bar and plates together. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.16 · 0.27 · 0.37 · 0.51 · 0.63 · 0.75 · 0.87 |
| Bent-Arm Dumbbell Pullover | provisional | The weight of the one dumbbell, held in both hands. | 0.18 · 0.30 · 0.42 · 0.57 · 0.69 · 0.83 · 0.97 × BW | 0.13 · 0.22 · 0.30 · 0.41 · 0.50 · 0.60 · 0.70 |
| Board Press | main | The bar and plates together. | 0.58 · 0.89 · 1.16 · 1.47 · 1.73 · 2.00 · 2.26 × BW | 0.41 · 0.62 · 0.81 · 1.03 · 1.21 · 1.40 · 1.58 |
| Bodyweight Squat | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 15 · 25 · 40 · 55 · 75 · 100 · 130 reps | 13 · 21 · 34 · 47 · 64 · 85 · 111 |
| Bodyweight Walking Lunge | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 10 · 20 · 32 · 45 · 60 · 80 · 100 reps | 9 · 17 · 27 · 38 · 51 · 68 · 85 |
| Box Squat | main | The bar and plates together. | 0.71 · 1.05 · 1.43 · 1.76 · 2.09 · 2.38 · 2.71 × BW | 0.55 · 0.82 · 1.12 · 1.37 · 1.63 · 1.86 · 2.11 |
| Butterfly | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.41 · 0.71 · 0.98 · 1.33 · 1.63 · 1.94 · 2.27 × BW | 0.29 · 0.50 · 0.69 · 0.93 · 1.14 · 1.36 · 1.59 |
| Cable Chest Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.33 · 0.57 · 0.78 · 1.06 · 1.30 · 1.55 · 1.81 × BW | 0.23 · 0.40 · 0.55 · 0.74 · 0.91 · 1.09 · 1.27 |
| Cable Crossover | provisional, machine | The weight on one stack (each side). | 0.14 · 0.24 · 0.33 · 0.44 · 0.54 · 0.65 · 0.76 × BW | 0.10 · 0.17 · 0.23 · 0.31 · 0.38 · 0.45 · 0.53 |
| Cable Deadlifts | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.45 · 0.71 · 1.03 · 1.34 · 1.65 · 1.94 · 2.24 × BW | 0.35 · 0.55 · 0.80 · 1.05 · 1.29 · 1.51 · 1.75 |
| Cable Hammer Curls - Rope Attachment | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.23 · 0.40 · 0.55 · 0.74 · 0.91 · 1.09 · 1.27 × BW | 0.17 · 0.29 · 0.40 · 0.53 · 0.66 · 0.78 · 0.91 |
| Cable Lying Triceps Extension | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.15 · 0.27 · 0.36 · 0.50 · 0.61 · 0.73 · 0.85 |
| Cable One Arm Tricep Extension | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.52 · 0.60 × BW | 0.08 · 0.13 · 0.18 · 0.24 · 0.30 · 0.36 · 0.42 |
| Cable Preacher Curl | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.21 · 0.36 · 0.50 · 0.67 · 0.83 · 0.98 · 1.15 × BW | 0.15 · 0.26 · 0.36 · 0.48 · 0.60 · 0.71 · 0.83 |
| Cable Rear Delt Fly | provisional, machine | The weight on one stack (each side). | 0.07 · 0.13 · 0.19 · 0.27 · 0.34 · 0.42 · 0.51 × BW | 0.05 · 0.09 · 0.14 · 0.19 · 0.24 · 0.30 · 0.37 |
| Cable Rope Overhead Triceps Extension | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.15 · 0.27 · 0.36 · 0.50 · 0.61 · 0.73 · 0.85 |
| Cable Rope Rear-Delt Rows | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.16 · 0.27 · 0.37 · 0.51 · 0.63 · 0.75 · 0.87 |
| Cable Seated Lateral Raise | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.06 · 0.11 · 0.16 · 0.22 · 0.29 · 0.35 · 0.43 × BW | 0.04 · 0.08 · 0.11 · 0.15 · 0.20 · 0.24 · 0.30 |
| Cable Shoulder Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.47 · 0.65 · 0.88 · 1.09 · 1.30 · 1.51 × BW | 0.20 · 0.33 · 0.45 · 0.62 · 0.76 · 0.91 · 1.06 |
| Cable Shrugs | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.63 · 1.00 · 1.45 · 1.87 · 2.32 · 2.72 · 3.14 × BW | 0.45 · 0.72 · 1.04 · 1.35 · 1.67 · 1.96 · 2.26 |
| Calf Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.83 · 1.33 · 1.96 · 2.55 · 3.17 · 3.72 · 4.38 × BW | 0.65 · 1.04 · 1.53 · 1.99 · 2.47 · 2.90 · 3.42 |
| Calf Press On The Leg Press Machine | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.90 · 1.45 · 2.14 · 2.78 · 3.45 · 4.05 · 4.77 × BW | 0.70 · 1.13 · 1.67 · 2.17 · 2.69 · 3.16 · 3.72 |
| Chin-Up | main | Your body weight counts automatically; log only weight you add, or the assistance a machine gives you. | 0.88 · 1.08 · 1.24 · 1.39 · 1.60 · 1.80 · 2.01 × BW | 0.75 · 0.92 · 1.05 · 1.18 · 1.36 · 1.53 · 1.71 |
| Close-Grip Barbell Bench Press | main | The bar and plates together. | 0.50 · 0.77 · 0.99 · 1.26 · 1.49 · 1.71 · 1.94 × BW | 0.35 · 0.54 · 0.69 · 0.88 · 1.04 · 1.20 · 1.36 |
| Close-Grip Dumbbell Press | provisional | The weight of one dumbbell. | 0.18 · 0.30 · 0.42 · 0.57 · 0.69 · 0.83 · 0.97 × BW | 0.13 · 0.21 · 0.29 · 0.40 · 0.48 · 0.58 · 0.68 |
| Close-Grip EZ Bar Curl | provisional | The EZ bar and plates together. | 0.26 · 0.45 · 0.61 · 0.83 · 1.02 · 1.22 · 1.42 × BW | 0.19 · 0.32 · 0.44 · 0.60 · 0.73 · 0.88 · 1.02 |
| Close-Grip EZ-Bar Press | provisional | The EZ bar and plates together. | 0.44 · 0.68 · 0.88 · 1.12 · 1.32 · 1.52 · 1.72 × BW | 0.31 · 0.48 · 0.62 · 0.78 · 0.92 · 1.06 · 1.20 |
| Close-Grip Front Lat Pulldown | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.82 · 1.12 · 1.52 · 1.87 · 2.23 · 2.60 × BW | 0.34 · 0.59 · 0.81 · 1.09 · 1.35 · 1.61 · 1.87 |
| Close-Grip Standing Barbell Curl | provisional | The bar and plates together. | 0.26 · 0.45 · 0.63 · 0.85 · 1.04 · 1.24 · 1.45 × BW | 0.19 · 0.32 · 0.45 · 0.61 · 0.75 · 0.89 · 1.04 |
| Concentration Curls | provisional | The weight of the dumbbell, one arm at a time. | 0.12 · 0.21 · 0.29 · 0.39 · 0.48 · 0.57 · 0.67 × BW | 0.09 · 0.15 · 0.21 · 0.28 · 0.35 · 0.41 · 0.48 |
| Cross Body Hammer Curl | provisional | The weight of one dumbbell. | 0.14 · 0.24 · 0.33 · 0.44 · 0.54 · 0.65 · 0.76 × BW | 0.10 · 0.17 · 0.24 · 0.32 · 0.39 · 0.47 · 0.55 |
| Decline Barbell Bench Press | main | The bar and plates together. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Decline Dumbbell Bench Press | provisional | The weight of one dumbbell. | 0.23 · 0.40 · 0.55 · 0.74 · 0.91 · 1.09 · 1.27 × BW | 0.16 · 0.28 · 0.39 · 0.52 · 0.64 · 0.76 · 0.89 |
| Decline Dumbbell Flyes | provisional | The weight of one dumbbell. | 0.14 · 0.25 · 0.34 · 0.46 · 0.56 · 0.67 · 0.79 × BW | 0.10 · 0.18 · 0.24 · 0.32 · 0.39 · 0.47 · 0.55 |
| Decline EZ Bar Triceps Extension | provisional | The EZ bar and plates together. | 0.21 · 0.36 · 0.50 · 0.67 · 0.83 · 0.98 · 1.15 × BW | 0.15 · 0.25 · 0.35 · 0.47 · 0.58 · 0.69 · 0.81 |
| Decline Push-Up | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 4 · 10 · 18 · 25 · 33 · 45 · 60 reps | 3 · 6 · 10 · 14 · 18 · 25 · 33 |
| Decline Smith Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.55 · 0.95 · 1.31 · 1.77 · 2.17 · 2.59 · 3.02 × BW | 0.39 · 0.67 · 0.92 · 1.24 · 1.52 · 1.81 · 2.11 |
| Deficit Deadlift | main | The bar and plates together. | 0.83 · 1.20 · 1.61 · 1.98 · 2.35 · 2.67 · 2.99 × BW | 0.65 · 0.94 · 1.26 · 1.54 · 1.83 · 2.08 · 2.33 |
| Dips - Chest Version | main | Your body weight counts automatically; log only weight you add, or the assistance a machine gives you. | 0.85 · 1.15 · 1.40 · 1.65 · 1.90 · 2.10 · 2.30 × BW | 0.72 · 0.98 · 1.19 · 1.40 · 1.62 · 1.79 · 1.96 |
| Dips - Triceps Version | main | Your body weight counts automatically; log only weight you add, or the assistance a machine gives you. | 0.85 · 1.15 · 1.40 · 1.65 · 1.90 · 2.10 · 2.30 × BW | 0.72 · 0.98 · 1.19 · 1.40 · 1.62 · 1.79 · 1.96 |
| Drag Curl | provisional | The bar and plates together. | 0.23 · 0.40 · 0.55 · 0.74 · 0.91 · 1.09 · 1.27 × BW | 0.17 · 0.29 · 0.40 · 0.53 · 0.66 · 0.78 · 0.91 |
| Dumbbell Alternate Bicep Curl | provisional | The weight of one dumbbell. | 0.13 · 0.23 · 0.31 · 0.42 · 0.52 · 0.62 · 0.73 × BW | 0.09 · 0.17 · 0.22 · 0.30 · 0.37 · 0.45 · 0.53 |
| Dumbbell Bench Press | main | The weight of one dumbbell. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 |
| Dumbbell Bench Press with Neutral Grip | provisional | The weight of one dumbbell. | 0.21 · 0.36 · 0.50 · 0.67 · 0.83 · 0.98 · 1.15 × BW | 0.15 · 0.25 · 0.35 · 0.47 · 0.58 · 0.69 · 0.81 |
| Dumbbell Bicep Curl | provisional | The weight of one dumbbell. | 0.13 · 0.23 · 0.31 · 0.42 · 0.52 · 0.62 · 0.73 × BW | 0.09 · 0.17 · 0.22 · 0.30 · 0.37 · 0.45 · 0.53 |
| Dumbbell Floor Press | provisional | The weight of one dumbbell. | 0.20 · 0.35 · 0.48 · 0.65 · 0.80 · 0.96 · 1.12 × BW | 0.14 · 0.24 · 0.34 · 0.45 · 0.56 · 0.67 · 0.78 |
| Dumbbell Flyes | provisional | The weight of one dumbbell. | 0.14 · 0.24 · 0.33 · 0.44 · 0.54 · 0.65 · 0.76 × BW | 0.10 · 0.17 · 0.23 · 0.31 · 0.38 · 0.45 · 0.53 |
| Dumbbell Incline Row | provisional | The weight of one dumbbell. | 0.19 · 0.33 · 0.46 · 0.62 · 0.76 · 0.91 · 1.06 × BW | 0.14 · 0.24 · 0.33 · 0.45 · 0.55 · 0.66 · 0.76 |
| Dumbbell Lunges | provisional | The weight of one dumbbell. | 0.19 · 0.30 · 0.45 · 0.58 · 0.72 · 0.84 · 0.99 × BW | 0.15 · 0.23 · 0.35 · 0.45 · 0.56 · 0.66 · 0.77 |
| Dumbbell Lying Rear Lateral Raise | provisional | The weight of one dumbbell. | 0.06 · 0.12 · 0.17 · 0.25 · 0.31 · 0.39 · 0.47 × BW | 0.04 · 0.09 · 0.12 · 0.18 · 0.22 · 0.28 · 0.34 |
| Dumbbell One-Arm Shoulder Press | provisional | The weight of the dumbbell, one arm at a time. | 0.17 · 0.28 · 0.39 · 0.53 · 0.65 · 0.78 · 0.91 × BW | 0.12 · 0.20 · 0.27 · 0.37 · 0.45 · 0.55 · 0.64 |
| Dumbbell One-Arm Triceps Extension | provisional | The weight of the dumbbell, one arm at a time. | 0.07 · 0.13 · 0.19 · 0.27 · 0.34 · 0.42 · 0.51 × BW | 0.05 · 0.09 · 0.13 · 0.19 · 0.24 · 0.29 · 0.36 |
| Dumbbell Rear Lunge | provisional | The weight of one dumbbell. | 0.19 · 0.30 · 0.45 · 0.58 · 0.72 · 0.84 · 0.99 × BW | 0.15 · 0.23 · 0.35 · 0.45 · 0.56 · 0.66 · 0.77 |
| Dumbbell Shoulder Press | main | The weight of one dumbbell. | 0.18 · 0.27 · 0.35 · 0.45 · 0.53 · 0.61 · 0.69 × BW | 0.13 · 0.19 · 0.24 · 0.32 · 0.37 · 0.43 · 0.48 |
| Dumbbell Shrug | provisional | The weight of one dumbbell. | 0.36 · 0.57 · 0.83 · 1.07 · 1.32 · 1.55 · 1.79 × BW | 0.26 · 0.41 · 0.60 · 0.77 · 0.95 · 1.12 · 1.29 |
| Dumbbell Squat | provisional | The weight of one dumbbell. | 0.23 · 0.36 · 0.54 · 0.70 · 0.86 · 1.01 · 1.19 × BW | 0.18 · 0.28 · 0.42 · 0.55 · 0.67 · 0.79 · 0.93 |
| Dumbbell Squat To A Bench | provisional | The weight of one dumbbell. | 0.23 · 0.36 · 0.54 · 0.70 · 0.86 · 1.01 · 1.19 × BW | 0.18 · 0.28 · 0.42 · 0.55 · 0.67 · 0.79 · 0.93 |
| Dumbbell Step Ups | provisional | The weight of one dumbbell. | 0.17 · 0.27 · 0.39 · 0.51 · 0.63 · 0.74 · 0.88 × BW | 0.13 · 0.21 · 0.30 · 0.40 · 0.49 · 0.58 · 0.69 |
| Elevated Back Lunge | provisional | The bar and plates together. | 0.38 · 0.61 · 0.89 · 1.16 · 1.44 · 1.69 · 1.99 × BW | 0.30 · 0.48 · 0.69 · 0.90 · 1.12 · 1.32 · 1.55 |
| Elevated Cable Rows | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.81 · 1.11 · 1.50 · 1.85 · 2.20 · 2.57 × BW | 0.34 · 0.58 · 0.80 · 1.08 · 1.33 · 1.58 · 1.85 |
| EZ-Bar Curl | provisional | The EZ bar and plates together. | 0.26 · 0.45 · 0.61 · 0.83 · 1.02 · 1.22 · 1.42 × BW | 0.19 · 0.32 · 0.44 · 0.60 · 0.73 · 0.88 · 1.02 |
| EZ-Bar Skullcrusher | provisional | The EZ bar and plates together. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.15 · 0.27 · 0.36 · 0.50 · 0.61 · 0.73 · 0.85 |
| Face Pull | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.16 · 0.27 · 0.37 · 0.51 · 0.63 · 0.75 · 0.87 |
| Flat Bench Cable Flyes | provisional, machine | The weight on one stack (each side). | 0.12 · 0.21 · 0.29 · 0.39 · 0.48 · 0.57 · 0.67 × BW | 0.08 · 0.15 · 0.20 · 0.27 · 0.34 · 0.40 · 0.47 |
| Floor Press | main | The bar and plates together. | 0.51 · 0.78 · 1.01 · 1.29 · 1.52 · 1.75 · 1.98 × BW | 0.36 · 0.55 · 0.71 · 0.90 · 1.06 · 1.23 · 1.39 |
| Front Barbell Squat | main | The bar and plates together. | 0.60 · 0.88 · 1.20 · 1.48 · 1.76 · 2.00 · 2.28 × BW | 0.47 · 0.69 · 0.94 · 1.15 · 1.37 · 1.56 · 1.78 |
| Front Barbell Squat To A Bench | main | The bar and plates together. | 0.59 · 0.86 · 1.17 · 1.44 · 1.72 · 1.95 · 2.22 × BW | 0.46 · 0.67 · 0.91 · 1.12 · 1.34 · 1.52 · 1.73 |
| Front Cable Raise | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.07 · 0.13 · 0.19 · 0.27 · 0.34 · 0.42 · 0.51 × BW | 0.05 · 0.09 · 0.13 · 0.19 · 0.24 · 0.29 · 0.36 |
| Front Dumbbell Raise | provisional | The weight of one dumbbell. | 0.08 · 0.15 · 0.22 · 0.31 · 0.40 · 0.49 · 0.60 × BW | 0.06 · 0.11 · 0.15 · 0.22 · 0.28 · 0.34 · 0.42 |
| Front Plate Raise | provisional | The weight of the plate, held in both hands. | 0.12 · 0.21 · 0.29 · 0.39 · 0.48 · 0.57 · 0.67 × BW | 0.08 · 0.15 · 0.20 · 0.27 · 0.34 · 0.40 · 0.47 |
| Front Squat (Clean Grip) | main | The bar and plates together. | 0.60 · 0.88 · 1.20 · 1.48 · 1.76 · 2.00 · 2.28 × BW | 0.47 · 0.69 · 0.94 · 1.15 · 1.37 · 1.56 · 1.78 |
| Front Squats With Two Kettlebells | provisional | The weight of one kettlebell. | 0.23 · 0.36 · 0.54 · 0.70 · 0.86 · 1.01 · 1.19 × BW | 0.18 · 0.28 · 0.42 · 0.55 · 0.67 · 0.79 · 0.93 |
| Front Two-Dumbbell Raise | provisional | The weight of one dumbbell. | 0.07 · 0.14 · 0.20 · 0.29 · 0.37 · 0.46 · 0.55 × BW | 0.05 · 0.10 · 0.14 · 0.20 · 0.26 · 0.32 · 0.39 |
| Full Range-Of-Motion Lat Pulldown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.82 · 1.12 · 1.52 · 1.87 · 2.23 · 2.60 × BW | 0.34 · 0.59 · 0.81 · 1.09 · 1.35 · 1.61 · 1.87 |
| Goblet Squat | provisional | The weight of the kettlebell. | 0.34 · 0.54 · 0.80 · 1.04 · 1.30 · 1.52 · 1.79 × BW | 0.27 · 0.42 · 0.62 · 0.81 · 1.01 · 1.19 · 1.40 |
| Good Morning | provisional | The bar and plates together. | 0.41 · 0.64 · 0.93 · 1.20 · 1.49 · 1.75 · 2.02 × BW | 0.32 · 0.50 · 0.73 · 0.94 · 1.16 · 1.37 · 1.58 |
| Hack Squat | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.75 · 1.21 · 1.78 · 2.32 · 2.88 · 3.38 · 3.98 × BW | 0.59 · 0.94 · 1.39 · 1.81 · 2.25 · 2.64 · 3.10 |
| Hammer Curls | provisional | The weight of one dumbbell. | 0.14 · 0.25 · 0.34 · 0.46 · 0.56 · 0.67 · 0.79 × BW | 0.10 · 0.18 · 0.24 · 0.33 · 0.40 · 0.48 · 0.57 |
| Hammer Grip Incline DB Bench Press | provisional | The weight of one dumbbell. | 0.18 · 0.30 · 0.42 · 0.57 · 0.69 · 0.83 · 0.97 × BW | 0.13 · 0.21 · 0.29 · 0.40 · 0.48 · 0.58 · 0.68 |
| Handstand Push-Ups | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 3 · 6 · 9 · 12 · 15 · 19 · 25 reps | 3 · 6 · 9 · 12 · 15 · 18 · 21 |
| Hanging Leg Raise | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 3 · 8 · 12 · 18 · 24 · 30 · 40 reps | 3 · 7 · 10 · 15 · 20 · 26 · 34 |
| High Cable Curls | provisional, machine | The weight on one stack (each side). | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.52 · 0.60 × BW | 0.08 · 0.14 · 0.19 · 0.25 · 0.31 · 0.37 · 0.43 |
| Hyperextensions (Back Extensions) | provisional | The weight you hold, without your body weight. | 0.14 · 0.23 · 0.37 · 0.50 · 0.64 · 0.78 · 0.93 × BW | 0.11 · 0.18 · 0.29 · 0.39 · 0.50 · 0.61 · 0.73 |
| Incline Barbell Triceps Extension | provisional | The bar and plates together. | 0.20 · 0.34 · 0.47 · 0.64 · 0.78 · 0.93 · 1.09 × BW | 0.14 · 0.24 · 0.33 · 0.45 · 0.55 · 0.65 · 0.76 |
| Incline Cable Chest Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.47 · 0.65 · 0.88 · 1.09 · 1.30 · 1.51 × BW | 0.20 · 0.33 · 0.45 · 0.62 · 0.76 · 0.91 · 1.06 |
| Incline Cable Flye | provisional, machine | The weight on one stack (each side). | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.52 · 0.60 × BW | 0.08 · 0.13 · 0.18 · 0.24 · 0.30 · 0.36 · 0.42 |
| Incline Dumbbell Bench With Palms Facing In | provisional | The weight of one dumbbell. | 0.18 · 0.30 · 0.42 · 0.57 · 0.69 · 0.83 · 0.97 × BW | 0.13 · 0.21 · 0.29 · 0.40 · 0.48 · 0.58 · 0.68 |
| Incline Dumbbell Curl | provisional | The weight of one dumbbell. | 0.12 · 0.20 · 0.27 · 0.37 · 0.46 · 0.54 · 0.63 × BW | 0.09 · 0.14 · 0.19 · 0.27 · 0.33 · 0.39 · 0.45 |
| Incline Dumbbell Flyes | provisional | The weight of one dumbbell. | 0.12 · 0.21 · 0.29 · 0.39 · 0.48 · 0.57 · 0.67 × BW | 0.08 · 0.15 · 0.20 · 0.27 · 0.34 · 0.40 · 0.47 |
| Incline Dumbbell Press | main | The weight of one dumbbell. | 0.19 · 0.29 · 0.37 · 0.48 · 0.56 · 0.65 · 0.73 × BW | 0.13 · 0.20 · 0.26 · 0.34 · 0.39 · 0.45 · 0.51 |
| Incline Hammer Curls | provisional | The weight of one dumbbell. | 0.12 · 0.21 · 0.29 · 0.39 · 0.48 · 0.57 · 0.67 × BW | 0.09 · 0.15 · 0.21 · 0.28 · 0.35 · 0.41 · 0.48 |
| Incline Push-Up | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 8 · 18 · 30 · 40 · 52 · 70 · 95 reps | 5 · 12 · 20 · 26 · 34 · 46 · 62 |
| Incline Push-Up Close-Grip | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 6 · 15 · 25 · 34 · 45 · 60 · 80 reps | 4 · 9 · 15 · 20 · 27 · 36 · 48 |
| Incline Push-Up Medium | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 8 · 18 · 30 · 40 · 52 · 70 · 95 reps | 5 · 12 · 20 · 26 · 34 · 46 · 62 |
| Incline Push-Up Wide | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 8 · 18 · 30 · 40 · 52 · 70 · 95 reps | 5 · 12 · 20 · 26 · 34 · 46 · 62 |
| Inverted Row | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 3 · 8 · 14 · 20 · 26 · 33 · 42 reps | 3 · 6 · 10 · 14 · 18 · 23 · 29 |
| Inverted Row with Straps | provisional | Reps in one set, at a body angle you keep the same; added weight is not counted. | 3 · 8 · 14 · 20 · 26 · 33 · 42 reps | 3 · 6 · 10 · 14 · 18 · 23 · 29 |
| JM Press | provisional | The bar and plates together. | 0.30 · 0.52 · 0.72 · 0.97 · 1.19 · 1.42 · 1.66 × BW | 0.21 · 0.36 · 0.50 · 0.68 · 0.83 · 0.99 · 1.16 |
| Kettlebell One-Legged Deadlift | provisional | The weight of the kettlebell. | 0.27 · 0.43 · 0.62 · 0.80 · 0.99 · 1.17 · 1.34 × BW | 0.21 · 0.34 · 0.48 · 0.62 · 0.77 · 0.91 · 1.05 |
| Kettlebell Seated Press | provisional | The weight of one kettlebell. | 0.15 · 0.27 · 0.37 · 0.50 · 0.61 · 0.73 · 0.85 × BW | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.51 · 0.60 |
| Kneeling Cable Triceps Extension | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.15 · 0.27 · 0.36 · 0.50 · 0.61 · 0.73 · 0.85 |
| Kneeling High Pulley Row | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.44 · 0.76 · 1.05 · 1.41 · 1.74 · 2.07 · 2.42 × BW | 0.32 · 0.55 · 0.76 · 1.02 · 1.25 · 1.49 · 1.74 |
| Kneeling Single-Arm High Pulley Row | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.16 · 0.27 · 0.37 · 0.51 · 0.63 · 0.75 · 0.87 |
| Leg Extensions | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.59 · 0.94 · 1.39 · 1.81 · 2.25 · 2.63 · 3.10 × BW | 0.46 · 0.73 · 1.08 · 1.41 · 1.76 · 2.05 · 2.42 |
| Leg Press | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 1.31 · 2.12 · 3.12 · 4.06 · 5.04 · 5.91 · 6.96 × BW | 1.02 · 1.65 · 2.43 · 3.17 · 3.93 · 4.61 · 5.43 |
| Leverage Chest Press | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.50 · 0.85 · 1.18 · 1.59 · 1.95 · 2.33 · 2.72 × BW | 0.35 · 0.60 · 0.83 · 1.11 · 1.37 · 1.63 · 1.90 |
| Leverage Deadlift | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.90 · 1.43 · 2.07 · 2.67 · 3.31 · 3.89 · 4.48 × BW | 0.70 · 1.12 · 1.61 · 2.08 · 2.58 · 3.03 · 3.49 |
| Leverage Decline Chest Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.52 · 0.90 · 1.24 · 1.68 · 2.06 · 2.46 · 2.87 × BW | 0.36 · 0.63 · 0.87 · 1.18 · 1.44 · 1.72 · 2.01 |
| Leverage High Row | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.81 · 1.11 · 1.50 · 1.85 · 2.20 · 2.57 × BW | 0.34 · 0.58 · 0.80 · 1.08 · 1.33 · 1.58 · 1.85 |
| Leverage Incline Chest Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.44 · 0.76 · 1.05 · 1.41 · 1.74 · 2.07 · 2.42 × BW | 0.31 · 0.53 · 0.74 · 0.99 · 1.22 · 1.45 · 1.69 |
| Leverage Iso Row | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.81 · 1.11 · 1.50 · 1.85 · 2.20 · 2.57 × BW | 0.34 · 0.58 · 0.80 · 1.08 · 1.33 · 1.58 · 1.85 |
| Leverage Shoulder Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.33 · 0.57 · 0.78 · 1.06 · 1.30 · 1.55 · 1.81 × BW | 0.23 · 0.40 · 0.55 · 0.74 · 0.91 · 1.09 · 1.27 |
| Leverage Shrug | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.72 · 1.14 · 1.65 · 2.14 · 2.65 · 3.11 · 3.58 × BW | 0.52 · 0.82 · 1.19 · 1.54 · 1.91 · 2.24 · 2.58 |
| Low Cable Crossover | provisional, machine | The weight on one stack (each side). | 0.12 · 0.21 · 0.29 · 0.39 · 0.48 · 0.57 · 0.67 × BW | 0.08 · 0.15 · 0.20 · 0.27 · 0.34 · 0.40 · 0.47 |
| Lying Cable Curl | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.16 · 0.27 · 0.37 · 0.51 · 0.63 · 0.75 · 0.87 |
| Lying Dumbbell Tricep Extension | provisional | The weight of one dumbbell. | 0.09 · 0.15 · 0.21 · 0.28 · 0.35 · 0.41 · 0.48 × BW | 0.06 · 0.11 · 0.15 · 0.20 · 0.24 · 0.29 · 0.34 |
| Lying High Bench Barbell Curl | provisional | The bar and plates together. | 0.21 · 0.36 · 0.50 · 0.67 · 0.83 · 0.98 · 1.15 × BW | 0.15 · 0.26 · 0.36 · 0.48 · 0.60 · 0.71 · 0.83 |
| Lying Leg Curls | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.45 · 0.73 · 1.07 · 1.39 · 1.73 · 2.03 · 2.39 × BW | 0.35 · 0.57 · 0.83 · 1.08 · 1.35 · 1.58 · 1.86 |
| Lying Machine Squat | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.75 · 1.21 · 1.78 · 2.32 · 2.88 · 3.38 · 3.98 × BW | 0.59 · 0.94 · 1.39 · 1.81 · 2.25 · 2.64 · 3.10 |
| Lying One-Arm Lateral Raise | provisional | The weight of the dumbbell, one arm at a time. | 0.06 · 0.11 · 0.16 · 0.22 · 0.29 · 0.35 · 0.43 × BW | 0.04 · 0.08 · 0.11 · 0.15 · 0.20 · 0.24 · 0.30 |
| Lying T-Bar Row | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.41 · 0.71 · 0.98 · 1.33 · 1.63 · 1.94 · 2.27 × BW | 0.30 · 0.51 · 0.71 · 0.96 · 1.17 · 1.40 · 1.63 |
| Lying Triceps Press | provisional | The EZ bar and plates together. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.15 · 0.27 · 0.36 · 0.50 · 0.61 · 0.73 · 0.85 |
| Machine Bench Press | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.50 · 0.85 · 1.18 · 1.59 · 1.95 · 2.33 · 2.72 × BW | 0.35 · 0.60 · 0.83 · 1.11 · 1.37 · 1.63 · 1.90 |
| Machine Bicep Curl | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.25 · 0.43 · 0.59 · 0.80 · 0.98 · 1.17 · 1.36 × BW | 0.18 · 0.31 · 0.42 · 0.58 · 0.71 · 0.84 · 0.98 |
| Machine Preacher Curls | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.16 · 0.27 · 0.37 · 0.51 · 0.63 · 0.75 · 0.87 |
| Machine Shoulder (Military) Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.33 · 0.57 · 0.78 · 1.06 · 1.30 · 1.55 · 1.81 × BW | 0.23 · 0.40 · 0.55 · 0.74 · 0.91 · 1.09 · 1.27 |
| Machine Triceps Extension | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.47 · 0.65 · 0.88 · 1.09 · 1.30 · 1.51 × BW | 0.20 · 0.33 · 0.45 · 0.62 · 0.76 · 0.91 · 1.06 |
| Mixed Grip Chin | provisional | Your body weight counts automatically; log only weight you add, or the assistance a machine gives you. | 0.85 · 1.05 · 1.20 · 1.35 · 1.55 · 1.75 · 1.95 × BW | 0.72 · 0.89 · 1.02 · 1.15 · 1.32 · 1.49 · 1.66 |
| Narrow Stance Hack Squats | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.71 · 1.15 · 1.69 · 2.20 · 2.74 · 3.21 · 3.78 × BW | 0.55 · 0.90 · 1.32 · 1.72 · 2.14 · 2.50 · 2.95 |
| Narrow Stance Leg Press | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 1.24 · 2.00 · 2.94 · 3.83 · 4.75 · 5.57 · 6.57 × BW | 0.97 · 1.56 · 2.29 · 2.99 · 3.71 · 4.34 · 5.12 |
| Narrow Stance Squats | main | The bar and plates together. | 0.68 · 0.99 · 1.35 · 1.67 · 1.98 · 2.25 · 2.57 × BW | 0.53 · 0.77 · 1.05 · 1.30 · 1.54 · 1.76 · 2.00 |
| Natural Glute Ham Raise | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 3 · 6 · 9 · 12 · 15 · 18 · 21 reps | 3 · 6 · 9 · 12 · 15 · 18 · 21 |
| One Arm Dumbbell Bench Press | provisional | The weight of the dumbbell, one arm at a time. | 0.21 · 0.36 · 0.50 · 0.67 · 0.83 · 0.98 · 1.15 × BW | 0.15 · 0.25 · 0.35 · 0.47 · 0.58 · 0.69 · 0.81 |
| One Arm Dumbbell Preacher Curl | provisional | The weight of the dumbbell, one arm at a time. | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.52 · 0.60 × BW | 0.08 · 0.14 · 0.19 · 0.25 · 0.31 · 0.37 · 0.43 |
| One Arm Lat Pulldown | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.25 · 0.43 · 0.59 · 0.80 · 0.98 · 1.17 · 1.36 × BW | 0.18 · 0.31 · 0.42 · 0.58 · 0.71 · 0.84 · 0.98 |
| One-Arm Dumbbell Row | main | The weight of the dumbbell, one arm at a time. | 0.25 · 0.38 · 0.50 · 0.63 · 0.74 · 0.86 · 0.97 × BW | 0.18 · 0.27 · 0.36 · 0.45 · 0.53 · 0.62 · 0.70 |
| One-Arm Flat Bench Dumbbell Flye | provisional | The weight of the dumbbell, one arm at a time. | 0.13 · 0.23 · 0.31 · 0.42 · 0.52 · 0.62 · 0.73 × BW | 0.09 · 0.16 · 0.22 · 0.29 · 0.36 · 0.43 · 0.51 |
| One-Arm Incline Lateral Raise | provisional | The weight of the dumbbell, one arm at a time. | 0.06 · 0.11 · 0.16 · 0.22 · 0.29 · 0.35 · 0.43 × BW | 0.04 · 0.08 · 0.11 · 0.15 · 0.20 · 0.24 · 0.30 |
| One-Arm Kettlebell Row | provisional | The weight of the kettlebell. | 0.23 · 0.40 · 0.55 · 0.74 · 0.91 · 1.09 · 1.27 × BW | 0.17 · 0.29 · 0.40 · 0.53 · 0.66 · 0.78 · 0.91 |
| One-Arm Long Bar Row | provisional | The plates loaded on the bar, one arm. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.16 · 0.27 · 0.37 · 0.51 · 0.63 · 0.75 · 0.87 |
| One-Arm Side Laterals | provisional | The weight of the dumbbell, one arm at a time. | 0.08 · 0.15 · 0.22 · 0.31 · 0.40 · 0.49 · 0.60 × BW | 0.06 · 0.11 · 0.15 · 0.22 · 0.28 · 0.34 · 0.42 |
| Overhead Cable Curl | provisional, machine | The weight on one stack (each side). | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.52 · 0.60 × BW | 0.08 · 0.14 · 0.19 · 0.25 · 0.31 · 0.37 · 0.43 |
| Parallel Bar Dip | main | Your body weight counts automatically; log only weight you add, or the assistance a machine gives you. | 0.85 · 1.15 · 1.40 · 1.65 · 1.90 · 2.10 · 2.30 × BW | 0.72 · 0.98 · 1.19 · 1.40 · 1.62 · 1.79 · 1.96 |
| Pin Presses | main | The bar and plates together. | 0.58 · 0.89 · 1.16 · 1.47 · 1.73 · 2.00 · 2.26 × BW | 0.41 · 0.62 · 0.81 · 1.03 · 1.21 · 1.40 · 1.58 |
| Plie Dumbbell Squat | provisional | The weight of the one dumbbell, held in both hands. | 0.34 · 0.54 · 0.80 · 1.04 · 1.30 · 1.52 · 1.79 × BW | 0.27 · 0.42 · 0.62 · 0.81 · 1.01 · 1.19 · 1.40 |
| Power Clean | provisional | The bar and plates together. | 0.54 · 0.78 · 1.05 · 1.29 · 1.53 · 1.74 · 1.95 × BW | 0.42 · 0.61 · 0.82 · 1.01 · 1.19 · 1.36 · 1.52 |
| Preacher Curl | provisional | The bar and plates together. | 0.23 · 0.40 · 0.55 · 0.74 · 0.91 · 1.09 · 1.27 × BW | 0.17 · 0.29 · 0.40 · 0.53 · 0.66 · 0.78 · 0.91 |
| Preacher Hammer Dumbbell Curl | provisional | The weight of one dumbbell. | 0.12 · 0.20 · 0.27 · 0.37 · 0.46 · 0.54 · 0.63 × BW | 0.09 · 0.14 · 0.19 · 0.27 · 0.33 · 0.39 · 0.45 |
| Pull Through | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.36 · 0.57 · 0.83 · 1.07 · 1.32 · 1.55 · 1.79 × BW | 0.29 · 0.46 · 0.66 · 0.86 · 1.06 · 1.24 · 1.43 |
| Pullups | main | Your body weight counts automatically; log only weight you add, or the assistance a machine gives you. | 0.85 · 1.05 · 1.20 · 1.35 · 1.55 · 1.75 · 1.95 × BW | 0.72 · 0.89 · 1.02 · 1.15 · 1.32 · 1.49 · 1.66 |
| Push-Up Wide | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 5 · 12 · 22 · 30 · 40 · 55 · 75 reps | 3 · 7 · 13 · 18 · 24 · 33 · 45 |
| Push-Ups - Close Triceps Position | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 4 · 10 · 18 · 25 · 33 · 45 · 60 reps | 3 · 6 · 10 · 14 · 18 · 25 · 33 |
| Push-Ups With Feet Elevated | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 4 · 10 · 18 · 25 · 33 · 45 · 60 reps | 3 · 6 · 10 · 14 · 18 · 25 · 33 |
| Pushups (Close and Wide Hand Positions) | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 5 · 12 · 22 · 30 · 40 · 55 · 75 reps | 3 · 7 · 13 · 18 · 24 · 33 · 45 |
| Pushups | main | Reps in one set; added weight is not counted, and assisted sets do not count. | 5 · 12 · 22 · 30 · 40 · 55 · 75 reps | 3 · 6 · 12 · 18 · 25 · 35 · 45 |
| Rack Pulls | main | The bar and plates together. | 0.99 · 1.43 · 1.93 · 2.37 · 2.81 · 3.19 · 3.58 × BW | 0.77 · 1.12 · 1.51 · 1.85 · 2.19 · 2.49 · 2.79 |
| Reverse Barbell Curl | provisional | The bar and plates together. | 0.21 · 0.36 · 0.50 · 0.67 · 0.83 · 0.98 · 1.15 × BW | 0.15 · 0.26 · 0.36 · 0.48 · 0.60 · 0.71 · 0.83 |
| Reverse Barbell Preacher Curls | provisional | The EZ bar and plates together. | 0.18 · 0.31 · 0.43 · 0.58 · 0.72 · 0.85 · 1.00 × BW | 0.13 · 0.22 · 0.31 · 0.42 · 0.52 · 0.61 · 0.72 |
| Reverse Cable Curl | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.20 · 0.34 · 0.47 · 0.64 · 0.78 · 0.93 · 1.09 × BW | 0.14 · 0.24 · 0.34 · 0.46 · 0.56 · 0.67 · 0.78 |
| Reverse Flyes | provisional | The weight of one dumbbell. | 0.07 · 0.13 · 0.19 · 0.27 · 0.34 · 0.42 · 0.51 × BW | 0.05 · 0.09 · 0.14 · 0.19 · 0.24 · 0.30 · 0.37 |
| Reverse Grip Bent-Over Rows | main | The bar and plates together. | 0.47 · 0.72 · 0.94 · 1.19 · 1.40 · 1.62 · 1.83 × BW | 0.34 · 0.52 · 0.68 · 0.86 · 1.01 · 1.17 · 1.32 |
| Reverse Grip Triceps Pushdown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.19 · 0.33 · 0.46 · 0.62 · 0.76 · 0.91 · 1.06 × BW | 0.13 · 0.23 · 0.32 · 0.43 · 0.53 · 0.64 · 0.74 |
| Reverse Machine Flyes | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.30 · 0.52 · 0.72 · 0.97 · 1.19 · 1.42 · 1.66 × BW | 0.22 · 0.37 · 0.52 · 0.70 · 0.86 · 1.02 · 1.20 |
| Ring Dips | provisional | Your body weight counts automatically; log only weight you add, or the assistance a machine gives you. | 0.72 · 0.98 · 1.19 · 1.40 · 1.62 · 1.79 · 1.96 × BW | 0.61 · 0.83 · 1.01 · 1.19 · 1.38 · 1.52 · 1.67 |
| Romanian Deadlift | main | The bar and plates together. | 0.68 · 0.98 · 1.31 · 1.61 · 1.91 · 2.18 · 2.44 × BW | 0.53 · 0.76 · 1.02 · 1.26 · 1.49 · 1.70 · 1.90 |
| Rope Straight-Arm Pulldown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.21 · 0.36 · 0.50 · 0.67 · 0.83 · 0.98 · 1.15 × BW | 0.15 · 0.26 · 0.36 · 0.48 · 0.60 · 0.71 · 0.83 |
| Seated Barbell Military Press | main | The bar and plates together. | 0.36 · 0.55 · 0.72 · 0.91 · 1.07 · 1.24 · 1.40 × BW | 0.25 · 0.39 · 0.50 · 0.64 · 0.75 · 0.87 · 0.98 |
| Seated Bent-Over Rear Delt Raise | provisional | The weight of one dumbbell. | 0.07 · 0.13 · 0.19 · 0.27 · 0.34 · 0.42 · 0.51 × BW | 0.05 · 0.09 · 0.14 · 0.19 · 0.24 · 0.30 · 0.37 |
| Seated Cable Rows | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.49 · 0.84 · 1.16 · 1.57 · 1.93 · 2.31 · 2.69 × BW | 0.35 · 0.60 · 0.84 · 1.13 · 1.39 · 1.66 · 1.94 |
| Seated Cable Shoulder Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.47 · 0.65 · 0.88 · 1.09 · 1.30 · 1.51 × BW | 0.20 · 0.33 · 0.45 · 0.62 · 0.76 · 0.91 · 1.06 |
| Seated Calf Raise | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.56 · 0.91 · 1.34 · 1.74 · 2.16 · 2.53 · 2.98 × BW | 0.44 · 0.71 · 1.05 · 1.36 · 1.68 · 1.97 · 2.32 |
| Seated Dumbbell Curl | provisional | The weight of one dumbbell. | 0.13 · 0.22 · 0.30 · 0.41 · 0.50 · 0.60 · 0.70 × BW | 0.09 · 0.16 · 0.22 · 0.30 · 0.36 · 0.43 · 0.50 |
| Seated Dumbbell Press | main | The weight of one dumbbell. | 0.18 · 0.27 · 0.35 · 0.45 · 0.53 · 0.61 · 0.69 × BW | 0.13 · 0.19 · 0.24 · 0.32 · 0.37 · 0.43 · 0.48 |
| Seated Good Mornings | provisional | The bar and plates together. | 0.27 · 0.43 · 0.62 · 0.80 · 0.99 · 1.17 · 1.34 × BW | 0.21 · 0.34 · 0.48 · 0.62 · 0.77 · 0.91 · 1.05 |
| Seated Leg Curl | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.76 · 1.12 · 1.46 · 1.81 · 2.13 · 2.51 × BW | 0.37 · 0.59 · 0.87 · 1.14 · 1.41 · 1.66 · 1.96 |
| Seated One-arm Cable Pulley Rows | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.25 · 0.43 · 0.59 · 0.80 · 0.98 · 1.17 · 1.36 × BW | 0.18 · 0.31 · 0.42 · 0.58 · 0.71 · 0.84 · 0.98 |
| Seated Side Lateral Raise | provisional | The weight of one dumbbell. | 0.07 · 0.13 · 0.19 · 0.27 · 0.34 · 0.42 · 0.51 × BW | 0.05 · 0.09 · 0.13 · 0.19 · 0.24 · 0.29 · 0.36 |
| Seated Triceps Press | provisional | The weight of the one dumbbell, held in both hands. | 0.15 · 0.27 · 0.37 · 0.50 · 0.61 · 0.73 · 0.85 × BW | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.51 · 0.60 |
| Side Lateral Raise | provisional | The weight of one dumbbell. | 0.07 · 0.14 · 0.20 · 0.29 · 0.37 · 0.46 · 0.55 × BW | 0.05 · 0.10 · 0.14 · 0.20 · 0.26 · 0.32 · 0.39 |
| Single-Arm Cable Crossover | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.08 · 0.16 · 0.23 · 0.34 · 0.43 · 0.53 · 0.64 × BW | 0.06 · 0.11 · 0.16 · 0.24 · 0.30 · 0.37 · 0.45 |
| Single-Arm Push-Up | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 3 · 6 · 9 · 12 · 15 · 19 · 25 reps | 3 · 6 · 9 · 12 · 15 · 18 · 21 |
| Single-Leg Leg Extension | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.29 · 0.46 · 0.68 · 0.88 · 1.09 · 1.28 · 1.51 × BW | 0.23 · 0.36 · 0.53 · 0.69 · 0.85 · 1.00 · 1.18 |
| Smith Machine Behind the Back Shrug | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.68 · 1.07 · 1.55 · 2.00 · 2.48 · 2.91 · 3.36 × BW | 0.49 · 0.77 · 1.12 · 1.44 · 1.79 · 2.10 · 2.42 |
| Smith Machine Bench Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.52 · 0.90 · 1.24 · 1.68 · 2.06 · 2.46 · 2.87 × BW | 0.36 · 0.63 · 0.87 · 1.18 · 1.44 · 1.72 · 2.01 |
| Smith Machine Bent Over Row | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.44 · 0.76 · 1.05 · 1.41 · 1.74 · 2.07 · 2.42 × BW | 0.32 · 0.55 · 0.76 · 1.02 · 1.25 · 1.49 · 1.74 |
| Smith Machine Calf Raise | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.64 · 1.03 · 1.52 · 1.97 · 2.45 · 2.87 · 3.38 × BW | 0.50 · 0.80 · 1.19 · 1.54 · 1.91 · 2.24 · 2.64 |
| Smith Machine Close-Grip Bench Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.47 · 0.81 · 1.11 · 1.50 · 1.85 · 2.20 · 2.57 × BW | 0.33 · 0.57 · 0.78 · 1.05 · 1.30 · 1.54 · 1.80 |
| Smith Machine Hip Raise | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.83 · 1.33 · 1.96 · 2.55 · 3.17 · 3.72 · 4.38 × BW | 0.66 · 1.06 · 1.57 · 2.04 · 2.54 · 2.98 · 3.50 |
| Smith Machine Incline Bench Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.44 · 0.76 · 1.05 · 1.41 · 1.74 · 2.07 · 2.42 × BW | 0.31 · 0.53 · 0.74 · 0.99 · 1.22 · 1.45 · 1.69 |
| Smith Machine Leg Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.90 · 1.45 · 2.14 · 2.78 · 3.45 · 4.05 · 4.77 × BW | 0.70 · 1.13 · 1.67 · 2.17 · 2.69 · 3.16 · 3.72 |
| Smith Machine Overhead Shoulder Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.34 · 0.59 · 0.81 · 1.10 · 1.35 · 1.61 · 1.87 × BW | 0.24 · 0.41 · 0.57 · 0.77 · 0.94 · 1.13 · 1.31 |
| Smith Machine Reverse Calf Raises | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.23 · 0.36 · 0.54 · 0.70 · 0.86 · 1.01 · 1.19 × BW | 0.18 · 0.28 · 0.42 · 0.55 · 0.67 · 0.79 · 0.93 |
| Smith Machine Squat | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.71 · 1.15 · 1.69 · 2.20 · 2.74 · 3.21 · 3.78 × BW | 0.55 · 0.90 · 1.32 · 1.72 · 2.14 · 2.50 · 2.95 |
| Smith Machine Stiff-Legged Deadlift | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.63 · 1.00 · 1.45 · 1.87 · 2.32 · 2.72 · 3.14 × BW | 0.49 · 0.78 · 1.13 · 1.46 · 1.81 · 2.12 · 2.45 |
| Smith Machine Upright Row | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.26 · 0.45 · 0.63 · 0.85 · 1.04 · 1.24 · 1.45 × BW | 0.19 · 0.32 · 0.45 · 0.61 · 0.75 · 0.89 · 1.04 |
| Smith Single-Leg Split Squat | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.34 · 0.54 · 0.80 · 1.04 · 1.30 · 1.52 · 1.79 × BW | 0.27 · 0.42 · 0.62 · 0.81 · 1.01 · 1.19 · 1.40 |
| Speed Squats | provisional | The bar and plates together. | 0.45 · 0.66 · 0.90 · 1.11 · 1.32 · 1.50 · 1.71 × BW | 0.35 · 0.51 · 0.70 · 0.87 · 1.03 · 1.17 · 1.33 |
| Spider Curl | provisional | The EZ bar and plates together. | 0.21 · 0.36 · 0.50 · 0.67 · 0.83 · 0.98 · 1.15 × BW | 0.15 · 0.26 · 0.36 · 0.48 · 0.60 · 0.71 · 0.83 |
| Split Squat with Dumbbells | provisional | The weight of one dumbbell. | 0.19 · 0.30 · 0.45 · 0.58 · 0.72 · 0.84 · 0.99 × BW | 0.15 · 0.23 · 0.35 · 0.45 · 0.56 · 0.66 · 0.77 |
| Standing Alternating Dumbbell Press | provisional | The weight of one dumbbell. | 0.17 · 0.28 · 0.39 · 0.53 · 0.65 · 0.78 · 0.91 × BW | 0.12 · 0.20 · 0.27 · 0.37 · 0.45 · 0.55 · 0.64 |
| Standing Barbell Calf Raise | provisional | The bar and plates together. | 0.60 · 0.88 · 1.20 · 1.48 · 1.76 · 2.00 · 2.28 × BW | 0.47 · 0.69 · 0.94 · 1.15 · 1.37 · 1.56 · 1.78 |
| Standing Barbell Press Behind Neck | provisional | The bar and plates together. | 0.33 · 0.51 · 0.66 · 0.84 · 0.99 · 1.14 · 1.29 × BW | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 |
| Standing Biceps Cable Curl | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.25 · 0.43 · 0.59 · 0.80 · 0.98 · 1.17 · 1.36 × BW | 0.18 · 0.31 · 0.42 · 0.58 · 0.71 · 0.84 · 0.98 |
| Standing Cable Chest Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.47 · 0.65 · 0.88 · 1.09 · 1.30 · 1.51 × BW | 0.20 · 0.33 · 0.45 · 0.62 · 0.76 · 0.91 · 1.06 |
| Standing Calf Raises | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.71 · 1.15 · 1.69 · 2.20 · 2.74 · 3.21 · 3.78 × BW | 0.55 · 0.90 · 1.32 · 1.72 · 2.14 · 2.50 · 2.95 |
| Standing Concentration Curl | provisional | The weight of the dumbbell, one arm at a time. | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.52 · 0.60 × BW | 0.08 · 0.14 · 0.19 · 0.25 · 0.31 · 0.37 · 0.43 |
| Standing Dumbbell Calf Raise | provisional | The weight of one dumbbell. | 0.26 · 0.42 · 0.62 · 0.81 · 1.01 · 1.18 · 1.39 × BW | 0.20 · 0.33 · 0.48 · 0.63 · 0.79 · 0.92 · 1.08 |
| Standing Dumbbell Press | provisional | The weight of one dumbbell. | 0.17 · 0.28 · 0.39 · 0.53 · 0.65 · 0.78 · 0.91 × BW | 0.12 · 0.20 · 0.27 · 0.37 · 0.45 · 0.55 · 0.64 |
| Standing Dumbbell Reverse Curl | provisional | The weight of one dumbbell. | 0.10 · 0.17 · 0.24 · 0.32 · 0.39 · 0.47 · 0.54 × BW | 0.07 · 0.12 · 0.17 · 0.23 · 0.28 · 0.34 · 0.39 |
| Standing Dumbbell Triceps Extension | provisional | The weight of the one dumbbell, held in both hands. | 0.17 · 0.28 · 0.39 · 0.53 · 0.65 · 0.78 · 0.91 × BW | 0.12 · 0.20 · 0.27 · 0.37 · 0.45 · 0.55 · 0.64 |
| Standing Dumbbell Upright Row | provisional | The weight of one dumbbell. | 0.12 · 0.21 · 0.29 · 0.39 · 0.48 · 0.57 · 0.67 × BW | 0.09 · 0.15 · 0.21 · 0.28 · 0.35 · 0.41 · 0.48 |
| Standing Front Barbell Raise Over Head | provisional | The bar and plates together. | 0.14 · 0.24 · 0.33 · 0.44 · 0.54 · 0.65 · 0.76 × BW | 0.10 · 0.17 · 0.23 · 0.31 · 0.38 · 0.45 · 0.53 |
| Standing Leg Curl | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.21 · 0.34 · 0.50 · 0.65 · 0.81 · 0.95 · 1.11 × BW | 0.16 · 0.27 · 0.39 · 0.51 · 0.63 · 0.74 · 0.87 |
| Standing Low-Pulley Deltoid Raise | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.05 · 0.10 · 0.14 · 0.20 · 0.26 · 0.32 · 0.38 × BW | 0.04 · 0.07 · 0.10 · 0.14 · 0.18 · 0.22 · 0.27 |
| Standing Low-Pulley One-Arm Triceps Extension | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.10 · 0.17 · 0.24 · 0.32 · 0.39 · 0.47 · 0.54 × BW | 0.07 · 0.12 · 0.17 · 0.22 · 0.27 · 0.33 · 0.38 |
| Standing Military Press | main | The bar and plates together. | 0.36 · 0.55 · 0.72 · 0.91 · 1.07 · 1.24 · 1.40 × BW | 0.25 · 0.39 · 0.50 · 0.64 · 0.75 · 0.87 · 0.98 |
| Standing One-Arm Cable Curl | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.12 · 0.21 · 0.29 · 0.39 · 0.48 · 0.57 · 0.67 × BW | 0.09 · 0.15 · 0.21 · 0.28 · 0.35 · 0.41 · 0.48 |
| Standing One-Arm Dumbbell Triceps Extension | provisional | The weight of the dumbbell, one arm at a time. | 0.07 · 0.13 · 0.19 · 0.27 · 0.34 · 0.42 · 0.51 × BW | 0.05 · 0.09 · 0.13 · 0.19 · 0.24 · 0.29 · 0.36 |
| Standing Overhead Barbell Triceps Extension | provisional | The bar and plates together. | 0.19 · 0.33 · 0.46 · 0.62 · 0.76 · 0.91 · 1.06 × BW | 0.13 · 0.23 · 0.32 · 0.43 · 0.53 · 0.64 · 0.74 |
| Standing Palm-In One-Arm Dumbbell Press | provisional | The weight of the dumbbell, one arm at a time. | 0.17 · 0.28 · 0.39 · 0.53 · 0.65 · 0.78 · 0.91 × BW | 0.12 · 0.20 · 0.27 · 0.37 · 0.45 · 0.55 · 0.64 |
| Standing Palms-In Dumbbell Press | provisional | The weight of one dumbbell. | 0.17 · 0.28 · 0.39 · 0.53 · 0.65 · 0.78 · 0.91 × BW | 0.12 · 0.20 · 0.27 · 0.37 · 0.45 · 0.55 · 0.64 |
| Stiff Leg Barbell Good Morning | provisional | The bar and plates together. | 0.38 · 0.60 · 0.87 · 1.12 · 1.39 · 1.63 · 1.88 × BW | 0.30 · 0.47 · 0.68 · 0.87 · 1.08 · 1.27 · 1.47 |
| Stiff-Legged Barbell Deadlift | main | The bar and plates together. | 0.68 · 0.98 · 1.31 · 1.61 · 1.91 · 2.18 · 2.44 × BW | 0.53 · 0.76 · 1.02 · 1.26 · 1.49 · 1.70 · 1.90 |
| Stiff-Legged Dumbbell Deadlift | provisional | The weight of one dumbbell. | 0.32 · 0.50 · 0.72 · 0.94 · 1.16 · 1.36 · 1.57 × BW | 0.25 · 0.39 · 0.56 · 0.73 · 0.90 · 1.06 · 1.22 |
| Straight-Arm Dumbbell Pullover | provisional | The weight of the one dumbbell, held in both hands. | 0.17 · 0.28 · 0.39 · 0.53 · 0.65 · 0.78 · 0.91 × BW | 0.12 · 0.20 · 0.28 · 0.38 · 0.47 · 0.56 · 0.66 |
| Straight-Arm Pulldown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.16 · 0.27 · 0.37 · 0.51 · 0.63 · 0.75 · 0.87 |
| Sumo Deadlift | main | The bar and plates together. | 0.90 · 1.30 · 1.75 · 2.15 · 2.55 · 2.90 · 3.25 × BW | 0.70 · 1.01 · 1.37 · 1.68 · 1.99 · 2.26 · 2.54 |
| Suspended Push-Up | provisional | Reps in one set; added weight is not counted, and assisted sets do not count. | 4 · 10 · 18 · 25 · 33 · 45 · 60 reps | 3 · 6 · 10 · 14 · 18 · 25 · 33 |
| Suspended Row | provisional | Reps in one set, at a body angle you keep the same; added weight is not counted. | 3 · 8 · 14 · 20 · 26 · 33 · 42 reps | 3 · 6 · 10 · 14 · 18 · 23 · 29 |
| T-Bar Row with Handle | provisional | The plates loaded on the bar. | 0.44 · 0.68 · 0.88 · 1.12 · 1.32 · 1.52 · 1.72 × BW | 0.32 · 0.49 · 0.63 · 0.81 · 0.95 · 1.09 · 1.24 |
| Thigh Abductor | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.56 · 0.91 · 1.34 · 1.74 · 2.16 · 2.53 · 2.98 × BW | 0.44 · 0.71 · 1.05 · 1.36 · 1.68 · 1.97 · 2.32 |
| Thigh Adductor | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.56 · 0.91 · 1.34 · 1.74 · 2.16 · 2.53 · 2.98 × BW | 0.44 · 0.71 · 1.05 · 1.36 · 1.68 · 1.97 · 2.32 |
| Trap Bar Deadlift | main | The trap bar and plates together. | 0.95 · 1.37 · 1.84 · 2.26 · 2.68 · 3.05 · 3.41 × BW | 0.74 · 1.07 · 1.44 · 1.76 · 2.09 · 2.38 · 2.66 |
| Tricep Dumbbell Kickback | provisional | The weight of one dumbbell. | 0.07 · 0.13 · 0.19 · 0.27 · 0.34 · 0.42 · 0.51 × BW | 0.05 · 0.09 · 0.13 · 0.19 · 0.24 · 0.29 · 0.36 |
| Triceps Overhead Extension with Rope | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.38 · 0.52 · 0.71 · 0.87 · 1.04 · 1.21 × BW | 0.15 · 0.27 · 0.36 · 0.50 · 0.61 · 0.73 · 0.85 |
| Triceps Pushdown - Rope Attachment | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.23 · 0.40 · 0.55 · 0.74 · 0.91 · 1.09 · 1.27 × BW | 0.16 · 0.28 · 0.39 · 0.52 · 0.64 · 0.76 · 0.89 |
| Triceps Pushdown - V-Bar Attachment | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.47 · 0.65 · 0.88 · 1.09 · 1.30 · 1.51 × BW | 0.20 · 0.33 · 0.45 · 0.62 · 0.76 · 0.91 · 1.06 |
| Triceps Pushdown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.47 · 0.65 · 0.88 · 1.09 · 1.30 · 1.51 × BW | 0.20 · 0.33 · 0.45 · 0.62 · 0.76 · 0.91 · 1.06 |
| Two-Arm Dumbbell Preacher Curl | provisional | The weight of one dumbbell. | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.52 · 0.60 × BW | 0.08 · 0.14 · 0.19 · 0.25 · 0.31 · 0.37 · 0.43 |
| Two-Arm Kettlebell Military Press | provisional | The weight of one kettlebell. | 0.15 · 0.27 · 0.37 · 0.50 · 0.61 · 0.73 · 0.85 × BW | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.51 · 0.60 |
| Two-Arm Kettlebell Row | provisional | The weight of one kettlebell. | 0.19 · 0.33 · 0.46 · 0.62 · 0.76 · 0.91 · 1.06 × BW | 0.14 · 0.24 · 0.33 · 0.45 · 0.55 · 0.66 · 0.76 |
| Underhand Cable Pulldowns | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.82 · 1.12 · 1.52 · 1.87 · 2.23 · 2.60 × BW | 0.34 · 0.59 · 0.81 · 1.09 · 1.35 · 1.61 · 1.87 |
| Upright Barbell Row | provisional | The bar and plates together. | 0.28 · 0.47 · 0.65 · 0.88 · 1.09 · 1.30 · 1.51 × BW | 0.20 · 0.34 · 0.47 · 0.63 · 0.78 · 0.94 · 1.09 |
| Upright Cable Row | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.47 · 0.65 · 0.88 · 1.09 · 1.30 · 1.51 × BW | 0.20 · 0.34 · 0.47 · 0.63 · 0.78 · 0.94 · 1.09 |
| V-Bar Pulldown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.82 · 1.12 · 1.52 · 1.87 · 2.23 · 2.60 × BW | 0.34 · 0.59 · 0.81 · 1.09 · 1.35 · 1.61 · 1.87 |
| V-Bar Pullup | provisional | Your body weight counts automatically; log only weight you add, or the assistance a machine gives you. | 0.85 · 1.05 · 1.20 · 1.35 · 1.55 · 1.75 · 1.95 × BW | 0.72 · 0.89 · 1.02 · 1.15 · 1.32 · 1.49 · 1.66 |
| Weighted Pull Ups | main | Your body weight counts automatically; log only weight you add, or the assistance a machine gives you. | 0.85 · 1.05 · 1.20 · 1.35 · 1.55 · 1.75 · 1.95 × BW | 0.72 · 0.89 · 1.02 · 1.15 · 1.32 · 1.49 · 1.66 |
| Weighted Squat | provisional | The weight you hold or wear, without your body weight. | 0.45 · 0.66 · 0.90 · 1.11 · 1.32 · 1.50 · 1.71 × BW | 0.35 · 0.51 · 0.70 · 0.87 · 1.03 · 1.17 · 1.33 |
| Wide Stance Barbell Squat | main | The bar and plates together. | 0.71 · 1.05 · 1.43 · 1.76 · 2.09 · 2.38 · 2.71 × BW | 0.55 · 0.82 · 1.12 · 1.37 · 1.63 · 1.86 · 2.11 |
| Wide-Grip Barbell Bench Press | main | The bar and plates together. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Wide-Grip Decline Barbell Bench Press | main | The bar and plates together. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Wide-Grip Lat Pulldown | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.82 · 1.12 · 1.52 · 1.87 · 2.23 · 2.60 × BW | 0.34 · 0.59 · 0.81 · 1.09 · 1.35 · 1.61 · 1.87 |
| Wide-Grip Pulldown Behind The Neck | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.41 · 0.71 · 0.98 · 1.33 · 1.63 · 1.94 · 2.27 × BW | 0.30 · 0.51 · 0.71 · 0.96 · 1.17 · 1.40 · 1.63 |
| Wide-Grip Rear Pull-Up | provisional | Your body weight counts automatically; log only weight you add, or the assistance a machine gives you. | 0.78 · 0.97 · 1.10 · 1.24 · 1.43 · 1.61 · 1.79 × BW | 0.66 · 0.82 · 0.94 · 1.05 · 1.22 · 1.37 · 1.52 |
| Wide-Grip Standing Barbell Curl | provisional | The bar and plates together. | 0.26 · 0.45 · 0.61 · 0.83 · 1.02 · 1.22 · 1.42 × BW | 0.19 · 0.32 · 0.44 · 0.60 · 0.73 · 0.88 · 1.02 |
| Zercher Squats | provisional | The bar and plates together. | 0.56 · 0.83 · 1.13 · 1.39 · 1.65 · 1.88 · 2.14 × BW | 0.44 · 0.65 · 0.88 · 1.08 · 1.29 · 1.47 · 1.67 |
| Zottman Curl | provisional | The weight of one dumbbell. | 0.11 · 0.19 · 0.26 · 0.35 · 0.43 · 0.52 · 0.60 × BW | 0.08 · 0.14 · 0.19 · 0.25 · 0.31 · 0.37 · 0.43 |
