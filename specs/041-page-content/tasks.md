# Tasks: Page content and the assistant for pages

## Slice 1: library screens and attachments
- [x] T001 Web: a page's Food tab is its library (foods, recipes): list, create, edit, delete.
- [x] T002 Web: a page's Training tab is its library (exercises, plans): list, create, edit, delete.
- [x] T003 Composer: a page attaches a food selection or a training plan; preview routes open to pages.
- [x] T004 Integration test: page creates a food and a plan, posts each, a person saves and copies.
- [x] T005 Docs: pages.md, posts.md, changelog; close T040 in specs/040-pages/tasks.md.

## Slice 2: connector for pages
- [x] T010 Consent: a switch on the account plus the page's "run with AI" mark; acting check (FR-010). A `pages` OAuth scope on the grant is not built (see Open).
- [x] T011 Tools: list_pages, create_page (run with AI), update_page.
- [x] T012 Tools: page library (foods, recipes, exercises, plans).
- [x] T013 Tools: create_post, save_draft, publish_draft, update_post, delete_post, list_page_posts.
- [x] T014 Tools: get_for_you, get_following, get_post, get_comments, get_page_profile, suggested_pages.
- [x] T015 Privacy policy and docs/modules/mcp.md; LEGAL_VERSION.

## Slice 3: engaging, caps, log
- [x] T020 Domain: caps (defaults, override, none), the same-manager rule; tests.
- [x] T021 `page_assistant_actions` log and daily counts; in ACCOUNT_PLAN.
- [x] T022 Tools: follow, unfollow, like, unlike, comment, reply_message.
- [x] T023 People screen: caps per person; defaults for everyone.
- [x] T024 Web: "What the assistant did" on a page, for its managers.

## Slice 4: disabling a page
- [x] T030 `users.disabledAt` for a page; hidden everywhere; enable/delete in the app; tool disable_page.

## Slice 5: recipes and meal plans
- [ ] T040 Recipe steps and photo on a saved meal.
- [ ] T041 Meal plans: module, publication snapshot, copy; for people and pages.

## Slice 6: programmes, collections, profile
- [ ] T050 A post carrying food and training together.
- [ ] T051 Collections. T052 Pinned post, link and contact.

## Slice 7: photos and insights
- [x] T060 Photos through the connector: upload link, server-side check and clean, `mediaIds` on posts. (The hand-stocked shelf was dropped in favour of this.)
- [ ] T062 Video through the same flow.
- [ ] T061 Insights: followers over time, saves and copies per item.

## Later (on the roadmap)
- Co-managers. Verification of real businesses. Challenges. Images from a web address.

## Open

- The pages consent is one switch on the account, shared by every assistant connection the
  person made. A separate OAuth scope chosen per connection is stricter and not built.
- Photo upload needs an assistant that can send an HTTP PUT with a file and reach the storage host; not verified with ChatGPT or Claude yet.
- `update_page_post` cannot change a post's photos.
- `create_page_plan` covers workouts, exercises and planned sets; supersets and edits to an
  existing plan are not offered.
- Caps reset at midnight UTC, not the person's midnight.
