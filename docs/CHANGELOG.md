# Changelog

User-visible changes. Newest first.

## 2026-11-14: Update a plan day from a workout

- **After a plan workout, you can save what you changed to the plan.** If you added, removed,
  swapped or reordered exercises, or changed a rest or a superset, a card under the finished
  workout offers "Update <day> in <plan>". Review shows each change, the day after and the day
  now; nothing changes until you confirm, and "Not now" leaves the plan as it is. It is also there
  when you open that workout from History.
- **Only that day changes, and only what you changed.** Skipped or unfinished exercises stay in
  the plan. A new exercise's planned sets come from the sets you logged, never their weights; an
  exercise you kept keeps its planned sets.
- **Ready-made plans** are saved as your own copy with that day updated.
- **No lost edits.** If the day was edited since you opened the review, or in another tab, you are
  asked to review again instead of it being overwritten. Your workout history, records, ranks and
  tournaments are unchanged.

## 2026-11-14: Rank emblems and All ranks

- **New rank emblems.** Each of the eight tiers has its own emblem, from a stone circle (Initiate)
  to a gold-rayed sun (Legend). Pips under it show the division: one for III, two for II, three
  for I.
- **All ranks.** On an exercise's rank, "All ranks" shows every tier with where its III, II and I
  start for that exercise, where you are, how far to the next division (with an estimate of the
  extra weight), and how ranks differ from your level and from tournaments. "All strength ranks"
  on your training level shows the tiers.
- Ranks, thresholds and tournaments themselves are unchanged.

## 2026-11-14: Pick an exercise, not a machine

- **Adding an exercise is one tap.** There is no "Which machine?" step any more: an exercise's
  name says its equipment, and you can filter by equipment in the search.
- **Machine exercises whose names hid it now say so**, e.g. "Butterfly (Machine)", "Leg
  Extensions (Machine)", "Pallof Press (Cable)". Searching the old name still finds them.
- **My machines is gone** from the Exercises tab. Workouts you logged on a machine still show it,
  and your history, records and ranks are unchanged.

## 2026-11-13: Sets are ticked off in the row; exercise details in tabs

- **In a workout, each set is one row: its numbers, and a tick at the end.** Planned sets are
  there from the start, already filled in; change a number in the row if you need to and tick it.
  The separate "Log set" form is gone. Tick again to take a set back (its numbers stay in the
  row), and edit a done set right in its row. The set number opens type and RPE.
- **A big "Add set" button** under the rows adds one more, starting from the set above it.
- **Pull-ups, dips and the like have one weight box instead of two.** `+` is added weight, `−` is
  assistance; tap the sign to switch (or type a minus where the keyboard has one).
- **Tap an exercise's name in a workout to open its details**: how it is done, your progress,
  your rank and tournament, and your past sessions.
- **Exercise details are in tabs** (About, Progress, Rank, History), in the Exercises tab too, so
  nothing hides below a long scroll.

## 2026-11-13: Tournaments use standards v1; no machine tournaments

- **A tournament group says which standards it is scored under** (v1), fixed for the month.
- **Machine and cable lifts have no tournament.** Machines differ between gyms, so their loads
  can't be compared fairly between people. Your rank on them still works.
- **The "enrolment is open" reminder arrives once per month**, even if the server was down at
  midnight on the 20th.
- **Final results say "no valid set"** for a member without one, rather than "no valid set yet".
- **Error messages are announced by screen readers** (they are alerts now), across the app.
- Tournaments are still behind a flag.

## 2026-11-13: Strength standards v1 are fixed

- **The rank standards are final for v1.** A future change will come as a new version and never
  takes away a rank you have reached. The rank details say so instead of "draft".
- Ranks are still behind a flag.

## 2026-11-13: Weighted pull-ups and dips count your body weight

- **Weighted pull-ups, bar and ring dips, suspended rows and similar** now count your body weight
  plus what you add, like Pullups. Enter only the weight you add.
- **Assistance works on body-weight exercises.** On a pull-up or dip you can enter the assistance
  a machine gives you instead of added weight, and it counts for progress and ranks.
- **Nothing you logged before changes.** Sets logged as weight only on these exercises stay as
  they were in their workouts. The statistics page says how many were logged that way and
  leaves them out of its figures.
- **Machine ranks say they are personal benchmarks.** They are not comparable across gyms.
- **Rank standards are now release candidate 1.** Small isolation lifts such as raises and
  kickbacks were too strict at the top and have been widened. Ranks are still behind a flag.

## 2026-11-13: Strength ranks for 280 exercises (draft standards)

- **Most lifts you log now have a rank**: curls, raises, triceps work, flyes, lunges, calf
  raises, kettlebell and Smith-machine lifts, cable and machine exercises, and body-weight
  variants. That is 280 exercises, up from 36.
- **Provisional ranks are labelled.** Where no published standard exists, the rank is estimated
  from the main lifts and marked "Provisional".
- **Each exercise says how to enter the weight**, such as per dumbbell, the bar and plates, or
  one stack per side. You see this with the rank and while logging a workout.
- Ranks are still behind a flag and the standards are a draft for review.

## 2026-11-13: Monthly strength tournaments (internal only)

- **Join a lift's monthly tournament** from its statistics, from the 20th of the month before.
  You choose the men's or women's category and see exactly what your group will see, the
  closing and grace times in your own time zone, the 12-month retention and that there are no
  prizes, before agreeing.
- **Groups of 3 to 100 at a similar rank** are set when enrolment closes on the 1st (00:00 UTC).
  Your group shows names and photos only; blocked members appear as "A member".
- **Withdraw any time**, and you leave the group at once.
- **Scored on strength, with a little credit for improving.** Your best valid set of the month
  counts, raised by up to 5% for beating your best of the 90 days before. More sets or workouts
  add nothing, and exact ties share a place. Your group sees places and scores; only you see how
  yours was worked out.
- **Live standings, then final results** three days after the month ends, with a notification.
- Notifications when enrolment opens and when you get a group.
- Behind the `tournaments` flag; off in production.

## 2026-11-13: Strength ranks for more lifts, machines included (draft standards, revised)

- **Ranks for about 35 lifts**, up from 11: squat, deadlift and bench variants, Romanian deadlift,
  hip thrust, dumbbell presses and rows, and the common machine and cable lifts (leg press,
  pulldown, cable row, chest press, leg extension and curl). Machine ranks are marked as rougher.
- **Thresholds revised from published research and coaching standards**, still a draft for review.
  Ranks you already see may move.
- **Hard sets in one workout add a little**: +1% for each one after the first, up to +5%. The rank
  explains how much.

## 2026-11-13: Strength ranks for standard lifts (draft standards)

