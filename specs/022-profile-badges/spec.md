# Feature Specification: Profile badges

**Feature Branch**: `022-profile-badges`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Profile badges: earnable, equippable achievements shown on a person's profile. Fun but serious — understated, not gamified noise. Badges are earned from achievements and a person can equip a small number (e.g. up to 3) to show on their profile header; the rest are visible in a badge collection on their own profile. Three families: (1) Standard badges everyone can earn (e.g. joined / early member, completed setup, first post, first friend). (2) Food badges from the nutrition module: consecutive days logging food (streaks such as 7/30/100/365 days), days kept within calorie/macro goals (goal maintenance streaks and totals). (3) Training badges from the training module (spec 020, behind the training flag): workout streaks, total workouts logged, consistency per week. Badges are derived from existing event rows (meals, workouts, posts, connections) — derived never persisted where possible; only the award moment and equip choice may need storing so a badge is not lost if history is edited. Day boundaries follow the profile's dayStartHour. A badge from a module only appears if that module is enabled/accessible for the user. Other people see only equipped badges, subject to the profile audience/privacy checks; nothing reveals private tracking numbers beyond the badge itself. Badges should be extensible so they can later be tied to challenges. Optional: a notification when a badge is earned (via the notifications module, server-decided)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Earn badges and see my collection (Priority: P1)

A person who has been using the app opens their own profile and finds a **Badges** section. It
shows every badge they have earned, with the date it was earned. It also shows the badges they
haven't earned yet that are available to them, with quiet private progress such as "12 of 30
days". Badges they already qualify for from past activity are there the first time they look;
they don't have to start over.

**Why this priority**: Earning is the core of the feature. Without it, there is nothing to equip
or show. A private collection is valuable on its own: it rewards consistency without exposing
anything.

**Independent Test**: Seed an account with completed setup, one post, one friend and 8
consecutive days of food logging. Open the own profile. "Set up", "First post", "First friend"
and "7-day logging streak" show as earned, and "30-day logging streak" shows "8 of 30 days".

**Acceptance Scenarios**:

1. **Given** a person has logged food on each of the last 7 food days, **When** they open their badge collection, **Then** the 7-day logging streak badge is shown as earned, dated the day the streak reached 7.
2. **Given** a person earned the 7-day logging streak badge and has since missed a day, **When** they open the collection, **Then** the badge is still earned, and the next tier's progress restarts from the current streak.
3. **Given** a person deletes the meals that formed a past streak, **When** they open the collection, **Then** the badge they already earned is still there.
4. **Given** a person does not have the nutrition module, **When** they open the collection, **Then** no food badges are shown, neither earned nor locked.
5. **Given** a person has history that qualifies for several badges when this feature launches, **When** they first open the collection, **Then** all of those badges are earned at once, dated when each was first reached where that can be determined from history, otherwise the launch day.

---

### User Story 2 - Equip badges on my profile (Priority: P1)

From the collection, a person picks up to **three** earned badges to show on their profile
header, in the order they choose. The equipped badges appear as small, understated marks under
their name, and the person can change or clear them at any time.

**Why this priority**: Equipping is what the user asked for. It turns earned badges into
self-expression, and it is the only way a badge becomes visible to anyone else.

**Independent Test**: With three earned badges, equip two, reorder them and reload. The header
shows those two in that order. Unequip one and the header shows one.

**Acceptance Scenarios**:

1. **Given** a person has earned five badges, **When** they equip three, **Then** their header shows those three in the chosen order.
2. **Given** three badges are equipped, **When** they try to equip a fourth, **Then** they are asked which equipped badge to replace; a fourth is never added silently.
3. **Given** a person has no badges equipped, **When** anyone views their header, **Then** no empty badge space or placeholder is shown.
4. **Given** a tiered badge (for example, logging streak) is equipped, **When** the person earns a higher tier, **Then** the equipped slot shows the highest tier earned, with no action needed.
5. **Given** a person tries to equip a badge they have not earned, **Then** it is refused.

---

### User Story 3 - See other people's equipped badges (Priority: P2)

Viewing a friend's or a stranger's profile shows that person's equipped badges, and only those.
Each badge can be tapped to see its name, what it is awarded for, and when it was earned. The
viewer cannot see the person's other badges, their progress, or any underlying tracking numbers.

**Why this priority**: This is the social payoff, but it depends on stories 1 and 2. Its privacy
rules must be exactly right.

**Independent Test**: Account A equips "30-day logging streak". Account B, a friend, views A's
profile and sees that badge and its description. B cannot see A's other badges, A's current
streak length, or A's meals. A stranger who can see A's profile sees the same equipped badge.
Someone A has blocked cannot see A's profile at all, so they see no badges.

**Acceptance Scenarios**:

1. **Given** A has equipped badges, **When** B views A's profile, **Then** B sees exactly A's equipped badges, in A's order.
2. **Given** A equipped a food badge but A's meal audience is private, **When** B views A's profile, **Then** B still sees the equipped badge, because equipping is A's explicit choice to show it, and B still cannot see any of A's meals or numbers.
3. **Given** A's nutrition module is no longer available to A, **When** anyone views A's profile, **Then** A's food badges are not shown, even if equipped.
4. **Given** A uses "View as friend" or "View as stranger", **When** the preview renders, **Then** it shows the same equipped badges others would see.

