# Feature Specification: Training sharing

**Feature Branch**: `036-training-sharing`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "Training social sharing: let a member post a finished workout on their wall, and share a training plan, a single plan workout, or one of their own exercises, as an explicit snapshot-based publication separate from live widget sharing (in the manner of food posts, spec 007). A viewer who is allowed to see the post can import what was shared into their own training data as an attributed private copy: a shared plan or plan workout becomes their own plan, a shared own exercise becomes their own exercise; nothing is ever logged or started on import. The sharer controls what is shared: they can share only part of a plan (chosen workouts), and can turn copying off so viewers can see it but not import it. This prepares for creators selling workouts later (not in scope now: no payments), so copy permission and partial sharing must be first-class. Respect existing rules: audience checks and graph checks on every read, no-store responses, idempotency keys and deletion tombstones, snapshots built by the server and never accepted from a request, private tracking records (weights lifted, body weight, records, ranks) never exposed unless the sharer explicitly includes a workout's logged sets in a workout post."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Post a finished workout (Priority: P1)

After finishing a workout, a member shares it as a post: its name, when it was done, how long it took, and the exercises with how many sets each had. They preview exactly what others will see, choose the audience, and publish. The weights and reps they lifted stay private unless they switch on "Include weights and reps" for that post.

**Why this priority**: It is the most frequent reason to share anything from Training, it needs no import, and it proves the whole path: choose, preview, publish, read.

**Independent Test**: Finish a workout, share it to friends, and open the post as a friend, as a stranger and as the author. The friend sees the workout's summary and no weights; the stranger sees nothing; switching on "Include weights and reps" before publishing shows them to the friend.

**Acceptance Scenarios**:

1. **Given** a finished workout, **When** the member chooses Share from its recap or from History, **Then** a new post opens with that workout attached and a preview of exactly what will be published.
2. **Given** the preview with "Include weights and reps" off, **When** the post is published, **Then** viewers see exercise names, the muscle group, the number of sets and the workout's duration, and no weight, reps, body weight, record or rank.
3. **Given** "Include weights and reps" on, **When** the post is published, **Then** viewers also see each logged set's weight and reps as they were at publishing, and still no body weight.
4. **Given** a published workout post, **When** the member later edits or deletes that workout, **Then** the post still shows what was published.
5. **Given** an open (unfinished) workout, **When** the member looks for Share, **Then** it is not offered.

---

### User Story 2 - Share a plan, or part of one (Priority: P1)

A member shares one of their own plans. They pick which of its workouts to include (all by default), decide whether viewers may copy it, preview it, choose the audience and publish. Viewers see the plan's name, the included workouts, and each workout's exercises with their planned sets. If only some workouts are included, the post says it is part of a larger plan without naming what was left out.

**Why this priority**: Plans are the thing other people most want from someone's training, and partial sharing and copy permission are the controls the owner asked to be first-class from the start.

**Independent Test**: Share two of a five-workout plan with copying off. As a friend, open the post: two workouts are shown in full, the post says it is part of a larger plan, and there is no way to copy it.

**Acceptance Scenarios**:

1. **Given** an own plan with five workouts, **When** the member shares it and deselects three, **Then** the preview and the published post contain only the two chosen workouts and say "2 of 5 workouts".
2. **Given** the share form, **When** the member turns "Allow copying" off, **Then** the published post has no copy action for anyone but the author.
3. **Given** a published plan post, **When** the member edits, reorders or deletes the plan, **Then** the post still shows what was published.
4. **Given** a plan that uses one of the member's own exercises, **When** it is shared, **Then** viewers see that exercise's name, muscles, equipment and how it is measured, and nothing else about the member's use of it.
5. **Given** a single workout inside a plan, **When** the member chooses Share on that workout, **Then** the share form opens with only that workout selected.

---

### User Story 3 - Copy a shared plan into my own plans (Priority: P1)