- **See your rank on a lift.** An exercise's statistics now show a strength rank for the standard
  barbell lifts, pull-ups, chin-ups, dips and push-ups: eight tiers from Initiate to Legend, each
  in three divisions, with how close you are to the next one and exactly which set it came from.
- **Current and highest ever.** Your current rank is your best set of the last 90 days; after 90
  days without one the lift shows as inactive rather than dropping. Your highest rank stays.
- It's personal: compared with published standards (men's or women's, your choice), never with
  other members. The standards are a draft for now and the app says so.
- The statistics view also links your account-wide training level.

## 2026-11-13: For You measurement, built and switched off

- **Settings → For You → Measurement** says plainly whether For You viewing is counted for you (it
  isn't: measurement is off for everyone), what would be counted, how long it's kept and who sees
  it, and lets you opt out in advance.
- For the developer, a *For You measurement* page shows daily totals (posts seen, video play,
  likes, comments, reposts, Not interested, visitors), with rates only over at least 30.

## 2026-11-13: Choose your interests for For You

- **Tell For You what you like.** Setup now has an optional step to pick a few interests, such as
  High protein, Baking, Quick meals or Running, and you can change them anytime in Settings → For
  You. They're private and only used for For You. With personalised ranking on, posts that match
  rise a little, with a line saying which interest they match; other posts still fill the feed.
- **Start For You fresh.** *Reset recommendations* in Settings makes For You forget your earlier
  likes, comments and reposts (they stay where they are). *Clear interests* is separate.

## 2026-11-13: For You learns what you like

- **For You is ordered for you.** Posts on topics and from people you like, comment on and repost
  rise, fresh posts and ones other members engage with get a boost, and every fifth post is
  something new from a smaller voice, so the feed never becomes only more of the same. Each post
  says why it's there in one line under the name; tap it for the full reasons and what they're
  based on: only your likes, comments and reposts from the last 90 days, never your food logs or
  health data. Until you've interacted with a few posts, For You stays newest first. Not interested
  and hiding an author always win. Behind the new For You ranking feature (internal and developer
  accounts for now).

## 2026-11-13: Exercise statistics

- **See how an exercise is going.** An exercise's history, from a workout or the exercise library,
  now opens with your best, how many sessions you've done, when you last did it and how the last
  four weeks compare with the four before. A chart shows the best of each session over 3 months, a
  year or all time, for est. 1RM, heaviest or volume (reps, time, distance or pace for other kinds of
  exercise). A *next record* card says what would beat your best and, for weighted lifts, one set
  that would do it. Your sessions follow, as before. Pounds work everywhere.

## 2026-11-13: Training levels

- **A level for how much you train.** Training's header shows your level and the XP to the next.
  Every finished workout with at least three working sets and ten minutes earns XP, with a little
  extra for more sets. The fifth and sixth workout of a week earn half, and a second workout in a
  day earns half, so steady training is what counts. Rest days never cost anything, and there's no
  top level: about five years of three workouts a week reaches level 100. Behind the new Training
  levels feature (internal and developer accounts for now).

## 2026-11-13: Diet tags on food posts

- **Posts say what kind of food they are.** A food post shows small tags such as *High protein*,
  *Low carb*, *Low fat*, *Low calorie*, *Low sugar* or *High fibre*. They're worked out from the
  nutrition facts it publishes, using the EU nutrition-claim definitions, and the rule shows when
  you hover or use a screen reader. A tag only appears when every number it needs is there.
  Hashtags in captions are recognised too, ready for For You and, later, Explore.

## 2026-11-13: Play starts your plan's next workout

- **Home's training Play button follows your plan.** If you trained from a plan in the last four
  weeks, Play starts that plan's next workout with its exercises and targets filled in, and its
  label says which one ("Start Workout B · Full body"). With no recent plan it starts an empty
  workout as before, and a workout in progress is still resumed, never doubled.

## 2026-11-12: Rest over, on your lock screen

- **A notification when your rest is over.** With notifications on, your phone tells you when
  it's time for the next set, even with the screen locked. +15s, −15s and Skip move or cancel it,
  and there is none in the middle of a superset. Turn it off under Notifications › Rest timer.

## 2026-11-12: A workout that follows you

- **Duplicate a day.** In the plan editor every workout has a Duplicate button, so Push / Pull /
  Legs becomes Push, Pull, Push (2), Pull (2), Legs in two taps.
- **See what's done and what's next.** Finished exercises turn green and fold into one line (tap
  to open one again and add sets). The exercise you're on has a ring and a "Now" label.
- **Rest your way.** Each exercise shows its rest; tap it to change it for this workout, and
  optionally save it to your plan. The timer has −15s, +15s and Skip instead of Hide.
- **Supersets.** Link exercises with "Superset with next" in a plan or during a workout. After A1
  you go straight to A2, then rest, then round again.
- **Your workout everywhere.** While a workout is open, a bar under the header shows the current
  exercise, the time and the rest countdown on every page. Tap it to get back to the workout.

## 2026-11-12: The rest timer stays in view

- **The rest countdown follows you down the workout.** While you rest, the timer stays pinned
  just under the app header as you scroll through exercises, on phones and desktop, and goes away
  when the rest is over or you tap Hide.

## 2026-11-12: A colourful Training

- **This week at a glance.** Training opens with a colourful header: workouts and time this week,
  and your newest record or how long since your last workout. The tabs have icons.
- **Colour by muscle group.** Push, pull, legs, core, arms and cardio each have a colour and an
  icon, used on exercise cards, in the exercise list and on the muscle filter chips, which now
  scroll sideways above the list.
- **A workout you can follow.** The open workout has a header in its plan's colour with the time,
  sets and a progress bar of planned sets done. Each exercise shows sets done against planned,
  and set types (warm-up, working, drop, failure) are coloured chips. The rest timer is coloured
  and counts down with a bar.
- **Plans as cards.** Every plan has its own colour and icon, with its next workout. A plan's
  page has a coloured header and its workouts are lettered A, B, C.
- **History by week.** Workouts are grouped under This week, Last week and earlier weeks, each
  with its workouts, sets and time, and each workout has a coloured date.

## 2026-11-12: Workout plans

- **Ready-made plans.** Training has a Plans tab with four plans written for this app: Full body,
  Upper / Lower, Push / Pull / Legs and Bodyweight at home. Open one and tap Start on a workout.
- **Suggested sets.** A plan workout opens with its exercises and planned sets as suggestions,
  pre-filled from what you did last time (or from the plan). When you did what it says, the tick
  logs it in one tap; otherwise change the values and log the set as usual.
- **Change it as you go.** Skip an exercise, swap it for another before you log it, remove it or
  add your own. Finishing keeps only what you logged, and History shows the workout under its
  plan name. Starting an empty workout works as before.
- **Your own plans.** Make a plan from scratch with New plan, or copy a ready-made one and change
  it: rename it, add, remove and reorder workouts and exercises, and set each planned set's reps
  (or a range like 8-12), weight, time or distance, rest and a note. Problems are pointed out
  before saving. Deleting a plan leaves the workouts you did from it in History.
- **What's next.** A plan shows when you last did each workout and marks the next one in order.
  With no workout open, the Workout tab offers the next workout of each plan you used in the last
  four weeks, one tap to start.

## 2026-11-12: Training badges and badge notifications

- **Training badges.** A first workout; 10, 50, 100 and 250 finished workouts; and 4, 12, 26 and
  52 weeks in a row with at least two workouts each. Rest days never break anything, and past
  workouts count.
- **Told when you earn one.** A notification says which badge you earned, or how many if several
  arrived together, and opens it on your profile. It shows in Activity too. Turn it off under
  Notifications → Badges; you still earn them.

## 2026-11-12: Badges on your profile

- **A Badges tab on your own profile.** It lists what you've earned from what you already do:
  - finishing setup, a first post, a first friend, ten friends, and being an early member;
  - logging streaks of 7, 30, 100 and 365 days;
  - streaks and totals of days within 10% of your calorie target.
- **You start with what you've already done.** Past history counts, and each badge is dated the
  day you actually reached it.
- **Earned is earned.** Deleting old meals, breaking a streak or unfriending someone never takes a
  badge away.
- **Progress is private.** "8 of 30 days" is visible only to you.
- **Show up to three badges under your name.** Tap an earned badge to show it on your profile,
  move it, or remove it. With three already shown, you choose which one to replace.
- **Everyone who can see your profile sees only the badges you chose to show.** Tapping one shows
  what it's for and when it was earned. Your other badges, progress, meals and workouts stay
  private. "View as" shows exactly what others see.

## 2026-11-12: Turning on Training works again

- **Choosing modules no longer fails with "moduleVisibility.property training should not
  exist".** Saving your modules sends every module's visibility, and the server did not know
  Training's. It now accepts it (always private, like EPAM), and choosing all nine modules at
  once works too.

## 2026-11-12: Training in pounds, and loads from your weigh-ins

- **kg or lb.** The gear on Training sets your weight unit (and the default rest). Every weight
  is shown and typed in it; switching shows the same lifts converted and changes nothing you
  logged.
- **Bodyweight and assisted sets show the load they moved**, e.g. "85 kg load · from weigh-in
  1 Nov", using your weigh-in from Food on or before that day. Without a weigh-in you see your
  reps and nothing made up.

## 2026-11-12: Training on Home

- **A Training card on Home**: workouts and time this week, then your newest personal record from
  the last two weeks, or how long since your last workout.
- **Start or resume from Home.** The card's one button starts a workout and opens it, or takes you
  back to the one in progress.

## 2026-11-12: Training: progress and personal records

- **Exercise history.** Every exercise shows your sessions newest first, with each one's sets,
  best set, total volume and an estimated one-rep max. Open it from the clock icon on an exercise
  in your workout, or from the exercise's details.
- **Personal records.** Heaviest, best estimated 1RM, most reps (at a weight or heavier), longest
  time and distance, fastest pace. A set that beats your earlier best gets a **PR** badge as you
  log it. Fix or delete a set and the records follow; warm-ups never count.
- **Estimates say how they were worked out**: "est. 1RM 116.67 kg · Epley, from 100 kg × 5".
  Pull-ups and other bodyweight work use your latest weigh-in from Food on or before that day,
  and say so.

## 2026-11-12: Feature access shows real values for groups

- **Groups have no hidden defaults.** For All production users and All internal users, every
  feature now shows Enabled or Disabled, the value those accounts actually get, and you set it.
  The "Built-in default" option is gone.
- **Individual accounts show what they inherit.** "Group default" now says whether that is on or
  off for the account's group.

## 2026-11-12: Training: your own exercises and machines

- **Better exercise search.** Names that start with what you type come first, then whole words,
  then the rest, and exercises you did in the last 90 days are marked "recent" and listed first.
  Filter by muscle and equipment.
- **Create your own exercises** when the catalogue lacks one, with other names search will find,
  muscles, equipment, how it is measured, steps and a photo. Only you see them.
- **Your machines.** Add the specific machines at your gym (name, brand, photo, what they are used
  for). When you add an exercise to a workout you can say which machine you used, and change it
  later from the exercise's card.
- **An Exercises tab** to browse the catalogue, open an exercise's details, and edit or delete your
  own. Deleting something a past workout uses archives it instead, so your history stays intact.

## 2026-11-12: Your profile, one way, one tap away

- **Your profile looks the same however you get there.** Tapping your own name on a post used to
  show your profile as a stranger would see it; it now opens your real profile.
- **Profile is the last tab.** It replaces Menu; the ☰ button at the top of your profile opens the
  menu. The friend-request badge moved onto the Profile tab.
- **Profile photos.** Tap the circle on your profile to add one; it shows on your posts, comments,
  chats and in people lists. Photos are cropped square and stripped of location before upload.
- **A tidier header.** View as, Share, Edit and Menu are icons on the header instead of a row of
  buttons, and your friend count links to Friends. On other people's profiles, only Add friend or
  Message is a button; Mute, Unfriend and Block are under "…", and Unfriend and Block ask first.

## 2026-11-12: Training, first version (behind a flag)

A new **Training** module for logging gym workouts, on for the internal cohort only. Start a
workout, pick exercises from a catalogue of about 870, and log each set as you go: weight and
reps, bodyweight or assisted reps, time, or distance and time, with an optional set type and RPE.
Each exercise shows what you did last time, the next set starts from your last one, and a rest
timer runs after every set. If the signal drops, sets wait on screen and are sent when it comes
back. History lists past workouts, and any of them can be opened and corrected. Records, the Home
card, kg/lb and your own exercises and machines come next.

## 2026-11-12: Not interested, in For You

A post's menu in For You has **Not interested** and **Hide {name} from For You**. The post (or
everything from that person) leaves For You straight away, with an Undo right there. It changes
nothing else: they still show in Friends, on their profile and through links.

