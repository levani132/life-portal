# Portal setup and feature access

Status: Implemented. First milestone of the approved social portal roadmap.

New production accounts see Food only, with a resumable setup for module selection,
privacy and Home order. Existing accounts keep general module availability and receive
an invitation to review setup; data and existing card order survive. EPAM is developer-only.
Developer identity is an explicit server-configured user ID, never the legacy owner role.

Acceptance:
- Availability, selection and visibility are independent. Disabled modules retain their data.
- Production defaults to Food; internal accounts get general modules; the developer gets all.
- API requests enforce current account flags, including alternate ingest/MCP credentials.
- Home requests only selected, available summaries, with one Money card and no financial
  headline for Food-only accounts. Projects use one overview card; EPAM stays separate.
- Setup persists each completed step, supports skip/resume, and can be revisited from Menu.
- Privacy defaults to private. Legacy food/profile sharing is reset once, without deleting data.
- Privacy choices are stored for future social views; this milestone exposes no social views.
- Menu provides modules, privacy, settings, integrations and sign-out. Social tabs arrive later.
- Developer can manage cohorts and per-user feature overrides; ordinary users cannot escalate.

Deferred: profiles, friendships, social feeds, publishing and bulk food import.