A viewer who can see a plan post with copying allowed taps Copy. The shared workouts become a new plan of their own, marked with who it came from. Nothing is started or logged. They can then edit it freely; later changes by the sharer do not reach it.

**Why this priority**: Sharing a plan is only half a feature until someone else can use it.

**Independent Test**: As a friend, copy a shared two-workout plan. A new own plan appears with those two workouts and an attribution line; no workout was started; tapping Copy again opens the same copy instead of making a second one.

**Acceptance Scenarios**:

1. **Given** a visible plan post with copying allowed, **When** the viewer taps Copy, **Then** a new plan of their own is created with exactly the shared workouts, exercises and planned sets, and it says who it was copied from.
2. **Given** the viewer already copied this post, **When** they tap Copy again, **Then** they are taken to their existing copy and no second plan is made.
3. **Given** the shared plan includes an exercise that was the sharer's own, **When** the viewer copies it, **Then** that exercise is created once as the viewer's own exercise and the copied plan uses it.
4. **Given** copying is off, or the viewer can no longer see the post (audience changed, unfriended, blocked, post deleted), **When** they try to copy, **Then** it is refused and nothing is created.
5. **Given** a copy was made, **When** the sharer deletes the post or the original plan, **Then** the viewer's copy stays, and its attribution still names the person.
6. **Given** a workout post with copying allowed, **When** the viewer taps Copy, **Then** they get a new one-workout plan with that workout's exercises and number of sets, and never the sharer's weights or reps.

---

### User Story 4 - Share one of my own exercises (Priority: P2)

A member shares an exercise they created: its name, muscles, equipment, how it is measured and its instructions. A viewer with copying allowed can add it to their own exercises.

**Why this priority**: Smaller audience than plans, and plans already carry own exercises with them, but it completes the set the owner listed.

**Independent Test**: Share an own exercise to friends; as a friend, copy it; it appears among the friend's own exercises with an attribution line and no history.

**Acceptance Scenarios**:

