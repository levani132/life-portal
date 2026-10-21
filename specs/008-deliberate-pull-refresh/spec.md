# Deliberate pull to refresh

Bug: scrolling upward could refresh immediately because momentum reaching the top armed refresh, and drags starting further down could turn into a pull without lifting.

Plan: remove momentum-triggered refresh; require a new touch starting at the page top, a downward pull beyond the existing threshold, then release. Short pulls, upward/sideways gestures, cancellation, multiple touches and nested scrollers must not refresh.

Tasks:
- [x] Restrict gesture eligibility and remove momentum refresh/bounce.
- [x] Nine gesture regression tests; full typecheck/lint/test checks and API/web builds pass.
