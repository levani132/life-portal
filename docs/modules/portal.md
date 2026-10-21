# Portal: access, setup and Home preferences

Portal setup and feature access. Module audiences now govern shared profile widgets; explicit
food publishing remains separate. See [social.md](social.md) for profiles and connections.

## Availability

`AccessModule` is global. `users.cohort` is `production` or `internal`; registrations explicitly
write production. Missing legacy cohorts resolve as internal. The only developer is the exact
account ID in server `DEVELOPER_USER_ID`, independent of legacy `roles: ['owner']`.
The developer always has all modules; EPAM is denied to every other account regardless of override.

Production defaults to Food; internal defaults to all general modules. The `feature_policies`
collection stores cohort overrides because releases need changing without a deploy. User
`featureOverrides` take precedence over cohort policy; explicit false is meaningful.
There is no public writer for cohort, overrides or developer identity.

Developer-only `GET /api/access/users` (up to 200 names/IDs) and `PUT /api/access/users/:id`
manage user cohorts/overrides. GET/PUT `/api/access/users/policies` manage cohort defaults.
Override writes replace the object; `{}` restores defaults. DTOs reject unknown flags.
Menu → Feature access is the UI. Access checks read current policy, rather than stale JWT roles.

`@RequireModule` and a global guard protect module API controllers. Bank ingest validates
Money availability after token verification. Both MCP transports validate Food availability.
Board resolution, listing and direct child mutation checks protect EPAM even by Mongo ID.
Selection is a Home preference: it does not revoke API access to an available module.

## Preferences and setup

`GET /api/portal` combines access and settings. `PUT /api/portal` accepts only:
`selectedModules`, `moduleVisibility`, `widgetOrder`, `setupStep` (0–3), `setupCompleted`,
`setupDismissed`. Module/audience IDs and order are bounded and validated. EPAM stays private.
The first Portal read freezes the initial available-module selection, so a later flag release
does not automatically add modules to Home. Unavailable modules cannot be newly selected. Previously selected unavailable modules remain
stored, so restoring access restores the user's choice; module data is never deleted.

Settings fields:
- `selectedModules`: absent means all currently available modules; `[]` is intentionally empty.
- `moduleVisibility`: per-module private/friends/public, missing values always private.
- `setupStep`, `setupCompleted`, `setupDismissed`: independently persisted for resume and skip.

Setup has modules, privacy, order and a first-action step. New production accounts are offered
setup before Home; existing accounts see a review invitation and can keep working. Finish later
saves progress and allows Home. Completed users can revisit setup without resetting history.
Menu always links module management, privacy, setup and settings.

## Dashboard

The dashboard intersects selection with availability *before* invoking summary services.
It sends only selected summaries. Money combines cashflow and spending into one card with the
old `cashflow` card ID; services keep ownership of their own data. Projects produce one overview
card and an overview route, while EPAM gets its own card only for the developer.
No finance/FX summary requests run for Food-only Home. Net position is omitted unless all four
contributing finance modules are selected, avoiding a partial number labelled as net position.
Alerts are built only from the summaries that were loaded.

Home/Menu remain the production default. Social-enabled users also get Search and Friends;
Wall will be added with publishing. The floating rearrangement bar sits above navigation and safe-area space.

The independent `social` feature is stored in the same cohort/user policies, defaults off for
production and on for internal/developer, and never appears in selectedModules.

## Food posts flag (007)

`foodPosts` is a separate feature switch alongside `social`; publishing and reads additionally require `nutrition`. It defaults off for production and on for internal/developer accounts. Wall is the fourth tab when all three are enabled. Turning any dependency off revokes server access to that user's posts and import actions; widget selection/visibility does not automatically publish or withdraw intentional snapshots. See [food posts](posts.md).
