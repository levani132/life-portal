# Spec 046: My Portal (draft, planning)

Asked by the owner on 2026-11-26, after pausing Pages. Roadmap item 5, decided 2026-11-22.

## Why

The app is called LifePortal, and "check my portal" should be literally true. Today a person's
profile is posts plus an About tab of small shared cards; the dashboard they see on Home is
theirs alone. The portal turns the profile into that dashboard, shown to others as far as the
person chooses: one page for a life (food and training now, more later), so a friend who opens it
sees how that person eats and trains, not only their posts.

Principles already decided (ROADMAP item 5):
- The person decides per module: private, friends or public. **Private stays the default.**
- Money is the person's choice too, later, with a plain warning (scams are built on it, and once
  public it cannot be taken back).
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

## Open decisions (for the owner)

1. **Public = who?** Signed-in members only (today's rule: no open-internet routes), or a portal
   link that also opens for people without an account? Recommendation: members only now; an
   open, narrow preview card for links later, like posts have.
2. **Portal order:** its own arrangement, or the same order as Home? Recommendation: its own,
   starting from Home's order.
3. **Training parts:** which may be shown (workouts per week, streak, records, level, rank)?
   Body weight never, as for posts. Recommendation: each opt-in, level and rank included.
4. **Money now:** hide money modules from portals until the warning flow exists (they are
   shareable today without one). Recommendation: yes, hide now.
5. **Food detail:** keep today's split (meals, targets, weight separately) and add "this week".
