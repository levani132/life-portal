# Plan

1. Extend the existing transient nutrition summary with carbohydrate/fat consumption, goals and
   target provenance, using current domain arithmetic. Amend widget presentation limit for the
   approved four-metric Food glance; management controls remain separate from module actions.
2. Reuse SortableGrid in a focus carousel with responsive compact previews, horizontal gestures,
   keyboard/button selection and accessible menus. Persist reorder/removal through existing APIs.
3. Add scroll-direction header behavior without moving widgets into sticky content. Reuse PostsList
   on Home and restyle PostCard previews without modifying access checks or publication behavior.
4. Verify domain edges, carousel states/gestures/menus/arrangement, responsive themes and real feed;
   run typecheck/lint/tests/build and document browser evidence and limits.