## 2026-11-12: For You and Friends on Home (behind a flag)

Where the flag is on, Home's feed has two tabs under the widgets. **For You** opens first and
shows public posts from people across Life Portal who chose to be found; **Friends** is the feed
you had before. Each tab keeps its place and its page when you switch, and Home remembers which
tab you were on until you close the app. The tabs scroll away with the feed rather than sticking
to the top, which left a hollow band under the iPhone status bar.

## 2026-11-12: For You feed API (behind a flag)

A new feed source finds public posts from people across Life Portal, newest first, for the
coming For You tab. Only people who turned on "Let people find me" appear in it, and never
anyone you blocked, who blocked you, or whom you muted. It is off for everyone outside the
internal cohort while image moderation does not exist. Nothing on screen changes yet.

## 2026-11-07: Your foods as cards

The Foods tab shows your foods as a grid of cards instead of lines of text: a large photo (or, for
a food without one, a big icon on a tint of its main macro), the calories per serving, a bar of
where those calories come from, and protein, carbs and fat in their colours. Tap a card to edit
it; the star, share, edit and delete buttons sit on the card. All, Favourites and Archived chips
replace the "include archived" checkbox.

## 2026-11-07: A tidier Log food window

The Log food window fits on one phone screen. The meal is a row of icons (sunrise, sun, moon,
cookie), and the day sits beside the title: arrows step a day, the label opens the calendar, and
anything but today is highlighted. Pressing the food box opens a list with each food's photo — or
an icon guessed from its name, tinted by its main macro — plus its calories and macros, and the
chosen food folds into a card. A food you cannot find can be added straight from the list, with
the name already typed. Servings and amount share one line, servings has −/+ buttons in half
steps, and a newly chosen food starts at one serving so the rings show it at once.

