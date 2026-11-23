# Feature Specification: Page content and the assistant for pages

**Feature**: `041-page-content` · **Created**: 2026-11-23 · **Status**: In progress
**Builds on**: spec 040 (pages), spec 036 (training sharing), spec 007 (food posts), `docs/modules/mcp.md`

## Why

A page exists to publish. Today it can post text, photos and video. It should publish the things
people come to the app for: foods, recipes, meal plans, training plans, and programmes that
combine eating and training. And its manager should be able to run it through an AI assistant
(the connector), openly marked as run with AI.

## Decisions (owner, 2026-11-23)

1. **The assistant may act only as a page marked "Run with AI".** A page created through the
   assistant is marked so from the start. Switching the mark off ends the assistant's access to
   that page.
2. **A separate consent.** Linking an assistant for one's own food does not give it pages.
   Acting as pages is its own permission, chosen per page.
3. **Limits and a log.** Daily caps per page on what the assistant may do (posts, comments,
   likes, follows, messages). The owner sets the defaults and may change or lift them for a
   person; the owner's own account has none. Every assistant action on a page is listed for its
   managers.
4. **No approval step.** What a manager asks the assistant to publish is published. The
   assistant can also save a draft and publish it later when asked.
5. **Photos.** See "Photos through the assistant" below.
6. **The assistant may disable a page, not delete it.** A disabled page is hidden everywhere and
   keeps everything; its manager enables it again or deletes it in the app. Disabling is also
   offered to managers in the app.
7. **Insights** for a page's managers: followers over time, and how often each food, recipe or
   plan was saved or copied.
8. **Later, tracked on the roadmap:** co-managers, verification of real businesses.

9. **One person's pages may engage with each other**, by hand or through the assistant: like,
   follow, comment, message. (First built as a refusal, "never a crowd"; removed the same day on
   the owner's decision.) What stays from spec 040: a page is always shown as a page, and as run
   with AI when it is, so none of it is presented as a person.

## What a page can publish

| Content | Notes |
|---|---|
| Foods | The page's own database; anyone can save one. A page may have a brand. |
| Recipes | A saved meal with ingredients, plus steps and a photo. |
| Meal plans | Days of meals with targets. New for people too. Copied, never logged for anyone. |
| Exercises and training plans | As people share them today (spec 036). |
| Programmes | A meal plan and a training plan in one post. |
| Collections | A named, ordered set of the page's posts. |
| Pinned post, link and contact | On the profile. |
| Challenges | Later; builds on tournaments. |

Content a page publishes is presented as something to save, never as something the page ate or
did (spec 040, FR-024).

## Photos through the assistant

An assistant cannot hold a camera, and most cannot upload a file to a signed link. Three ways,
in the order they will be built:

1. **The page's photo shelf.** A manager uploads photos to the page in the app (the normal
   upload: re-encoded in the browser, checked like any photo). The assistant lists the shelf and
   attaches a photo by id. Nothing new reaches the server by a new road.
2. **A food's or recipe's own photo** is used automatically when the post attaches it.
3. **A web address of an image** the assistant gives, fetched by the server: only if the first
   two are not enough. It needs strict limits (https only, public addresses only, size and type
   checked, re-encoded, moderation check before it is shown) and a line in the privacy policy.
   Not built until asked for.

## Slices

1. **Library screens** for a page (foods, recipes, exercises, training plans) and attaching food
   or a training plan to a page's post.
2. **Connector for pages**: the consent, page tools (list, create, edit, disable), library
   tools, post tools (create, draft, publish, edit, delete), reading (For You, Following, a
   post, comments, a profile, suggested pages).
3. **Engaging through the connector** (follow, like, comment, reply to messages) with the caps,
   the same-manager rule, the owner's limit settings and the activity log.
4. **Disabling a page** in the app and through the connector.
5. **Recipes with steps, then meal plans.**
6. **Programmes, collections, pinned post, link and contact.**
7. **Photo shelf. Insights.**

## Requirements

- **FR-001** A page's manager, acting as the page, can list, create, edit and delete the page's
  foods, recipes, exercises and training plans.
- **FR-002** A page's post can carry a food selection or a training plan, built by the same
  snapshot services as a person's, and savable or copyable by a viewer.
- **FR-003** No route that logs food, a workout or weight opens to a page.
- **FR-010** The connector acts as a page only when: the token holds the pages consent for that
  page, the person still manages it, the page is marked run with AI, and it is neither suspended
  nor disabled.
- **FR-011** A page created through the connector is marked run with AI and counts toward the
  person's page limit.
- **FR-012** The connector can disable a page and cannot delete one.
- **FR-013** Each connector action on a page is counted against that page's daily cap for its
  kind and recorded with its time, kind and target. A capped action is refused with a reason the
  assistant can relay.
- **FR-014** Caps have defaults the owner can change, a per-person override (a number or none),
  and do not apply to the owner's own account.
- **FR-015** (withdrawn 2026-11-23) The connector does not treat pages of the same manager
  differently from any other.
- **FR-016** Posts and comments made through the connector go through the same moderation as
  any other.
- **FR-020** A disabled page: cannot be acted as (in the app only to enable or delete it), is
  not found by anyone else, its posts are unreadable, it is not suggested, and nothing is
  deleted.

## Out of scope for now

Co-managers, verification, challenges, an approval queue, fetching images from web addresses.
