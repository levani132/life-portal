# Social connections and profiles

This milestone adds profiles, opt-in discovery, mutual friendships and shared widget previews.
Wall publishing is separate future work. All routes require a signed-in account and the current
`social` feature flag. Internal/developer accounts default on, production defaults off. Developer
controls can override the flag by cohort or user without changing their module choices.

## Data ownership

`social_profiles` holds only publishable identity: unique userId/username, displayName, bio and
opt-in `discoverable` (false by default), which governs being found by strangers: people search and, since 018, the For You feed (only discoverable authors' public posts are candidates). Keeping it separate from users prevents email, roles,
password/refresh-token hashes or other account fields entering social responses. Default handles
use `user-<id>`; handles matching that pattern are reserved to their own account. A known profile
link works even when search is off; audiences still apply. No anonymous/open-internet routes.

`avatarKey` (optional) is the profile photo's storage key under `avatars/<userId>/`. It never
leaves the API: every response that names a person (profiles, people lists, post and comment
authors, chat headers) carries a signed `avatarUrl` instead, signed per read after that read's own
check. A photo is identity, like the display name, so it is shown wherever the name is; there is
no separate audience for it. The browser crops it to the centre square at 512 px and re-encodes
it (`prepareAvatar`, which strips EXIF/GPS like every upload); the server copies the upload into
the profile (`MediaService.copyForAvatar`, images only) and deletes the previous file.

`social_connections` stores one unique canonical pair with pending/accepted/none state,
request sender and directional blockedBy/mutedBy arrays. One row makes accept/block/cancel
conditional atomic writes rather than conflicting mutations of mirrored friendship documents.
- Only the recipient may accept/decline; only the sender may cancel.
- Duplicate outgoing requests are idempotent. Opposite requests never auto-accept.
- Either party may unfriend; no third party can act on their pair.
- Blocking removes the friendship/request and mutes, and applies in both directions.
- Each actor can remove only their own block. Unblocking never restores a friendship.
- Mute is private to the viewer, preserves friendship, and is available to the later Wall.
  Muting someone also stops their notifications to you.
- `acceptedAt` is set when a request is accepted and unset whenever the pair returns to
  none. Activity uses it to sort "accepted your request". Rows accepted before it existed have
  none and simply don't appear there; there is no backfill.
- `act()` returns whether the state changed, so a retried request never notifies twice.

The global SocialGraphModule owns graph reads/writes, including block lookups used by Nutrition.
SocialModule orchestrates profiles and explicit shared responses; it never queries another
module's tracking collections directly.

A friend's profile shows **Message** with the `messages` feature ([messages](messages.md)).
`SocialService.authors()` gives Messages public identities in one query.

SocialService registers the `friendRequest` and `friendAccepted` notification types and the
Activity source for incoming requests and accepted requests
([notifications](notifications.md)). It sends after a state-changing `request` or `accept`.

## API

All under `/api/social`, with `Cache-Control: private, no-store`:
- GET/PUT `/me`: own profile/create-on-first-read or validated identity update.
- GET `/me?preview=friend|stranger`: owner-only audience preview.
- PUT `/me/avatar` `{mediaId}` / DELETE `/me/avatar`: set or remove the profile photo. Needs
  `postMedia` and configured storage, the same as any upload.
- Your own profile (from `/me` or `/profiles/<your id>`) also carries `friendCount`. Other
  people's counts are never returned.
- GET `/profiles/:userId`: audience-checked profile. Preview parameters cannot elevate a viewer.
- GET `/search?q=&skip=`: literal escaped name/username search, minimum two characters.
- GET `/connections?kind=friends|incoming|outgoing|blocked&skip=`: private connection lists.
- PUT `/connections/:userId` `{action}`: request/accept/decline/cancel/unfriend/block/unblock/mute/unmute.
- GET `/requests/count`: visible incoming requests in the first page, plus `more` for 20+.

Lists paginate in stable order, 20 results per page (plus one lookahead). Disabled/deleted social
accounts and either-direction blocks are omitted from discovery and normal relationship lists.
Own blocks remain removable from the blocked list when the target disables social.

## Shared widgets

The shared-widget reader returns only module, title, audience and at most three formatted stats.
No owner dashboard payload, alerts, quick actions, private links, record IDs, notes or raw summaries.

Every read intersects the owner's selected modules, both accounts' feature access and the
owner's explicit module audience. Missing audiences are private. Friends means an accepted,
unblocked mutual connection. The developer has no privacy bypass. EPAM is never shareable.
Own About uses the same filtered shared projections; private widgets remain on Home.

Cards follow Home order, skipping private/disallowed/empty cards. Friends shows the first two
actually readable cards; About shows all readable cards. Counts for Projects exclude EPAM.

Nutrition's `sharedStats()` owns the finer-grained projection. Meals, targets and weight are
independently opt-in; no switches enabled means no Food card. Weight excludes future records.
Enabling one category does not reveal another. Food database publishing is independent of diary
sharing, but either-direction blocking also removes foods from browse/count/import endpoints.
Already imported independent food copies remain the recipient's data.

Social browser reads include an explicit browser-local nutrition day and poll visible pages
periodically, revalidating on focus. Every API read checks current flags/relationships/privacy;
privacy changes cannot erase information already seen, but later reads return only current access.

## UI

Social-enabled accounts get Home/Messages/Search/**Profile**: the last tab is your own profile,
and its ☰ button opens Menu (Menu stays the last tab for accounts without social). Your own
profile is one page however you reach it: `/people/<your id>` (your name on a post, a shared link)
redirects to `/profile`, and `ProfileView` decides "own" from the signed-in user, never from the
route. The friend-request badge sits on the Profile tab, the ☰ button and the friends count.

The profile header carries its actions as icons on a gradient band (no cover photo): your own has
View as (friend/stranger preview, with a banner while previewing), Share (the share sheet, or the
link copied), Edit and Menu; someone else's has "…" with Mute, Unfriend, Cancel request and Block
(the last two confirm first). Only the main action gets a button row: Add friend, Accept/Decline,
Message, Unblock. Tapping your own photo changes or removes it. Friends includes Requests, Sent
and Blocked. Privacy settings link to the preview and to Food's meal/target/weight controls.

## Wall and profile posts (007)

Profiles now have Posts and About tabs when social + nutrition + foodPosts are enabled. [PostsModule](posts.md) owns explicit food publications and imports. `SocialGraphService.wallAuthorIds` returns accepted, unblocked, unmuted friends; direct post reads still evaluate current audience and graph permissions. Muting affects Wall rather than profile access. Public post authors use the same allowlisted profile projection, never Auth user records.