## 2026-11-07: See your day before you log a meal

The Log food window now shows four rings — calories, protein, carbs and fat — for the day as it
will be after the meal: solid for what you have already eaten, a softly pulsing extension for
this meal, with the target, how much it adds and what is left. The meal's part turns red when it
takes you over a target. Correcting a logged meal counts it once, not twice.

## 2026-11-05: The same macro colours everywhere

Calories are green, protein purple, carbs blue and fat amber on the Home widget, the Food page,
the week chart, posts, share images and link previews. Before, the widget and the Food page each
had their own colours (fat was green on Home).

## 2026-11-05: Share to Instagram, TikTok, WhatsApp and more

The Share sheet has a **Share to** row. Instagram and TikTok get a Story-sized image of the post:
the photo, the title and the macro rings. WhatsApp, Messenger, Facebook and X share the link, and
**Save image** keeps the picture. Images are offered for your own posts and for public ones.

A link to a public post now shows a preview card in chats and social apps, with the photo, title
and macros. Links to friends-only or private posts show only "A post on Life Portal".

On a friend's post with food, **Save foods** in the Share sheet copies its foods into yours.

## 2026-11-05: Reposts

Share → **Repost** puts a friend's post on your wall and in your friends' Home feeds, with
"↻ you reposted" above it. Tap **Reposted** to take it back. The post keeps its author's audience:
someone who can't see the original never sees your repost, and if the author deletes it or makes
it private, reposts disappear too. Authors get a "reposted your post" notification, with its own
toggle in notification settings.

## 2026-11-05: The camera stops asking every time

The camera on the new post page asks for permission once per session instead of every time it
opens, and the **+** in the tab bar is wider. It also asks for the microphone right after the
camera, so holding the shutter for your first video records straight away.

A post has three buttons now: Like, Comment and Share. Share opens a sheet with your recent
chats (tap one to send the post), Copy link, and More… for the phone's own share menu.

## 2026-11-04 — New post page with the camera, and new foods from a photo

The tab bar is now Home, Messages, **+**, Search and Menu; Friends is in the Menu. The **+** opens
the new post page: what you write is on top and the camera is live underneath. Drag the camera up
to fill the screen or down to put it away. Photos and videos you take go straight into the post.

**New food** lets you type a food right there: name, portion, calories and macros, shown as rings
under the photo. Choose whether to save it to your foods and whether to log it as the current meal,
then save it, post it, or both. You can do this with or without a photo.

Foods can have a photo of their own, added in the Food form. It shows in your list, in the food
picker, and on the food when you post it. In posts, a photo and its food are now one card.

## 2026-11-04 — One way to post, with photos and video

The header has a **+** on the left that opens a new post from anywhere. LifePortal sits in the
middle; your name is gone from the header (your account is in the Menu tab).

A post no longer has to be about food. Write something on its own, add up to ten photos from your
library, or open the camera: tap the shutter for a photo, or hold it to record a video of up to
30 seconds while a ring fills around the button. Photos upload while you write, with a ring
showing progress, and are cleaned of location details before they leave your phone. The **+** in
the composer adds something from Food: a logged food, a meal, a whole day, a food, a saved meal or
your whole database, previewed exactly as it will be shared. The share buttons in Food open the
same composer with that item already attached.

Photos and videos appear in a carousel you swipe through; videos play silently while on screen,
and a tap turns the sound on. A post shared into a chat shows its first photo.

## 2026-11-04 — Sharp header in the iPhone app

In the installed app on iOS 26 and later, the header's logo and buttons sat under a blur that iOS
draws across the top of Home Screen web apps. The header now leaves room for that blur, so its
contents stay sharp. The same applies to a conversation's header. Browser tabs are unchanged.

## 2026-11-04 — Tabs stay where you left them

Home, Messages, Search, Friends and Menu now stay open in the background. Scroll down Home, move
to Messages or open a widget, and coming back finds Home exactly where you left it. Swiping
between tabs no longer nudges the page down when it lands. Tapping the tab you're already on
scrolls it to the top. Inside a conversation the app's header is gone; the chat's own header
(back, the person, mute) is the only one.

## 2026-11-04 — Messages tab and swiping between tabs

Messages moved from the header to the bottom tabs, right after Home, with the unread count on
the tab. The inbox no longer has a title or a box around it: your friends sit along the top as
round avatars (tap one to start or open a conversation), and conversations follow as plain rows.

On a phone, swipe left or right on Home, Messages, Search, Friends or Menu to move to the next
or previous tab. The next tab slides in under your finger, already loaded. A swipe that starts
on something that scrolls sideways, such as the widget carousel or the friends row, scrolls that
instead, so flicking through widgets never changes the tab.

## 2026-11-03 — Messages

You can now message your friends. Tap **Message** on a friend's profile, or use the new message
icon in the header to open your inbox. Messages appear within a few seconds while the
conversation is open, and your last message shows "Seen" once your friend has read it. You can
unsend your own messages, mute a conversation, and share a food post into a chat with the new
**Send** button. The post's audience still decides who can open it. New messages notify you
when the conversation isn't open, one notification per conversation. Turn on **Show message
previews** in Notifications to see the text. Messages are behind the `messages` feature flag
(on for internal accounts).

## 2026-11-03 — Push notifications and Activity

