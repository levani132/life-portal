# Feature Specification: Plans made of rules

**Feature**: `043-plan-rules` · **Created**: 2026-11-23 · **Status**: In progress
**Builds on**: spec 042 (meal plans, programmes), spec 001 (nutrition targets)

## Why

A meal plan today is a list of foods. Real advice is mostly numbers: "150 g of protein a day",
"under 2,000 kcal", "30 g of protein at breakfast", "1.8 g of protein per kg", "40/30/30". People
and pages (and their assistants) should be able to write any of that, simply, without a
dietitian with a strict plan hitting a wall; and anyone should be able to follow it and see it
in Food as advice they can follow or not. Food itself does not change: what was eaten is still
what was logged. Plans are advice laid over it.

## Decisions (owner, 2026-11-23)

1. **A plan is rules and/or foods.** Rules are numbers; foods are the lines spec 042 built. A
   plan may be only rules, only foods, or both, over one day or several days in rotation.
2. **Rules.** Each is *what* (calories, protein, carbs, fat), *where* (the whole day, or one
   meal: breakfast, lunch, dinner, snacks), and a *limit*: at least, at most, between, or about
   (with a tolerance). The number can be an amount, **per kg of current weight**, **per kg of
   target weight**, or a **share**: of the day's calories from a macro ("30% from protein"), or
   of the day's calories at a meal ("breakfast is 25% of the day"). Rules on the plan apply
   every day; a day of a rotating plan may add its own.
3. **Following, not activating.** A person follows any number of plans; each stays in their
   list and can be switched off and on. Plans from others are followed as the person's own copy
   (as spec 042 saves them), with **who recommended it** kept and shown.
4. **Combining.** Rules that measure the same thing in the same place combine: the higher of two
   floors and the lower of two ceilings, always saying which plan set the number. Foods from
   several plans all show.
5. **Conflicts warn, never block.** Following a plan whose rules cannot both be met with those
   already followed (at most 1,000 kcal and at least 2,000) asks first and names both. If the
   person goes ahead, both show, and whichever is not met says so.
6. **No partial following.** A plan is followed whole. Changing it means saving it as one's own
   and editing it. One button to follow, one to stop. A programme is followed whole as well: its
   training plan works as Training already does (Play suggests the next workout).
7. **The app's own targets are the default.** Daily rules from followed plans override the
   app's calculated targets wherever targets show. Food → You says the targets come from a plan
   and names it. Choosing one of the app's goals there while such a plan is followed warns that
   it stops following it. With no rule-bearing plan followed, the app's targets apply as before.
   A plan's number also beats a hand-typed override (owner, 2026-11-23): plan, then override,
   then the app.
8. **Target weight.** The profile gains a target weight. Rules per kg of target weight use it;
   later the app's own recommendation will use it too (lower than now: losing; higher: gaining;
   the same: maintaining or recomposition, which the goal still says).
9. **Shown well.** Rules are not a list on top: a daily rule shows on that macro's tile, a meal's
   rule in that meal's header, with the same macro colours and bars as the rest of Food.
10. **Later.** Rules about each food ("snacks under 10 g sugar", "no item over 600 kcal",
    "40/30/30 in every food"), shown as advice while choosing a food. Then fibre, sugar,
    sodium. Then sharing rules in posts and assistant tools for all of this.

## Slices

1. Rules on plans (plan and day level), plans with only rules, an editor that makes simple
   rules simple, target weight, following several plans with switching on and off, combining
   and conflict warnings, who recommended it, and rules shown in Food (tiles and meal headers),
   for any day.
2. Daily rules override the app's targets everywhere (Home card, You tab, sharing of targets),
   with the warning when choosing an app goal.
3. Food options ("one of these").
4. Per-food rules, shown while choosing a food.
5. Programmes as bundles of plans; posts and assistant tools carry rules.

## Constraints

- Integers only (principle 2): kcal whole, macros as mg, per-kg values as mg (or kcal) per kg,
  shares as whole percent.
- Nothing derived is stored (principle 3): what a rule resolves to, whether it is met and how
  rules combine are worked out on read by pure functions in `libs/shared/domain` with the day
  and the weights passed in (principle 5).
- A resolved number that used an estimate (a weight from a weigh-in, a share of a calorie
  target that is itself estimated) is labelled as such (principle 6).
- Pages keep and post plans with rules but never follow one (they have no diary).