1. **Given** an own exercise, **When** the member shares it, **Then** the post shows its name, muscles, equipment, measure and instructions, and none of the member's history, records or ranks on it.
2. **Given** a catalogue exercise (not the member's own), **When** the member looks for Share on it, **Then** it is not offered, because everyone already has it.
3. **Given** a visible exercise post with copying allowed, **When** the viewer copies it, **Then** it becomes one of their own exercises, attributed, and copying again returns the same one.

---

### User Story 5 - Change my mind after sharing (Priority: P2)

The author can change a training post's audience, caption and copy permission, or delete it. What was shared (the workouts, exercises, sets) cannot be edited; to share something different they make a new post.

**Why this priority**: Control after the fact is part of sharing safely, and turning copying off later is the lever a creator will need.

**Independent Test**: Publish a plan post with copying on, let a friend copy it, turn copying off, and check that a second friend cannot copy while the first friend's copy remains.

**Acceptance Scenarios**:

1. **Given** a published training post, **When** the author turns copying off, **Then** nobody else can copy it from then on, and copies already made are untouched.
2. **Given** a published training post, **When** the author narrows the audience, **Then** people outside it can no longer see or copy it.
3. **Given** a published training post, **When** the author deletes it, **Then** it disappears for everyone and cannot be copied; a retry of the original publish does not bring it back.

---

### Edge Cases

- The workout chosen for sharing is deleted, or the plan changes, between preview and publish: publishing is refused and the member is shown a fresh preview, as with food posts.
- A plan is shared with zero workouts selected: publishing is not possible.
- A plan references a catalogue exercise that has since been archived or renamed: the post shows it as it was named at publishing; a copy uses the same catalogue exercise.
- The viewer does not have Training turned on: they can see the post's summary but have no Copy action.
- Copying a large plan partially fails: nothing is left half-created; the viewer either has the whole copy or none.
- The sharer blocks the viewer after the viewer copied: the copy stays (it is the viewer's own data), the post is no longer reachable from its attribution.
- A repost of a training post: copying follows the original post's permission and visibility, never the reposter's.
- The author previews their own post "as a friend" or "as a stranger": they see what that viewer would, including whether Copy is offered.
- A workout post made from a workout that itself came from a copied plan: sharing it is allowed; the plan's attribution is not carried into the post.
- The same own exercise appears in several copied plans from the same sharer: it is created once for the viewer and reused.

## Requirements *(mandatory)*

### Functional Requirements

**What can be shared**

- **FR-001**: Members MUST be able to attach exactly one Training item to a post: a finished workout, an own plan (all or chosen workouts), or an own exercise. A post carries at most one attachment in total (Food or Training, never both).
- **FR-002**: A workout post MUST contain the workout's name, the day it was done, its duration, and each exercise's name, muscle group and number of sets. It MUST NOT contain weights or reps unless the author switched on "Include weights and reps" for that post, and MUST NEVER contain body weight, records, ranks, level or XP.
- **FR-003**: A plan post MUST contain the plan's name, the chosen workouts in plan order, and each workout's exercises with their planned sets. When not every workout is included it MUST state how many of how many are included, without naming or describing the others.
- **FR-004**: An exercise post MUST contain the exercise's name, muscles, equipment, measure and instructions, and nothing from the author's use of it.
- **FR-005**: Only the author's own plans and own exercises can be shared; ready-made plans and catalogue exercises MUST NOT be offered for sharing. Only finished workouts can be shared.
- **FR-006**: When shared content uses an exercise that is the author's own, the post MUST carry that exercise's name, muscles, equipment and measure, so it is readable and copyable without access to the author's private exercises.

**Publishing**

- **FR-007**: Every training attachment MUST be previewed before publishing, and the preview MUST show exactly what will be published.
- **FR-008**: What is published MUST be a snapshot built by the service from the author's own data at publishing time. It MUST NOT be accepted from the request, and MUST NOT change when the author later edits or deletes the workout, plan or exercise.
- **FR-009**: If what would be published differs from what was previewed, publishing MUST be refused and the author shown a new preview.
- **FR-010**: Every post MUST have an explicit audience (only me, friends, public), with the same meaning as for other posts. A retry of the same publish MUST return the original post and never create a second one.
- **FR-011**: Each training post MUST carry a copy permission chosen by the author before publishing ("Allow copying"), on by default.

**Reading**

- **FR-012**: Every read of a training post MUST apply the same checks as any other post, at the time of the read: audience, current friendship, blocks in either direction, the features of author and viewer, reports and deletion. Responses MUST NOT be stored by browsers or intermediaries.
- **FR-013**: Reading a training post MUST NOT reveal anything about the author's training beyond the snapshot: no other workouts, plans, exercises, history, records, ranks or body weight.
- **FR-014**: Each post shown to a viewer MUST say whether that viewer may copy it.
- **FR-015**: The link preview shown outside the app for a public post MUST NOT include training details beyond what it already includes for any post.

**Copying**

- **FR-016**: A viewer who can currently read a post whose copy permission is on, and who has Training, MUST be able to copy it into their own training data. Otherwise copying MUST be refused and create nothing.
- **FR-017**: Copying a plan post MUST create one new own plan containing exactly the shared workouts. Copying a workout post MUST create one new own plan with one workout made from that workout's exercises and number of sets, never from the author's weights or reps. Copying an exercise post MUST create one new own exercise.
- **FR-018**: Copying MUST never start a workout, log a set, or change any existing plan, exercise or history of the viewer.
- **FR-019**: A copy MUST record where it came from (the post and its author) and show it to its owner. The attribution MUST survive the post's deletion; it then names the author without linking to the post.
- **FR-020**: Copying the same post again MUST return the existing copy while it exists. If the viewer deleted their copy, copying again MUST create a new one.
- **FR-021**: An exercise that was the author's own MUST be created as the viewer's own exercise when copied, once per viewer and source, and reused by later copies from the same source.
- **FR-022**: A copy is the viewer's own from the moment it is made: later changes to, or deletion of, the post, the original, the friendship or the copy permission MUST NOT change or remove it.
- **FR-023**: Copying MUST be all-or-nothing: a failure MUST NOT leave part of a plan or stray exercises behind.

**After publishing**

- **FR-024**: The author MUST be able to change a training post's audience, caption and copy permission, and to delete it. The shared content itself MUST NOT be editable.
- **FR-025**: A deleted post MUST stay deleted: it MUST NOT be readable or copyable, and a retry of its original publish MUST NOT recreate it.
- **FR-026**: Reposting a training post MUST follow existing repost rules; copy permission and visibility are always the original's.

**Access and rollout**

- **FR-027**: Training sharing MUST be behind its own feature switch, off for production until reviewed, and MUST additionally require Social, Training and posts to be on for the member.
- **FR-028**: Publishing, copying and changing a training post MUST require a connection; none of them is queued for later.

### Key Entities *(include if feature involves data)*

- **Training attachment**: what a post carries from Training: its kind (workout, plan or exercise), the snapshot shown to viewers, the copy permission, and for a plan how many workouts were included of how many.
- **Workout snapshot**: name, day, duration, exercises with their number of sets, and optionally each set's weight and reps.
- **Plan snapshot**: name and the included workouts, each with its exercises and planned sets.
- **Exercise snapshot**: name, muscles, equipment, measure and instructions; also carried inside a workout or plan snapshot for each exercise that was the author's own.
- **Copy record**: which viewer copied which post, what it became (a plan or an exercise of theirs), and the author's name at the time, kept for attribution and to make repeat copies return the same thing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member can share a finished workout in under 30 seconds from its recap, including the preview.
- **SC-002**: A viewer can copy a shared plan and see it among their own plans in under 10 seconds, in one tap from the post.
- **SC-003**: In every tested combination of audience, friendship, block and copy permission, a viewer who should not see or copy a post cannot: 0 exceptions.
- **SC-004**: No training post or copy reveals a weight, reps, body weight, record or rank that its author did not explicitly include: 0 exceptions across the test matrix.
- **SC-005**: Editing or deleting the original workout, plan or exercise changes 0 published posts and 0 existing copies.
- **SC-006**: Repeating a publish or a copy (double tap, retry after a lost connection) creates exactly one post or one copy.

## Assumptions

- **Copying is on by default.** The owner asked for the option to forbid copying, not for it to be the norm; someone who shares a plan usually wants it used. It is one switch on the share form and can be turned off later.
- **A partial plan says it is partial** ("2 of 5 workouts") but reveals nothing about the rest. This keeps a viewer from mistaking a sample for the whole plan, which matters more once plans can be sold.
- **Workout posts hide weights and reps by default** and never show body weight, records or ranks. Showing a personal record on a post is a possible later addition, not part of this feature.
- **One attachment per post.** A post has Food or Training, not both, as today a post has at most one food.
- **Viewers need Training to copy, not to look.** A member without Training can read a training post's summary.
- **Selling is out of scope.** No prices, payments, purchases or paid access here. Copy permission and partial sharing are the only parts built now for that future.
- **Online only for now.** Offline post drafts (spec 032) do not carry training attachments in this feature.
- **Own exercise photos are not shared** in this feature; the exercise's text details are.
- **Discovery is unchanged.** Training posts appear wherever posts already appear (Wall, profiles, For You where that is on, messages), under the existing rules. No training-specific topics or ranking.
- **Existing "Copy" on ready-made plans is unchanged**; this feature adds copying from posts.
- Reuses the post, audience, graph, report, repost, comment and like behaviour of spec 007 and its follow-ups without changing them.