With notifications turned on, you hear about friend requests, accepted requests, and comments
and likes on your posts, including on iPhone from the Home Screen app. Tapping a notification
opens the app on the right screen. Bursts of likes are grouped ("Ana and 4 others liked…").
Notifications show names and what happened, never food, weight or money. Comment text appears
only if you turn on previews.

The app offers notifications after you send a friend request, publish or comment, never when
it opens. In Safari on iPhone it explains how to add the app to the Home Screen first. Menu ›
Notifications has a main switch, a switch per type, comment previews and your devices. A new
bell in the header opens Activity, and the app icon shows how many items you haven't seen.
Signing out stops notifications on that device.

The feature is behind the `push` feature flag (on for internal accounts) and needs the three
VAPID keys in the API's environment.

## 2026-11-02 — Likes, comments and sharing on posts

Food posts now have Like, Comment and Share in their footer. Comments can be deleted by
whoever wrote them and by the post's owner. Comments from people you have blocked, or who
blocked you, are hidden. Share opens the phone's share sheet, or copies the post's link; the
post's audience still decides who can open it. The post header also has a quick audience
switch.

## 2026-11-02 — Home widgets follow your finger

Swiping between Home widgets now tracks the finger one-to-one instead of racing ahead of it.
The widget you leave switches to its compact view as soon as you start swiping, and the
next one shows its full view only after it has settled, so nothing jumps while the cards
resize.

The widget strip is shorter (184px, was 216px) and every widget was refitted to it. The food
card drops its activity-adjustment line and its duplicate "set goals" alert. While scrolling
the Home feed, the bottom tabs now hide and return together with the header. On phones the widget strip
now runs almost edge to edge, with a 2px gutter instead of 16px.

A widget you swipe to now expands the moment it lands instead of after the snap has fully
stopped. On the food widget the calories ring glides and grows between its small and full
positions while protein, carbs and fat slide out from behind it one after another. The small
food card no longer has a + button.

## 2026-10-21 — Fix assistant sign-in in the browser

Fixed the “Invalid form origin” error after submitting the assistant sign-in page,
including connections started from Claude. Browser form submissions now retain the origin
required by consent validation; cross-origin requests remain blocked.

## 2026-10-18 · First-time ChatGPT beta setup

AI Assistant Setup now walks invited testers through creating their own ChatGPT connection,
with a copyable server URL, OAuth choices, personal account sign-in and iPhone setup help.
It no longer assumes the owner's private plugin is already available to a new user.

## 2026-10-18 — Sign in to connect an assistant from your phone

Life Portal now supports an OAuth sign-in and approval screen for nutrition assistants.
After enabling it on the server and updating the plugin connection, connect from ChatGPT on
an iPhone with your Life Portal email and password instead of copying a token. Connected
assistants can be disconnected from Settings → AI Assistant. Existing manual tokens still work.
MCP sessions now verify credentials and account ownership on every request.

## 2026-09-04 — Sell shares, and say where the money goes

Each purchase on the Stocks page now has a *sell* action: how many shares (part of a lot is
fine), at what price, on what day — and, in the same dialog, where the money goes. All to your
balance, all earmarked for a loan, or split: pick the loan and say how much of the proceeds it
gets, and the rest lands as spendable cash on the sale day. The earmarked share is set aside for
the debt rather than counted as free money; record the actual repayment on the Debts screen when
you send it, as before.

## 2026-09-04 — Tell the app the salary landed early

Salaries rarely land on the scheduled day — a weekend or a holiday moves them forward. Each income
row now has *landed on another day?*: pick the payday that moved and the day the money actually
arrived, and everything recalculates around the real date — the projected balance rises on that
day, "next salary" skips an occurrence already received, and the free-money window closes on the
real arrival instead of the calendar one. It moves the payday, never duplicates it, and an *undo*
in the same dialog puts it back.

## 2026-09-04 — A hand-entered payment can now name its card

A transfer entered by hand used to make the missing-message check cry wolf: the card's next
balance reading moved by money the chain knew nothing about. The *card last four* field now shows
when editing any payment, not only when adding one — put the card on the transfer and the gap
closes; clear the field and the payment leaves the chain again. (Adding the card at entry time
always worked; now it can be fixed after the fact.)

## 2026-09-04 — One tap to make a split add up

When confirming a payment across several allowances, editing one amount left you doing arithmetic
for the others. Each row now offers *put the remaining X here* (or *take the extra X off this
row*, when the split overshoots) so the second field levels itself.

## 2026-09-04 — The edit form no longer hides behind the payment list

**Fixed:** pressing *edit* inside "Every payment" opened the edit form underneath the list it was
opened from. It now opens on top, and Escape closes only the top-most dialog instead of the whole
stack.

## 2026-09-01 — A dollar payment is no longer a "missed message"

**Fixed:** paying in a foreign currency on the lari card put a permanent gap in the capture-health
panel. The bank prints the charge in dollars but the balance in lari, and the completeness check
deducted the raw dollar figure from the lari balance — so every such payment looked like money
that left the account without a message. Foreign payments are now converted at the National Bank
of Georgia rate for the day they were made, with a small allowance for the bank converting at its
own card rate; a real missed message still shows at its full size.

## 2026-09-01 — Pull down to refresh

The page now refreshes the way the feed apps do: pull down at the top — or just keep dragging,
or flick hard enough, when a scroll reaches it: the top bounces, and a bounce past the threshold
refreshes without a second gesture. The ring fills as you
pull, a small tick (on phones that have one) says when to let go, and releasing refetches
everything on the page — no reload, no lost scroll position elsewhere. The header also casts a
soft shadow once content scrolls under it, and no longer follows the page when the top is
overscrolled — the browser's rubber band is off, and the pull gesture is what lives there now.

## 2026-08-30 — The shortcut works however your phone formats dates

**Fixed:** the very first real message from a correctly set-up shortcut was rejected, because iOS
sends its date variable as human-readable text unless told otherwise, and the server insisted on a
machine format — losing the message over a cosmetic field. Any date format is accepted now; one
the server cannot read just files the payment under the moment it arrived, seconds off at most.
The setup instructions also show how to set the variable to ISO 8601 for exact timing.

**Also fixed before it ever bit:** the day a payment belongs to was computed in the *server's*
timezone, which is UTC in production — an early-morning payment (before 8am Tbilisi) would have
been filed a day early. The day now comes from the timestamp's own wall clock, wherever the
server runs.

## 2026-08-30 — A lari lunch no longer wears a dollar sign

**Fixed:** a budget line entered in one currency was shown with the display currency's symbol on
its raw number — a ₾8.28 lunch read as $8.28 — and the "≈ /month" totals on the spending panels
and the per-category breakdown added raw lari to raw dollars, producing figures that meant
nothing. Every row now shows its own currency (the converted view lives on the bar beneath it),
and every total converts each line at today's rate before summing.