---

### User Story 4 - Training badges (Priority: P2)

A person with the training module earns badges for their first workout, for total workouts
logged, and for **weekly consistency**: consecutive weeks with at least two completed workouts.
Training deliberately has no daily streaks: rest days are part of training, and a badge must
never reward skipping them.

**Why this priority**: Training is new and behind a flag, and it serves fewer accounts today.
The badge mechanism is the same as food's.

**Independent Test**: Seed 10 completed workouts across 4 consecutive weeks, at least two per
week. "First workout", "10 workouts" and "4-week consistency" are earned. An in-progress or
discarded workout does not count.

**Acceptance Scenarios**:

1. **Given** a person completed two workouts in each of the last four weeks, **When** they open the collection, **Then** the 4-week consistency badge is earned.
2. **Given** the current week has one workout so far, **When** they look at the consistency progress, **Then** the current week does not break the run; only a completed week with fewer than two workouts does.
3. **Given** the training module is off for this account, **Then** no training badges appear anywhere.

---

### User Story 5 - Be told when I earn a badge (Priority: P3)

When a person earns a badge, they get one notification ("You earned the 30-day logging streak").
Tapping it opens their badge collection with that badge highlighted, so they can equip it.

**Why this priority**: It is a nice touch, but the feature is complete without it. It reuses the
existing notifications system.

**Independent Test**: Log the meal that completes a 7-day streak. One notification for that
badge arrives, and tapping it opens the collection.

**Acceptance Scenarios**:

1. **Given** a person earns a badge, **Then** they receive at most one notification for it, ever.
2. **Given** several badges are awarded at once (for example, at launch from past history), **Then** they get at most one summary notification, not one per badge.
3. **Given** the person has turned off the badge notification type, **Then** nothing is sent, and the badge is still awarded.

---

### Edge Cases

- **A day that isn't over yet** never breaks a streak. A logging streak counts through
  yesterday, plus today once today has an entry.
- **Food day boundaries** follow the person's `dayStartHour`. A 01:00 snack counts for the
  previous day, exactly as it does in the food log.
- **Cheat days** neither break nor extend an on-target streak. A configured cheat day is skipped
  over, so a planned cheat day never costs a goal badge.
- **Days without targets.** If targets are unavailable (no weigh-in or missing profile inputs),
  a day cannot be on target and cannot be off target either: it breaks the on-target streak but
  is not counted against totals. The locked badge says that targets are needed.
- **Unfriending** after earning "First friend", or deleting the first post, does not remove
  the badge. Earned is permanent.
- **Losing module access** hides that module's badges everywhere (collection, header, other
  viewers) without deleting them. They return, with their original earned dates, if access
  returns. A hidden equipped badge frees nothing; the slot is simply not shown.
- **Feature flag off** (the social flag, which owns profiles): there is no profile, so there
  are no badges to show. Awarding may still happen so nothing is lost when it turns on.
- **Concurrent awards.** Two devices completing the qualifying action at the same moment
  produce one award and at most one notification.
- **Back-dated logging.** Filling in a missed day later can complete a streak, and the badge is
  then awarded. The earned date is the day it was awarded, not the back-dated day.
- **Blocked viewers** see nothing, because the profile itself is not shown to them.

## Requirements *(mandatory)*

### Functional Requirements

**Catalogue**

- **FR-001**: The system MUST define a fixed badge catalogue. Each badge has a stable
  identifier, a family (standard, food or training), a name, a one-line description of what earns
  it, and, for tiered badges, its tiers.
- **FR-002**: The v1 catalogue MUST include at least:
  - **Standard**
    - Set up: completed onboarding setup.
    - First post.
    - First friend: one accepted friendship.
    - Connected: 10 accepted friendships.
    - Early member: an account created before a cut-off date that is fixed when the app leaves
      its test stage.
  - **Food** (requires nutrition)
    - Logging streak: consecutive food days with at least one entry. Tiers are 7, 30, 100 and
      365 days.
    - On target streak: consecutive food days whose calories were within ±10% of that day's
      calorie target. Tiers are 7 and 30 days.
    - Days on target: total days on target. Tiers are 30, 100 and 365.
  - **Training** (requires training)
    - First workout.
    - Workouts: completed workouts. Tiers are 10, 50, 100 and 250.
    - Consistency: consecutive weeks (Monday start) with at least two completed workouts. Tiers
      are 4, 12, 26 and 52 weeks.
- **FR-003**: Each badge MUST record its source, so that future sources such as challenges can
  award a badge without changing how badges are stored, shown or equipped.

**Earning**

- **FR-004**: Whether a person qualifies for a badge MUST be computed from their existing
  records (meals, workouts, posts, connections, setup state). Progress MUST NOT be stored.
- **FR-005**: When a person first qualifies, the system MUST record the award (badge, tier,
  date earned). From then on the award MUST be permanent, regardless of later edits, deletions,
  broken streaks or unfriending.
