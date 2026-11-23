# Feature Specification: Eating and training together

**Feature**: `042-programmes` · **Created**: 2026-11-23 · **Status**: In progress
**Builds on**: spec 007 (food posts), spec 036 (training sharing), spec 041 (page content)

## Why

People come for both halves: what to eat and how to train. Today each half can be shared, saved
and copied, but never as one thing. This feature makes them travel together, for a person
sharing what works for them and for a page publishing a programme. Everything here is for
**people and pages alike**; a page still never logs anything.

## Slices

### Slice 1: one post, both halves (built 2026-11-23)

A post may carry a food attachment and a training attachment together: a recipe (or a food, a
day of eating, a set of foods) with the training plan or exercise it goes with. Each half is
previewed, frozen, shown, saved and copied by its own module, exactly as when it travels alone
(`NutritionPublicationService`, `TrainingPublicationService`): posts only stores both.

- The composer keeps one attachment when the other is added, and can attach an existing training
  plan ("Create and attach" → "One of my training plans").
- The assistant's `create_page_post` takes one food or recipe and one plan or exercise together.

### Slice 2: meal plans

A meal plan is a named set of days; each day has meals by slot; each meal is foods with amounts
or a recipe. New for people and pages.

- **Library.** Create, edit, delete in Food (people) and in the Library (pages). Totals per meal,
  per day and the plan's daily average are computed on read from the foods as they are now
  (principle 3): nothing derived is stored.
- **Using one (people only).** Pick a day of the plan and log it into the diary, whole or meal by
  meal. Logging takes the normal snapshot at that moment. A page cannot log.
- **Sharing.** A meal plan is published as a food publication of a new kind with its days and
  slots; a reader saves the foods and gets their own copy of the plan. Never logged for them.

### Slice 3: programmes

A programme joins a meal plan and a training plan under one name and one post: "8 weeks, lean
bulk". Published as one post with both halves (slice 1 carries it); copying gives the reader
both, linked. Insights later count saves and copies of each.

## Requirements

- **FR-001** A post with food and training shows both, and each can be saved or copied without
  the other.
- **FR-002** Neither half's snapshot is built by posts or taken from a request.
- **FR-003** Editing, deleting, audience, moderation and reposting treat the post as one.
- **FR-010** A meal plan stores foods and amounts by day and slot, and no totals.
- **FR-011** Logging from a meal plan is a person's action on their own diary day; no route opens
  it to pages.
- **FR-012** A published meal plan carries no private notes, targets or diary data, only foods,
  amounts, slots and day names.
- **FR-020** Copying a programme never starts a workout or logs a meal.

## Out of scope for now

Schedules that advance a plan day by day on their own, shopping lists, swapping one meal for
another across the plan, paid programmes.
