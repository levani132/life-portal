# Rank standards (v1-draft-3)

Every exercise strength ranks cover, from `STANDARDS_V1_DRAFT_3` in
`libs/shared/domain/src/lib/strength-ranks.ts`; the rules are in [training](training.md),
"Strength ranks". **Draft for owner review (#5); not frozen.** Regenerate this table when the
standards change. `rank-standards.catalogue.spec.ts` checks every row against the catalogue.

## Coverage

| | Exercises |
|---|---|
| Catalogue (free-exercise-db) | 876 |
| Logged with reps (weight or body weight), so a rank is possible at all | 729 |
| **Ranked** | **280** (was 36 in v1-draft-2) |

Excluded with a concrete reason:

| Reason | Count | Examples |
|---|---|---|
| Core, neck and forearm work: endurance-like, or no meaningful loaded standard | 97 | crunches, sit-ups, twists, wrist curls, ab wheel |
| Plyometrics: power and skill, not load | 60 | box jumps, bounds, throws |
| Bands or chains: resistance can't be measured | 41 | band good morning, squat with chains, band-assisted pull-up |
| Olympic lifting technique work: skill-limited (Power Clean is ranked) | 35 | clean, snatch, jerk, pulls |
| Strongman implements: not standardised | 20 | atlas stones, sled drags, yoke |
| Bodyweight lifts the catalogue logs as weight only, so body weight would be missed | 17 | weighted pull-ups, parallel-bar and ring dips, muscle-ups |
| Balls, rollers and bands | 10 | ball leg curl, medicine-ball slams |

**Not ranked yet: 169 long-tail entries**, mostly kettlebell ballistics and
Turkish get-ups, unusual one-off variants (Bradford press, Cuban press, Tate press), sled work and
single-leg balance lifts. Ranking them responsibly needs a standard of their own rather than a
ratio, and few are commonly logged.

Assisted pull-ups and dips need no standard of their own: logged on Pullups or Dips with
assistance, the assisted load counts.

## Evidence labels

- **main**: a powerlifting lift or a close barbell or body-weight variant, from the researched
  tables (v1-draft-2's research report in training.md).
- **machine**: the machine or cable standards of v1-draft-2.
- **provisional**: extrapolated from a main lift by a typical ratio between lifts, not from
  published tables for the exercise itself. This covers isolation, dumbbell and kettlebell
  variants, all new machine and cable work, and body-weight endurance in reps. The app labels
  these "Provisional" and says why.

Women's thresholds use the same movement-family factors as v1-draft-2 (`RANK_WOMEN_FACTORS`):
curls and rows use "pull", triceps and raises "press", and calves and adductors "legs". These
factors are not approved values.

## How load is entered

Every standard states its convention: the bar and plates, one dumbbell, the stack, one stack per
side, plates on a Smith bar or sled, or body weight plus what you add. The same text appears with
the rank and, while logging, under the exercise ("Weight: The weight of one dumbbell."). A set
entered another way ranks wrongly, so the hint is shown wherever the weight is typed.

## Thresholds

Multiples of the reference body weight (80 kg men, 60 kg women) where each tier starts after
Initiate, or reps in one set.

| Exercise | Evidence | How load is entered | Men (Explorer → Legend) | Women |
|---|---|---|---|---|
| Alternate Hammer Curl | provisional | The weight of one dumbbell. | 0.14 · 0.22 · 0.29 · 0.36 · 0.43 · 0.49 · 0.56 × BW | 0.10 · 0.16 · 0.21 · 0.26 · 0.31 · 0.35 · 0.40 |
| Alternate Incline Dumbbell Curl | provisional | The weight of one dumbbell. | 0.12 · 0.18 · 0.23 · 0.29 · 0.35 · 0.40 · 0.45 × BW | 0.09 · 0.13 · 0.17 · 0.21 · 0.25 · 0.29 · 0.32 |
| Alternating Kettlebell Press | provisional | The weight of one kettlebell. | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 × BW | 0.11 · 0.17 · 0.22 · 0.27 · 0.32 · 0.37 · 0.42 |
| Alternating Kettlebell Row | provisional | The weight of one kettlebell. | 0.19 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.75 × BW | 0.14 · 0.22 · 0.28 · 0.35 · 0.42 · 0.48 · 0.54 |
| Arnold Dumbbell Press | provisional | The weight of one dumbbell. | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 × BW | 0.11 · 0.17 · 0.22 · 0.27 · 0.32 · 0.37 · 0.42 |
| Barbell Bench Press - Medium Grip | main | The bar and plates together. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Barbell Curl | provisional | The bar and plates together. | 0.28 · 0.43 · 0.55 · 0.70 · 0.83 · 0.95 · 1.08 × BW | 0.20 · 0.31 · 0.40 · 0.50 · 0.60 · 0.68 · 0.78 |
| Barbell Deadlift | main | The bar and plates together. | 0.90 · 1.30 · 1.75 · 2.15 · 2.55 · 2.90 · 3.25 × BW | 0.70 · 1.01 · 1.37 · 1.68 · 1.99 · 2.26 · 2.54 |
| Barbell Full Squat | main | The bar and plates together. | 0.75 · 1.10 · 1.50 · 1.85 · 2.20 · 2.50 · 2.85 × BW | 0.59 · 0.86 · 1.17 · 1.44 · 1.72 · 1.95 · 2.22 |
| Barbell Glute Bridge | provisional | The bar and plates together. | 0.83 · 1.21 · 1.65 · 2.04 · 2.42 · 2.75 · 3.14 × BW | 0.66 · 0.97 · 1.32 · 1.63 · 1.94 · 2.20 · 2.51 |
| Barbell Hack Squat | provisional | The bar and plates together. | 0.45 · 0.66 · 0.90 · 1.11 · 1.32 · 1.50 · 1.71 × BW | 0.35 · 0.51 · 0.70 · 0.87 · 1.03 · 1.17 · 1.33 |
| Barbell Hip Thrust | main | The bar and plates together. | 0.98 · 1.43 · 1.95 · 2.41 · 2.86 · 3.25 · 3.71 × BW | 0.78 · 1.14 · 1.56 · 1.93 · 2.29 · 2.60 · 2.97 |
| Barbell Incline Bench Press - Medium Grip | main | The bar and plates together. | 0.44 · 0.68 · 0.88 · 1.12 · 1.32 · 1.52 · 1.72 × BW | 0.31 · 0.48 · 0.62 · 0.78 · 0.92 · 1.06 · 1.20 |
| Barbell Lunge | provisional | The bar and plates together. | 0.41 · 0.61 · 0.83 · 1.02 · 1.21 · 1.38 · 1.57 × BW | 0.32 · 0.48 · 0.65 · 0.80 · 0.94 · 1.08 · 1.22 |
| Barbell Seated Calf Raise | provisional | The bar and plates together. | 0.45 · 0.66 · 0.90 · 1.11 · 1.32 · 1.50 · 1.71 × BW | 0.35 · 0.51 · 0.70 · 0.87 · 1.03 · 1.17 · 1.33 |
| Barbell Shoulder Press | main | The bar and plates together. | 0.36 · 0.55 · 0.72 · 0.91 · 1.07 · 1.24 · 1.40 × BW | 0.25 · 0.39 · 0.50 · 0.64 · 0.75 · 0.87 · 0.98 |
| Barbell Shrug | provisional | The bar and plates together. | 0.77 · 1.11 · 1.49 · 1.83 · 2.17 · 2.47 · 2.76 × BW | 0.55 · 0.80 · 1.07 · 1.32 · 1.56 · 1.78 · 1.99 |
| Barbell Shrug Behind The Back | provisional | The bar and plates together. | 0.68 · 0.98 · 1.31 · 1.61 · 1.91 · 2.18 · 2.44 × BW | 0.49 · 0.71 · 0.94 · 1.16 · 1.38 · 1.57 · 1.76 |
| Barbell Side Split Squat | provisional | The bar and plates together. | 0.38 · 0.55 · 0.75 · 0.93 · 1.10 · 1.25 · 1.43 × BW | 0.30 · 0.43 · 0.59 · 0.73 · 0.86 · 0.98 · 1.12 |
| Barbell Squat | main | The bar and plates together. | 0.75 · 1.10 · 1.50 · 1.85 · 2.20 · 2.50 · 2.85 × BW | 0.59 · 0.86 · 1.17 · 1.44 · 1.72 · 1.95 · 2.22 |
| Barbell Squat To A Bench | main | The bar and plates together. | 0.71 · 1.05 · 1.43 · 1.76 · 2.09 · 2.38 · 2.71 × BW | 0.55 · 0.82 · 1.12 · 1.37 · 1.63 · 1.86 · 2.11 |
| Barbell Step Ups | provisional | The bar and plates together. | 0.34 · 0.50 · 0.68 · 0.83 · 0.99 · 1.13 · 1.28 × BW | 0.27 · 0.39 · 0.53 · 0.65 · 0.77 · 0.88 · 1.00 |
| Barbell Walking Lunge | provisional | The bar and plates together. | 0.41 · 0.61 · 0.83 · 1.02 · 1.21 · 1.38 · 1.57 × BW | 0.32 · 0.48 · 0.65 · 0.80 · 0.94 · 1.08 · 1.22 |
| Bench Dips | provisional | Reps in one set; added weight is not counted. | 8 · 15 · 25 · 35 · 45 · 58 · 75 reps | 6 · 11 · 19 · 26 · 34 · 44 · 56 |
| Bench Press - Powerlifting | main | The bar and plates together. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Bent Over Barbell Row | main | The bar and plates together. | 0.47 · 0.72 · 0.94 · 1.19 · 1.40 · 1.62 · 1.83 × BW | 0.34 · 0.52 · 0.68 · 0.86 · 1.01 · 1.17 · 1.32 |
| Bent Over Dumbbell Rear Delt Raise With Head On Bench | provisional | The weight of one dumbbell. | 0.06 · 0.09 · 0.11 · 0.14 · 0.17 · 0.19 · 0.22 × BW | 0.04 · 0.06 · 0.08 · 0.10 · 0.12 · 0.14 · 0.16 |
| Bent Over Low-Pulley Side Lateral | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.04 · 0.07 · 0.09 · 0.11 · 0.13 · 0.15 · 0.17 × BW | 0.03 · 0.05 · 0.06 · 0.08 · 0.09 · 0.11 · 0.12 |
| Bent Over Two-Arm Long Bar Row | provisional | The plates loaded on the bar. | 0.41 · 0.64 · 0.83 · 1.05 · 1.24 · 1.43 · 1.61 × BW | 0.30 · 0.46 · 0.60 · 0.76 · 0.89 · 1.03 · 1.16 |
| Bent Over Two-Dumbbell Row | provisional | The weight of one dumbbell. | 0.21 · 0.32 · 0.42 · 0.53 · 0.63 · 0.72 · 0.82 × BW | 0.15 · 0.23 · 0.30 · 0.38 · 0.45 · 0.52 · 0.59 |
| Bent Over Two-Dumbbell Row With Palms In | provisional | The weight of one dumbbell. | 0.21 · 0.32 · 0.42 · 0.53 · 0.63 · 0.72 · 0.82 × BW | 0.15 · 0.23 · 0.30 · 0.38 · 0.45 · 0.52 · 0.59 |
| Bent-Arm Barbell Pullover | provisional | The bar and plates together. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.16 · 0.24 · 0.32 · 0.40 · 0.48 · 0.55 · 0.62 |
| Bent-Arm Dumbbell Pullover | provisional | The weight of the one dumbbell, held in both hands. | 0.18 · 0.27 · 0.35 · 0.45 · 0.53 · 0.61 · 0.69 × BW | 0.13 · 0.19 · 0.25 · 0.32 · 0.38 · 0.44 · 0.50 |
| Board Press | main | The bar and plates together. | 0.58 · 0.89 · 1.16 · 1.47 · 1.73 · 2.00 · 2.26 × BW | 0.41 · 0.62 · 0.81 · 1.03 · 1.21 · 1.40 · 1.58 |
| Bodyweight Squat | provisional | Reps in one set; added weight is not counted. | 15 · 25 · 40 · 55 · 75 · 100 · 130 reps | 13 · 21 · 34 · 47 · 64 · 85 · 111 |
| Bodyweight Walking Lunge | provisional | Reps in one set; added weight is not counted. | 10 · 20 · 32 · 45 · 60 · 80 · 100 reps | 9 · 17 · 27 · 38 · 51 · 68 · 85 |
| Box Squat | main | The bar and plates together. | 0.71 · 1.05 · 1.43 · 1.76 · 2.09 · 2.38 · 2.71 × BW | 0.55 · 0.82 · 1.12 · 1.37 · 1.63 · 1.86 · 2.11 |
| Butterfly | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.41 · 0.64 · 0.83 · 1.05 · 1.24 · 1.43 · 1.61 × BW | 0.29 · 0.45 · 0.58 · 0.74 · 0.87 · 1.00 · 1.13 |
| Cable Chest Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.33 · 0.51 · 0.66 · 0.84 · 0.99 · 1.14 · 1.29 × BW | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 |
| Cable Crossover | provisional, machine | The weight on one stack (each side). | 0.14 · 0.21 · 0.28 · 0.35 · 0.41 · 0.48 · 0.54 × BW | 0.10 · 0.15 · 0.20 · 0.24 · 0.29 · 0.34 · 0.38 |
| Cable Deadlifts | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.45 · 0.65 · 0.88 · 1.08 · 1.28 · 1.45 · 1.63 × BW | 0.35 · 0.51 · 0.69 · 0.84 · 1.00 · 1.13 · 1.27 |
| Cable Hammer Curls - Rope Attachment | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 × BW | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.58 · 0.65 |
| Cable Lying Triceps Extension | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 |
| Cable One Arm Tricep Extension | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.11 · 0.17 · 0.22 · 0.28 · 0.33 · 0.38 · 0.43 × BW | 0.08 · 0.12 · 0.15 · 0.20 · 0.23 · 0.27 · 0.30 |
| Cable Preacher Curl | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.21 · 0.32 · 0.42 · 0.53 · 0.63 · 0.72 · 0.82 × BW | 0.15 · 0.23 · 0.30 · 0.38 · 0.45 · 0.52 · 0.59 |
| Cable Rear Delt Fly | provisional, machine | The weight on one stack (each side). | 0.07 · 0.10 · 0.13 · 0.17 · 0.20 · 0.23 · 0.26 × BW | 0.05 · 0.07 · 0.09 · 0.12 · 0.14 · 0.17 · 0.19 |
| Cable Rope Overhead Triceps Extension | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 |
| Cable Rope Rear-Delt Rows | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.16 · 0.24 · 0.32 · 0.40 · 0.48 · 0.55 · 0.62 |
| Cable Seated Lateral Raise | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.06 · 0.09 · 0.11 · 0.14 · 0.17 · 0.19 · 0.22 × BW | 0.04 · 0.06 · 0.08 · 0.10 · 0.12 · 0.13 · 0.15 |
| Cable Shoulder Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.43 · 0.55 · 0.70 · 0.83 · 0.95 · 1.08 × BW | 0.20 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.76 |
| Cable Shrugs | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.63 · 0.91 · 1.23 · 1.51 · 1.79 · 2.03 · 2.28 × BW | 0.45 · 0.66 · 0.89 · 1.09 · 1.29 · 1.46 · 1.64 |
| Calf Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.83 · 1.21 · 1.65 · 2.04 · 2.42 · 2.75 · 3.14 × BW | 0.65 · 0.94 · 1.29 · 1.59 · 1.89 · 2.15 · 2.45 |
| Calf Press On The Leg Press Machine | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.90 · 1.32 · 1.80 · 2.22 · 2.64 · 3.00 · 3.42 × BW | 0.70 · 1.03 · 1.40 · 1.73 · 2.06 · 2.34 · 2.67 |
| Chin-Up | main | Your body weight counts automatically; log only weight you add. | 0.88 · 1.08 · 1.24 · 1.39 · 1.60 · 1.80 · 2.01 × BW | 0.75 · 0.92 · 1.05 · 1.18 · 1.36 · 1.53 · 1.71 |
| Close-Grip Barbell Bench Press | main | The bar and plates together. | 0.50 · 0.77 · 0.99 · 1.26 · 1.49 · 1.71 · 1.94 × BW | 0.35 · 0.54 · 0.69 · 0.88 · 1.04 · 1.20 · 1.36 |
| Close-Grip Dumbbell Press | provisional | The weight of one dumbbell. | 0.18 · 0.27 · 0.35 · 0.45 · 0.53 · 0.61 · 0.69 × BW | 0.13 · 0.19 · 0.24 · 0.32 · 0.37 · 0.43 · 0.48 |
| Close-Grip EZ Bar Curl | provisional | The EZ bar and plates together. | 0.26 · 0.40 · 0.52 · 0.66 · 0.78 · 0.89 · 1.01 × BW | 0.19 · 0.29 · 0.37 · 0.48 · 0.56 · 0.64 · 0.73 |
| Close-Grip EZ-Bar Press | provisional | The EZ bar and plates together. | 0.44 · 0.68 · 0.88 · 1.12 · 1.32 · 1.52 · 1.72 × BW | 0.31 · 0.48 · 0.62 · 0.78 · 0.92 · 1.06 · 1.20 |
| Close-Grip Front Lat Pulldown | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.73 · 0.95 · 1.20 · 1.42 · 1.63 · 1.85 × BW | 0.34 · 0.53 · 0.68 · 0.86 · 1.02 · 1.17 · 1.33 |
| Close-Grip Standing Barbell Curl | provisional | The bar and plates together. | 0.26 · 0.41 · 0.53 · 0.67 · 0.79 · 0.91 · 1.03 × BW | 0.19 · 0.30 · 0.38 · 0.48 · 0.57 · 0.66 · 0.74 |
| Concentration Curls | provisional | The weight of the dumbbell, one arm at a time. | 0.12 · 0.19 · 0.24 · 0.31 · 0.36 · 0.42 · 0.47 × BW | 0.09 · 0.14 · 0.17 · 0.22 · 0.26 · 0.30 · 0.34 |
| Cross Body Hammer Curl | provisional | The weight of one dumbbell. | 0.14 · 0.21 · 0.28 · 0.35 · 0.41 · 0.48 · 0.54 × BW | 0.10 · 0.15 · 0.20 · 0.25 · 0.30 · 0.35 · 0.39 |
| Decline Barbell Bench Press | main | The bar and plates together. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Decline Dumbbell Bench Press | provisional | The weight of one dumbbell. | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 × BW | 0.16 · 0.25 · 0.32 · 0.41 · 0.48 · 0.56 · 0.63 |
| Decline Dumbbell Flyes | provisional | The weight of one dumbbell. | 0.14 · 0.22 · 0.29 · 0.36 · 0.43 · 0.49 · 0.56 × BW | 0.10 · 0.15 · 0.20 · 0.25 · 0.30 · 0.34 · 0.39 |
| Decline EZ Bar Triceps Extension | provisional | The EZ bar and plates together. | 0.21 · 0.32 · 0.42 · 0.53 · 0.63 · 0.72 · 0.82 × BW | 0.15 · 0.22 · 0.29 · 0.37 · 0.44 · 0.50 · 0.57 |
| Decline Push-Up | provisional | Reps in one set; added weight is not counted. | 4 · 10 · 18 · 25 · 33 · 45 · 60 reps | 3 · 6 · 10 · 14 · 18 · 25 · 33 |
| Decline Smith Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Deficit Deadlift | main | The bar and plates together. | 0.83 · 1.20 · 1.61 · 1.98 · 2.35 · 2.67 · 2.99 × BW | 0.65 · 0.94 · 1.26 · 1.54 · 1.83 · 2.08 · 2.33 |
| Dips - Triceps Version | main | Your body weight counts automatically; log only weight you add. | 0.85 · 1.15 · 1.40 · 1.65 · 1.90 · 2.10 · 2.30 × BW | 0.72 · 0.98 · 1.19 · 1.40 · 1.62 · 1.79 · 1.96 |
| Drag Curl | provisional | The bar and plates together. | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 × BW | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.58 · 0.65 |
| Dumbbell Alternate Bicep Curl | provisional | The weight of one dumbbell. | 0.13 · 0.20 · 0.26 · 0.34 · 0.40 · 0.46 · 0.52 × BW | 0.09 · 0.14 · 0.19 · 0.24 · 0.29 · 0.33 · 0.37 |
| Dumbbell Bench Press | main | The weight of one dumbbell. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 |
| Dumbbell Bench Press with Neutral Grip | provisional | The weight of one dumbbell. | 0.21 · 0.32 · 0.42 · 0.53 · 0.63 · 0.72 · 0.82 × BW | 0.15 · 0.22 · 0.29 · 0.37 · 0.44 · 0.50 · 0.57 |
| Dumbbell Bicep Curl | provisional | The weight of one dumbbell. | 0.13 · 0.20 · 0.26 · 0.34 · 0.40 · 0.46 · 0.52 × BW | 0.09 · 0.14 · 0.19 · 0.24 · 0.29 · 0.33 · 0.37 |
| Dumbbell Floor Press | provisional | The weight of one dumbbell. | 0.20 · 0.31 · 0.41 · 0.52 · 0.61 · 0.70 · 0.80 × BW | 0.14 · 0.22 · 0.29 · 0.36 · 0.43 · 0.49 · 0.56 |
| Dumbbell Flyes | provisional | The weight of one dumbbell. | 0.14 · 0.21 · 0.28 · 0.35 · 0.41 · 0.48 · 0.54 × BW | 0.10 · 0.15 · 0.20 · 0.24 · 0.29 · 0.34 · 0.38 |
| Dumbbell Incline Row | provisional | The weight of one dumbbell. | 0.19 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.75 × BW | 0.14 · 0.22 · 0.28 · 0.35 · 0.42 · 0.48 · 0.54 |
| Dumbbell Lunges | provisional | The weight of one dumbbell. | 0.19 · 0.28 · 0.38 · 0.46 · 0.55 · 0.63 · 0.71 × BW | 0.15 · 0.22 · 0.30 · 0.36 · 0.43 · 0.49 · 0.55 |
| Dumbbell Lying Rear Lateral Raise | provisional | The weight of one dumbbell. | 0.05 · 0.08 · 0.10 · 0.13 · 0.15 · 0.17 · 0.19 × BW | 0.04 · 0.06 · 0.07 · 0.09 · 0.11 · 0.12 · 0.14 |
| Dumbbell One-Arm Shoulder Press | provisional | The weight of the dumbbell, one arm at a time. | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.57 · 0.65 × BW | 0.12 · 0.18 · 0.23 · 0.29 · 0.35 · 0.40 · 0.45 |
| Dumbbell One-Arm Triceps Extension | provisional | The weight of the dumbbell, one arm at a time. | 0.07 · 0.10 · 0.13 · 0.17 · 0.20 · 0.23 · 0.26 × BW | 0.05 · 0.07 · 0.09 · 0.12 · 0.14 · 0.16 · 0.18 |
| Dumbbell Rear Lunge | provisional | The weight of one dumbbell. | 0.19 · 0.28 · 0.38 · 0.46 · 0.55 · 0.63 · 0.71 × BW | 0.15 · 0.22 · 0.30 · 0.36 · 0.43 · 0.49 · 0.55 |
| Dumbbell Shoulder Press | main | The weight of one dumbbell. | 0.18 · 0.27 · 0.35 · 0.45 · 0.53 · 0.61 · 0.69 × BW | 0.13 · 0.19 · 0.24 · 0.32 · 0.37 · 0.43 · 0.48 |
| Dumbbell Shrug | provisional | The weight of one dumbbell. | 0.36 · 0.52 · 0.70 · 0.86 · 1.02 · 1.16 · 1.30 × BW | 0.26 · 0.37 · 0.50 · 0.62 · 0.73 · 0.84 · 0.94 |
| Dumbbell Squat | provisional | The weight of one dumbbell. | 0.23 · 0.33 · 0.45 · 0.56 · 0.66 · 0.75 · 0.86 × BW | 0.18 · 0.26 · 0.35 · 0.44 · 0.51 · 0.59 · 0.67 |
| Dumbbell Squat To A Bench | provisional | The weight of one dumbbell. | 0.23 · 0.33 · 0.45 · 0.56 · 0.66 · 0.75 · 0.86 × BW | 0.18 · 0.26 · 0.35 · 0.44 · 0.51 · 0.59 · 0.67 |
| Dumbbell Step Ups | provisional | The weight of one dumbbell. | 0.17 · 0.24 · 0.33 · 0.41 · 0.48 · 0.55 · 0.63 × BW | 0.13 · 0.19 · 0.26 · 0.32 · 0.37 · 0.43 · 0.49 |
| Elevated Back Lunge | provisional | The bar and plates together. | 0.38 · 0.55 · 0.75 · 0.93 · 1.10 · 1.25 · 1.43 × BW | 0.30 · 0.43 · 0.59 · 0.73 · 0.86 · 0.98 · 1.12 |
| Elevated Cable Rows | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.72 · 0.94 · 1.19 · 1.40 · 1.62 · 1.83 × BW | 0.34 · 0.52 · 0.68 · 0.86 · 1.01 · 1.17 · 1.32 |
| EZ-Bar Curl | provisional | The EZ bar and plates together. | 0.26 · 0.40 · 0.52 · 0.66 · 0.78 · 0.89 · 1.01 × BW | 0.19 · 0.29 · 0.37 · 0.48 · 0.56 · 0.64 · 0.73 |
| EZ-Bar Skullcrusher | provisional | The EZ bar and plates together. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 |
| Face Pull | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.16 · 0.24 · 0.32 · 0.40 · 0.48 · 0.55 · 0.62 |
| Flat Bench Cable Flyes | provisional, machine | The weight on one stack (each side). | 0.12 · 0.19 · 0.24 · 0.31 · 0.36 · 0.42 · 0.47 × BW | 0.08 · 0.13 · 0.17 · 0.22 · 0.25 · 0.29 · 0.33 |
| Floor Press | main | The bar and plates together. | 0.51 · 0.78 · 1.01 · 1.29 · 1.52 · 1.75 · 1.98 × BW | 0.36 · 0.55 · 0.71 · 0.90 · 1.06 · 1.23 · 1.39 |
| Front Barbell Squat | main | The bar and plates together. | 0.60 · 0.88 · 1.20 · 1.48 · 1.76 · 2.00 · 2.28 × BW | 0.47 · 0.69 · 0.94 · 1.15 · 1.37 · 1.56 · 1.78 |
| Front Barbell Squat To A Bench | main | The bar and plates together. | 0.59 · 0.86 · 1.17 · 1.44 · 1.72 · 1.95 · 2.22 × BW | 0.46 · 0.67 · 0.91 · 1.12 · 1.34 · 1.52 · 1.73 |
| Front Cable Raise | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.07 · 0.10 · 0.13 · 0.17 · 0.20 · 0.23 · 0.26 × BW | 0.05 · 0.07 · 0.09 · 0.12 · 0.14 · 0.16 · 0.18 |
| Front Dumbbell Raise | provisional | The weight of one dumbbell. | 0.08 · 0.12 · 0.15 · 0.20 · 0.23 · 0.27 · 0.30 × BW | 0.06 · 0.08 · 0.11 · 0.14 · 0.16 · 0.19 · 0.21 |
| Front Plate Raise | provisional | The weight of the plate, held in both hands. | 0.12 · 0.19 · 0.24 · 0.31 · 0.36 · 0.42 · 0.47 × BW | 0.08 · 0.13 · 0.17 · 0.22 · 0.25 · 0.29 · 0.33 |
| Front Squat Clean Grip | main | The bar and plates together. | 0.60 · 0.88 · 1.20 · 1.48 · 1.76 · 2.00 · 2.28 × BW | 0.47 · 0.69 · 0.94 · 1.15 · 1.37 · 1.56 · 1.78 |
| Front Squats With Two Kettlebells | provisional | The weight of one kettlebell. | 0.23 · 0.33 · 0.45 · 0.56 · 0.66 · 0.75 · 0.86 × BW | 0.18 · 0.26 · 0.35 · 0.44 · 0.51 · 0.59 · 0.67 |
| Front Two-Dumbbell Raise | provisional | The weight of one dumbbell. | 0.07 · 0.11 · 0.14 · 0.18 · 0.21 · 0.25 · 0.28 × BW | 0.05 · 0.08 · 0.10 · 0.13 · 0.15 · 0.18 · 0.20 |
| Full Range-Of-Motion Lat Pulldown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.73 · 0.95 · 1.20 · 1.42 · 1.63 · 1.85 × BW | 0.34 · 0.53 · 0.68 · 0.86 · 1.02 · 1.17 · 1.33 |
| Goblet Squat | provisional | The weight of the kettlebell. | 0.34 · 0.50 · 0.68 · 0.83 · 0.99 · 1.13 · 1.28 × BW | 0.27 · 0.39 · 0.53 · 0.65 · 0.77 · 0.88 · 1.00 |
| Good Morning | provisional | The bar and plates together. | 0.41 · 0.59 · 0.79 · 0.97 · 1.15 · 1.31 · 1.46 × BW | 0.32 · 0.46 · 0.62 · 0.76 · 0.90 · 1.02 · 1.14 |
| Hack Squat | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.75 · 1.10 · 1.50 · 1.85 · 2.20 · 2.50 · 2.85 × BW | 0.59 · 0.86 · 1.17 · 1.44 · 1.72 · 1.95 · 2.22 |
| Hammer Curls | provisional | The weight of one dumbbell. | 0.14 · 0.22 · 0.29 · 0.36 · 0.43 · 0.49 · 0.56 × BW | 0.10 · 0.16 · 0.21 · 0.26 · 0.31 · 0.35 · 0.40 |
| Hammer Grip Incline DB Bench Press | provisional | The weight of one dumbbell. | 0.18 · 0.27 · 0.35 · 0.45 · 0.53 · 0.61 · 0.69 × BW | 0.13 · 0.19 · 0.24 · 0.32 · 0.37 · 0.43 · 0.48 |
| Handstand Push-Ups | provisional | Reps in one set; added weight is not counted. | 3 · 6 · 9 · 12 · 15 · 19 · 25 reps | 3 · 6 · 9 · 12 · 15 · 18 · 21 |
| Hanging Leg Raise | provisional | Reps in one set; added weight is not counted. | 3 · 8 · 12 · 18 · 24 · 30 · 40 reps | 3 · 7 · 10 · 15 · 20 · 26 · 34 |
| High Cable Curls | provisional, machine | The weight on one stack (each side). | 0.11 · 0.17 · 0.22 · 0.28 · 0.33 · 0.38 · 0.43 × BW | 0.08 · 0.12 · 0.16 · 0.20 · 0.24 · 0.27 · 0.31 |
| Hyperextensions Back Extensions | provisional | The weight you hold, without your body weight. | 0.14 · 0.20 · 0.26 · 0.32 · 0.38 · 0.44 · 0.49 × BW | 0.11 · 0.16 · 0.20 · 0.25 · 0.30 · 0.34 · 0.38 |
| Incline Barbell Triceps Extension | provisional | The bar and plates together. | 0.20 · 0.31 · 0.40 · 0.50 · 0.59 · 0.68 · 0.77 × BW | 0.14 · 0.22 · 0.28 · 0.35 · 0.41 · 0.48 · 0.54 |
| Incline Cable Chest Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.43 · 0.55 · 0.70 · 0.83 · 0.95 · 1.08 × BW | 0.20 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.76 |
| Incline Cable Flye | provisional, machine | The weight on one stack (each side). | 0.11 · 0.17 · 0.22 · 0.28 · 0.33 · 0.38 · 0.43 × BW | 0.08 · 0.12 · 0.15 · 0.20 · 0.23 · 0.27 · 0.30 |
| Incline Dumbbell Bench With Palms Facing In | provisional | The weight of one dumbbell. | 0.18 · 0.27 · 0.35 · 0.45 · 0.53 · 0.61 · 0.69 × BW | 0.13 · 0.19 · 0.24 · 0.32 · 0.37 · 0.43 · 0.48 |
| Incline Dumbbell Curl | provisional | The weight of one dumbbell. | 0.12 · 0.18 · 0.23 · 0.29 · 0.35 · 0.40 · 0.45 × BW | 0.09 · 0.13 · 0.17 · 0.21 · 0.25 · 0.29 · 0.32 |
| Incline Dumbbell Flyes | provisional | The weight of one dumbbell. | 0.12 · 0.19 · 0.24 · 0.31 · 0.36 · 0.42 · 0.47 × BW | 0.08 · 0.13 · 0.17 · 0.22 · 0.25 · 0.29 · 0.33 |
| Incline Dumbbell Press | main | The weight of one dumbbell. | 0.19 · 0.29 · 0.37 · 0.48 · 0.56 · 0.65 · 0.73 × BW | 0.13 · 0.20 · 0.26 · 0.34 · 0.39 · 0.45 · 0.51 |
| Incline Hammer Curls | provisional | The weight of one dumbbell. | 0.12 · 0.19 · 0.24 · 0.31 · 0.36 · 0.42 · 0.47 × BW | 0.09 · 0.14 · 0.17 · 0.22 · 0.26 · 0.30 · 0.34 |
| Incline Push-Up | provisional | Reps in one set; added weight is not counted. | 8 · 18 · 30 · 40 · 52 · 70 · 95 reps | 5 · 12 · 20 · 26 · 34 · 46 · 62 |
| Incline Push-Up Close-Grip | provisional | Reps in one set; added weight is not counted. | 6 · 15 · 25 · 34 · 45 · 60 · 80 reps | 4 · 9 · 15 · 20 · 27 · 36 · 48 |
| Incline Push-Up Medium | provisional | Reps in one set; added weight is not counted. | 8 · 18 · 30 · 40 · 52 · 70 · 95 reps | 5 · 12 · 20 · 26 · 34 · 46 · 62 |
| Incline Push-Up Wide | provisional | Reps in one set; added weight is not counted. | 8 · 18 · 30 · 40 · 52 · 70 · 95 reps | 5 · 12 · 20 · 26 · 34 · 46 · 62 |
| Inverted Row | provisional | Reps in one set; added weight is not counted. | 3 · 8 · 14 · 20 · 26 · 33 · 42 reps | 3 · 6 · 10 · 14 · 18 · 23 · 29 |
| JM Press | provisional | The bar and plates together. | 0.30 · 0.47 · 0.61 · 0.77 · 0.91 · 1.05 · 1.18 × BW | 0.21 · 0.33 · 0.43 · 0.54 · 0.64 · 0.74 · 0.83 |
| Kettlebell One-Legged Deadlift | provisional | The weight of the kettlebell. | 0.27 · 0.39 · 0.53 · 0.65 · 0.77 · 0.87 · 0.98 × BW | 0.21 · 0.30 · 0.41 · 0.51 · 0.60 · 0.68 · 0.76 |
| Kettlebell Seated Press | provisional | The weight of one kettlebell. | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 × BW | 0.11 · 0.17 · 0.22 · 0.27 · 0.32 · 0.37 · 0.42 |
| Kneeling Cable Triceps Extension | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 |
| Kneeling High Pulley Row | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.44 · 0.68 · 0.88 · 1.12 · 1.32 · 1.52 · 1.72 × BW | 0.32 · 0.49 · 0.63 · 0.81 · 0.95 · 1.09 · 1.24 |
| Kneeling Single-Arm High Pulley Row | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.16 · 0.24 · 0.32 · 0.40 · 0.48 · 0.55 · 0.62 |
| Leg Extensions | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.59 · 0.86 · 1.17 · 1.44 · 1.72 · 1.95 · 2.22 × BW | 0.46 · 0.67 · 0.91 · 1.12 · 1.34 · 1.52 · 1.73 |
| Leg Press | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 1.31 · 1.93 · 2.63 · 3.24 · 3.85 · 4.38 · 4.99 × BW | 1.02 · 1.51 · 2.05 · 2.53 · 3.00 · 3.42 · 3.89 |
| Leverage Chest Press | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.50 · 0.77 · 0.99 · 1.26 · 1.49 · 1.71 · 1.94 × BW | 0.35 · 0.54 · 0.69 · 0.88 · 1.04 · 1.20 · 1.36 |
| Leverage Deadlift | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.90 · 1.30 · 1.75 · 2.15 · 2.55 · 2.90 · 3.25 × BW | 0.70 · 1.01 · 1.37 · 1.68 · 1.99 · 2.26 · 2.54 |
| Leverage Decline Chest Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.52 · 0.81 · 1.05 · 1.33 · 1.57 · 1.81 · 2.04 × BW | 0.36 · 0.57 · 0.74 · 0.93 · 1.10 · 1.27 · 1.43 |
| Leverage High Row | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.72 · 0.94 · 1.19 · 1.40 · 1.62 · 1.83 × BW | 0.34 · 0.52 · 0.68 · 0.86 · 1.01 · 1.17 · 1.32 |
| Leverage Incline Chest Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.44 · 0.68 · 0.88 · 1.12 · 1.32 · 1.52 · 1.72 × BW | 0.31 · 0.48 · 0.62 · 0.78 · 0.92 · 1.06 · 1.20 |
| Leverage Iso Row | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.72 · 0.94 · 1.19 · 1.40 · 1.62 · 1.83 × BW | 0.34 · 0.52 · 0.68 · 0.86 · 1.01 · 1.17 · 1.32 |
| Leverage Shoulder Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.33 · 0.51 · 0.66 · 0.84 · 0.99 · 1.14 · 1.29 × BW | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 |
| Leverage Shrug | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.72 · 1.04 · 1.40 · 1.72 · 2.04 · 2.32 · 2.60 × BW | 0.52 · 0.75 · 1.01 · 1.24 · 1.47 · 1.67 · 1.87 |
| Low Cable Crossover | provisional, machine | The weight on one stack (each side). | 0.12 · 0.19 · 0.24 · 0.31 · 0.36 · 0.42 · 0.47 × BW | 0.08 · 0.13 · 0.17 · 0.22 · 0.25 · 0.29 · 0.33 |
| Lying Cable Curl | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.16 · 0.24 · 0.32 · 0.40 · 0.48 · 0.55 · 0.62 |
| Lying Dumbbell Tricep Extension | provisional | The weight of one dumbbell. | 0.09 · 0.14 · 0.18 · 0.22 · 0.26 · 0.30 · 0.34 × BW | 0.06 · 0.10 · 0.13 · 0.15 · 0.18 · 0.21 · 0.24 |
| Lying High Bench Barbell Curl | provisional | The bar and plates together. | 0.21 · 0.32 · 0.42 · 0.53 · 0.63 · 0.72 · 0.82 × BW | 0.15 · 0.23 · 0.30 · 0.38 · 0.45 · 0.52 · 0.59 |
| Lying Leg Curls | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.45 · 0.66 · 0.90 · 1.11 · 1.32 · 1.50 · 1.71 × BW | 0.35 · 0.51 · 0.70 · 0.87 · 1.03 · 1.17 · 1.33 |
| Lying Machine Squat | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.75 · 1.10 · 1.50 · 1.85 · 2.20 · 2.50 · 2.85 × BW | 0.59 · 0.86 · 1.17 · 1.44 · 1.72 · 1.95 · 2.22 |
| Lying One-Arm Lateral Raise | provisional | The weight of the dumbbell, one arm at a time. | 0.06 · 0.09 · 0.11 · 0.14 · 0.17 · 0.19 · 0.22 × BW | 0.04 · 0.06 · 0.08 · 0.10 · 0.12 · 0.13 · 0.15 |
| Lying T-Bar Row | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.41 · 0.64 · 0.83 · 1.05 · 1.24 · 1.43 · 1.61 × BW | 0.30 · 0.46 · 0.60 · 0.76 · 0.89 · 1.03 · 1.16 |
| Lying Triceps Press | provisional | The EZ bar and plates together. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 |
| Machine Bench Press | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.50 · 0.77 · 0.99 · 1.26 · 1.49 · 1.71 · 1.94 × BW | 0.35 · 0.54 · 0.69 · 0.88 · 1.04 · 1.20 · 1.36 |
| Machine Bicep Curl | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.25 · 0.38 · 0.50 · 0.63 · 0.74 · 0.86 · 0.97 × BW | 0.18 · 0.27 · 0.36 · 0.45 · 0.53 · 0.62 · 0.70 |
| Machine Preacher Curls | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.16 · 0.24 · 0.32 · 0.40 · 0.48 · 0.55 · 0.62 |
| Machine Shoulder Military Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.33 · 0.51 · 0.66 · 0.84 · 0.99 · 1.14 · 1.29 × BW | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 |
| Machine Triceps Extension | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.43 · 0.55 · 0.70 · 0.83 · 0.95 · 1.08 × BW | 0.20 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.76 |
| Narrow Stance Hack Squats | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 0.71 · 1.05 · 1.43 · 1.76 · 2.09 · 2.38 · 2.71 × BW | 0.55 · 0.82 · 1.12 · 1.37 · 1.63 · 1.86 · 2.11 |
| Narrow Stance Leg Press | provisional, machine | The plates loaded, not the sled or carriage; machines differ, so compare like with like. | 1.24 · 1.82 · 2.48 · 3.05 · 3.63 · 4.13 · 4.70 × BW | 0.97 · 1.42 · 1.93 · 2.38 · 2.83 · 3.22 · 3.67 |
| Narrow Stance Squats | main | The bar and plates together. | 0.68 · 0.99 · 1.35 · 1.67 · 1.98 · 2.25 · 2.57 × BW | 0.53 · 0.77 · 1.05 · 1.30 · 1.54 · 1.76 · 2.00 |
| Natural Glute Ham Raise | provisional | Reps in one set; added weight is not counted. | 3 · 6 · 9 · 12 · 15 · 18 · 21 reps | 3 · 6 · 9 · 12 · 15 · 18 · 21 |
| One Arm Dumbbell Bench Press | provisional | The weight of the dumbbell, one arm at a time. | 0.21 · 0.32 · 0.42 · 0.53 · 0.63 · 0.72 · 0.82 × BW | 0.15 · 0.22 · 0.29 · 0.37 · 0.44 · 0.50 · 0.57 |
| One Arm Dumbbell Preacher Curl | provisional | The weight of the dumbbell, one arm at a time. | 0.11 · 0.17 · 0.22 · 0.28 · 0.33 · 0.38 · 0.43 × BW | 0.08 · 0.12 · 0.16 · 0.20 · 0.24 · 0.27 · 0.31 |
| One Arm Lat Pulldown | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.25 · 0.38 · 0.50 · 0.63 · 0.74 · 0.86 · 0.97 × BW | 0.18 · 0.27 · 0.36 · 0.45 · 0.53 · 0.62 · 0.70 |
| One-Arm Dumbbell Row | main | The weight of the dumbbell, one arm at a time. | 0.25 · 0.38 · 0.50 · 0.63 · 0.74 · 0.86 · 0.97 × BW | 0.18 · 0.27 · 0.36 · 0.45 · 0.53 · 0.62 · 0.70 |
| One-Arm Flat Bench Dumbbell Flye | provisional | The weight of the dumbbell, one arm at a time. | 0.13 · 0.20 · 0.26 · 0.34 · 0.40 · 0.46 · 0.52 × BW | 0.09 · 0.14 · 0.18 · 0.24 · 0.28 · 0.32 · 0.36 |
| One-Arm Incline Lateral Raise | provisional | The weight of the dumbbell, one arm at a time. | 0.06 · 0.09 · 0.11 · 0.14 · 0.17 · 0.19 · 0.22 × BW | 0.04 · 0.06 · 0.08 · 0.10 · 0.12 · 0.13 · 0.15 |
| One-Arm Kettlebell Row | provisional | The weight of the kettlebell. | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 × BW | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.58 · 0.65 |
| One-Arm Long Bar Row | provisional | The plates loaded on the bar, one arm. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.16 · 0.24 · 0.32 · 0.40 · 0.48 · 0.55 · 0.62 |
| One-Arm Side Laterals | provisional | The weight of the dumbbell, one arm at a time. | 0.08 · 0.12 · 0.15 · 0.20 · 0.23 · 0.27 · 0.30 × BW | 0.06 · 0.08 · 0.11 · 0.14 · 0.16 · 0.19 · 0.21 |
| Overhead Cable Curl | provisional, machine | The weight on one stack (each side). | 0.11 · 0.17 · 0.22 · 0.28 · 0.33 · 0.38 · 0.43 × BW | 0.08 · 0.12 · 0.16 · 0.20 · 0.24 · 0.27 · 0.31 |
| Pin Presses | main | The bar and plates together. | 0.58 · 0.89 · 1.16 · 1.47 · 1.73 · 2.00 · 2.26 × BW | 0.41 · 0.62 · 0.81 · 1.03 · 1.21 · 1.40 · 1.58 |
| Plie Dumbbell Squat | provisional | The weight of the one dumbbell, held in both hands. | 0.34 · 0.50 · 0.68 · 0.83 · 0.99 · 1.13 · 1.28 × BW | 0.27 · 0.39 · 0.53 · 0.65 · 0.77 · 0.88 · 1.00 |
| Power Clean | provisional | The bar and plates together. | 0.54 · 0.78 · 1.05 · 1.29 · 1.53 · 1.74 · 1.95 × BW | 0.42 · 0.61 · 0.82 · 1.01 · 1.19 · 1.36 · 1.52 |
| Preacher Curl | provisional | The bar and plates together. | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 × BW | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.58 · 0.65 |
| Preacher Hammer Dumbbell Curl | provisional | The weight of one dumbbell. | 0.12 · 0.18 · 0.23 · 0.29 · 0.35 · 0.40 · 0.45 × BW | 0.09 · 0.13 · 0.17 · 0.21 · 0.25 · 0.29 · 0.32 |
| Pull Through | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.36 · 0.52 · 0.70 · 0.86 · 1.02 · 1.16 · 1.30 × BW | 0.29 · 0.42 · 0.56 · 0.69 · 0.82 · 0.93 · 1.04 |
| Pullups | main | Your body weight counts automatically; log only weight you add. | 0.85 · 1.05 · 1.20 · 1.35 · 1.55 · 1.75 · 1.95 × BW | 0.72 · 0.89 · 1.02 · 1.15 · 1.32 · 1.49 · 1.66 |
| Push-Up Wide | provisional | Reps in one set; added weight is not counted. | 5 · 12 · 22 · 30 · 40 · 55 · 75 reps | 3 · 7 · 13 · 18 · 24 · 33 · 45 |
| Push-Ups - Close Triceps Position | provisional | Reps in one set; added weight is not counted. | 4 · 10 · 18 · 25 · 33 · 45 · 60 reps | 3 · 6 · 10 · 14 · 18 · 25 · 33 |
| Push-Ups With Feet Elevated | provisional | Reps in one set; added weight is not counted. | 4 · 10 · 18 · 25 · 33 · 45 · 60 reps | 3 · 6 · 10 · 14 · 18 · 25 · 33 |
| Pushups | main | Reps in one set; added weight is not counted. | 5 · 12 · 22 · 30 · 40 · 55 · 75 reps | 3 · 6 · 12 · 18 · 25 · 35 · 45 |
| Pushups Close and Wide Hand Positions | provisional | Reps in one set; added weight is not counted. | 5 · 12 · 22 · 30 · 40 · 55 · 75 reps | 3 · 7 · 13 · 18 · 24 · 33 · 45 |
| Rack Pulls | main | The bar and plates together. | 0.99 · 1.43 · 1.93 · 2.37 · 2.81 · 3.19 · 3.58 × BW | 0.77 · 1.12 · 1.51 · 1.85 · 2.19 · 2.49 · 2.79 |
| Reverse Barbell Curl | provisional | The bar and plates together. | 0.21 · 0.32 · 0.42 · 0.53 · 0.63 · 0.72 · 0.82 × BW | 0.15 · 0.23 · 0.30 · 0.38 · 0.45 · 0.52 · 0.59 |
| Reverse Barbell Preacher Curls | provisional | The EZ bar and plates together. | 0.18 · 0.28 · 0.36 · 0.46 · 0.54 · 0.63 · 0.71 × BW | 0.13 · 0.20 · 0.26 · 0.33 · 0.39 · 0.45 · 0.51 |
| Reverse Cable Curl | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.20 · 0.31 · 0.40 · 0.50 · 0.59 · 0.68 · 0.77 × BW | 0.14 · 0.22 · 0.29 · 0.36 · 0.42 · 0.49 · 0.55 |
| Reverse Flyes | provisional | The weight of one dumbbell. | 0.06 · 0.09 · 0.11 · 0.14 · 0.17 · 0.19 · 0.22 × BW | 0.04 · 0.06 · 0.08 · 0.10 · 0.12 · 0.14 · 0.16 |
| Reverse Grip Bent-Over Rows | main | The bar and plates together. | 0.47 · 0.72 · 0.94 · 1.19 · 1.40 · 1.62 · 1.83 × BW | 0.34 · 0.52 · 0.68 · 0.86 · 1.01 · 1.17 · 1.32 |
| Reverse Grip Triceps Pushdown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.19 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.75 × BW | 0.13 · 0.21 · 0.27 · 0.34 · 0.41 · 0.47 · 0.53 |
| Reverse Machine Flyes | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.30 · 0.47 · 0.61 · 0.77 · 0.91 · 1.05 · 1.18 × BW | 0.22 · 0.34 · 0.44 · 0.55 · 0.66 · 0.76 · 0.85 |
| Romanian Deadlift | main | The bar and plates together. | 0.68 · 0.98 · 1.31 · 1.61 · 1.91 · 2.18 · 2.44 × BW | 0.53 · 0.76 · 1.02 · 1.26 · 1.49 · 1.70 · 1.90 |
| Rope Straight-Arm Pulldown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.21 · 0.32 · 0.42 · 0.53 · 0.63 · 0.72 · 0.82 × BW | 0.15 · 0.23 · 0.30 · 0.38 · 0.45 · 0.52 · 0.59 |
| Seated Barbell Military Press | main | The bar and plates together. | 0.36 · 0.55 · 0.72 · 0.91 · 1.07 · 1.24 · 1.40 × BW | 0.25 · 0.39 · 0.50 · 0.64 · 0.75 · 0.87 · 0.98 |
| Seated Bent-Over Rear Delt Raise | provisional | The weight of one dumbbell. | 0.06 · 0.09 · 0.11 · 0.14 · 0.17 · 0.19 · 0.22 × BW | 0.04 · 0.06 · 0.08 · 0.10 · 0.12 · 0.14 · 0.16 |
| Seated Cable Rows | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.49 · 0.76 · 0.98 · 1.25 · 1.47 · 1.69 · 1.91 × BW | 0.35 · 0.55 · 0.71 · 0.90 · 1.06 · 1.22 · 1.38 |
| Seated Cable Shoulder Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.43 · 0.55 · 0.70 · 0.83 · 0.95 · 1.08 × BW | 0.20 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.76 |
| Seated Calf Raise | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.56 · 0.83 · 1.13 · 1.39 · 1.65 · 1.88 · 2.14 × BW | 0.44 · 0.65 · 0.88 · 1.08 · 1.29 · 1.47 · 1.67 |
| Seated Dumbbell Curl | provisional | The weight of one dumbbell. | 0.13 · 0.20 · 0.25 · 0.32 · 0.38 · 0.44 · 0.49 × BW | 0.09 · 0.14 · 0.18 · 0.23 · 0.27 · 0.32 · 0.35 |
| Seated Dumbbell Press | main | The weight of one dumbbell. | 0.18 · 0.27 · 0.35 · 0.45 · 0.53 · 0.61 · 0.69 × BW | 0.13 · 0.19 · 0.24 · 0.32 · 0.37 · 0.43 · 0.48 |
| Seated Good Mornings | provisional | The bar and plates together. | 0.27 · 0.39 · 0.53 · 0.65 · 0.77 · 0.87 · 0.98 × BW | 0.21 · 0.30 · 0.41 · 0.51 · 0.60 · 0.68 · 0.76 |
| Seated Leg Curl | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.69 · 0.95 · 1.17 · 1.39 · 1.58 · 1.80 × BW | 0.37 · 0.54 · 0.74 · 0.91 · 1.08 · 1.23 · 1.40 |
| Seated One-arm Cable Pulley Rows | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.25 · 0.38 · 0.50 · 0.63 · 0.74 · 0.86 · 0.97 × BW | 0.18 · 0.27 · 0.36 · 0.45 · 0.53 · 0.62 · 0.70 |
| Seated Side Lateral Raise | provisional | The weight of one dumbbell. | 0.07 · 0.10 · 0.13 · 0.17 · 0.20 · 0.23 · 0.26 × BW | 0.05 · 0.07 · 0.09 · 0.12 · 0.14 · 0.16 · 0.18 |
| Seated Triceps Press | provisional | The weight of the one dumbbell, held in both hands. | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 × BW | 0.11 · 0.17 · 0.22 · 0.27 · 0.32 · 0.37 · 0.42 |
| Side Lateral Raise | provisional | The weight of one dumbbell. | 0.07 · 0.11 · 0.14 · 0.18 · 0.21 · 0.25 · 0.28 × BW | 0.05 · 0.08 · 0.10 · 0.13 · 0.15 · 0.18 · 0.20 |
| Single-Arm Cable Crossover | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.08 · 0.13 · 0.17 · 0.21 · 0.25 · 0.29 · 0.32 × BW | 0.06 · 0.09 · 0.12 · 0.15 · 0.18 · 0.20 · 0.22 |
| Single-Arm Push-Up | provisional | Reps in one set; added weight is not counted. | 3 · 6 · 9 · 12 · 15 · 19 · 25 reps | 3 · 6 · 9 · 12 · 15 · 18 · 21 |
| Single-Leg Leg Extension | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.29 · 0.42 · 0.57 · 0.70 · 0.84 · 0.95 · 1.08 × BW | 0.23 · 0.33 · 0.44 · 0.55 · 0.66 · 0.74 · 0.84 |
| Smith Machine Behind the Back Shrug | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.68 · 0.98 · 1.31 · 1.61 · 1.91 · 2.18 · 2.44 × BW | 0.49 · 0.71 · 0.94 · 1.16 · 1.38 · 1.57 · 1.76 |
| Smith Machine Bench Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.52 · 0.81 · 1.05 · 1.33 · 1.57 · 1.81 · 2.04 × BW | 0.36 · 0.57 · 0.74 · 0.93 · 1.10 · 1.27 · 1.43 |
| Smith Machine Bent Over Row | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.44 · 0.68 · 0.88 · 1.12 · 1.32 · 1.52 · 1.72 × BW | 0.32 · 0.49 · 0.63 · 0.81 · 0.95 · 1.09 · 1.24 |
| Smith Machine Calf Raise | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.64 · 0.94 · 1.28 · 1.57 · 1.87 · 2.13 · 2.42 × BW | 0.50 · 0.73 · 1.00 · 1.22 · 1.46 · 1.66 · 1.89 |
| Smith Machine Close-Grip Bench Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.47 · 0.72 · 0.94 · 1.19 · 1.40 · 1.62 · 1.83 × BW | 0.33 · 0.50 · 0.66 · 0.83 · 0.98 · 1.13 · 1.28 |
| Smith Machine Hip Raise | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.83 · 1.21 · 1.65 · 2.04 · 2.42 · 2.75 · 3.14 × BW | 0.66 · 0.97 · 1.32 · 1.63 · 1.94 · 2.20 · 2.51 |
| Smith Machine Incline Bench Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.44 · 0.68 · 0.88 · 1.12 · 1.32 · 1.52 · 1.72 × BW | 0.31 · 0.48 · 0.62 · 0.78 · 0.92 · 1.06 · 1.20 |
| Smith Machine Leg Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.90 · 1.32 · 1.80 · 2.22 · 2.64 · 3.00 · 3.42 × BW | 0.70 · 1.03 · 1.40 · 1.73 · 2.06 · 2.34 · 2.67 |
| Smith Machine Overhead Shoulder Press | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.34 · 0.53 · 0.68 · 0.87 · 1.02 · 1.18 · 1.33 × BW | 0.24 · 0.37 · 0.48 · 0.61 · 0.71 · 0.83 · 0.93 |
| Smith Machine Reverse Calf Raises | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.23 · 0.33 · 0.45 · 0.56 · 0.66 · 0.75 · 0.86 × BW | 0.18 · 0.26 · 0.35 · 0.44 · 0.51 · 0.59 · 0.67 |
| Smith Machine Squat | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.71 · 1.05 · 1.43 · 1.76 · 2.09 · 2.38 · 2.71 × BW | 0.55 · 0.82 · 1.12 · 1.37 · 1.63 · 1.86 · 2.11 |
| Smith Machine Stiff-Legged Deadlift | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.63 · 0.91 · 1.23 · 1.51 · 1.79 · 2.03 · 2.28 × BW | 0.49 · 0.71 · 0.96 · 1.18 · 1.40 · 1.58 · 1.78 |
| Smith Machine Upright Row | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.26 · 0.41 · 0.53 · 0.67 · 0.79 · 0.91 · 1.03 × BW | 0.19 · 0.30 · 0.38 · 0.48 · 0.57 · 0.66 · 0.74 |
| Smith Single-Leg Split Squat | provisional, machine | The plates on the Smith bar; bars differ (some are counterweighted), so compare like with like. | 0.34 · 0.50 · 0.68 · 0.83 · 0.99 · 1.13 · 1.28 × BW | 0.27 · 0.39 · 0.53 · 0.65 · 0.77 · 0.88 · 1.00 |
| Speed Squats | provisional | The bar and plates together. | 0.45 · 0.66 · 0.90 · 1.11 · 1.32 · 1.50 · 1.71 × BW | 0.35 · 0.51 · 0.70 · 0.87 · 1.03 · 1.17 · 1.33 |
| Spider Curl | provisional | The EZ bar and plates together. | 0.21 · 0.32 · 0.42 · 0.53 · 0.63 · 0.72 · 0.82 × BW | 0.15 · 0.23 · 0.30 · 0.38 · 0.45 · 0.52 · 0.59 |
| Split Squat with Dumbbells | provisional | The weight of one dumbbell. | 0.19 · 0.28 · 0.38 · 0.46 · 0.55 · 0.63 · 0.71 × BW | 0.15 · 0.22 · 0.30 · 0.36 · 0.43 · 0.49 · 0.55 |
| Standing Alternating Dumbbell Press | provisional | The weight of one dumbbell. | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.57 · 0.65 × BW | 0.12 · 0.18 · 0.23 · 0.29 · 0.35 · 0.40 · 0.45 |
| Standing Barbell Calf Raise | provisional | The bar and plates together. | 0.60 · 0.88 · 1.20 · 1.48 · 1.76 · 2.00 · 2.28 × BW | 0.47 · 0.69 · 0.94 · 1.15 · 1.37 · 1.56 · 1.78 |
| Standing Barbell Press Behind Neck | provisional | The bar and plates together. | 0.33 · 0.51 · 0.66 · 0.84 · 0.99 · 1.14 · 1.29 × BW | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 |
| Standing Biceps Cable Curl | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.25 · 0.38 · 0.50 · 0.63 · 0.74 · 0.86 · 0.97 × BW | 0.18 · 0.27 · 0.36 · 0.45 · 0.53 · 0.62 · 0.70 |
| Standing Cable Chest Press | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.43 · 0.55 · 0.70 · 0.83 · 0.95 · 1.08 × BW | 0.20 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.76 |
| Standing Calf Raises | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.71 · 1.05 · 1.43 · 1.76 · 2.09 · 2.38 · 2.71 × BW | 0.55 · 0.82 · 1.12 · 1.37 · 1.63 · 1.86 · 2.11 |
| Standing Concentration Curl | provisional | The weight of the dumbbell, one arm at a time. | 0.11 · 0.17 · 0.22 · 0.28 · 0.33 · 0.38 · 0.43 × BW | 0.08 · 0.12 · 0.16 · 0.20 · 0.24 · 0.27 · 0.31 |
| Standing Dumbbell Calf Raise | provisional | The weight of one dumbbell. | 0.26 · 0.39 · 0.53 · 0.65 · 0.77 · 0.88 · 1.00 × BW | 0.20 · 0.30 · 0.41 · 0.51 · 0.60 · 0.69 · 0.78 |
| Standing Dumbbell Press | provisional | The weight of one dumbbell. | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.57 · 0.65 × BW | 0.12 · 0.18 · 0.23 · 0.29 · 0.35 · 0.40 · 0.45 |
| Standing Dumbbell Reverse Curl | provisional | The weight of one dumbbell. | 0.10 · 0.15 · 0.20 · 0.25 · 0.30 · 0.34 · 0.39 × BW | 0.07 · 0.11 · 0.14 · 0.18 · 0.22 · 0.24 · 0.28 |
| Standing Dumbbell Triceps Extension | provisional | The weight of the one dumbbell, held in both hands. | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.57 · 0.65 × BW | 0.12 · 0.18 · 0.23 · 0.29 · 0.35 · 0.40 · 0.45 |
| Standing Dumbbell Upright Row | provisional | The weight of one dumbbell. | 0.12 · 0.19 · 0.24 · 0.31 · 0.36 · 0.42 · 0.47 × BW | 0.09 · 0.14 · 0.17 · 0.22 · 0.26 · 0.30 · 0.34 |
| Standing Front Barbell Raise Over Head | provisional | The bar and plates together. | 0.14 · 0.21 · 0.28 · 0.35 · 0.41 · 0.48 · 0.54 × BW | 0.10 · 0.15 · 0.20 · 0.24 · 0.29 · 0.34 · 0.38 |
| Standing Leg Curl | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.21 · 0.31 · 0.42 · 0.52 · 0.62 · 0.70 · 0.80 × BW | 0.16 · 0.24 · 0.33 · 0.41 · 0.48 · 0.55 · 0.62 |
| Standing Low-Pulley Deltoid Raise | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.05 · 0.08 · 0.10 · 0.13 · 0.15 · 0.17 · 0.19 × BW | 0.04 · 0.06 · 0.07 · 0.09 · 0.11 · 0.12 · 0.13 |
| Standing Low-Pulley One-Arm Triceps Extension | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.10 · 0.15 · 0.20 · 0.25 · 0.30 · 0.34 · 0.39 × BW | 0.07 · 0.11 · 0.14 · 0.18 · 0.21 · 0.24 · 0.27 |
| Standing Military Press | main | The bar and plates together. | 0.36 · 0.55 · 0.72 · 0.91 · 1.07 · 1.24 · 1.40 × BW | 0.25 · 0.39 · 0.50 · 0.64 · 0.75 · 0.87 · 0.98 |
| Standing One-Arm Cable Curl | provisional, machine | The weight on the stack, one arm or leg at a time. | 0.12 · 0.19 · 0.24 · 0.31 · 0.36 · 0.42 · 0.47 × BW | 0.09 · 0.14 · 0.17 · 0.22 · 0.26 · 0.30 · 0.34 |
| Standing One-Arm Dumbbell Triceps Extension | provisional | The weight of the dumbbell, one arm at a time. | 0.07 · 0.10 · 0.13 · 0.17 · 0.20 · 0.23 · 0.26 × BW | 0.05 · 0.07 · 0.09 · 0.12 · 0.14 · 0.16 · 0.18 |
| Standing Overhead Barbell Triceps Extension | provisional | The bar and plates together. | 0.19 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.75 × BW | 0.13 · 0.21 · 0.27 · 0.34 · 0.41 · 0.47 · 0.53 |
| Standing Palm-In One-Arm Dumbbell Press | provisional | The weight of the dumbbell, one arm at a time. | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.57 · 0.65 × BW | 0.12 · 0.18 · 0.23 · 0.29 · 0.35 · 0.40 · 0.45 |
| Standing Palms-In Dumbbell Press | provisional | The weight of one dumbbell. | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.57 · 0.65 × BW | 0.12 · 0.18 · 0.23 · 0.29 · 0.35 · 0.40 · 0.45 |
| Stiff Leg Barbell Good Morning | provisional | The bar and plates together. | 0.38 · 0.55 · 0.74 · 0.90 · 1.07 · 1.22 · 1.37 × BW | 0.30 · 0.43 · 0.58 · 0.70 · 0.83 · 0.95 · 1.07 |
| Stiff-Legged Barbell Deadlift | main | The bar and plates together. | 0.68 · 0.98 · 1.31 · 1.61 · 1.91 · 2.18 · 2.44 × BW | 0.53 · 0.76 · 1.02 · 1.26 · 1.49 · 1.70 · 1.90 |
| Stiff-Legged Dumbbell Deadlift | provisional | The weight of one dumbbell. | 0.32 · 0.45 · 0.61 · 0.75 · 0.89 · 1.01 · 1.14 × BW | 0.25 · 0.35 · 0.48 · 0.59 · 0.69 · 0.79 · 0.89 |
| Straight-Arm Dumbbell Pullover | provisional | The weight of the one dumbbell, held in both hands. | 0.17 · 0.26 · 0.33 · 0.42 · 0.50 · 0.57 · 0.65 × BW | 0.12 · 0.19 · 0.24 · 0.30 · 0.36 · 0.41 · 0.47 |
| Straight-Arm Pulldown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.16 · 0.24 · 0.32 · 0.40 · 0.48 · 0.55 · 0.62 |
| Sumo Deadlift | main | The bar and plates together. | 0.90 · 1.30 · 1.75 · 2.15 · 2.55 · 2.90 · 3.25 × BW | 0.70 · 1.01 · 1.37 · 1.68 · 1.99 · 2.26 · 2.54 |
| T-Bar Row with Handle | provisional | The plates loaded on the bar. | 0.44 · 0.68 · 0.88 · 1.12 · 1.32 · 1.52 · 1.72 × BW | 0.32 · 0.49 · 0.63 · 0.81 · 0.95 · 1.09 · 1.24 |
| Thigh Abductor | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.56 · 0.83 · 1.13 · 1.39 · 1.65 · 1.88 · 2.14 × BW | 0.44 · 0.65 · 0.88 · 1.08 · 1.29 · 1.47 · 1.67 |
| Thigh Adductor | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.56 · 0.83 · 1.13 · 1.39 · 1.65 · 1.88 · 2.14 × BW | 0.44 · 0.65 · 0.88 · 1.08 · 1.29 · 1.47 · 1.67 |
| Trap Bar Deadlift | main | The trap bar and plates together. | 0.95 · 1.37 · 1.84 · 2.26 · 2.68 · 3.05 · 3.41 × BW | 0.74 · 1.07 · 1.44 · 1.76 · 2.09 · 2.38 · 2.66 |
| Tricep Dumbbell Kickback | provisional | The weight of one dumbbell. | 0.05 · 0.08 · 0.10 · 0.13 · 0.15 · 0.17 · 0.19 × BW | 0.04 · 0.06 · 0.07 · 0.09 · 0.11 · 0.12 · 0.13 |
| Triceps Overhead Extension with Rope | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.22 · 0.34 · 0.44 · 0.56 · 0.66 · 0.76 · 0.86 × BW | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 |
| Triceps Pushdown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.43 · 0.55 · 0.70 · 0.83 · 0.95 · 1.08 × BW | 0.20 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.76 |
| Triceps Pushdown - Rope Attachment | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.23 · 0.36 · 0.46 · 0.59 · 0.69 · 0.80 · 0.90 × BW | 0.16 · 0.25 · 0.32 · 0.41 · 0.48 · 0.56 · 0.63 |
| Triceps Pushdown - V-Bar Attachment | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.43 · 0.55 · 0.70 · 0.83 · 0.95 · 1.08 × BW | 0.20 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.76 |
| Two-Arm Dumbbell Preacher Curl | provisional | The weight of one dumbbell. | 0.11 · 0.17 · 0.22 · 0.28 · 0.33 · 0.38 · 0.43 × BW | 0.08 · 0.12 · 0.16 · 0.20 · 0.24 · 0.27 · 0.31 |
| Two-Arm Kettlebell Military Press | provisional | The weight of one kettlebell. | 0.15 · 0.24 · 0.31 · 0.39 · 0.46 · 0.53 · 0.60 × BW | 0.11 · 0.17 · 0.22 · 0.27 · 0.32 · 0.37 · 0.42 |
| Two-Arm Kettlebell Row | provisional | The weight of one kettlebell. | 0.19 · 0.30 · 0.39 · 0.49 · 0.58 · 0.67 · 0.75 × BW | 0.14 · 0.22 · 0.28 · 0.35 · 0.42 · 0.48 · 0.54 |
| Underhand Cable Pulldowns | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.73 · 0.95 · 1.20 · 1.42 · 1.63 · 1.85 × BW | 0.34 · 0.53 · 0.68 · 0.86 · 1.02 · 1.17 · 1.33 |
| Upright Barbell Row | provisional | The bar and plates together. | 0.28 · 0.43 · 0.55 · 0.70 · 0.83 · 0.95 · 1.08 × BW | 0.20 · 0.31 · 0.40 · 0.50 · 0.60 · 0.68 · 0.78 |
| Upright Cable Row | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.28 · 0.43 · 0.55 · 0.70 · 0.83 · 0.95 · 1.08 × BW | 0.20 · 0.31 · 0.40 · 0.50 · 0.60 · 0.68 · 0.78 |
| V-Bar Pulldown | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.73 · 0.95 · 1.20 · 1.42 · 1.63 · 1.85 × BW | 0.34 · 0.53 · 0.68 · 0.86 · 1.02 · 1.17 · 1.33 |
| V-Bar Pullup | provisional | Your body weight counts automatically; log only weight you add. | 0.85 · 1.05 · 1.20 · 1.35 · 1.55 · 1.75 · 1.95 × BW | 0.72 · 0.89 · 1.02 · 1.15 · 1.32 · 1.49 · 1.66 |
| Weighted Squat | provisional | The weight you hold or wear, without your body weight. | 0.45 · 0.66 · 0.90 · 1.11 · 1.32 · 1.50 · 1.71 × BW | 0.35 · 0.51 · 0.70 · 0.87 · 1.03 · 1.17 · 1.33 |
| Wide Stance Barbell Squat | main | The bar and plates together. | 0.71 · 1.05 · 1.43 · 1.76 · 2.09 · 2.38 · 2.71 × BW | 0.55 · 0.82 · 1.12 · 1.37 · 1.63 · 1.86 · 2.11 |
| Wide-Grip Barbell Bench Press | main | The bar and plates together. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Wide-Grip Decline Barbell Bench Press | main | The bar and plates together. | 0.55 · 0.85 · 1.10 · 1.40 · 1.65 · 1.90 · 2.15 × BW | 0.39 · 0.60 · 0.77 · 0.98 · 1.16 · 1.33 · 1.51 |
| Wide-Grip Lat Pulldown | machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.47 · 0.73 · 0.95 · 1.20 · 1.42 · 1.63 · 1.85 × BW | 0.34 · 0.53 · 0.68 · 0.86 · 1.02 · 1.17 · 1.33 |
| Wide-Grip Pulldown Behind The Neck | provisional, machine | The weight on the stack or the plates loaded; machines differ, so compare like with like. | 0.41 · 0.64 · 0.83 · 1.05 · 1.24 · 1.43 · 1.61 × BW | 0.30 · 0.46 · 0.60 · 0.76 · 0.89 · 1.03 · 1.16 |
| Wide-Grip Rear Pull-Up | provisional | Your body weight counts automatically; log only weight you add. | 0.78 · 0.97 · 1.10 · 1.24 · 1.43 · 1.61 · 1.79 × BW | 0.66 · 0.82 · 0.94 · 1.05 · 1.22 · 1.37 · 1.52 |
| Wide-Grip Standing Barbell Curl | provisional | The bar and plates together. | 0.26 · 0.40 · 0.52 · 0.66 · 0.78 · 0.89 · 1.01 × BW | 0.19 · 0.29 · 0.37 · 0.48 · 0.56 · 0.64 · 0.73 |
| Zercher Squats | provisional | The bar and plates together. | 0.56 · 0.83 · 1.13 · 1.39 · 1.65 · 1.88 · 2.14 × BW | 0.44 · 0.65 · 0.88 · 1.08 · 1.29 · 1.47 · 1.67 |
| Zottman Curl | provisional | The weight of one dumbbell. | 0.11 · 0.17 · 0.22 · 0.28 · 0.33 · 0.38 · 0.43 × BW | 0.08 · 0.12 · 0.16 · 0.20 · 0.24 · 0.27 · 0.31 |