- **FR-006**: Awards MUST be evaluated whenever the person views their own badges or profile,
  and soon after any action that can complete a badge (logging food, finishing a workout,
  posting, a friendship being accepted). Awarding MUST NOT require an always-on background
  worker.
- **FR-007**: Awarding MUST be idempotent: repeating the evaluation, or evaluating
  concurrently, never creates a duplicate award or a second notification.
- **FR-008**: Food day boundaries MUST follow the person's `dayStartHour`. "On target" MUST use
  the same daily calorie target the food log shows for that day. Configured cheat days MUST be
  skipped, neither breaking nor extending an on-target streak.
- **FR-009**: Only completed workouts MUST count toward training badges. A week that has not
  ended MUST NOT break a consistency run.

**Collection and equipping**

- **FR-010**: Each person MUST be able to see their own badge collection: earned badges with
  their dates, and locked badges available to them with private progress.
- **FR-011**: A person MUST be able to equip up to 3 earned badges, in an order they choose, and
  to reorder, replace or clear them.
- **FR-012**: An equipped tiered badge MUST always show the highest tier earned.
- **FR-013**: The system MUST refuse to equip a badge that has not been earned, or one from a
  module the person currently cannot access.

**Visibility and privacy**

- **FR-014**: Badges from a module MUST be shown only while that module is available to the
  person: not in the collection, not on the header and not to other viewers.
- **FR-015**: Other people MUST see only equipped badges, and only when the existing profile
  checks allow them to see the profile at all (blocks, the social flag). Equipping a badge is
  the person's explicit choice to show that badge. It MUST NOT expose any other data from that
  module, including progress, current streak length, meals, workouts or targets.
- **FR-016**: Responses about other people MUST contain only the equipped badge's identity,
  tier and earned date. Locked badges and progress MUST appear only in the owner's own
  responses.
- **FR-017**: The owner's "View as" preview MUST show exactly what others would see.

**Presentation**

- **FR-018**: Badges MUST be understated: small, consistent marks with a name. There MUST be no
  confetti, sounds, points, levels or leaderboards. A newly earned badge MAY be highlighted once
  in the collection.
- **FR-019**: A tapped badge, on any profile, MUST show its name, what earns it and when it was
  earned.

**Notifications (P3)**

- **FR-020**: Earning a badge MUST send at most one notification per award, through the
  existing notifications system, as its own type that the person can turn off. Several awards
  arriving together MUST be collapsed into a single notification.

### Key Entities

- **Badge definition**: a catalogue entry, not stored per person.
  - Identifier, family, name, description, required module (if any) and tiers.
  - How qualification is computed for it.
- **Badge award**: the one stored fact that a person earned a badge.
  - Person, badge, tier and date earned.
  - Source (derived rule, or later a challenge).
  - One per person, badge and tier. It is never edited after creation.
- **Equipped selection**: a person's ordered list of up to 3 badge identifiers shown on their
  profile.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person with qualifying history sees every badge they qualify for the first time
  they open their collection, with none missing and no duplicates.
- **SC-002**: A badge is awarded within one minute of the action that completes it, or at the
  latest the next time the person opens their profile.
- **SC-003**: Equipping, reordering or clearing badges takes at most three taps from the
  profile, and the header reflects the change immediately.
- **SC-004**: In privacy tests, no response about another person contains locked badges,
  progress, streak lengths or tracking numbers. 100% of such checks pass.
- **SC-005**: Editing or deleting historical records never removes an earned badge (verified by
  test).
- **SC-006**: Opening a profile with badges is no slower than opening one without badges, as
  far as a person can tell.

## Assumptions

- **Equip limit.** 3, as suggested in the request. It is a single constant if it needs to
  change.
- **Showing a badge is consent.** Equipping a badge is itself the consent to show it, the same
  way an explicit food post is. So a food or training badge can be shown even though meals stay
  private and training is otherwise unshareable. This does not change any module audience.
- **The ±10% on-target rule** uses the day's calorie target only. Macro-based badges are out of
  scope for v1, because macro targets are less universal; they can be added as new definitions.
- **Training has no daily streak.** Training uses weekly consistency instead of daily streaks,
  deliberately, so the app never rewards skipping rest.
- **Weeks start on Monday.** This matches the food module's existing week convention.
- **Launch day.** Badges qualified for before launch are awarded on first evaluation. The
  earned date is the date the threshold was first reached when history allows, otherwise the
  launch day. Launch awards produce at most one summary notification.
- **Early member.** The cut-off date is set when the app leaves the test stage. Until then,
  every account qualifies.
- **Out of scope:** challenges, badge artwork uploads, public leaderboards, and badges on post
  or comment bylines. Bylines can come later. Badges appear only on the profile.
- **Dependencies:** the social module (profiles, the "View as" preview), nutrition (entries,
  targets, `dayStartHour`, cheat days), training (spec 020: completed workouts), posts and the
  social graph (first post, friends), onboarding setup state, and notifications (spec 012) for
  US5.
