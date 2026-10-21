# Plan

1. Extend flags with social independently of module selection.
2. Add shared social contracts and pure audience/order/state policy tests.
3. Add an atomic unique-pair social graph, with no transport bypass of state transitions.
4. Add profiles, opt-in discovery and dedicated safe shared widget readers.
5. Apply blocks to existing public food surfaces via the graph's service.
6. Build Search/Friends/Profile screens and own profile/privacy preview controls.
7. Run policy tests, isolated multi-user HTTP/browser flows, checks/builds; update docs.

Collections: social_profiles keeps publishable identity separate from private users;
social_connections owns each pair's relationship/block/mute state atomically. Neither copies
tracking data or derived widget summaries. No new runtime dependencies.