## 2026-08-30 — A day now says what it spent, not just what it paid

The date panel used to answer only the bank's question — how much money left the account that day.
It now also answers yours: **how much that day actually consumed**, whichever day paid for it. Milk
bought once spends across every breakfast it covers, so a quiet day can still have spending, and a
₾7.67 shopping day can have spent only its own slice. The two figures sit side by side as *paid
out* and *spent*, with the day's slices listed underneath — each saying which payment it came from
and when that was paid.

## 2026-08-30 — The comma key now types fractions

On a Georgian keyboard the iPhone's number pad offers a comma where the decimal point should be,
which made fractions impossible to type into any amount field. Typing a comma now simply becomes a
decimal point, everywhere — money, portions, body weight.

## 2026-08-30 — One money page

**The Spending page has merged into Free money.** They were always the same question — where is my
money, where is it going, what have I kept — and now one page answers it.

What changed, walking down the page: the four headline tiles are now *on hand now*, *used against
allowances*, *saved this month* (with your all-time saving underneath) and *monthly net*. The chart
lets you choose how far ahead to look, marks today, and draws the past from your **actual**
payments and the future from your plan. Picking a date now works for past days too, and shows the
real payments of that day — labelled confirmed, projected or planned — beside the transfers and
one-offs. "Where it goes" shows what you have actually spent per category against what you
budgeted. Your daily, weekly, monthly and yearly spending panels now fill up as real payments
arrive (x of y on every line), can be dragged into the order the money should drain in, and carry
the app's budget suggestions inline. One-off spending keeps its month view and gains the unplanned
overflow — anything past every allowance lands there. Payments and capture health live in compact
side panels, and the projection itself is now anchored to reality: past days use what you really
spent, while transfers and one-offs the messages cannot see stay counted.

Runway is gone (never looked at), and "free to spend" folded into the date picker where it always
made more sense.

## 2026-08-29 — Spending: see where the money went, and what you saved

Building on the capture below, the app now works out **what each payment was probably for** and
keeps score.

**Your budget becomes a ladder.** The spending you already planned — daily meals, weekly fuel and
chores, the monthly lines — fills up in the order you choose. A payment fills the first allowance,
then the next; when the day's allowances are used up it draws on the week's, then the month's, and
anything past that is unplanned spending you can sort out later. One payment can split across
several allowances, so the bars always add up to what you actually spent.

**The app guesses; you decide.** Every payment shows where it probably went, marked plainly as a
guess. Confirm it and it becomes fact — across several allowances if one shop trip was part dinner
and part household, or only partly if you only know some of it. Say it was something else entirely
and it stops touching your budget at all, and one button turns it into a new budget line if it
turns out to happen every month.

**Confirming one payment rearranges the guesses around it.** Say the morning shop was the whole
day's food and the evening one moves to your weekly allowance by itself. And once you have said
what an allowance went on, no guess may quietly fill the rest of it — that unspent part is a saving
you earned, and it stays visible.

**Two things you can now say that most budget apps cannot.** That tonight's shopping was for
tomorrow, and that one carton of milk covers the next four breakfasts — the cost spreads evenly
across those days, so tomorrow correctly shows as already partly paid for. And where part of a
payment was never really yours — a shared dinner someone paid you back for — you can mark that part
as not really spent.

**It keeps score.** For any day, week or month: what you saved against your allowances, what you
spent outside them, and the net. Across all time: how much you have saved in total and how much of
it came from your daily, weekly and monthly allowances. Overspending shows as overspending, not as
zero.

**And over time it will tell you when your budget is wrong.** Once there is enough history — four
weeks for a daily line — it proposes a figure that matches what you actually spend, always saying
what it is based on. Nothing changes until you accept it.

## 2026-08-29 — Your card payments arrive on their own

**Your bank already texts you every time you pay. The app now listens.** Set up a shortcut on your
phone once — there are step-by-step instructions and copy buttons on the new Spending screen — and
from then on every card payment appears within a minute, with the amount, the shop and the card,
without you opening anything.

Anything it cannot read confidently is **kept exactly as it arrived and queued** rather than
guessed at, so a bank changing its wording is a short list to work through rather than a hole in
your records. Cash and anything your bank did not text about can be added by hand in seconds.

It also **checks its own arithmetic**. One of your banks prints the account balance in every
message, so when the balance and the payments disagree, the app can tell you a message went
missing and exactly how much it was for — rather than letting a lost text quietly look like a
cheap day.

Loyalty points, cashback and account balances are read but never counted as money, and a transfer
into your account is never mistaken for spending.

## 2026-08-29 — Choose the currency when you enter an amount

**Every amount you enter now has a currency picker**, sitting inside the amount box. Spending,
income, your balance, items to sell, debts and personal plans all have one, and it starts on your
display currency so most of the time there is nothing to change.

Until now no form offered the choice, so everything was recorded as dollars whatever you meant —
which is why a lari expense could end up stored as a dollar one. Existing records keep whatever
they were saved as; correct any that are wrong by editing them and picking the right currency.

Share lots deliberately have no picker: a share's currency is set by the exchange it trades on,
not by preference, and choosing the wrong one would quietly corrupt every position figure.

## 2026-08-29 — The currency setting now reaches every page

**Fixed:** the Stocks, Items and Personal pages showed their totals with a lari sign over dollar
amounts, and changing the display currency in settings did nothing to them. Only the dashboard had
been converting. All three now honour the setting, as does every figure they show.

Individual rows still read in the currency they were recorded in — a share bought at $114 says
$114, because that is what was paid. It is the totals that follow your display currency.

## 2026-08-25 — Everything in lari

**The app now reads in one currency, and it is yours to choose.** Figures recorded in dollars —
the salary, the loans, the EPAM shares, the budget lines — are converted and shown in Georgian
lari, so the dashboard's net position is finally one number rather than dollars and lari added
together. Set it back to USD or EUR in settings whenever you like; nothing about your data changes,
only what it is displayed as.

**Rates come from the National Bank of Georgia**, refreshed each morning, and every amount is
converted at the rate that applied *on its own day*. A figure you looked at last week still reads
the same this week, even though the lari has moved since.

Where a rate is genuinely unavailable, the amount is shown in the currency it was recorded in and
marked as such, rather than quietly presented as though it had been converted.

## 2026-08-24 — Put the widgets where you want them

**Hold a card and drag it.** The dashboard's cards are no longer stuck in the order the app picked.
Press and hold any card for a moment: the cards start to wobble, the one under your finger lifts,
and dragging it moves it — the others slide out of the way, the same as rearranging icons on a
phone. Let go and it stays there, on every device you sign in on.

