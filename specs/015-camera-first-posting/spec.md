# Feature Specification: Camera-first posting and food photos (posting v2)

**Feature**: 015-camera-first-posting · **Created**: 2026-11-04 · **Status**: Ready
**Input**: Move Friends into Menu and put a New post button in the middle of the tab bar. The new
post page sits outside the swipeable tabs and is split like ChatGPT's camera: a composer on top
and a live camera below, which can be dragged up to full screen or down out of the way. Captures
go into the composer. A post can carry a food from Food or a **new food** typed in place, with its
macros shown as rings merged with the photo. A new food can be saved to the database, logged as
the current meal and/or posted. Foods in the database can have a photo. Next (not here): an AI
button that estimates the macros from the photo.

## User stories

### US1 — The camera is one tap away (P1)
The tab bar is Home, Messages, **+**, Search, Menu. Friends moves into Menu (with its request
count). Tapping + opens the new post page full screen; swiping between the four tabs never lands
on it. The page opens with the composer on the top half and the camera live on the bottom half.
1. Dragging the camera up makes it full screen; dragging it down hides it, leaving the composer
   full screen with a small bar to bring the camera back.
2. Tap the shutter for a photo, hold it for a video of up to 30 s (a ring fills around it). The
   capture drops into the composer. A gallery button beside the shutter adds library photos.
3. Closing the page returns to the tab it was opened from, as it was.

### US2 — A new food from the photo (P1)
In the composer, **New food** opens a form: name, portion size and unit, calories, protein, carbs
and fat for that portion. As the numbers are typed, macro rings appear joined to the bottom of the
first photo as one card (no gap, rounded only on the outside). Without a photo the card stands
alone. Two checkboxes: **Save to my foods** (on) and **Log as <current meal>** (off, disabled
unless saving). The buttons follow them:

| Save | Log | Buttons |
|---|---|---|
| on | off | Save food · Save and Post |
| on | on | Save and log food · Save, Log and Post |
| off | — | Post |

Saving makes a food in the database with the photo as its picture. Logging logs one portion now,
to the meal the clock says (respecting the day-start hour). Posting shares the logged portion if
logged, else the food. Posting without saving shares the food without adding it to the database.

### US3 — Photos and food are one card everywhere (P2)
Any post with both photos and a food shows the carousel and the food's card joined into one
block. The food card shows calories with a ring split by protein, carbs and fat, and a ring for
each macro filled to its share of the calories.

### US4 — Foods have photos (P2)
A food in the database can have a photo: added, replaced or removed in its edit form, shown as a
thumbnail in the food list and the composer's food picker. A food created from a captured photo
gets that photo. Deleting a food (outright) deletes its photo.

## Requirements
- FR-001 The new post page is a route outside the tab set: no tab bar, no app header, no swipe.
- FR-002 The camera stream runs only while the camera panel is visible, and the microphone is
  asked for only when a video recording starts.
- FR-003 Opened from a share button in Food, the page opens with that item attached and the
  camera hidden.
- FR-004 One food attachment per post: picking a food replaces a new-food draft and vice versa.
- FR-005 A new food is created at most once per draft: a retried Post after a failure reuses it.
- FR-006 Logging requires saving. A food posted without saving never appears in the database.
- FR-007 A food photo is a copy of the captured file, so deleting the post never removes the
  food's picture, and deleting the food never removes a post's photo.
- FR-008 Food photos are private: signed short-lived links, only to the owner (the food list is
  the owner's own).
- FR-009 Macro rings show shares of calories (protein and carbs 4 kcal/g, fat 9), so they mean
  something without targets.

## Assumptions
- Portion units: g or ml (no densities). Default portion 100.
- Imported foods (from someone's post) don't copy photos; a picked food's photo is not added to
  the post automatically (both are follow-ups).
- On iOS the installed app may ask for camera permission again each time it is reopened; that is
  the platform's behaviour.

## Success criteria
- SC-001 From any tab, a photo is in the composer within two taps.
- SC-002 Create, log and post a new food with a photo in one flow, one tap at the end.
- SC-003 The four tabs still swipe as before; + never appears as a swipe target.
