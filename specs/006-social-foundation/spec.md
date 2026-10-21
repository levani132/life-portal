# Profiles, friendships and shared widgets

Status: Implemented. Next milestone of the approved social portal roadmap.

Internal/developer accounts can trial social connections behind a separate social flag.
Production accounts remain Food-only until the developer enables social access.

Acceptance:
- A user can create/edit a profile with unique username, display name, bio and opt-in search.
- Search returns only discoverable, social-enabled people and never account emails.
- Known profile links work without search visibility; private modules remain private.
- Mutual requests support send, accept, decline, cancel and unfriend with server authorization.
- Blocking in either direction hides profiles/search/shared widgets/public foods/imports,
  cancels the friendship/request, and unblocking never restores it. Mute is independent.
- Friends show up to two permitted widgets in Home order. Profile About shows permitted widgets.
- Widget reads use explicit shared DTOs, never owner's dashboard/alerts/IDs/quick actions.
- Owner and viewer feature availability, selection and audience all constrain shared widgets.
- Food intersects widget audience with existing meal/target/weight switches; missing switches deny.
- Own profile offers friend/stranger previews. Developer never bypasses another user's privacy.
- Privacy/relationship/flag changes are checked on every read; social responses are no-store.
- Search, Friends and Profile UI have useful empty/error states and paginated lists.

Deferred: Wall/posts/comments/reactions, photos, open-internet profiles and push notifications.