There is a **Rearrange** button above the cards for when a long press is not what you feel like
doing, particularly with a mouse, and while rearranging a bar at the bottom offers **Reset order**
to put everything back the way it shipped. **Done** — or Escape — leaves rearranging. With a
keyboard, tab to a card and the arrow keys move it.

A card you have never arranged — a board you add tomorrow — appears at the end rather than pushing
its way into the middle of the order you set. Removing a board just removes its card; everything
else keeps its place.

## 2026-08-24 — Yesterday's breakfast, one tap away

**Every meal now offers what you usually eat then.** Under breakfast, lunch, dinner, snacks and
anything else there is an "Again" row of the things that slot has eaten over the last fortnight,
each one a single button: the food, the portion you actually had, and what it adds. Press it and
the meal is logged — no picker, no amount to type. Eat the same porridge most mornings and it sits
first every morning; a one-off from yesterday is offered too, just below the routine.

The portion offered is the one from the last day you ate it, and the calories are the food's
numbers as they are now, so the button says exactly what pressing it will add. Anything already
logged in that slot today drops off the row, and the row follows the day you are looking at — fill
in Saturday and it offers what the Saturdays before it ate, not what today ate.

## 2026-08-21 — The loading screen is the logo, and the app no longer zooms

**The boot screen is centred, and animated.** Opening the app used to show a small spinner and a
line of text pinned near the top of an otherwise empty page. It now fills the screen with the app's
own mark — the portal ring from the icon, with its gauge sweeping to 100%, holding for a beat and
unwinding back to 0% while the three bars inside breathe. It reports no percentage, because the boot
has no measurable stages and a fake number would be a claim the app cannot support. With
"reduce motion" turned on it shows the static logo instead.

**Zoom is off.** Pinch-zoom and double-tap zoom are disabled, and — the actual daily annoyance —
iOS no longer zooms in by itself every time you tap a text field: form controls are 16px on touch
screens, which is the threshold above which it leaves the page alone. Nothing needs magnifying to
read, and a stray pinch no longer leaves the app sitting off-centre with no browser chrome to
reset it.

## 2026-08-18 — Today's balance is calculated, not remembered

**"On hand now" was showing the figure you last typed in**, not what you have today. It is now the
reconciliation rolled forward through every salary, expense and sale since — so the salary that
landed on the 7th is in it — and it is marked as the estimate it is, with the confirmed figure and
its date underneath. The "Update balance" form opens on that projected number so you only have to
correct it.

**"On this plan you run out of money on …" no longer points at the past.** It only reports a
shortfall from today onward; the stretch between your last reconciliation and today already
happened.

**Debts now tell you when the ledger has fallen behind the plan.** If scheduled repayments have
fallen due with no payment recorded, the loan shows how many and how much, and what you would owe
if they all went out as planned — with a one-click prefilled way to record them. Outstanding itself
still counts only payments you have recorded: a plan is an intention, and assuming it was followed
would understate a real debt.

## 2026-08-18 — Free money: spending split by cadence, and a day-detail panel

Recurring spending was one flat list where a daily habit sat next to a yearly premium. It is now
four panels side by side — **Daily, Weekly, Monthly, Yearly** — each with its entry count and
monthly equivalent (labelled as the estimate it is), plus the total across all of them. A
"No schedule" panel appears only if a recurring row somehow has no recurrence, so nothing is hidden.

**One-off spending** has its own section with a month chooser: pick a month, step through with
‹ ›, or jump to any month that has entries, and see just that month's one-offs and their total.
Paused rows are shown but excluded from the total, matching the projections.

**State on a specific day** is a new panel: opening, in, out and closing balance for the day you
pick, then everything that lands on it — salary, recurring spending, one-offs and cash from things
you sold, each labelled with what put it there. **Any date works, including past ones.** Balances
only exist from your last reconciliation onward, so for earlier days the two balance figures read
"—" and you still see everything that moved.

Each cadence panel has a **`+`** that opens the add form already set to that cadence, and the
one-off panel's `+` dates the new entry into the month you are looking at. Empty panels offer the
same button instead of just saying nothing is there.

**Changing the date no longer reloads the page.** The planning panel used to refetch everything
for the new date, which blanked the whole screen to a spinner; the three numbers are now computed
from the projection already in hand.

**Selling something now shows up as money in.** Marking an item sold, or selling shares from a
lot, produces a one-off inflow in the projection and in the day panel — derived from the item or
lot itself, so there is nothing extra to record and nothing that can drift out of step. Proceeds
you earmarked for a debt are deliberately left out of the cash figure, because the Debts screen
already counts them; a fully earmarked sale is listed at $0 with a "to debt" tag rather than
hidden. And a sale no longer counts as a payday, so it cannot make "due before payday" look
smaller than it is.

## 2026-08-03 — Fixed a dev-server port clash

`npm run dev` started the API and the web app on the same port. `PORT` is read by both NestJS and
Next, so a single value made whichever started second fail with `EADDRINUSE`. The API now reads
`API_PORT` (falling back to `PORT` for managed hosts) and the web ports are pinned to 4200, so
they cannot collide. **Rename `PORT` to `API_PORT` in your `.env`.**

## 2026-08-03 — Initial build

The whole portal, end to end: eight widgets with summary cards and detail pages, wired together.

**Debts** — many loans with an explicit repayment priority. Payment history, repayment plans, and
three payoff scenarios ("Everything sells at target", "Realistic", "Salary only") each listing
what it assumed. Seeded with the real friend loan: $17,000 borrowed, $10,500 outstanding.

**Free money** — reconcile your balance, record income and recurring or one-off spending, then see
a day-by-day projection and, for any date you pick, the three numbers that matter: what you will
have, what is due before your next salary, and what is genuinely free.

**Items to sell** — three price points per item (asking, realistic, walk-away), statuses from
draft through to sold, buyer interest, and earmarking of proceeds to a specific debt. Marking
something sold can record the payment against that debt in the same step.

**Stocks** — holdings as individual purchases so the same share bought twice keeps both cost
bases. Live prices from Finnhub with graceful fallback to manual entry, your own target prices,
and a suggested target that shows its full arithmetic. The EPAM share plan is projected forward:
$2,880 every six months at 15% off the lower of the 1 May and 1 November closes.

**EPAM** — direct reports with attention states and the reason behind each one, 1:1 tracking with
an overdue flag, a promotion-points log for interviews, referrals and staffing help over a rolling
six months, and a review-evidence log.

**Client project, SoulArt, ShopIt** — prioritised task lists with notes; the client project also
keeps review evidence.

**Personal life** — activities, date nights, trips and goals, with travel history. A plan with a
cost and a date can add itself to your budget automatically.

