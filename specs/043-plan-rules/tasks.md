# Tasks: plans made of rules (spec 043)

## Slice 1
- [x] T001 Domain: `PlanRule`, validity, resolving a rule to numbers (amount, per kg current or target, share), whether a day meets it, combining followed plans' rules, conflicts. Tests.
- [x] T002 Schema: `rules` on `meal_plans` and on its days; plans with only rules; `source` (post, author) on copies; `targetWeightGrams` on the nutrition profile.
- [x] T003 Following several plans: switch on and off, conflict warning on follow, who recommended it.
- [x] T004 Editor: rules made simple (preset sentences, then the full form).
- [x] T005 Food: daily rules on the macro tiles, meal rules in meal headers, any day.
- [x] T006 Integration tests, docs.

## Slice 3 (built 2026-11-23, before slice 2, at the owner's ask)
- [x] T020 Food options: a line may have up to five other options; any one meets it; logged by choice; shared and copied (a recipe option becomes the reader's recipe); the assistant can write them.

## Slice 2
- [ ] T010 Daily rules override the app's targets everywhere; You says so; choosing an app goal warns and stops following.

## Notes on slice 1 (built 2026-11-23)
- Rules on posts and the assistant's `create_page_meal_plan` were brought forward from slice 5:
  they were small, and a rules-only plan could not otherwise be shared.
- The conflict check on following uses amounts only (no weights), so per-kg rules are not
  compared yet.
- Daily rules replace the app's target on Food's tiles only; Home, You and shared targets are
  slice 2.
