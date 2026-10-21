# Opt-in daily food diary and visible Wall

Show actual logged foods/portions and meal macros on a shared profile when an owner explicitly enables diary sharing. Keep the existing totals switch separate; add shareDiary=false for all accounts, including existing accounts. Food module selection, audience, current friendship, bilateral blocks and both accounts' feature access gate every diary read. Never include private entry/catalogue IDs, notes, targets or body metrics in the diary projection. Permit day navigation through today. Existing frozen food posts remain independent.

Plan/tasks:
- [ ] Add independent privacy preference and allowlisted nutrition-owned daily projection.
- [ ] Add authorized social read and profile day/meal view, with a visible sharing control.
- [ ] Verify privacy matrix, full user flow and checks/builds with isolated data.
- [ ] Restart the stale local API and verify posts routes on port 3333; keep the user's choices unchanged.
