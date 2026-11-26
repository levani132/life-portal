# Spec 046: My Portal

Asked by the owner on 2026-11-26, after pausing Pages. Roadmap item 5, decided 2026-11-22.

## Why

The app is called LifePortal, and "check my portal" should be literally true. Today a person's
profile is posts plus an About tab of small shared cards; the dashboard they see on Home is
theirs alone. The portal turns the profile into that dashboard, shown to others as far as the
person chooses: one page for a life (food and training now, more later), so a friend who opens it
sees how that person eats and trains, not only their posts.

Principles already decided (ROADMAP item 5):
- The person decides per module: private, friends or public. **Private stays the default.**
- Money stays out of portals for now (its modules are not open to members yet). No in-app warning:
  the terms cover what sharing money means (owner, 2026-11-26).
- Self-declared, and shown as such: nothing is presented as checked unless it was (imported
  workouts and Apple Health data are the one "verified" kind).
- The words follow: "Profile" becomes "Portal" in the tab bar, menu, sharing and links, and a
  portal has an address a person can send.

## What exists to build on

- `settings.moduleVisibility`: private / friends / public per module (missing = private), set in
  Privacy and sharing (`portal-preferences.tsx`), previewable with "View as" friend / stranger.
- Shared widgets (`SharedWidgetsService`): a title and at most three formatted stats per module,
  on the profile's About tab. Food has finer switches (meals, targets, weight) and a shared diary.
- **Training is not shareable at all today** (`UNSHAREABLE_MODULES`: epam, training).
- **Money modules are shareable today** as three-stat cards (cashflow, debts, stocks, items,
  personal, projects), with no warning. They are developer/internal only for now.
- Profile tabs: Posts, Badges, About. Pages show a profile too.

## Proposed slices

1. **Portal first, and the words.** The profile opens on the Portal (what was About, rebuilt),
   then Posts and Badges. "Profile" becomes "Portal" in the tab bar, menu, share sheet. A portal
   address: `/@username`.
2. **Real cards, not three stats.** Each module renders on the portal as a read-only version of
   its Home card, built from a projection the module owns (never its dashboard payload). Food:
   today and this week against target, logging streak; diary only if shared.
3. **Training on the portal.** A training projection: workouts this week, streak, recent
   records, level. Each part its own switch.
4. **"Who sees my portal" screen.** One place: each module's audience and its finer switches,
   with the friend / stranger preview beside it. Replaces the scattered controls.
5. **Arranging the portal.** Order (and what is shown at all) for the portal itself.
6. **Self-declared labels.** Entered by hand vs imported (Apple Health, a synced workout).
7. **Money, later**, behind a plain warning, one module at a time. Until then money is hidden
   from portals.
8. **Pages' portals** (later): a page's portal is its library (foods, recipes, plans, programmes).

## Decisions (owner, 2026-11-26)

1. **A portal opens without an account.** Someone with no account sees what is public on the
   portal's first view and one or two of the latest public posts; scrolling further or opening
   another tab covers everything with a popup to join or sign in.
2. **Its own arrangement, unlike Home.** No carousel: the widgets look the same as on Home, read
   only, laid out like iOS home-screen widgets (sizes on a grid), arranged for the portal alone.
3. **Training: rank too.** People want to share and compare ranks; workouts, streak, records,
   level and rank can each be shared. Body weight is still never shown.
4. **Everything has its own privacy setting.**
5. **Money:** no warning; already hidden from members. Addressed in the terms when it opens.
6. **Food adds "this week".**
7. **Pages' portals later.**

## Privacy rules for the open portal (slice 1)

- Only what the person made **public** is shown to someone without an account, and only if the
  person is findable by strangers (`discoverable`); otherwise the open link says the portal is
  private and offers to join. Pages are public by nature.
- The open view is one narrow, `@Public()` read of a portal by username: identity (name,
  username, photo, bio, page marks), public widgets, and the two newest public posts in the same
  narrow projection as the link preview. Nothing else is reachable without an account, and the
  popup is a nudge, not the protection: the server sends nothing more.

## Progress

- **Slice 1, done 2026-11-26:** Portal tab first, "Portal" in the tab bar, `/@username`
  addresses, the open portal for visitors with the join popup, sign-in back to the portal.