**Dashboard** — every widget as a card with at most three numbers, a net-position figure, and a
cross-widget attention feed (salary landing soon, negative free money, a debt with no guaranteed
plan, stale share prices, people needing attention, overdue 1:1s, a plan this week).

**Food** — what you ate today against what you should eat. Log a meal in three taps from the
dashboard itself, or from any of breakfast, lunch, dinner, snacks and anything else, choosing
servings or grams and seeing the calories and macros before you commit to them. Your own food
database, entered from the packet either per serving or per 100 g, or imported by name or barcode
from Open Food Facts — and still fully usable by hand when that is unavailable. Calorie, protein,
carb and fat targets worked out from your height, age, weight, activity and one of six goals —
including body recomposition, for losing fat and building muscle at the same time, each
figure showing the equation and inputs behind it, with warnings when a goal asks for a deficit
deeper than is useful. Weigh-ins are dated, so the targets follow your weight and the trend is
drawn for you. The week is shown beside the day, because that is what actually moves the scale, and
a cheat day you set gets a countdown, a priority list of what you want to eat, and the calories
banked from the days you came in under.

The food database starts with the eleven things you actually eat — the Fresco chicken meals, both
protein shakes, the Go On bar, grilled chicken breast, buckwheat, and eggs — loaded by
`npm run seed:foods`, which is safe to re-run.

**Install it on your phone** — Life Portal is now a proper app: add it to your home screen and it
opens without browser chrome, with its own icon and splash screen, and still loads the shell when
the connection drops. It caches no data of yours to do that. The mobile layout was rebuilt at the
same time: no more sideways scrolling, and the eleven widgets live behind a menu button instead of
four rows of wrapped links.

**Under the hood** — full authentication with rotating refresh tokens, every API route guarded by
default and scoped to the owner, integer-cent money throughout, calendar dates as strings to
sidestep timezones, and 182 unit tests over the projection, scenario, ESPP, target-price and
nutrition logic.

## 2026-10-22

- Added resumable setup for modules, privacy, Home order and a first Food action.
- Added Home/Menu navigation and reusable module/privacy settings.
- New accounts get Food by default; developer controls release access by cohort or individual.
- Money now has one Home card; Projects have one overview and a creation screen.
- Home loads only selected modules and omits unrelated financial headlines and alerts.
- Existing sharing defaults migrate to private once; existing tracking data stays intact.

### Social foundation

- Added internal/developer social feature access with cohort/user controls.
- Added profiles, opt-in search, mutual friend requests, unfriend, mute and block/unblock.
- Friends show up to two audience-approved widgets in Home order; profiles show shared About.
- Added friend/stranger previews and links to Food's separate privacy controls.
- Blocked users no longer appear in public food browsing or imports in either direction.
- Private data stays private by default; new social profiles are hidden from search until opted in.

### 2026-10-22 — Wall and food posts

- Added fourth-tab Wall and profile Posts/About tabs behind the foodPosts feature flag. Production remains Food-only by default.
- Share one logged food, a whole meal/day, a catalogue food, a combination/saved meal or an immutable food-database collection. Preview and choose Only me/Friends/Everyone before publishing; Only me is the default.
- Edit post text/audience or delete it; current friendship, blocking and feature switches govern access. Muting removes updates from Wall.
- Import selected foods privately with duplicate previews, preserved provenance and optional whole-meal saving. Repeated/concurrent imports are safe and never log meals.
- Added report-and-hide and developer removal controls. Previously imported copies remain independent after a source post changes or is removed.

### 2026-10-22 — Prevent accidental refresh while scrolling

Pull-to-refresh now requires a fresh downward drag starting at the page top and release beyond the threshold. Scrolling or momentum reaching the top, short pulls, canceled gestures and multiple touches no longer trigger refresh.

### 2026-10-31 — Light and dark appearance

Added an Appearance panel in Settings with Light, System default and Dark choices. Theme controls stay out of the main header and sign-in/register screens. The preference stays in this browser and applies before the first paint. Shared backgrounds, cards, text, borders, accents and chart furniture adapt to the palette; status text remains readable in light mode while nutrition progress fills retain their existing colors.

## 2026-10-31 — Food profile and activity

- Setup remembers each completed step and offers new food/activity questions with saved inputs.
- Everyday movement and exercise now have independent questions; preferences, timezone and day boundary remain editable.
- Food uses colorful calorie/macro circles and a separate activity adjustment with sync details.
- Added scoped Health receiver, revocation and freshness handoff. Apple Health installation is unavailable until the generated Shortcut is signed, checked on an iPhone and shared; estimates keep working.
- Home keeps the wall; duplicate Wall tab/button removed and old links redirect Home.

## 2026-10-31 — Health upload authentication and diagnostics

- Restored scoped Health-ticket authentication so Shortcut uploads reach their guard without a login JWT.
- Log upload arrival and response status before JSON parsing without printing request bodies or credentials.
- Local development can proxy API requests through the web app; Shortcut upload URLs resolve to the current origin when configured relatively. No tunnel is started by the app.

### Health payload validation diagnostics

Uploads rejected before the controller now log bounded schema field paths and failed validation rules. Health values, tickets and arbitrary payload keys stay out of logs; existing 400 responses and validation requirements are unchanged.

### Shortcut sample-array compatibility

Health uploads now accept a sample array encoded as JSON text by Shortcuts, while preserving nested field validation and size limits. This fixes the observed `samplesShape=string` rejection without requiring an installed Shortcut edit.

### Compact mobile Food view

- Keep Food tabs, sharing, assistant connection and Log food on one compact row; share a day from its date controls.
- Move Apple Health setup, sync controls and activity explanations behind the Activity adjustment info button.
- Hide the page-top sync banner on Food while retaining automatic sync and the manual fallback inside Health details.

- Keep a visible Sync action beside Activity adjustment; setup and detailed explanations remain behind Info.

## 2026-11-01 — Manual Health sync and resumable batches

- Remove automatic Shortcuts launches and browser-return callbacks. Refresh results when users return to their existing PWA.
- Keep Sync beside Activity adjustment and show Sync due after six hours without a successful receipt.
- Add resumable hourly query windows, split capped results, retry acknowledgements safely, and preserve unreceived known samples.
- Add complete manual iPhone Shortcut instructions; importing generated plist source is not required or supported.

### Generated Shortcut dictionary-state correction

Fixed an invalid field tag in the reference batching generator: `WFItemType=1` denotes a Dictionary, not a Number, and was paired with text state for sample values. The generator now consistently emits Text dictionary fields, which the receiver already validates and converts. Added a structural assertion to prevent that mismatch. Corrected output passes the local signer's loading stage; this environment still reports iCloud sharing unavailable, so signing and iPhone execution are not claimed verified.
